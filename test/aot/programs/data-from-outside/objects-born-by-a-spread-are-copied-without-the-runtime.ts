declare const aotOperationCount: (name: string) => number;
// A literal that spreads a typed record of four fields and defines two more properties, in a callback whose result has no declared type, enters its record type as it is. The runtime's type check is not entered once per object.
type State = "open" | "closed";
interface Row { id: number; title: string; state: State; login: string; body: string }
interface Author { login: string }
interface Mention { id: number; title: string; state: State; author: Author }
interface Hit extends Mention { body: string; words: number }

const all: Row[] = [];
for (let i = 0; i < 100; i++) all.push({ id: i, title: "title " + i, state: i & 1 ? "open" : "closed", login: "u" + (i & 7), body: "a body of some words " + i });

function mentionOf(row: Row): Mention {
  return { id: row.id, title: row.title, state: row.state, author: { login: row.login } };
}
async function hits(): Promise<Hit[]> {
  const rows = await Promise.resolve(all);
  return rows.map(row => ({ ...mentionOf(row), body: row.body, words: row.body.length }));
}
function withoutBody(found: Hit[]): number {
  return found.map(({ body, ...hit }) => ({ ...hit, summary: body.length })).length;
}
await hits();
const before = aotOperationCount("operationAOTEnforceType");
let total = 0;
let last: Hit[] = [];
for (let round = 0; round < 5; round++) {
  last = await hits();
  total += withoutBody(last);
}
const slow = aotOperationCount("operationAOTEnforceType") - before;
console.log(total, slow < 20 ? "without the runtime" : "through the runtime: " + slow);
console.log(JSON.stringify(last[7]), Object.keys(last[7]).join(), last[8].state, last[8].words, last[8].author.login);
