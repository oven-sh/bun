"use strict";
function sift(heap, from, size) { let place = from; for (;;) { let greatest = place; const left = 2 * place + 1, right = left + 1; if (left < size && heap[left] > heap[greatest]) greatest = left; if (right < size && heap[right] > heap[greatest]) greatest = right; if (greatest === place) return place; const moved = heap[place]; heap[place] = heap[greatest]; heap[greatest] = moved; place = greatest; } }
function show(heap) { return Object.keys(heap).map(key => key + "=" + heap[key]).join(",") + "#" + heap.length; }
const turns = +process.argv[2] || 40; let out = "";
for (let turn = 0; turn < turns; turn++) { const heap = []; for (let place = 0; place < 15; place++) heap.push(place * 5 % 15); for (let place = 7; place >= 0; place--) sift(heap, place, 15); out = show(heap); }
{ const whole = []; for (let place = 0; place < 15; place++) whole.push(place * 5 % 15); out += "\nwhole:" + sift(whole, 0, 15) + ":" + show(whole); whole[4] = 99.5; out += ":" + sift(whole, 0, 15) + ":" + show(whole); whole[9] = "text"; out += ":" + sift(whole, 1, 15) + ":" + show(whole); }
console.log(out);
