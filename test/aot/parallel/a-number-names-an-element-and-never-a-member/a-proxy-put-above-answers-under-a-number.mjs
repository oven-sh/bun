const o = { x: 1 };
Object.setPrototypeOf(o, new Proxy({}, { get(t, k, receiver) { receiver.x = "text"; return k; } }));
function get(h, i) { return h[i]; }
console.log(typeof o.x, get(o, [].length), typeof o.x);
