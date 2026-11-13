class P { constructor(x) { this.x = x; } }
class Q { constructor(x) { this.x = -x; } }
const T = { P }, k = JSON.parse('"P"');
let s = "";
for (let i = 0; i < 8; i++) { if (i === 3) T.P = Q; if (i === 6) T.P = () => 0; try { s += Reflect.construct(T[k], [i]).x + ","; } catch (e) { s += e.constructor.name + ","; } }
console.log(s);
