const unseen = (0, eval)("(x) => x");
function pick(item, floor) {
  let got = 0;
  try { got = item.box.v; } catch (e) { return e ? -1 : -2; }
  try { if (got < floor) throw 1; } catch { throw "below the floor"; }
  return got;
}
const scales = [{ by: 2 }];
if (unseen(0)) scales.push(unseen(0));
function total(full, empty, n, floor) {
  const scale = scales[0];
  let sum = 0;
  for (let i = 0; i < n; i++) sum += scale.by + pick(i % 7 === 3 ? empty : full, floor);
  return sum;
}
const full = { box: { v: 10 } }, empty = { box: null };
console.log(total(full, empty, 300, 0));
try { console.log(total(full, empty, 300, 50)); } catch (e) { console.log(String(e)); }
