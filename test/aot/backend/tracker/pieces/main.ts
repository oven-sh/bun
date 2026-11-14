// Parts of the tracker without a socket and without a database: what one request computes, over and over.
//
//   main.ts <page | json | thread | markdown | dates | escape> <issues.txt> <rounds>
//   main.ts rows <issue id> <rounds>             uses the database ($DATABASE_URL): fetches that issue's comments, one query per round
//
// A round goes once through the twenty issues of issues.txt (export.sql makes it). The last line says how many bytes a round made,
// which must be the same in main.go and main.rs.
import { formatMinute, timeTag } from "../app/format";
import { renderMarkdown } from "../app/markdown";
import { buildThread, participantsOf } from "../app/thread";
import type { Comment, Issue, Label, Project, Session } from "../app/types";
import { issuePageView } from "../app/views/issue-page";
import { layout } from "../app/views/layout";

interface Loaded {
  project: Project;
  issue: Issue;
  comments: Comment[];
}

function moment(text: string): Date | null {
  return text === "" ? null : new Date(Number(text));
}

// Every field becomes a string of its own, as a driver makes them: one that is all ASCII takes a byte a character.
function fields(record: string): string[] {
  return record.split("\x1f").map(field => new TextDecoder().decode(new TextEncoder().encode(field)));
}

function load(text: string): Loaded[] {
  return text
    .trimEnd()
    .split("\x1d")
    .map(block => {
      const [first = "", second = "", ...rest] = block.split("\x1e");
      const f = fields(first);
      const l = second === "" ? [] : fields(second);
      const labels: Label[] = [];
      for (let k = 0; k + 2 < l.length; k += 3) labels.push({ id: Number(l[k]), name: l[k + 1]!, color: l[k + 2]! });
      return {
        project: { id: Number(f[0]), slug: f[1]!, name: f[2]!, description: f[3]! },
        issue: {
          id: Number(f[4]),
          number: Number(f[5]),
          title: f[6]!,
          state: f[7] === "closed" ? "closed" : "open",
          priority: Number(f[8]),
          commentCount: Number(f[9]),
          createdAt: new Date(Number(f[10])),
          updatedAt: new Date(Number(f[11])),
          author: { login: f[12]!, name: f[13]! },
          assignee: f[14] === "" ? null : { login: f[14]!, name: f[15]! },
          labels,
          body: f[17]!,
          closedAt: moment(f[16]!),
        },
        comments: rest.map(record => {
          const c = fields(record);
          return {
            id: Number(c[0]),
            parentId: c[1] === "" ? null : Number(c[1]),
            author: { login: c[2]!, name: c[3]! },
            body: c[6]!,
            createdAt: new Date(Number(c[4])),
            editedAt: moment(c[5]!),
          };
        }),
      };
    });
}

const session: Session = {
  token: "t".repeat(64),
  csrfToken: "c".repeat(32),
  flash: null,
  user: { id: 7, login: "tomas-ali-7", name: "Tomás Ali", role: "member" },
};

const encoder = new TextEncoder();

const pieces: Record<string, (loaded: Loaded) => number> = {
  page({ project, issue, comments }) {
    const html = layout({
      title: `${issue.title} · Issue #${issue.number}`,
      session,
      content: issuePageView(project, issue, buildThread(comments), participantsOf(comments), session, null),
    });
    return encoder.encode(html).length;
  },
  json({ project, issue, comments }) {
    return encoder.encode(JSON.stringify({ project, issue, participants: participantsOf(comments), comments: buildThread(comments) })).length;
  },
  thread({ comments }) {
    return buildThread(comments).length + participantsOf(comments).length;
  },
  markdown({ project, issue, comments }) {
    let bytes = encoder.encode(renderMarkdown(issue.body, project.slug)).length;
    for (const comment of comments) bytes += encoder.encode(renderMarkdown(comment.body, project.slug)).length;
    return bytes;
  },
  dates({ comments }) {
    let bytes = 0;
    for (const comment of comments) bytes += timeTag(comment.createdAt, formatMinute(comment.createdAt)).length;
    return bytes;
  },
  escape({ comments }) {
    let bytes = 0;
    for (const comment of comments) bytes += encoder.encode(Bun.escapeHTML(comment.body)).length + Bun.escapeHTML(comment.author.name).length;
    return bytes;
  },
};

const [name = "", file = "", rounds = "1"] = process.argv.slice(2);
if (name === "rows") {
  const { commentsOf } = await import("../app/queries/issues");
  let rows = 0;
  for (let round = Number(rounds); round > 0; round--) rows = (await commentsOf(Number(file))).length;
  console.log(name, rows);
  process.exit(0);
}
const piece = pieces[name];
if (!piece) throw new Error(`There is no piece ${name}`);
const loaded = load(await Bun.file(file).text());
let bytes = 0;
for (let round = Number(rounds); round > 0; round--) {
  bytes = 0;
  for (const one of loaded) bytes += piece(one);
}
console.log(name, bytes);
