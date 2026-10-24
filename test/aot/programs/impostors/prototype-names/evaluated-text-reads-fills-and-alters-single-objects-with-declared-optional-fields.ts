// Functions made from text at run time are interpreted and know nothing of layouts. They get compiled objects, a literal typed by an interface and an instance of a class, and do to them
// what any JavaScript may: read an absent field 2000 times, store it for the first time, delete it, store another type, define an accessor, freeze, change the prototype. Typed code looks before and after.
interface Shape {
  id: number;
  x?: number;
  label?: string;
}
class Boxed implements Shape {
  id: number;
  x?: number;
  label?: string;
  constructor(id: number) {
    this.id = id;
    delete this.x;
    delete this.label;
  }
}
function xOf(shape: Shape) {
  return shape.x;
}
function setX(shape: Shape, value: number) {
  shape.x = value;
}
function state(shape: Shape) {
  let x: unknown;
  try {
    x = xOf(shape);
  } catch (error) {
    x = (error as Error).constructor.name;
  }
  return `${String(x)} ${"x" in shape} [${Object.keys(shape)}] ${JSON.stringify(shape)}`;
}
const text = (parameters: string, body: string) => new Function(...parameters.split(","), JSON.parse(JSON.stringify(body.split(""))).join("")) as (...values: any[]) => any;
const readMany = text("o", "let n = 0; for (let i = 0; i < 2000; i++) if (o.x === undefined) n++; return n");
const readKeyed = text("o,k", "let n = 0; for (let i = 0; i < 2000; i++) if (o[k] === undefined) n++; return n");
const store = text("o,v", "o.x = v; return o.x");
const storeKeyed = text("o,k,v", "o[k] = v; return o[k]");
const drop = text("o", "return delete o.x");
const has = text("o", "return ('x' in o) + ' ' + Object.hasOwn(o, 'x') + ' ' + Object.keys(o)");
const accessor = text("o,log", "Object.defineProperty(o, 'x', { get() { log.push('get'); return 9 }, set(v) { log.push('set ' + v) }, enumerable: true, configurable: true })");
const freeze = text("o", "Object.freeze(o)");
const link = text("o,p", "Object.setPrototypeOf(o, p)");
const makers: [string, (id: number) => Shape][] = [
  ["a literal", id => ({ id })],
  ["an instance", id => new Boxed(id)],
];

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const shape = makers[i & 1][1](i);
  sum += xOf(shape) ?? 1;
  if (i & 2) setX(shape, 2);
  if (i % 100 === 0) store(shape, 3);
  sum += xOf(shape) ?? 1;
}
console.log("warm", sum);

for (const [label, make] of makers) {
  const log: string[] = [];
  const a = make(1);
  console.log(label, "| read while absent:", readMany(a), readKeyed(a, "x"), has(a));
  console.log(label, "| first store by the text:", store(a, 5), state(a), has(a), readMany(a));
  setX(a, 6);
  console.log(label, "| typed store, read by the text:", store(a, a.x! + 1), state(a));
  console.log(label, "| deleted by the text:", drop(a), state(a), has(a));
  a.label = "l";
  console.log(label, "| stored under a key after another field:", storeKeyed(a, "x", 8), state(a));
  console.log(label, "| another type:", store(a, "text"), has(a), JSON.stringify(a), typeof (a as any).x);
  console.log(label, "| the right type again:", store(a, 4), state(a));
  const b = make(2);
  accessor(b, log);
  console.log(label, "| an accessor:", state(b), log.join());
  setX(b, 3);
  console.log(label, "| a typed store:", state(b), log.join());
  const c = make(3);
  freeze(c);
  let outcome = "stored";
  try {
    setX(c, 1);
  } catch (error) {
    outcome = (error as Error).constructor.name;
  }
  console.log(label, "| frozen by the text:", outcome, state(c), store(c, 2), state(c));
  const d = make(4);
  link(d, { x: 70 });
  console.log(label, "| another prototype:", state(d), readMany(d));
  setX(d, 7);
  console.log(label, "| a typed store:", state(d), drop(d), state(d));
}
