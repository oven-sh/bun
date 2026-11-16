// Two classes have one field each, of one name, at one place and in one form, so the table of fields says the same of both. The constructor of the one defines its property so that it cannot be written.
// A store by name through a receiver that is written `any` remembers which kinds of values a field has taken. That the one field took a value does not make the other writable.
class Foo { p: string = "foo-p"; }
class Written { x: Foo = new Foo(); }
class Defined { constructor(value: unknown) { Object.defineProperty(this, "x", { value }); } }
const unseen = (0, eval)("(x) => x");
function put(holder: any, value: any): string {
  try { holder.x = value; return "stored"; } catch (error) { return (error as Error).constructor.name; }
}
const putWithoutComplaint = (0, eval)("(function (put) { return function (holder, value) { holder.x = value; return 'no complaint'; }; })")(put);
const tally = new Map<string, number>();
function say(row: string): void { tally.set(row, (tally.get(row) ?? 0) + 1); }
for (let turn = 0; turn < 300; turn++) {
  const written = unseen(new Written());
  const first = unseen(new Foo());
  const defined = unseen(new Defined(first));
  const definedWithText = unseen(new Defined("first"));
  const foo = unseen(new Foo());
  say(`${put(written, foo)} ${written.x === foo}`);
  say(`${put(defined, foo)} ${defined.x === first} ${JSON.stringify(Object.getOwnPropertyDescriptor(defined, "x"))}`);
  say(`${put(definedWithText, foo)} ${typeof definedWithText.x} ${definedWithText.x}`);
  say(`${putWithoutComplaint(defined, foo)} ${defined.x === first}`);
}
for (const [row, count] of tally) console.log(count, row);
