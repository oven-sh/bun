// The SQLite adapter of Bun.sql creates plain objects. A callback called with rows of sql<Row[]> converts a plain row that matches Row in place at its entry and runs its typed body; a row that does not match runs the untyped clone.
import { SQL } from "bun";

interface Row {
  id: number;
  parentId: number | null;
  body: string;
  login: string;
}
interface Author {
  login: string;
}
interface Comment {
  id: number;
  parentId: number | null;
  author: Author;
  body: string;
}
interface CommentNode extends Comment {
  replies: CommentNode[];
}

const db = new SQL("sqlite://:memory:");
await db`CREATE TABLE comments (id INTEGER PRIMARY KEY, parentId INTEGER, body, login TEXT)`;
await db`INSERT INTO comments VALUES (1, NULL, 'first', 'ann'), (2, 1, '', 'bob'), (3, 1, 'naïve — 日本語', 'ann')`;
await db`CREATE TABLE mismatches (id INTEGER PRIMARY KEY, parentId INTEGER, body, login TEXT)`;
await db`INSERT INTO mismatches VALUES (1, NULL, 'matches', 'ann'), (2, 1, 7, 'bob'), (3, 1, 'no login', NULL)`;

async function commentsOf(): Promise<Comment[]> {
  const rows = await db<Row[]>`SELECT id, parentId, body, login FROM comments ORDER BY id`;
  return rows.map(row => ({ id: row.id, parentId: row.parentId, author: { login: row.login }, body: row.body }));
}

function describe(comments: Comment[]): string {
  let text = "";
  for (const comment of comments) {
    const node: CommentNode = { ...comment, replies: [] };
    text += `${node.id}:${node.parentId}:${node.author.login}:${node.body.length}:${node.replies.length} `;
  }
  return text;
}
console.log(describe(await commentsOf()));

async function inspectMismatches(): Promise<void> {
  const rows = await db<Row[]>`SELECT id, parentId, body, login FROM mismatches ORDER BY id`;
  console.log(rows.map(row => `${row.id}${typeof row.body}${typeof row.login}`).join(), JSON.stringify(rows), Object.keys(rows[0]!).join());
}
await inspectMismatches();

await db.close();
Bun.gc(true);
