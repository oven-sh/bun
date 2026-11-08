// The same as main.ts, on the modules of ../rivals/rust.
#![allow(dead_code)]
#[path = "../rivals/rust/src/excerpt.rs"]
mod excerpt;
#[path = "../rivals/rust/src/filters.rs"]
mod filters;
#[path = "../rivals/rust/src/format.rs"]
mod format;
#[path = "../rivals/rust/src/markdown.rs"]
mod markdown;
#[path = "../rivals/rust/src/queries.rs"]
mod queries;
#[path = "../rivals/rust/src/thread.rs"]
mod thread;
#[path = "../rivals/rust/src/types.rs"]
mod types;
#[path = "../rivals/rust/src/views.rs"]
mod views;

use serde::Serialize;
use types::*;

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

pub struct Failure(String);

impl<E: std::fmt::Display> From<E> for Failure {
    fn from(error: E) -> Self {
        Failure(error.to_string())
    }
}

/// Fetches one issue's comments, one query per round.
async fn rows(issue_id: i32, rounds: usize) -> Result<usize, Failure> {
    use deadpool_postgres::{Manager, ManagerConfig, Pool, RecyclingMethod};
    let config: tokio_postgres::Config = std::env::var("DATABASE_URL")?.parse()?;
    let manager = Manager::from_config(config, tokio_postgres::NoTls, ManagerConfig { recycling_method: RecyclingMethod::Fast });
    let client = Pool::builder(manager).max_size(1).build()?.get().await?;
    let mut count = 0;
    for _ in 0..rounds {
        count = queries::comments_of(&client, issue_id).await?.len();
    }
    Ok(count)
}

struct Loaded {
    project: Project,
    issue: Issue,
    comments: Vec<Comment>,
}

fn number(text: &str) -> i32 {
    text.parse().unwrap_or(0)
}

fn moment(text: &str) -> Timestamp {
    Timestamp(text.parse::<i64>().unwrap_or(0) * 1000)
}

fn optional_moment(text: &str) -> Option<Timestamp> {
    (!text.is_empty()).then(|| moment(text))
}

fn load(text: &str) -> Vec<Loaded> {
    text.trim_end_matches('\n')
        .split('\x1d')
        .map(|block| {
            let records: Vec<&str> = block.split('\x1e').collect();
            let f: Vec<&str> = records[0].split('\x1f').collect();
            let l: Vec<&str> = if records[1].is_empty() { Vec::new() } else { records[1].split('\x1f').collect() };
            Loaded {
                project: Project { id: number(f[0]), slug: f[1].into(), name: f[2].into(), description: f[3].into() },
                issue: Issue {
                    id: number(f[4]),
                    number: number(f[5]),
                    title: f[6].into(),
                    state: f[7].into(),
                    priority: number(f[8]),
                    comment_count: number(f[9]),
                    created_at: moment(f[10]),
                    updated_at: moment(f[11]),
                    author: UserRef { login: f[12].into(), name: f[13].into() },
                    assignee: (!f[14].is_empty()).then(|| UserRef { login: f[14].into(), name: f[15].into() }),
                    labels: l.chunks_exact(3).map(|label| Label { id: number(label[0]), name: label[1].into(), color: label[2].into() }).collect(),
                    body: f[17].into(),
                    closed_at: optional_moment(f[16]),
                },
                comments: records[2..].iter().map(|record| comment_of(&record.split('\x1f').collect::<Vec<&str>>())).collect(),
            }
        })
        .collect()
}

fn comment_of(c: &[&str]) -> Comment {
    Comment {
        id: number(c[0]),
        parent_id: (!c[1].is_empty()).then(|| number(c[1])),
        author: UserRef { login: c[2].into(), name: c[3].into() },
        body: c[6].into(),
        created_at: moment(c[4]),
        edited_at: optional_moment(c[5]),
        replies: Vec::new(),
    }
}

// The server gets its comments fresh from the database with every request and may take them apart. Here they are copied first.
fn copies(comments: &[Comment]) -> Vec<Comment> {
    comments
        .iter()
        .map(|c| Comment { id: c.id, parent_id: c.parent_id, author: c.author.clone(), body: c.body.clone(), created_at: c.created_at, edited_at: c.edited_at, replies: Vec::new() })
        .collect()
}

#[derive(Serialize)]
struct IssueAnswer<'a> {
    project: &'a Project,
    issue: &'a Issue,
    participants: &'a [Participant],
    comments: &'a [Comment],
}

fn main() {
    let arguments: Vec<String> = std::env::args().collect();
    if arguments[1] == "rows" {
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let count = runtime.block_on(rows(number(&arguments[2]), arguments[3].parse().unwrap())).unwrap_or_else(|failure| panic!("{}", failure.0));
        println!("rows {count}");
        return;
    }
    let all = load(&std::fs::read_to_string(&arguments[2]).unwrap());
    let session = Session {
        token: "t".repeat(64),
        csrf_token: "c".repeat(32),
        flash: None,
        user: SessionUser { id: 7, login: "tomas-ali-7".into(), name: "Tomás Ali".into(), role: "member".into() },
    };
    let piece = |l: &Loaded| -> usize {
        match arguments[1].as_str() {
            "page" => {
                let participants = thread::participants_of(&l.comments);
                let tree = thread::build_thread(copies(&l.comments));
                let title = format!("{} · Issue #{}", l.issue.title, l.issue.number);
                views::layout(&title, Some(&session), "", |out| views::issue_page_view(out, &l.project, &l.issue, &tree, &participants, Some(&session), None)).len()
            }
            "json" => {
                let participants = thread::participants_of(&l.comments);
                let tree = thread::build_thread(copies(&l.comments));
                serde_json::to_vec(&IssueAnswer { project: &l.project, issue: &l.issue, participants: &participants, comments: &tree }).unwrap().len()
            }
            "thread" => thread::participants_of(&l.comments).len() + thread::build_thread(copies(&l.comments)).len(),
            "markdown" => {
                let mut out = String::with_capacity(16 * 1024);
                markdown::render_markdown(&mut out, &l.issue.body, &l.project.slug);
                for comment in &l.comments {
                    markdown::render_markdown(&mut out, &comment.body, &l.project.slug);
                }
                out.len()
            }
            "dates" => {
                let mut out = String::with_capacity(4 * 1024);
                for comment in &l.comments {
                    format::push_time_tag(&mut out, comment.created_at, format::push_minute);
                }
                out.len()
            }
            "escape" => {
                let mut n = 0;
                for comment in &l.comments {
                    let mut out = String::new();
                    format::escape(&mut out, &comment.body);
                    n += out.len();
                    out.clear();
                    format::escape(&mut out, &comment.author.name);
                    n += out.encode_utf16().count();
                }
                n
            }
            other => panic!("There is no piece {other}"),
        }
    };
    let mut total = 0;
    for _ in 0..arguments[3].parse::<usize>().unwrap() {
        total = all.iter().map(piece).sum();
    }
    println!("{} {}", arguments[1], total);
}
