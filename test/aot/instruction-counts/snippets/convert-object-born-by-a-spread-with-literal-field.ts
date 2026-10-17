// builds objects with a spread of a typed record and two more properties in a callback whose result has no declared type, so each is born plain with two properties out of line and is then copied into its record type, which has a field that is a union of string literals
type State = "open" | "closed";
interface Row { id: number; title: string; state: State; login: string; body: string }
interface Mention { id: number; title: string; state: State; author: { login: string } }
interface Hit extends Mention { body: string; words: number }
const operations = 100;
const all: Row[] = [];
for (let i = 0; i < operations; i++) all.push({ id: i, title: "title", state: i & 1 ? "open" : "closed", login: "u", body: "a body" });
const mentionOf = (row: Row): Mention => ({ id: row.id, title: row.title, state: row.state, author: { login: row.login } });
const hits = async (): Promise<Hit[]> => {
  const rows = await Promise.resolve(all);
  return rows.map(row => ({ ...mentionOf(row), body: row.body, words: row.body.length }));
};
let total = (await hits()).length;

kernel: {
  total += (await hits()).length;
}

console.log(total);
