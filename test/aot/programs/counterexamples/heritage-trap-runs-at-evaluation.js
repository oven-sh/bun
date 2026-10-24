// `extends P` with a Proxy runs the `get` trap when the module is evaluated.
const P = new Proxy(class {}, { get(t, k) { console.log("trap", k); return t[k]; } });
export const a = [class extends P {}];
console.log("end");
(() => a)();
