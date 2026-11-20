// An untyped package and a program of it (lazy): iterators and generators by hand: lazy chains, closing, delegation, coroutines, walkers, asynchronous streams
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const { Seq } = lib, closed = []; const src = n => new Seq(function* () { try { for (let i = 0; ; i++) { if (i > 50) throw new Error('ran away'); yield i * n; } } finally { closed.push(n); } });
const forms = [() => src(1).map(x => x * x).filter(x => x % 2).take(5).array(), () => src(2).zip(src(3), 'abcd').array().join(' '), () => src(4).chunk(3).skip(1).take(2).array().join('|'), () => src(5).window(3).map((w, i) => w.reduce((a, b) => a + b) * i).while(x => x < 200).array(), () => src(6).first(), () => Seq.of([1, 2], 'xy', new Set([3])).flat().array(), () => Seq.range(10, 0, -3).scan((a, x) => a + x, 100).array(), () => Seq.iterate(1, x => x * 2).skip(5).take(4).reduce((a, b) => a + b, 0), () => { const s = src(7).share(); return [...s.take(2), ...s.take(2), '/', ...s.take(1)]; }, () => src(8).take(0).array().length, () => src(9).map(x => { if (x > 20) throw new RangeError('at ' + x); return x; }).array(), () => { const [a, , b, ...c] = Seq.range(0, 6); return [a, b, c]; }, () => Math.max(...Seq.from(new Map([[1, 5], [2, 9]])).map(([, v]) => v)), () => src(10).array()];
for (let n = 0; n < 2; n++) forms.forEach((f, i) => { let r; try { r = f(); } catch (e) { r = e.name + ' ' + e.message; } say(n, i, String(r), 'closed', closed.splice(0).join()); });
