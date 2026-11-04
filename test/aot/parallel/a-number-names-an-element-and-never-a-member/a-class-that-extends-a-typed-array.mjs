class T extends Uint8Array { x = 1; }
const t = new T(2);
function put(h, i, v) { h[i] = v; }
function get(h, i) { return h[i]; }
put(t, [].length, 300);
put(t, 5, 1);
put(t, -1, 1);
put(t, 1.5, 1);
console.log(get(t, [].length), get(t, 5), get(t, -1), get(t, 1.5), Object.keys(t).join());
