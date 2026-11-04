// One test asks for several functions at once. Some are neighbors, strangers are written between others, and some closures have changed.
function add(a: number, b: number) {
  return a + b;
}
function sub(a: number, b: number) {
  return a - b;
}
function stranger(a: number, b: number) {
  return a * 100 + b;
}
function mul(a: number, b: number) {
  return a * b;
}
function div(a: number, b: number) {
  return a / b;
}
class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
}

type Op = typeof add | typeof sub | typeof mul | typeof div;

function run(op: Op | string) {
  if (typeof op !== "string") return op(12, 4);
  return op;
}

function runOneOfFive(op: Op | typeof stranger) {
  return run(op as Op);
}

const values: any[] = [
  add,
  sub,
  stranger,
  mul,
  div,
  "text",
  (a: number, b: number) => a % b,
  add.bind(null, 1),
  Math.max,
  Point,
];

function show(label: string) {
  for (const value of values) {
    let result: unknown;
    try {
      result = run(value);
    } catch (error) {
      result = error instanceof TypeError ? "TypeError" : "another error";
    }
    console.log(label, typeof value === "function" ? value.name : value, result);
  }
  for (const op of [add, sub, stranger, mul, div]) console.log(label, op.name, runOneOfFive(op));
}

show("as created");
(mul as any).note = "a property";
Object.freeze(sub);
Object.setPrototypeOf(div, Object.create(Function.prototype));
show("changed");

function wanted0() {
  return 0;
}
function other0() {
  return 100;
}
function wanted1() {
  return 1;
}
function other1() {
  return 101;
}
function wanted2() {
  return 2;
}
function neighborOfWanted2() {
  return 22;
}
function other2() {
  return 102;
}
function wanted3() {
  return 3;
}
function other3() {
  return 103;
}
function wanted4() {
  return 4;
}
function other4() {
  return 104;
}

type Wanted = typeof wanted0 | typeof wanted1 | typeof wanted2 | typeof neighborOfWanted2 | typeof wanted3 | typeof wanted4;

function call(wanted: Wanted | null) {
  return wanted === null ? -1 : wanted();
}

const callees: any[] = [wanted0, other0, wanted1, other1, wanted2, neighborOfWanted2, other2, wanted3, other3, wanted4, other4, null];
for (const callee of callees) console.log(call(callee));
