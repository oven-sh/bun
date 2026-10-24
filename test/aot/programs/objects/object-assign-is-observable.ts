// `Object.assign` is an ordinary call: its getters, setters and order of evaluation are observable.
declare const console: any;
const show = (o: any) => JSON.stringify([Object.keys(o), Object.getOwnPropertyNames(o), Object.getPrototypeOf(o) === Object.prototype, o]);
console.log("defineProperties", show(Object.defineProperties({ a: 1 }, { b: { value: 2, enumerable: true } })));
console.log("defineProperties hidden", show(Object.defineProperties({ a: 1 }, { b: { value: 2 } })));
console.log("setPrototypeOf", show(Object.setPrototypeOf({ a: 1 }, { b: 2 })));
console.log("defineProperty", show(Object.defineProperty({ a: 1 }, "b", { value: 2, enumerable: true })));
console.log("assign", show(Object.assign({ a: 1 }, { b: 2 })));
interface P { x: number }
const laid: P = { x: 5 };
console.log("assign laid", show(Object.assign({ a: 1 }, laid)));
console.log("setPrototypeOf laid", show(Object.setPrototypeOf({ a: 1 }, laid)));
const proto: { v: number } = JSON.parse('{"__proto__": {"inherited": 1}, "v": 2}');
const got = Object.assign({ a: 1 }, proto);
console.log("__proto__", Object.getOwnPropertyNames(got).join(), (got as any).inherited, Object.getPrototypeOf(got) === Object.prototype);
let n = 0;
const r = (n++, Object).assign({ a: 1 }, { b: 2 });
console.log("receiver", n, show(r));
const mine: typeof Object.assign = ((target: any) => target) as any;
console.log("mine", show(mine({ a: 1 }, { b: 2 })));
const order: string[] = [];
const o2 = Object.assign({ a: (order.push("a"), 1) }, (order.push("s1"), { b: 2 }), { c: (order.push("c"), 3) });
console.log("order", order.join(), show(o2));
const withGetter = { get g() { order.push("get"); return 7; } };
console.log("getter source", show(Object.assign({ a: 1 }, withGetter)), order.join());
