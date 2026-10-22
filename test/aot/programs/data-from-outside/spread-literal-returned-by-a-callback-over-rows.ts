// `rows.map(row => ({ ...mentionOf(row), body: row.body }))` over rows of sql<Row[]>, where Hit[] is expected: the literal is copied as a Hit. It was born with an anonymous layout of its own and converted at the first place that wants a Hit.
// IR+ ^layout (L\d+) .*name="Hit" [\s\S]* = CloneAs v\d+, v\d+ \(.*\) layout=\1\b
// IR+ ^layout (L\d+) .*name="Marked" [\s\S]* = CloneAs v\d+, v\d+ \(.*\) layout=\1\b
// IR+ ^layout (L\d+) .*name="Numbered" [\s\S]* = CloneAs v\d+, v\d+ \(.*\) layout=\1\b
import { SQL } from "bun";

type State = "open" | "closed";
interface Row {
  id: number;
  title: string;
  state: State;
  login: string;
  body: string;
}
interface Author {
  login: string;
}
interface Mention {
  id: number;
  title: string;
  state: State;
  author: Author;
}
interface Hit extends Mention {
  body: string;
  words: number;
}
interface Marked extends Row {
  mark: number;
}
interface Numbered extends Row {
  position: number;
}

const db = new SQL("sqlite://:memory:");
await db`CREATE TABLE issues (id INTEGER PRIMARY KEY, title TEXT, state TEXT, login, body TEXT)`;
await db`INSERT INTO issues VALUES (1, 'first', 'open', 'ann', 'one two three'), (2, 'second', 'closed', 'bob', ''), (3, 'naïve — 日本語', 'open', 'ann', 'four five')`;

function mentionOf(row: Row): Mention {
  return { id: row.id, title: row.title, state: row.state, author: { login: row.login } };
}

async function hits(): Promise<Hit[]> {
  const rows = await db<Row[]>`SELECT id, title, state, login, body FROM issues ORDER BY id`;
  return rows.map(row => ({ ...mentionOf(row), body: row.body, words: row.body.split(" ").length }));
}

async function marked(): Promise<Marked[]> {
  const rows = await db<Row[]>`SELECT id, title, state, login, body FROM issues ORDER BY id`;
  return rows.map(row => ({ ...row, mark: row.id * 2 }));
}

async function numbered(): Promise<Numbered[]> {
  const rows = await db<Row[]>`SELECT id, title, state, login, body FROM issues ORDER BY id`;
  return rows.map(row => ({ position: row.id - 1, ...row }));
}

function withoutBody(found: Hit[]): string {
  return JSON.stringify(found.map(({ body, ...hit }) => ({ ...hit, summary: body.slice(0, 7) })));
}

function describe(found: Hit[]): string {
  let text = "";
  for (const hit of found) text += `${hit.id}:${hit.title}:${hit.state}:${hit.author.login}:${hit.body.length}:${hit.words} `;
  return text;
}

const found = await hits();
console.log(describe(found), Object.keys(found[0]!).join(), JSON.stringify(found));
console.log(withoutBody(found));
const all = await marked();
console.log(Object.keys(all[0]!).join(), JSON.stringify(all), all[2]!.mark + all[1]!.id);
const inOrder = await numbered();
console.log(Object.keys(inOrder[0]!).join(), JSON.stringify(inOrder), inOrder[2]!.position);

await db.close();
