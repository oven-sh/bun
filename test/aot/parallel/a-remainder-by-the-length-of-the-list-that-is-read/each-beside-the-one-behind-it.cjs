// Each element of a list is read beside the one behind it, and behind the last one comes the first: the key of the second is a remainder by the length of the list.
"use strict";
const show = v => (v === undefined ? "_" : Object.is(v, -0) ? "-0" : String(v));
function widest(steps) { let widest = 0, at = -1; for (let i = 0; i < steps.length; i++) { const step = steps[(i + 1) % steps.length] - steps[i], size = step < 0 ? -step : step; if (size > widest) { widest = size; at = i; } } return at + ":" + show(widest); }
function beads(bracelet, turns) { let same = 0; for (let i = 0; i < turns; i++) if (bracelet[i % bracelet.length] === bracelet[(i + 1) % bracelet.length]) same++; return same; }
function links(all) { let out = ""; for (let i = 0; i < all.length; i++) { const here = all[i], next = all[(i + 1) % all.length]; out += here.name + ">" + next.name + (next.heavy > here.heavy ? "+" : "-"); } return out; }
function threes(list) { let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i] * list[(i + 1) % list.length] - list[(i + 2) % list.length]; return sum; }
function stored(list) { for (let i = 0; i < list.length; i++) list[(i + 1) % list.length] = list[i] + 1; return Array.from(list, show).join(); }
const lists = [[1, 4, 2, 9], [3], [], [0.5, -0, 1e300, -1e300], ["2", 7, null], [1, , 4], new Uint8Array([250, 3, 9]), new Float32Array([0.1, 0.7]), [NaN, 1], [2 ** 53, 1, -(2 ** 53)]];
for (const list of lists) console.log(widest(list), beads(list, list.length * 2 + 1), show(threes(list)), stored(list.slice()));
for (let k = 0; k < 100; k++) { widest([k, 1, 2]); threes([k, k / 2, 3]); beads([k, k, 1], 5); stored([k, 2]); }
const chain = ["a", "b", "c"].map((name, i) => ({ name, heavy: (i * 2) % 3 })); console.log(links(chain), links([chain[0]]), links([]), links([...chain, { name: "other", heavy: "1" }, Object.create(chain[1])]));
for (const bad of [[chain[0], null], [undefined], [chain[1], , chain[2]]]) { try { console.log(links(bad)); } catch (error) { console.log(error.constructor.name); } }
function changing(list) { let out = ""; for (let i = 0; i < 12 && i < list.length; i++) { out += show(list[(i + 1) % list.length]); if (i === 1) list.push("p"); if (i === 3) list.shift(); if (i === 4) list.length = 0; } return out; } console.log(changing([1, 2, 3, 4, 5]), changing([1]));
let asked = []; const watched = new Proxy([1, 2], { get(target, key) { asked.push(String(key)); return target[key]; } }); console.log(widest(watched), asked.join());
