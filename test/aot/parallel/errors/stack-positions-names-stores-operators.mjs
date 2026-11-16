// @bun
// `bun build --target=bun` writes the first line. Such a file has no source map, so a stack trace shows each place as JavaScriptCore records it, which is seldom the start of a token.
// A conversion in a template has no place of its own: it shows the place that was recorded last in front of it.
function pass(value) {
  return value;
}
function fail() {
  throw new Error("fail");
}
class Base {
  constructor() {
    fail();
  }
}
const nothing = null;
const symbol = Symbol("symbol");
const holder = { f: 5, boom() { throw new Error("boom"); } };
const frozen = Object.freeze({ a: 1 });
const guarded = new Proxy({}, { ownKeys: () => fail() });
let five = 5;
let key = "text";
const inThisFile = /stack-positions-names-stores-operators/;
function show(label, run) {
  try {
    run();
    console.log(label, "| nothing is thrown");
  } catch (error) {
    const lines = String(error.stack).split("\n").filter(line => inThisFile.test(line));
    console.log(label, "|", error.name, "|", lines.map(line => /:(\d+:\d+)\)?$/.exec(line)[1]).join(" "));
  }
}
// prettier-ignore
{
show("name = value", () => { key = pass(1); return `${{ toString: () => fail() }}`; });
show("name += value", () => { key += pass(1); return `${{ toString: () => fail() }}`; });
show("name ||= value", () => { key = 0; key ||= pass(1); return `${{ toString: () => fail() }}`; });
show("name &&= value", () => { key &&= pass(1); return `${{ toString: () => fail() }}`; });
show("name ??= value", () => { key = null; key ??= pass(1); return `${{ toString: () => fail() }}`; });
show("name++", () => { key++; return `${{ toString: () => fail() }}`; });
show("++name", () => { ++key; return `${{ toString: () => fail() }}`; });
show("name += what converts", () => { five += { valueOf() { fail(); } }; });
show("member += value", () => { holder.f += pass(1); return `${{ toString: () => fail() }}`; });
show("member of a frozen object += value", () => { frozen.a += 2; });
show("element of a frozen object += value", () => { frozen[pass("a")] += 2; });
show("member of a frozen object ||= value", () => { frozen.b ||= 2; });
show("name of a built-in", () => { Number(`${{ toString: () => fail() }}`); });
show("member of a built-in", () => { Math.max(1, `${{ toString: () => fail() }}`.length); });
show("undeclared = value", () => { undeclaredName = 1; });
show("undeclared = value, as an argument", () => { pass(undeclaredName = 1); });
show("undeclared += value", () => { undeclaredName += 1; });
show("early = value", () => { pass(1); late = 2; let late = 1; });
show("early++", () => { const read = () => late; late++; let late = 1; return read; });
show("early++, as an argument", () => { pass(late++); let late = 1; });
show("early shorthand member", () => { pass({ zz }); let zz = 1; });
show("early shorthand member in front of another", () => { pass({ zzz, a: 1 }); let zzz = 1; });
show("early shorthand member behind another", () => { pass({ a: 1, zz }); let zz = 1; });
show("spread of a call in parentheses", () => [...(0, holder.boom)()]);
show("spread of a name in parentheses", () => [...(nothing)]);
show("spread behind an element", () => [1, ...(five ? nothing : holder)]);
show("spread among arguments", () => pass(...(0, holder.boom)()));
show("spread among the arguments of new", () => new Base(...(0, holder.boom)()));
show("spread of a list that is written there", () => { let q = [1, ...[2, 3]]; return `${{ toString: () => fail() }}`; });
show("spread in an object", () => { pass({ a: pass(1), ...(five ? holder : nothing), c: `${{ toString: () => fail() }}` }); });
show("rest of an object", () => { let { f, ...others } = guarded; });
show("rest of an object in a parameter", () => { (({ f, ...others }) => others)(guarded); });
show("parentheses twice in front of operators", () => ((five + holder.f) * five + symbol));
show("parentheses behind an operand", () => holder.f + ((five + five) * symbol + five) * five);
show("parentheses in front of an operator, returned", () => { pass(1); return (five + five) * symbol; });
show("text === product", () => "s" === five * symbol);
show("null == product", () => null == five * symbol);
show("name in what stands in parentheses", () => "a" in (nothing));
show("instanceof what stands in parentheses", () => holder instanceof (nothing));
show("pattern of a generator", () => { function* make({ first }) {} make(nothing); });
show("renaming pattern of a generator", () => { function* make({ first: renamed }, { second }) {} make({}, nothing); });
show("class that a closure names", () => { class NamedByClosure {} pass(() => NamedByClosure); return `${{ toString: () => fail() }}`; });
show("short class that a closure names", () => { class Few {} pass(() => Few); return `${{ toString: () => fail() }}`; });
show("extends a name in parentheses", () => { class Heir extends (five) {} });
show("extends a condition", () => { class Heir extends (five ? five : 1) {} });
show("super()", () => { class Heir extends Base { constructor() { super(); } } new Heir(); });
show("super(value)", () => { class Heir extends Base { constructor(value) { super(value); } } new Heir(1); });
show("private name in a name", () => { class Holder { #part; static has(value) { return #part in value; } } Holder.has(5); });
show("private name in a call", () => { class Holder { #part; static has(value) { return #part in pass(value); } } Holder.has(5); });
show("private name in a name, in parentheses", () => { class Holder { #part; static has(value) { return (#part in value) && 1; } } Holder.has(5); });
}
