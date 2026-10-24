// A member behind a spread that has a property of the same name and of another kind: the object first gets the copy and then the member, in legal TypeScript. It prints what plain Bun prints, keys in the order of creation.
interface Before { id: number; status: string; note?: string }
interface After { id: number; status: { code: number }; note?: string }
interface Extra { status: number; tag: string }
function step(previous: Before): After { return { ...previous, status: { code: 1 } }; }
function twice(previous: Before, extra: Extra) { return { ...previous, ...extra }; }
function between(previous: Before, extra: Extra): After & { tag: string } { return { note: "first", ...previous, ...extra, status: { code: 2 } }; }
function copy(after: After): After { return { ...after }; }
const show = (label: string, o: object) => console.log(label + ":", JSON.stringify(o), Object.keys(o).join());
for (let round = 0; round < 3; round++) {
  const before: Before = round === 1 ? { status: "s", id: round, note: "n" } : { id: round, status: "s" };
  const after = step(before);
  show("a member behind a spread", after);
  show("two spreads", twice(before, { status: 5, tag: "t" }));
  show("a member, two spreads, a member", between(before, { tag: "t", status: 5 }));
  show("a copy", copy(after));
  after.status = { code: 3 };
  console.log(after.status.code, typeof before.status, copy(after).status.code);
}
