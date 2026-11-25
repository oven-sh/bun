// Three classes have one field each, of one name, at one place and in one form, so the table of fields says the same of all three. The written types of the fields differ.
// A store by name through a receiver that is written `any` remembers which kinds of values a field has taken. What the field of one class took says nothing of the field of another.
// Under: --aot-testing=CheckProofsAtRunTime: the type that a slot is held to
class Foo { p: string = "foo-p"; }
class Bar { q: string = "bar-q"; }
class HoldsFoo { x: Foo = new Foo(); }
class HoldsBar { x: Bar = new Bar(); }
class HoldsFooToo { x: Foo = new Foo(); }
const unseen = (0, eval)("(x) => x");
function put(holder: any, value: any): void { holder.x = value; }
function readP(holder: HoldsFoo | HoldsFooToo): string { return holder.x.p; }
function readQ(holder: HoldsBar): string { return holder.x.q; }
const tally = new Map<string, number>();
function say(row: string): void { tally.set(row, (tally.get(row) ?? 0) + 1); }
for (let turn = 0; turn < 300; turn++) {
  const holdsFoo = unseen(new HoldsFoo());
  const holdsBar = unseen(new HoldsBar());
  const holdsFooToo = unseen(new HoldsFooToo());
  const foo = unseen(new Foo());
  const bar = unseen(new Bar());
  put(holdsFoo, foo);
  put(holdsBar, foo);
  put(holdsFooToo, foo);
  say(`a Foo: ${readP(holdsFoo)} ${readQ(holdsBar)} ${readP(holdsFooToo)}`);
  put(holdsBar, bar);
  put(holdsFoo, bar);
  put(holdsFooToo, bar);
  say(`a Bar: ${readP(holdsFoo)} ${readQ(holdsBar)} ${readP(holdsFooToo)}`);
  put(holdsFoo, foo);
  put(holdsBar, bar);
  say(`each its own: ${readP(holdsFoo)} ${readQ(holdsBar)} ${holdsFoo.x === foo} ${holdsBar.x === bar}`);
}
for (const [row, count] of tally) console.log(count, row);
