// gc/list-or-literal-made-for-one-call-lets-go-of-a-temporary.ts in one executable with two other programs, none of which it names: which bodies the compiler copies into which goes by all that an executable holds.
// Prints what the compiler saves: objects that are collected earlier
// Flags: --aot-erase-types
// Entry points: ./evaluated-text-reads-fields-may.ts ./array-strings-made-runtime-read-written.ts
// Erased types: not built: it is built without its types as it stands
// Todo on linux x64: row 4177: a dead pointer is left in a frame word or a register where a body is copied in that is not copied in when the program stands alone
// Todo: Not every time: row 4177: which bodies are copied in was seen on linux x64 alone
// Todo under ASAN: Not every time: row 4177: frames are laid out otherwise there
type Thing = { id: number; payload: number[] };
let made = 0;
let watched: WeakRef<Thing> | undefined;
function make(): Thing {
  const thing = { id: ++made, payload: Array.from({ length: 50 }, (_, i) => i + made) };
  watched = new WeakRef(thing);
  return thing;
}
let sum = 0;
function mix(seed: number, ...rest: unknown[]): number {
  let more = rest.length;
  for (const value of rest) more += typeof value === "object" ? 1 : 2;
  return (seed * 31 + more) | 0;
}
function reads(box: { held: Thing }): number {
  return box.held.id;
}
const lines: string[] = [];
function report(what: string, ref: WeakRef<Thing> = watched!): void {
  lines.push(`${what}: ${ref.deref() === undefined ? "collected" : "KEPT"}`);
}
function temporaryInRestList(): void {
  sum = mix(sum, make());
  Bun.gc(true);
  report("a temporary in a rest list");
}
function temporaryInLiteral(): void {
  sum += reads({ held: make() });
  Bun.gc(true);
  report("a temporary in a literal");
}
function twiceInLoop(): void {
  for (let turn = 0; turn < 2; turn++) {
    sum = mix(sum, make(), turn);
    Bun.gc(true);
    report(`a temporary in a rest list, turn ${turn} of a loop`);
  }
}
const arrow = (): void => {
  sum += reads({ held: make() });
  Bun.gc(true);
  report("a temporary in a literal, in an arrow function");
};
temporaryInRestList();
temporaryInLiteral();
twiceInLoop();
arrow();
console.log(lines.join("\n"));
console.log(sum);
