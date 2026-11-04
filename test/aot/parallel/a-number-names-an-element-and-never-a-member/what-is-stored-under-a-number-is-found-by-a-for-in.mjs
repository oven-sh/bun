class P { constructor(v) { this.v = v; } }
const o = { x: 1 };
function put(i, v) { o[i] = v; }
put(0, new P(1));
put(0, new P("text"));
let j = 0;
for (let k = 0; k < 3; k++) j = k - k;
const found = (() => { for (const k in o) if (k === "0") return o[k]; })();
found.v = [found.v];
console.log(typeof found, typeof found.v, Array.isArray(found.v), typeof o.x);
