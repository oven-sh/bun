// Objects built member by member in untyped code are read through a record type with a field whose type is a union of string literals that the program never compares with anything. A text passes however it was made, of the union or outside it: a literal type promises the kind, string. A number throws where typed code reads the field, and the object stays as it was.
type State = "open" | "closed" | "";
type Author = { login: string };
type Hit = { id: number; state: State; author: Author; note?: "a" | "b" };

const makeAuthor = (login: string): Author => ({ login });
const makeHit = (id: number, author: Author): Hit => ({ id, state: "open", author });
const read = (hit: Hit) => hit.id + ":" + hit.state + ":" + hit.state.length + ":" + hit.author.login + ":" + hit.note;
function attempt(action: () => unknown): string {
  try {
    return String(action());
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
function grow(id: number, state: unknown, author: Author, note: unknown): any {
  const hit: any = { id };
  hit.state = state;
  hit.author = author;
  if (note !== 0) hit.note = note;
  return hit;
}

const author = makeAuthor("u");
console.log(read(makeHit(1, author)));
const texts = ["open", "closed", ""];
let lengths = 0;
const kept: any[] = [];
for (let i = 0; i < 3000; i++) {
  const made = "cl" + "osed".slice(0, 4);
  const hit = grow(i, i % 5 === 4 ? made : texts[i % 3], author, i % 2 ? "a" : 0);
  kept.push(hit);
  lengths += read(hit).length;
}
console.log(lengths);
for (const i of [0, 1, 2, 4, 2999]) console.log(JSON.stringify(kept[i]), Object.keys(kept[i]).join(), read(kept[i]));
for (const [name, state, note] of [
  ["a text outside the union", "other", 0],
  ["a longer text", "opened for good", 0],
  ["a text that begins alike", "open ", 0],
  ["a number", 5, 0],
  ["null", null, 0],
  ["undefined", undefined, 0],
  ["a note outside the union", "open", "c"],
  ["a note that is undefined", "open", undefined],
  ["not Latin-1", "opėn", 0],
] as [string, unknown, unknown][]) {
  const hit = grow(7, state, author, note);
  console.log(name + ":", attempt(() => read(hit)), JSON.stringify(hit));
}
console.log(attempt(() => { kept[0].state = "closed"; return read(kept[0]); }), attempt(() => { kept[0].state = "other"; return read(kept[0]); }));
