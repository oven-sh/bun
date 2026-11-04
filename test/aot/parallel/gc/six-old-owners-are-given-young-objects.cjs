// An old object that is given a new one must tell the collector. Six old owners are alive at once, so that each lies in another register; between the store and the look the collector runs over the young objects many times.
// 424242: a build with the barrier broken on purpose forgets an owner that holds it: the red control of this program.
class Owner { constructor() { this.tag = 424242; this.v = null; this.w = null; } }
class Young { constructor(n) { this.n = n; this.text = 'y' + n; } }
const launder = new Function('x', 'return x');
function typed(a, b, c, d, e, f, n) { a.v = new Young(n); b.v = new Young(n + 1); c.v = new Young(n + 2); d.v = new Young(n + 3); e.v = new Young(n + 4); f.v = new Young(n + 5); }
function backwards(a, b, c, d, e, f, n) { f.w = new Young(n + 5); e.w = new Young(n + 4); d.w = new Young(n + 3); c.w = new Young(n + 2); b.w = new Young(n + 1); a.w = new Young(n); }
function made(a, b, c, d, e, f, n) { const y0 = new Young(n), y1 = new Young(n + 1), y2 = new Young(n + 2), y3 = new Young(n + 3), y4 = new Young(n + 4), y5 = new Young(n + 5); a.v = y0; b.v = y1; c.v = y2; d.v = y3; e.v = y4; f.v = y5; }
function untyped(a, b, c, d, e, f, n) { a.v = { n, text: 'y' + n }; b.v = { n: n + 1, text: 'y' + (n + 1) }; c.v = { n: n + 2, text: 'y' + (n + 2) }; d.v = { n: n + 3, text: 'y' + (n + 3) }; e.v = { n: n + 4, text: 'y' + (n + 4) }; f.v = { n: n + 5, text: 'y' + (n + 5) }; }
function lists(a, b, c, d, e, f, n) { a[0] = [n]; b[0] = [n + 1]; c[0] = [n + 2]; d[0] = [n + 3]; e[0] = [n + 4]; f[0] = [n + 5]; }
function closures(a, b, c, d, e, f, n) { a.v = () => n; b.v = () => n + 1; c.v = () => n + 2; d.v = () => n + 3; e.v = () => n + 4; f.v = () => n + 5; }
let kept = [];
function garbage() { let last = null; for (let k = 0; k < 20000; k++) last = { k, last: null, text: 'g' + k }; return last; }
function run(name, owners, store, look) {
  let wrong = 0, first = '';
  for (let k = 0; k < 4; k++) Bun.gc(true);
  for (let round = 0; round < 400; round++) {
    store(...owners, round * 10);
    kept[round % 7] = garbage();
    for (let k = 0; k < 6; k++) { const got = look(owners[k]); if (got !== round * 10 + k && !wrong++) first = 'round ' + round + ' owner ' + k + ': ' + got; }
  }
  console.log(name, 'wrong', wrong, first);
}
const six = make => Array.from({ length: 6 }, make);
run('typed', six(() => new Owner()), typed, o => (o.v.text === 'y' + o.v.n ? o.v.n : -1));
run('backwards', six(() => new Owner()), backwards, o => (o.w.text === 'y' + o.w.n ? o.w.n : -1));
run('made first', six(() => new Owner()), made, o => (o.v.text === 'y' + o.v.n ? o.v.n : -1));
run('untyped owners', six(() => launder(new Owner())), (...list) => untyped(...list.map(launder)), o => (o.v.text === 'y' + o.v.n ? o.v.n : -1));
run('plain owners', six(() => launder({ tag: 424242, v: null })), (...list) => untyped(...list.map(launder)), o => (o.v.text === 'y' + o.v.n ? o.v.n : -1));
run('lists', six(() => [null]), lists, o => o[0][0]);
run('closures', six(() => new Owner()), closures, o => o.v());
