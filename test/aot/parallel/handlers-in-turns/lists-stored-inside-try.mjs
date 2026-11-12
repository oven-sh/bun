// A loop reads one list and stores into another inside a try. Its handler, the code that the handler calls, or the helper changes the length, the storage or the identity of either.
const make = () => JSON.parse("[" + Array.from({ length: 24 }, (_, k) => (k * 37) % 23).join() + "]");
const zeros = () => make().map(() => 0);
const text = list => Array.from(list, (_, k) => (k in list ? String(list[k]) : "hole")).join();
function plus(v) {
  if (v === 7 || v === 19) throw v;
  return v + 1;
}
function half(v) {
  if (v === 11) throw new Error("eleven");
  return v * 0.5;
}
let heard = 0;
const table = [e => { heard += String(e).length; }, e => { heard++; }];

function fill(list, target) { let s = 0; for (let i = 0; i < 24; i++) { const x = list[i]; try { target[i] = x + 1; } catch { s--; } s = (s + x) | 0; } return s; }
function fillThrowing(list, target) { let s = 0; for (let i = 0; i < 24; i++) { const x = list[i]; try { target[i] = plus(x); } catch { target[i] = -1; } s = (s + x) | 0; } return s; }
function doublesLater(list, target) { let s = 0; for (let i = 0; i < 24; i++) { const x = list[i]; try { target[i] = half(x); } catch (error) { target[i] = String(error).length; } s = (s + x) | 0; } return s; }
function shortens(list, target) { let s = 0; for (let i = 0; i < 24; i++) { const x = list[i]; try { target[i] = plus(x); } catch { target.length = 3; } s = (s + x) | 0; } return s; }
function boxes(list, target) { let s = 0; for (let i = 0; i < 24; i++) { const x = list[i]; try { target[i] = plus(x); } catch { target[i] = "caught"; } s = (s + x) | 0; } return s; }
function holes(list, target) { let s = 0; for (let i = 0; i < 24; i++) { const x = list[i]; try { target[i] = plus(x); } catch { delete target[i - 1]; target[i + 30] = 1; } s = (s + x) | 0; } return s; }
function replaces(list, target) { let s = 0; for (let i = 0; i < 24; i++) { const x = list[i]; try { target[i] = plus(x); } catch { target = target.map(v => v + 0.25); } s = (s + x) | 0; } return s + text(target); }
function freezes(list, target) { let s = 0; for (let i = 0; i < 24; i++) { const x = list[i]; try { target[i] = plus(x); } catch (error) { Object.freeze(target); s += error instanceof TypeError ? 1000 : 1; } s = (s + x) | 0; } return s; }
function changesWhatIsRead(list, target) { let s = 0; for (let i = 0; i < 24; i++) { const x = list[i]; try { target[i] = plus(x); } catch { list[i + 1] = 0.5; list.length = 22; } s += x ?? 3; } return s; }
function callsOther(list, target) { let s = 0; for (let i = 0; i < 24; i++) { const x = list[i]; try { target[i] = plus(x); } catch (error) { table[i & 1](error); target[0] = "t"; } s = (s + x) | 0; } return s; }
function readsAgain(list, target) { let s = 0; for (let i = 0; i < 24; i++) { const x = list[i]; try { target[i] = plus(x); } catch { target[i] = 0.75; } s = (s + target[i >> 1]) | 0; } return s; }
function growing(list) { const out = []; let s = 0; for (let i = 0; i < 24; i++) { const x = list[i]; try { out[i & 15] = plus(x); } catch (error) { out[i & 15] = String(error).length; } s = (s + out[i & 7]) | 0; } return s + text(out); }
function same(list) { return fillThrowing(list, list) + text(list); }

for (const run of [fill, fillThrowing, doublesLater, shortens, boxes, holes, replaces, freezes, changesWhatIsRead, callsOther, readsAgain, growing, same]) {
  const said = [];
  for (const target of [zeros(), zeros().map(v => v + 0.5), zeros().map(String), [], new Int32Array(24), new Float64Array(9), zeros()]) {
    const list = make();
    for (let turn = 0; turn < 2; turn++) {
      try { said.push(run(list, target)); } catch (error) { said.push(error.name); }
    }
    said.push(text(target), text(list));
  }
  console.log(run.name, heard, said.join(" "));
}
