// Compiled code reads a property of an ordinary object by name before evaluated text reads it at a site of its own. The site then sees
// the same kind of object again and again, other kinds in between, and objects whose property has moved, gone or become an accessor.
const lines: string[] = [];
function show(label: string, value: unknown): void {
  lines.push(label + " " + JSON.stringify(value));
}

const make = new Function("value", "return { value: value, issues: [] };");
const makeOther = new Function("value", "return { issues: [], extra: 1, value: value };");
function readInCompiledCode(payload: any): unknown {
  return payload.issues.length === 0 ? payload.value : undefined;
}
let total = 0;
for (let i = 0; i < 100; i++) total += readInCompiledCode(make(i)) as number;
for (let i = 0; i < 100; i++) total += readInCompiledCode(makeOther(i)) as number;
show("read by compiled code", total);

const read = new Function("payload", "return payload.value;");
const readTwice = new Function("a", "b", "return [a.value, b.value, a.issues.length, b.issues.length];");
total = 0;
for (let i = 0; i < 100; i++) total += read(make(i));
show("one kind", total);
total = 0;
for (let i = 0; i < 100; i++) total += read(i & 1 ? make(i) : makeOther(i));
show("two kinds in turn", total);
show("two sites", readTwice(make(1), makeOther(2)));

const removed = make(5);
delete removed.value;
const accessor = make(6);
Object.defineProperty(accessor, "value", { get() { return "computed"; } });
const inherited = Object.create(make(7));
const shadowed = Object.create(make(8));
shadowed.value = "own";
class Compiled { value = "field"; issues: unknown[] = []; }
show("removed, accessor, inherited, shadowed, compiled, primitive", [read(removed), read(accessor), read(inherited), read(shadowed), read(new Compiled()), read("text"), read(9)]);
show("and the first kind again", [read(make(10)), read(makeOther(11))]);
for (const bad of [undefined, null]) {
  try {
    read(bad);
  } catch (error) {
    show("of " + bad, (error as Error).constructor.name);
  }
}

console.log(lines.join("\n"));
