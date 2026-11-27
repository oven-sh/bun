"use strict";
function sift(heap, from, size) { let place = from; for (;;) { let greatest = place; const left = 2 * place + 1, right = left + 1; if (left < size && heap[left] > heap[greatest]) greatest = left; if (right < size && heap[right] > heap[greatest]) greatest = right; if (greatest === place) return place; const moved = heap[place]; heap[place] = heap[greatest]; heap[greatest] = moved; place = greatest; } }
function show(heap) { return Object.keys(heap).map(key => key + "=" + heap[key]).join(",") + "#" + heap.length; }
function fresh() { const heap = []; for (let place = 0; place < 23; place++) heap.push((place * 7 % 23) + 0.25); return heap; }
const turns = +process.argv[2] || 40; let out = "";
for (let turn = 0; turn < turns; turn++) { const heap = fresh(); for (let place = heap.length >> 1; place >= 0; place--) sift(heap, place, heap.length); out = show(heap); }
{ const heap = fresh(); out += "\n0.5/23:" + sift(heap, 0.5, 23) + ":" + show(heap); }
{ const heap = fresh(); out += "\n0.5/1e9:" + sift(heap, 0.5, 1e9) + ":" + show(heap); }
{ const heap = fresh(); out += "\n0.5/Infinity:" + sift(heap, 0.5, Infinity) + ":" + show(heap); }
{ const heap = fresh(); out += "\n0.5/NaN:" + sift(heap, 0.5, NaN) + ":" + show(heap); }
{ const heap = fresh(); out += "\n0.5/2 ** 33:" + sift(heap, 0.5, 2 ** 33) + ":" + show(heap); }
{ const heap = fresh(); out += "\n-0/23:" + sift(heap, -0, 23) + ":" + show(heap); }
{ const heap = fresh(); out += "\n-0/1e9:" + sift(heap, -0, 1e9) + ":" + show(heap); }
{ const heap = fresh(); out += "\n-0/Infinity:" + sift(heap, -0, Infinity) + ":" + show(heap); }
{ const heap = fresh(); out += "\n-0/NaN:" + sift(heap, -0, NaN) + ":" + show(heap); }
{ const heap = fresh(); out += "\n-0/2 ** 33:" + sift(heap, -0, 2 ** 33) + ":" + show(heap); }
{ const heap = fresh(); out += "\n-1/23:" + sift(heap, -1, 23) + ":" + show(heap); }
{ const heap = fresh(); out += "\n-1/1e9:" + sift(heap, -1, 1e9) + ":" + show(heap); }
{ const heap = fresh(); out += "\n-1/Infinity:" + sift(heap, -1, Infinity) + ":" + show(heap); }
{ const heap = fresh(); out += "\n-1/NaN:" + sift(heap, -1, NaN) + ":" + show(heap); }
{ const heap = fresh(); out += "\n-1/2 ** 33:" + sift(heap, -1, 2 ** 33) + ":" + show(heap); }
{ const heap = fresh(); out += "\n-0.5/23:" + sift(heap, -0.5, 23) + ":" + show(heap); }
{ const heap = fresh(); out += "\n-0.5/1e9:" + sift(heap, -0.5, 1e9) + ":" + show(heap); }
{ const heap = fresh(); out += "\n-0.5/Infinity:" + sift(heap, -0.5, Infinity) + ":" + show(heap); }
{ const heap = fresh(); out += "\n-0.5/NaN:" + sift(heap, -0.5, NaN) + ":" + show(heap); }
{ const heap = fresh(); out += "\n-0.5/2 ** 33:" + sift(heap, -0.5, 2 ** 33) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 30/23:" + sift(heap, 2 ** 30, 23) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 30/1e9:" + sift(heap, 2 ** 30, 1e9) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 30/Infinity:" + sift(heap, 2 ** 30, Infinity) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 30/NaN:" + sift(heap, 2 ** 30, NaN) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 30/2 ** 33:" + sift(heap, 2 ** 30, 2 ** 33) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 31 - 1/23:" + sift(heap, 2 ** 31 - 1, 23) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 31 - 1/1e9:" + sift(heap, 2 ** 31 - 1, 1e9) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 31 - 1/Infinity:" + sift(heap, 2 ** 31 - 1, Infinity) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 31 - 1/NaN:" + sift(heap, 2 ** 31 - 1, NaN) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 31 - 1/2 ** 33:" + sift(heap, 2 ** 31 - 1, 2 ** 33) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 31/23:" + sift(heap, 2 ** 31, 23) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 31/1e9:" + sift(heap, 2 ** 31, 1e9) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 31/Infinity:" + sift(heap, 2 ** 31, Infinity) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 31/NaN:" + sift(heap, 2 ** 31, NaN) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 31/2 ** 33:" + sift(heap, 2 ** 31, 2 ** 33) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 32 - 1/23:" + sift(heap, 2 ** 32 - 1, 23) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 32 - 1/1e9:" + sift(heap, 2 ** 32 - 1, 1e9) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 32 - 1/Infinity:" + sift(heap, 2 ** 32 - 1, Infinity) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 32 - 1/NaN:" + sift(heap, 2 ** 32 - 1, NaN) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 32 - 1/2 ** 33:" + sift(heap, 2 ** 32 - 1, 2 ** 33) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 32/23:" + sift(heap, 2 ** 32, 23) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 32/1e9:" + sift(heap, 2 ** 32, 1e9) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 32/Infinity:" + sift(heap, 2 ** 32, Infinity) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 32/NaN:" + sift(heap, 2 ** 32, NaN) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 32/2 ** 33:" + sift(heap, 2 ** 32, 2 ** 33) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 52/23:" + sift(heap, 2 ** 52, 23) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 52/1e9:" + sift(heap, 2 ** 52, 1e9) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 52/Infinity:" + sift(heap, 2 ** 52, Infinity) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 52/NaN:" + sift(heap, 2 ** 52, NaN) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 52/2 ** 33:" + sift(heap, 2 ** 52, 2 ** 33) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 53/23:" + sift(heap, 2 ** 53, 23) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 53/1e9:" + sift(heap, 2 ** 53, 1e9) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 53/Infinity:" + sift(heap, 2 ** 53, Infinity) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 53/NaN:" + sift(heap, 2 ** 53, NaN) + ":" + show(heap); }
{ const heap = fresh(); out += "\n2 ** 53/2 ** 33:" + sift(heap, 2 ** 53, 2 ** 33) + ":" + show(heap); }
{ const heap = fresh(); out += "\n1e21/23:" + sift(heap, 1e21, 23) + ":" + show(heap); }
{ const heap = fresh(); out += "\n1e21/1e9:" + sift(heap, 1e21, 1e9) + ":" + show(heap); }
{ const heap = fresh(); out += "\n1e21/Infinity:" + sift(heap, 1e21, Infinity) + ":" + show(heap); }
{ const heap = fresh(); out += "\n1e21/NaN:" + sift(heap, 1e21, NaN) + ":" + show(heap); }
{ const heap = fresh(); out += "\n1e21/2 ** 33:" + sift(heap, 1e21, 2 ** 33) + ":" + show(heap); }
{ const heap = fresh(); out += "\nInfinity/23:" + sift(heap, Infinity, 23) + ":" + show(heap); }
{ const heap = fresh(); out += "\nInfinity/1e9:" + sift(heap, Infinity, 1e9) + ":" + show(heap); }
{ const heap = fresh(); out += "\nInfinity/Infinity:" + sift(heap, Infinity, Infinity) + ":" + show(heap); }
{ const heap = fresh(); out += "\nInfinity/NaN:" + sift(heap, Infinity, NaN) + ":" + show(heap); }
{ const heap = fresh(); out += "\nInfinity/2 ** 33:" + sift(heap, Infinity, 2 ** 33) + ":" + show(heap); }
{ const heap = fresh(); out += "\n-Infinity/23:" + sift(heap, -Infinity, 23) + ":" + show(heap); }
{ const heap = fresh(); out += "\n-Infinity/1e9:" + sift(heap, -Infinity, 1e9) + ":" + show(heap); }
{ const heap = fresh(); out += "\n-Infinity/Infinity:" + sift(heap, -Infinity, Infinity) + ":" + show(heap); }
{ const heap = fresh(); out += "\n-Infinity/NaN:" + sift(heap, -Infinity, NaN) + ":" + show(heap); }
{ const heap = fresh(); out += "\n-Infinity/2 ** 33:" + sift(heap, -Infinity, 2 ** 33) + ":" + show(heap); }
{ const heap = fresh(); out += "\n11/23:" + sift(heap, 11, 23) + ":" + show(heap); }
{ const heap = fresh(); out += "\n11/1e9:" + sift(heap, 11, 1e9) + ":" + show(heap); }
{ const heap = fresh(); out += "\n11/Infinity:" + sift(heap, 11, Infinity) + ":" + show(heap); }
{ const heap = fresh(); out += "\n11/NaN:" + sift(heap, 11, NaN) + ":" + show(heap); }
{ const heap = fresh(); out += "\n11/2 ** 33:" + sift(heap, 11, 2 ** 33) + ":" + show(heap); }
{ const heap = fresh(); out += "\n22/23:" + sift(heap, 22, 23) + ":" + show(heap); }
{ const heap = fresh(); out += "\n22/1e9:" + sift(heap, 22, 1e9) + ":" + show(heap); }
{ const heap = fresh(); out += "\n22/Infinity:" + sift(heap, 22, Infinity) + ":" + show(heap); }
{ const heap = fresh(); out += "\n22/NaN:" + sift(heap, 22, NaN) + ":" + show(heap); }
{ const heap = fresh(); out += "\n22/2 ** 33:" + sift(heap, 22, 2 ** 33) + ":" + show(heap); }
{ const heap = fresh(); out += "\n23/23:" + sift(heap, 23, 23) + ":" + show(heap); }
{ const heap = fresh(); out += "\n23/1e9:" + sift(heap, 23, 1e9) + ":" + show(heap); }
{ const heap = fresh(); out += "\n23/Infinity:" + sift(heap, 23, Infinity) + ":" + show(heap); }
{ const heap = fresh(); out += "\n23/NaN:" + sift(heap, 23, NaN) + ":" + show(heap); }
{ const heap = fresh(); out += "\n23/2 ** 33:" + sift(heap, 23, 2 ** 33) + ":" + show(heap); }
{ const holed = fresh(); delete holed[3]; delete holed[8]; out += "\nholes:" + sift(holed, 1, 23) + ":" + show(holed) + ":" + sift(holed, 0, 23) + ":" + show(holed); }
{ const named = fresh(); named["-1"] = 1000; named["1.5"] = 2000; out += "\nnamed:" + sift(named, -1, 23) + ":" + sift(named, 0.25, 23) + ":" + show(named); }
{ const frozen = Object.freeze(fresh()); let said = ""; try { sift(frozen, 0, 23); } catch (error) { said = error.constructor.name; } out += "\nfrozen:" + said + ":" + show(frozen); }
console.log(out);
