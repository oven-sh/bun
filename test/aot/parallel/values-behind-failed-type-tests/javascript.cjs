var box = [];
function put(x, y) { if (x === undefined) x = 1; if (y == null) y = 'd'; box.push({ x: x, y: y }); }
put(); put(undefined, null); put(null, undefined); put('a', 0); put(0, ''); put(false, false); put(NaN, {});
for (var i = 0; i < box.length; i++) console.log(typeof box[i].x, String(box[i].x), typeof box[i].y, String(box[i].y));
function F(x) { this.x = typeof x === 'undefined' ? 10 : x; }
console.log(new F().x, new F(void 0).x, new F(null).x, new F('s').x);
