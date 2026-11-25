// A loop stores into an array and steps another one inside a try. The one that it steps is made, read or chosen in each iteration.
const zeros = () => [0, 0, 0, 0, 0, 0];
const view = () => new Float64Array(6);
const frozen = () => Object.freeze([0, 0, 0, 0, 0, 0]);
const rows = [[1, 2], [3], [4, 5, 6], [0.5, "x"], null, [7]];
const held = { inner: [3, 1] };
const fixed = [2, 4];
let moving = [1, 1];
const text = target => Array.prototype.map.call(target, String).join();

function literal(xs, target) { let s = 0; for (let i = 0; i < xs.length; i++) { try { for (const z of [1, 2]) s += z; target[i] = s; } catch (e) { s += 100; } } return s; }
function nested(xs, target) { let s = 0; for (let k = 0; k < 2; k++) { for (let i = 0; i < xs.length; i++) { try { for (const z of [1, 2]) for (const w of [z, k]) s += w; target[i] = s; } catch (e) { s += 100; } } } return s; }
function row(xs, target) { let s = 0; for (let i = 0; i < xs.length; i++) { try { for (const z of rows[i]) s += z; target[i] = s; } catch (e) { s += 100; } } return s; }
function passedRow(xs, target, all) { let s = 0; for (let i = 0; i < xs.length; i++) { try { for (const z of all[i]) s += z; target[i] = s; } catch (e) { s += 100; } } return s; }
function field(xs, target, all, o) { let s = 0; for (let i = 0; i < xs.length; i++) { try { for (const z of o.inner) s += z; target[i] = s; if (i === 2) o.inner = [9]; } catch (e) { s += 100; } } return s; }
function moduleArray(xs, target) { let s = 0; for (let i = 0; i < xs.length; i++) { try { for (const z of fixed) s += z; target[i] = s; } catch (e) { s += 100; } } return s; }
function replaced(xs, target) { let s = 0; moving = [1, 1]; for (let i = 0; i < xs.length; i++) { try { for (const z of moving) s += z; target[i] = s; moving = [i, s]; } catch (e) { s += 100; } } return s; }
function carried(xs, target, all) { let s = 0, list = all[0]; for (let i = 0; i < xs.length; i++) { try { for (const z of list) s += z; target[i] = s; list = all[i]; } catch (e) { s += 100; list = [i]; } } return s; }
function chosen(xs, target, all) { let s = 0; for (let i = 0; i < xs.length; i++) { try { for (const z of i & 1 ? xs : all[0]) s += z; target[i] = s; } catch (e) { s += 100; } } return s; }
function sliced(xs, target) { let s = 0; for (let i = 0; i < xs.length; i++) { try { for (const z of xs.slice(i)) s += z; target[i] = s; } catch (e) { s += 100; } } return s; }
function entries(xs, target) { let s = 0; for (let i = 0; i < xs.length; i++) { try { for (const [k, z] of [5, 6].entries()) s += k * z; target[i] = s; } catch (e) { s += 100; } } return s; }
function keys(xs, target, all) { let s = 0; for (let i = 0; i < xs.length; i++) { try { for (const k of all[i].keys()) s += k + 1; target[i] = s; } catch (e) { s += 100; } } return s; }
function called(xs, target, all) { const row = () => all[0]; let s = 0; for (let i = 0; i < xs.length; i++) { try { for (const z of row()) s += z; target[i] = s; } catch (e) { s += 100; } } return s; }
function invariant(xs, target) { let s = 0; for (let i = 0; i < xs.length; i++) { try { for (const z of xs) s += z; target[i] = s; } catch (e) { s += 100; } } return s; }
function inFinally(xs, target) { let s = 0; for (let i = 0; i < xs.length; i++) { try { target[i] = s; } finally { for (const z of [i, 2]) s += z; } } return s; }
function inCatch(xs, target, all) { let s = 0; for (let i = 0; i < xs.length; i++) { try { target[i] = s; all[i].length; } catch (e) { for (const z of [1, 2]) s += z * 10; } } return s; }
function leaves(xs, target) { let s = 0; for (let i = 0; i < xs.length; i++) { try { for (const z of [1, 2, 3]) { if (z === 2 && i & 1) continue; if (z === 3 && i === 2) break; s += z; } target[i] = s; } catch (e) { s += 100; } } return s; }
function throwing(xs, target) { let s = 0; for (let i = 0; i < xs.length; i++) { try { for (const z of [1, 2, 3]) { if (z === i) throw z; s += z; } target[i] = s; } catch (e) { s += typeof e === "number" ? e * 7 : 100; } } return s; }

for (const run of [literal, nested, row, passedRow, field, moduleArray, replaced, carried, chosen, sliced, entries, keys, called, invariant, inFinally, inCatch, leaves, throwing]) {
  for (const make of [zeros, view, frozen, () => null]) {
    for (let again = 0; again < 3; again++) {
      const target = make();
      held.inner = [3, 1];
      let answer;
      try { answer = run([1, 2, 3, 4, 5, 6], target, rows, held); } catch (error) { answer = error.constructor.name; }
      console.log(run.name, answer, target ? text(target) : "none");
    }
  }
}
