// Object.assign(this, o): a class of which nothing else is known. Its fields hold what the sources hold.
class F { constructor(o) { Object.assign(this, o); } }
var all = []; for (var i = 0; i < 40; i++) all.push(new F(i === 33 ? { x: "s", y: 1.5, list: [i] } : { x: i * 0.5, y: i, list: [i, i] }));
function sum(n) { var s = 0; for (var i = 0; i < n; i++) { var o = all[i % 33]; s = s + o.x + o.y + o.list.length; } return s; }
var text = ""; for (var i = 0; i < 40; i++) text = (text + all[i].x + " " + all[i].y + " " + all[i].list + ",").slice(-200);
console.log(sum(33), sum(400), text);
