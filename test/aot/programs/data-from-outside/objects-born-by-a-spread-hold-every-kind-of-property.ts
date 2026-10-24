// A literal that spreads a typed record and defines more properties, one of them read through another property, in a callback whose result has no declared type, enters its record type as it is: whatever kinds those properties have, the object holds what the literal held. `as` converts nothing: a primitive of the wrong kind throws there, and undefined and null stay what they are.
type State = "open" | "closed";
interface Author { login: string }
interface Row { id: number; title: string; state: State; login: string }
interface ScoredRow extends Row { body: unknown; score: unknown }
interface OwnedRow extends Row { level: unknown; owner: unknown }
interface Mention { id: number; title: string; state: State; author: Author }
interface Scored extends Mention { body: string; score: number; flag: boolean }
interface Owned extends Mention { level: State; owner: Author; ratio: number }
interface TextRow extends Row { body: string }
interface Hit extends Mention { body: string; words: number }

function mentionOf(row: Row): Mention {
  return { id: row.id, title: row.title, state: row.state, author: { login: row.login } };
}
async function scored(all: ScoredRow[]): Promise<Scored[]> {
  const rows = await Promise.resolve(all);
  return rows.map(row => ({ ...mentionOf(row), body: row.body as string, score: row.score as number, flag: row.title.length > 2 }));
}
async function owned(all: OwnedRow[]): Promise<Owned[]> {
  const rows = await Promise.resolve(all);
  return rows.map(row => ({ ...mentionOf(row), level: row.level as State, owner: row.owner as Author, ratio: row.title.length / 2 }));
}
async function hits(all: TextRow[]): Promise<Hit[]> {
  const rows = await Promise.resolve(all);
  return rows.map(row => ({ ...mentionOf(row), body: row.body, words: row.body.length }));
}
const weighHit = (hit: Hit) => hit.id + hit.title + hit.state + hit.author.login + hit.body + hit.words;
const weighScored = (hit: Scored) => hit.id + hit.title + hit.state + hit.author.login + hit.body + hit.score + hit.flag;
const weighOwned = (hit: Owned) => hit.id + hit.title + hit.state + hit.author.login + hit.level + hit.owner.login + hit.ratio;
const owner: Author = { login: "o" };
const row = (i: number): Row => ({ id: i, title: "t" + i, state: i & 1 ? "open" : "closed", login: "u" });
const scoredRow = (i: number, body: unknown, score: unknown): ScoredRow => ({ ...row(i), body, score });
const ownedRow = (i: number, level: unknown, held: unknown): OwnedRow => ({ ...row(i), level, owner: held });
async function attemptScored(body: unknown, score: unknown): Promise<string> {
  try {
    const [hit] = await scored([scoredRow(4, body, score)]);
    return weighScored(hit) + " " + JSON.stringify(hit) + " " + Object.keys(hit).join();
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
async function attemptOwned(level: unknown, held: unknown): Promise<string> {
  try {
    const [hit] = await owned([ownedRow(5, level, held)]);
    return weighOwned(hit) + " " + JSON.stringify(hit) + " " + Object.keys(hit).join();
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

const allScored: ScoredRow[] = [];
const allOwned: OwnedRow[] = [];
const allText: TextRow[] = [];
for (let i = 0; i < 100; i++) {
  allScored.push(scoredRow(i, "b" + i, i));
  allOwned.push(ownedRow(i, i & 2 ? "open" : "closed", owner));
  allText.push({ ...row(i), body: "a body " + i });
}
await scored(allScored);
await owned(allOwned);
await hits(allText);
let length = 0;
for (let round = 0; round < 5; round++) {
  for (const hit of await scored(allScored)) length += weighScored(hit).length;
  for (const hit of await owned(allOwned)) length += weighOwned(hit).length;
  for (const hit of await hits(allText)) length += weighHit(hit).length;
}
console.log(length);
const [first] = await hits([allText[7]]);
console.log(weighHit(first), JSON.stringify(first), Object.keys(first).join());
console.log(await attemptScored("b", 3));
console.log(await attemptOwned("open", owner));
const [kept] = await owned([ownedRow(3, "open", owner)]);
console.log(kept.owner === owner, (() => { kept.ratio = 2; return JSON.stringify(kept) + Object.keys(kept).join(); })());
console.log("a body that is a number:", await attemptScored(5, 3));
console.log("a score that is a text:", await attemptScored("b", "x"));
console.log("a score that is a fraction:", await attemptScored("b", 1.25));
console.log("a score that is large:", await attemptScored("b", 2 ** 40));
console.log("a score that is undefined:", await attemptScored("b", undefined));
console.log("a level outside the union:", await attemptOwned("other", owner));
console.log("a level that is null:", await attemptOwned(null, owner));
console.log("an owner that is plain:", await attemptOwned("open", JSON.parse('{"login":"p"}')));
console.log("an owner that is a text:", await attemptOwned("open", "nobody"));
console.log("an owner that is undefined:", await attemptOwned("open", undefined));
