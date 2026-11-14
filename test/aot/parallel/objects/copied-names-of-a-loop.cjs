// for (k in o) this[k] = o[k]: a class of which nothing else is known. Its fields hold what the sources hold.
class F { constructor(o) { for (const k in o) this[k] = o[k]; } }
var all = []; for (var i = 0; i < 40; i++) { const o = { x: i * 0.5, y: i === 33 ? "text" : i }; all.push(new F(o)); }
function sum(n) { var s = 0; for (var i = 0; i < n; i++) { var o = all[i % 33]; s = s + o.x + o.y; } return s; }
var text = ""; for (var i = 0; i < 40; i++) text = (text + all[i].x + " " + all[i].y + ",").slice(-200);
console.log(sum(33), sum(400), text);
