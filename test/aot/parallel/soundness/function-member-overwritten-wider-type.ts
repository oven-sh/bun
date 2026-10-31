// Has own of a function member overwritten through a wider type.
type Shape = { a: number; m: () => string };
function make(): Shape { return { a: 1, m: () => "m" }; }
function change(x: { m: unknown }): void { x.m = 9; }
const o = make();
change(o);
console.log(Object.hasOwn(o, "m"), "m" in o, Object.keys(o).join(), typeof (o as any).m, String((o as any).m), JSON.stringify(o), Object.getOwnPropertyNames(o).join(), o.hasOwnProperty("m"), Reflect.has(o, "m"), Object.entries(o).length);
