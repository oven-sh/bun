use serde::{Serialize, Serializer};
use tokio_postgres::types::{FromSql, Type};

/// A moment, in microseconds since 1970. JSON spells it as JavaScript's Date does: 2026-10-16T13:45:00.000Z.
#[derive(Clone, Copy)]
pub struct Timestamp(pub i64);

impl<'a> FromSql<'a> for Timestamp {
    fn from_sql(_: &Type, raw: &'a [u8]) -> Result<Self, Box<dyn std::error::Error + Sync + Send>> {
        const FROM_1970_TO_2000: i64 = 946_684_800_000_000;
        Ok(Timestamp(i64::from_be_bytes(raw.try_into()?) + FROM_1970_TO_2000))
    }

    fn accepts(ty: &Type) -> bool {
        *ty == Type::TIMESTAMPTZ
    }
}

impl Serialize for Timestamp {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut text = String::with_capacity(24);
        crate::format::push_iso(&mut text, *self);
        serializer.serialize_str(&text)
    }
}

#[derive(Serialize, Clone)]
pub struct UserRef {
    pub login: String,
    pub name: String,
}

#[derive(Serialize)]
pub struct Project {
    pub id: i32,
    pub slug: String,
    pub name: String,
    pub description: String,
}

#[derive(Serialize)]
pub struct Label {
    pub id: i32,
    pub name: String,
    pub color: String,
}

pub struct LabelCount {
    pub label: Label,
    pub open_issues: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueSummary {
    pub id: i32,
    pub number: i32,
    pub title: String,
    pub state: String,
    pub priority: i32,
    pub comment_count: i32,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub author: UserRef,
    pub assignee: Option<UserRef>,
    pub labels: Vec<Label>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub id: i32,
    pub number: i32,
    pub title: String,
    pub state: String,
    pub priority: i32,
    pub comment_count: i32,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub author: UserRef,
    pub assignee: Option<UserRef>,
    pub labels: Vec<Label>,
    pub body: String,
    pub closed_at: Option<Timestamp>,
}

/// A comment and the replies to it. As the database hands it over it has none yet.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: i32,
    pub parent_id: Option<i32>,
    pub author: UserRef,
    pub body: String,
    pub created_at: Timestamp,
    pub edited_at: Option<Timestamp>,
    pub replies: Vec<Comment>,
}

#[derive(Serialize)]
pub struct Participant {
    pub login: String,
    pub name: String,
    pub comments: usize,
}

#[derive(Default)]
pub struct StateCounts {
    pub open: i32,
    pub closed: i32,
}

impl StateCounts {
    pub fn of(&self, state: &str) -> i32 {
        if state == "closed" {
            self.closed
        } else {
            self.open
        }
    }
}

pub struct SessionUser {
    pub id: i32,
    pub login: String,
    pub name: String,
    pub role: String,
}

pub struct Session {
    pub token: String,
    pub csrf_token: String,
    pub flash: Option<String>,
    pub user: SessionUser,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: i32,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub open_issues: i32,
    pub closed_issues: i32,
}

#[derive(Serialize)]
pub struct ProjectRef {
    pub slug: String,
    pub name: String,
}

/// An issue as it is shown outside the pages of its project.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueMention {
    pub project: ProjectRef,
    pub number: i32,
    pub title: String,
    pub state: String,
    pub created_at: Timestamp,
    pub author: UserRef,
}

pub struct SearchHit {
    pub issue: IssueMention,
    pub body: String,
    pub comment_count: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: i32,
    pub login: String,
    pub name: String,
    pub bio: String,
    pub role: String,
    pub created_at: Timestamp,
}

#[derive(Serialize)]
pub struct IssueRef {
    pub number: i32,
    pub title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentMention {
    pub id: i32,
    pub project: ProjectRef,
    pub issue: IssueRef,
    pub body: String,
    pub created_at: Timestamp,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub user: User,
    pub issue_count: i32,
    pub comment_count: i32,
    pub issues: Vec<IssueMention>,
    pub comments: Vec<CommentMention>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub users: i32,
    pub projects: i32,
    pub open_issues: i32,
    pub closed_issues: i32,
    pub comments: i32,
}

#[derive(Serialize)]
pub struct MonthCount {
    pub month: String,
    pub opened: i32,
    pub closed: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PriorityCount {
    pub priority: i32,
    pub open: i32,
    pub minutes_to_close: i32,
}

#[derive(Serialize)]
pub struct Commenter {
    pub login: String,
    pub name: String,
    pub comments: i32,
}

#[derive(Serialize)]
pub struct BusyProject {
    pub slug: String,
    pub name: String,
    pub comments: i32,
}

#[derive(Serialize)]
pub struct AdminStats {
    pub totals: Totals,
    pub months: Vec<MonthCount>,
    pub priorities: Vec<PriorityCount>,
    pub commenters: Vec<Commenter>,
    pub busiest: Vec<BusyProject>,
}
