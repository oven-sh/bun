// Loops inside try blocks whose invariant reads stand before the loop: a handler gets what enters the loop. Loops of one iteration, and with a try inside them.
const out = [];
const log = (...words) => { out.push(words.map(word => (Object.is(word, -0) ? "-0" : String(word))).join(" ")); };
class Runner {
  run(text, last) {
    const list = JSON.parse(text), notes = [];
    let total = 0;
    try {
      for (let turn = 0; turn < last && turn < 12; turn++) {
        notes.push(String(list[turn / 2]));
        notes.push(String(list[turn]));
        total += Number(list[list.length - 1 - turn]);
        total += Number(list[2 ** 31]);
      }
    } catch (error) {
      log("threw", error.name, total);
    }
    log(total, notes.join(), Array.from(list, String).join("|"));
  }
  runOnce() {
    const list = JSON.parse("[7, 0, 4]"), notes = [];
    let total = 0;
    try {
      for (let turn = 0; turn < 1 && turn < 12; turn++) {
        notes.push(String(list[turn / 2]));
        notes.push(String(list[turn]));
        total += Number(list[list.length - 1 - turn]);
        total += Number(list[2 ** 31]);
      }
    } catch (error) {
      log("threw", error.name);
    }
    log(total, notes.join());
  }
}
function deletes(rows) { let sum = 0; for (let k = 1; k < 2; k++) { try { const row = rows[k]; delete row.gone; sum += 1; } catch { break; } } return sum; }
function codes(rows) { let sum = 0; try { for (let k = 1; k < 2; k++) sum += rows[k + 1].name.charCodeAt(0) | 0; } finally { sum++; log("codes", sum); } return sum; }
function fields(rows, factor) { let sum = 0.5, n = 0; try { for (let k = 0; k < rows.length; k++) { sum += rows[k].n * factor.by + rows.length; n++; if (rows[k].stop) throw n; } } catch (e) { return "caught " + e + " " + sum + " " + n; } finally { log("fields", sum, n); } return sum; }
function elements(rows, at) { let sum = 0; try { for (let k = 0; k < 5; k++) { sum += rows[at][k] + rows[at].length; rows[0][0] += 1; } } catch (e) { log(e.name, sum); sum = -sum; } return sum; }
function* steps(xs) { let sum = 0; try { for (let k = 0; k < xs.length; k++) { sum += xs[k] + xs[xs.length - 1]; if (k & 1) yield sum; } } catch (e) { yield "caught " + sum; } finally { log("steps", sum); } }
function consumes(xs) { const it = steps(xs); let r, n = 0; do r = it.next(1); while (!r.done && ++n < 4); return String(r.value) + n; }
const rows = () => [1, { gone: 2, name: "abc" }, { name: "xyz" }];
for (let round = 0; round < 3; round++) {
  for (const text of ["[7, 0, 4]", "[]", "[0.5, 1.5]", "[\"a\", 2]", "[[1], null, 3]"]) for (const last of [1, 2, 3]) new Runner().run(text, last);
  new Runner().runOnce();
  for (const run of [deletes, codes]) for (const given of [rows(), [], [1, 2, 3], [0, null, { name: "q" }]]) { try { log(run(given)); } catch (e) { log(e.name); } }
  for (const factor of [{ by: 2 }, { by: 0.5 }, null, { get by() { throw new RangeError("by"); } }]) for (const given of [[{ n: 1 }, { n: 2, stop: true }], [{ n: 0.5 }, {}], [], [null]]) { try { log(fields(given, factor)); } catch (e) { log(e.name); } }
  for (const at of [0, 1, 2, 3]) log(elements([[1, 2, 3, 4, 5], [0.5], "text", null], at));
  for (const xs of [[1, 2, 3, 4], [], [0.5, 1.5], ["a", "b"], [1n, 2]]) { try { log(consumes(xs)); } catch (e) { log(e.name); } }
}
let digest = 0;
for (const line of out) for (let i = 0; i < line.length; i++) digest = (digest * 31 + line.charCodeAt(i)) | 0;
console.log(out.length, digest);
console.log(out.join("\n"));
