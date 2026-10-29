// A GC formats the stack of an error early when a function in its frames has died. Each stack here has the frame of a built-in that compiled code called.
type Make = () => unknown;

const errors: Error[] = [];
function keep(): undefined {
  errors.push(new Error("kept"));
}
const lengthGetter = { get length(): number { keep(); return 0; } };
const stringifies = { toString(): string { keep(); return ""; } };
const hasValue = { valueOf(): number { keep(); return 0; } };
const hasGetter = { get member(): undefined { return keep(); } };

const rows: Array<[string, Make]> = [
  ["Reflect.apply", () => [Reflect.apply(String, undefined, lengthGetter as any)]],
  ["Function.prototype.apply", () => [(String as any).apply(undefined, lengthGetter)]],
  ["Function.prototype.call", () => [keep.call(undefined)]],
  ["Function.prototype.bind", () => [keep.bind(undefined)()]],
  ["String", () => [String(stringifies)]],
  ["Number", () => [Number(hasValue)]],
  ["parseInt", () => [parseInt(stringifies as any)]],
  ["Math.max", () => [Math.max(hasValue as any)]],
  ["JSON.stringify", () => [JSON.stringify({ toJSON: keep })]],
  ["JSON.parse", () => [JSON.parse("1", keep)]],
  ["Array.prototype.map", () => [[1].map(keep)]],
  ["Array.prototype.forEach", () => [[1].forEach(keep)]],
  ["Array.prototype.filter", () => [[1].filter(keep)]],
  ["Array.prototype.some", () => [[1].some(keep)]],
  ["Array.prototype.every", () => [[1].every(keep)]],
  ["Array.prototype.find", () => [[1].find(keep)]],
  ["Array.prototype.findIndex", () => [[1].findIndex(keep)]],
  ["Array.prototype.reduce", () => [[1, 2].reduce(keep as any)]],
  ["Array.prototype.flatMap", () => [[1].flatMap(keep)]],
  ["Array.prototype.sort", () => [[1, 2].sort(keep as any)]],
  ["Array.prototype.join", () => [[stringifies].join()]],
  ["Array.prototype.includes", () => [Array.prototype.includes.call(lengthGetter, 1)]],
  ["Array.from", () => [Array.from([1], keep)]],
  ["Object.assign", () => [Object.assign({}, hasGetter)]],
  ["Object.entries", () => [Object.entries(hasGetter)]],
  ["Object.values", () => [Object.values(hasGetter)]],
  ["Object.hasOwn", () => [Object.hasOwn(new Proxy({}, { getOwnPropertyDescriptor: keep }), "member")]],
  ["Object.keys", () => [Object.keys(new Proxy({}, { ownKeys() { keep(); return []; } }))]],
  ["Object.defineProperty", () => [Object.defineProperty({}, "member", { get value(): undefined { return keep(); } })]],
  ["Reflect.get", () => [Reflect.get(hasGetter, "member")]],
  ["Reflect.construct", () => [Reflect.construct(function () { keep(); }, [])]],
  ["Map.prototype.forEach", () => [new Map([[1, 1]]).forEach(keep)]],
  ["Set.prototype.forEach", () => [new Set([1]).forEach(keep)]],
  ["String.prototype.replace", () => ["a".replace("a", keep as any)]],
  ["String.prototype.concat", () => ["a".concat(stringifies as any)]],
  ["RegExp.prototype[Symbol.replace]", () => [/a/[Symbol.replace]("a", keep as any)]],
  ["Date.prototype[Symbol.toPrimitive]", () => [`${Object.assign(new Date(0), stringifies)}`]],
  ["Symbol.prototype.description", () => [Symbol(stringifies as any).description]],
];

for (const [, make] of rows) {
  // Each row has a caller of its own, whose source is not known at build time. Nothing holds it after the call.
  (new Function("make", "return [make()]; // " + Date.now()) as (make: Make) => unknown)(make);
}

Bun.gc(true);

rows.forEach(([name], row) => {
  const frames = errors[row].stack!.split("\n").slice(1).map(line => line.trim().replace(/^at /, "").replace(/ ?\(.*\)$/, ""));
  console.log(name + ": " + frames.filter(frame => !/[\\/]/.test(frame)).join(" < "));
});
