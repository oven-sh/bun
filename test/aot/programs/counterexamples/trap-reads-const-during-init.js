// The `get` trap of a Proxy in a heritage clause reads the const whose initializer is running.
let busy, first;
const P = new Proxy(class {}, { get(t, k) { if (!busy) { busy = 1; try { first = read(); } catch (e) { first = e.name; } } return t[k]; } });
const k = [class extends P {}];
export function read() { return k; }
console.log(read() === first ? "one array" : typeof first === "string" ? first : "two arrays");
