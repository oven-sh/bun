// `a && a.b && a.b.c` and `typeof x === "string" && x.length` say the same in `return ..` as in `if (..)`: what an operand has found out holds in the operands behind it, and nothing is tested twice.
// The functions are also called with a value that nobody follows, so their parameters keep the types that are written: `undefined` and `null` beside the object.
// IRT= 0 chain RequireObjectCoercible .* name="b"
// IRT= 1 byTypeof = TypeTest
// IRT= 0 byTypeof = PropGet
// IRT= 0 byNot RequireObjectCoercible
interface Inner { c: number }
interface Outer { id: number; b?: Inner }
function chain(a?: Outer) { return a && a.b && a.b.c; }
function byTypeof(x: string | number) { return typeof x === "string" && x.length; }
function byNot(a?: Outer) { return !!a && a.id; }
function either(a?: Outer, b?: Outer) { return a || b || null; }
function first(a: Outer | null | undefined, b: Outer | null | undefined, c: number) { return a ?? b ?? c; }
function mixed(a?: Outer, b?: Inner) { return (a && a.b && a.b.c) || (b && b.c) || -1; }
let calls = 0;
function counted<T>(value: T): T { calls++; return value; }
function onlyOnce(a?: Outer) { return counted(a) != null && counted(a!.id) > 1 && counted("both"); }

const stranger: any = JSON.parse(process.argv[2] ?? "null");
const every: any[] = [chain, byTypeof, byNot, either, first, mixed, onlyOnce];
const strange: unknown[] = [];
for (const f of every) strange.push(f(stranger, stranger, stranger));
console.log(JSON.stringify(strange));

const full: Outer = { id: 2, b: { c: 5 } };
const zero: Outer = { id: 0, b: { c: 0 } };
const half: Outer = { id: 1 };
const values: (Outer | undefined)[] = [full, zero, half, undefined];
for (const a of values) {
  console.log(chain(a), byNot(a), either(a, half)?.id, mixed(a, a?.b), onlyOnce(a), calls);
  console.log(first(a, null, 7) === a, first(null, a, 7) === (a ?? 7), first(undefined, undefined, 7));
}
console.log(byTypeof("four"), byTypeof(""), byTypeof(4), byTypeof(0));
let sum = 0;
for (let i = 0; i < 4000; i++) sum += (chain(values[i & 3]) || 0) + (byTypeof(i & 1 ? "ab" : i) || 0) + (byNot(values[i & 3]) || 0);
console.log(sum);
