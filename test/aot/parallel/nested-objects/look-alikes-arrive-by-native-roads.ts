// A function reads `body.at.x`. Direct calls pass what `make` makes. Schedulers, promise reactions, event emitters, array callbacks, revivers, clones and Reflect pass on look-alikes: literals with an inner literal of their own, further names and other types.
import { EventEmitter } from "node:events";

interface Inner { x: number }
interface Outer { at: Inner; mass: number }
const seen: unknown[] = [];
function weigh(body: Outer): void { seen.push(String(body.mass) + body.at.x); }
function move(body: Outer): void { body.at.x += 1; seen.push(body.at.x); }
function make(i: number): Outer { return { at: { x: i }, mass: i }; }
const anything = (value: unknown) => value as any;

weigh(make(1));
move(make(2));

process.nextTick(weigh, { mass: "tick", at: { x: "a" }, byNextTick: 1 });
process.nextTick(move, { mass: "tick", at: { x: "b" }, byNextTickToo: 1 });
setImmediate(weigh, anything({ mass: "immediate", at: { x: "c" }, bySetImmediate: 1 }));
setTimeout(weigh, 0, anything({ mass: "timeout", at: { x: "d" }, bySetTimeout: 1 }));
queueMicrotask(weigh.bind(null, anything({ mass: "microtask", at: { x: "e" }, byBind: 1 })));
Promise.resolve(anything({ mass: "then", at: { x: "f" }, byThen: 1 })).then(weigh);
Promise.reject(anything({ mass: "catch", at: { x: "g" }, byCatch: 1 })).catch(weigh);
(async () => weigh(await anything({ mass: "await", at: { x: "h" }, byAwait: 1 })))();
(async () => weigh(await anything({ then(resolve: (value: unknown) => void) { resolve({ mass: "thenable", at: { x: "i" }, byThenable: 1 }); } })))();

const emitter = new EventEmitter();
emitter.on("body", weigh);
emitter.once("body", move);
emitter.emit("body", { mass: "emit", at: { x: "j" }, byEmit: 1 });
const target = new EventTarget();
target.addEventListener("body", event => weigh(anything(event).detail));
target.dispatchEvent(new CustomEvent("body", { detail: { mass: "event", at: { x: "k" }, byDispatch: 1 } }));

anything([{ mass: "forEach", at: { x: "l" }, byForEach: 1 }]).forEach(weigh);
anything([{ mass: "map", at: { x: "m" }, byMap: 1 }]).map(weigh);
anything([{ mass: "filter", at: { x: "n" }, byFilter: 1 }]).filter(weigh);
anything([{ mass: "find", at: { x: "o" }, byFind: 1 }]).find(weigh);
anything([{ mass: "some", at: { x: "p" }, bySome: 1 }]).some(weigh);
anything([{ mass: "sort", at: { x: "q" }, bySort: 1 }, { mass: "sort", at: { x: "r" }, bySortToo: 1 }]).sort((a: Outer, b: Outer) => (weigh(a), weigh(b), 0));
anything([{ mass: "reduce", at: { x: "s" }, byReduce: 1 }]).reduce((_: unknown, body: Outer) => weigh(body), 0);
Array.from(anything([{ mass: "from", at: { x: "t" }, byFrom: 1 }]), weigh);
new Set([anything({ mass: "set", at: { x: "u" }, bySet: 1 })]).forEach(weigh);
new Map([[1, anything({ mass: "map value", at: { x: "v" }, byMapValue: 1 })]]).forEach(weigh);

JSON.parse('{"mass":"parse","at":{"x":"w"},"byParse":1}', function (key, value) { if (key === "") weigh(value); return value; });
JSON.stringify({ mass: "stringify", at: { x: "y" }, byStringify: 1 }, function (key, value) { if (key === "") weigh(value); return value; });
weigh(structuredClone(anything({ mass: "clone", at: { x: "z" }, byClone: 1 })));
weigh(structuredClone(make(3)));
move(structuredClone(make(4)));
Reflect.apply(weigh, undefined, [{ mass: "apply", at: { x: "A" }, byReflect: 1 }]);
weigh.call(undefined, anything({ mass: "call", at: { x: "B" }, byCall: 1 }));
weigh.apply(undefined, [anything({ mass: "apply", at: { x: "C" }, byApply: 1 })]);
weigh(anything(Object.assign({}, { mass: "assign", at: { x: "D" }, byAssign: 1 })));
weigh(anything({ ...{ mass: "spread", at: { x: "E" }, bySpread: 1 } }));
weigh(anything(Object.create({ mass: "inherited", at: { x: "F" }, byCreate: 1 })));
weigh(anything(new Proxy({ mass: "proxy", at: { x: "G" }, byProxy: 1 }, {})));
weigh(anything({ mass: "getter", get at() { return { x: "H" }; } }));

// What `make` makes goes the same roads, to readers that go by name.
const byName = (body: any) => { seen.push(Object.keys(body).join() + body["a" + "t"].x + JSON.stringify(body)); };
process.nextTick(byName, make(5));
setTimeout(byName, 0, make(6));
Promise.resolve(make(7)).then(byName);
emitter.on("named", byName);
emitter.emit("named", make(8));
[make(9)].forEach(byName);
byName(structuredClone(make(10)));
Reflect.apply(byName, undefined, [make(11)]);

await new Promise(resolve => setTimeout(resolve, 20));
console.log(seen.join("\n"));
