class Shelf { list = null; count = 0; }
const state = { rows: undefined };
function byLet(shelf, t) { let l = shelf.list; if (t < 0) l = null; let c = t & 1; for (let i = 0; i < l.length; i++) c = c + l[i] * 2; return c; }
function guarded(shelf, t) { let l = shelf.list; if (t < 0) l = null; let c = t & 1; if (l) for (let i = 0; i < l.length; i++) c = c + l[i] * 2; return c; }
function byDefault(list = null, t = 0) { let l = list; if (t < 0) l = null; let c = t & 1; for (let i = 0; i < l.length; i++) c = c + l[i] * 2; return c; }
function unset(t) { let p = state.rows; if (t < 0) p = undefined; let c = 0; for (let i = 0; i < p.length; i++) c = c + p[i] * 2; return c; }
function called(hook = null, x = 0) { let h = hook; if (x < 0) h = null; return h(x) + 1; }
function named(box = null, x = 0) { let b = box; if (x < 0) b = null; return b.width * b.height + x; }
function say(make) { try { console.log(String(make())); } catch (error) { console.log(error instanceof TypeError ? "TypeError" : "another error"); } }
const stored = JSON.parse('[[0.5,1.5,2.5],[],[1,null,"2"],"12",{"length":2,"0":3,"1":4},7,true,null]');
stored.push(new Float64Array([1, 2]), new Uint8Array([250, 5]), [1, , 3], undefined, new Map([[0, 1]]));
const shelf = new Shelf();
for (let round = 0; round < 3; round++) {
  for (const value of stored) {
    shelf.list = value; state.rows = value;
    say(() => byLet(shelf, round)); say(() => guarded(shelf, round)); say(() => byDefault(value, round)); say(() => unset(round));
  }
  say(() => byLet(shelf, -1)); say(() => guarded(shelf, -1)); say(() => byDefault(stored[0], -1)); say(() => byDefault()); say(() => unset(-1));
  say(() => called((x) => x * 2, round)); say(() => called()); say(() => called(7, round)); say(() => called((x) => x, -1));
  say(() => named({ width: 2, height: 3 }, round)); say(() => named()); say(() => named("text", round)); say(() => named({ width: 2 }, round));
}
let sum = 0; shelf.list = stored[0]; state.rows = stored[0];
for (let turn = 0; turn < 2000; turn++) sum += byLet(shelf, turn) + guarded(shelf, turn) + byDefault(stored[0], turn) + unset(turn);
console.log(sum);
