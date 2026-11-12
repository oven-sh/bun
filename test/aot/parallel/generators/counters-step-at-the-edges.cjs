// A counter that is stepped behind a call stays what it is as a number: one above 2 ** 53 is 2 ** 53 again.
const seen = [];
function note(x, i) { seen.push(i); return (x ^ i) & 1; }
function* filtered(list, i) { for (const x of list) { if (!note(x, i++)) continue; yield x; } return i; }
function* kept(list) { let i = 0; for (const x of list) { if (!note(x, i++)) continue; yield x; } return i; }
function* high(list) { let i = 9007199254740989; for (const x of list) { if (note(x, i++)) yield i; } return i; }
function* low(list) { let i = -9007199254740989; for (const x of list) { note(x, i--); if (x > 2) yield i; } return i; }
function plain(list) { let i = 9007199254740990; for (const x of list) note(x, i++); return i; }
function down(list) { let i = 2; for (const x of list) note(x, --i); return 1 / i; }
async function waits(list) { let i = 9007199254740990; for (const x of list) { note(x, i++); await x; } return i; }
const sources = [[1, 2, 3, 4, 5, 6], new Set([7, 8, 9]), "ab", kept([1, 2, 3, 4])];
function all(it) { const out = []; let r; while (!(r = it.next()).done) out.push(r.value); return out.join() + "=" + r.value; }
(async () => {
  for (let round = 0; round < 3; round++)
    for (let s = 0; s < 3; s++) {
      const list = sources[s];
      seen.length = 0;
      console.log(round, s, all(kept(list)), all(high(list)), all(low(list)), plain(list), down(list), await waits(list));
      console.log(all(filtered(list, 0)), all(filtered(list, 9007199254740990)), all(filtered(list, -0)), all(filtered(list, 0.5)), all(filtered(list, "4")), all(filtered(list, undefined)), seen.join());
    }
  console.log(all(sources[3]));
})();
