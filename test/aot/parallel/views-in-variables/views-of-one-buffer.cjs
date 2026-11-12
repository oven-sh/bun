// Variables that hold views of one buffer: one of them is cleared, replaced or moved between two accesses at one place.
var heap, bytes, halves, words, numbers, doubles, out = [];
function make(size, options) { heap = new ArrayBuffer(size, options); bytes = new Uint8Array(heap); halves = new Int16Array(heap); words = new Int32Array(heap); numbers = new Float32Array(heap); doubles = new Float64Array(heap); }
function half(size) { heap = new ArrayBuffer(size); bytes = new Uint8Array(heap); halves = new Int16Array(heap); other(); words = new Int32Array(heap); numbers = new Float32Array(heap); doubles = new Float64Array(heap); }
function other() { heap = new ArrayBuffer(16); }
function change(k) { if (k == 1) numbers = null; if (k == 2) make(8); if (k == 3) heap.transfer(); if (k == 4) make(64); if (k == 5) half(64); if (k == 6) make(64, { maxByteLength: 128 }); if (k == 7) words = undefined; if (k == 8) heap.resize(16); }
function pair(p, k) { var a = words[p]; change(k); var b = numbers[p]; words[p] = 7; numbers[p] = 0.5; return [a, b, words[p], halves[p + p]]; }
function loop(p, k) { var sum = 0; for (var i = 0; i < 6; i++) { words[p] = i; sum = sum + numbers[p] + words[p]; if (i == 3) change(k); halves[p] = i; bytes[p + 1] = 3; p = (p + 1) | 0; } return sum; }
function storeBetween(p) { var sum = words[p]; numbers = null; try { numbers[p] = 1; } catch (e) { sum += e.name; } words[p] = 5; make(64); return sum + "," + numbers[p] + "," + words[p]; }
function inLoop(p) { var sum = ""; for (var i = 0; i < 4; i++) { words[p] = i; if (i == 2) { numbers = undefined; } try { sum += numbers[p] + ","; } catch (e) { sum += e.name; } sum += words[p] + ";"; } make(64); return sum; }
function say(f, p, k) { try { out.push(f.name + p + k + ":" + f(p, k)); } catch (e) { out.push(f.name + p + k + e.name); } }
make(64);
for (var round = 0; round < 2; round++)
    for (var k = 0; k < 9; k++)
        for (var p of [0, 1, 3, 4, 7, 14, 15, 16, -1, 1 << 29, 2147483647]) {
            say(pair, p, k);
            say(loop, p, k);
            if (k != 6 && k != 8) make(64);
            if (!k) { say(storeBetween, p, k); say(inLoop, p, k); }
        }
console.log(out.length, out.join("\n"));
