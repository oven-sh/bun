"use strict";
// `table[i & 7]`: the key lies between nothing and the mask, so whether it lies inside is asked once in front of the loop: is the holder longer than the mask. Whatever may move the length in the turn, a mask that nobody wrote,
// a key that is made negative behind the mask, a holder shorter than the mask: as written.
var key = JSON.parse('"go"'), lines = [];
function say(name, value) { lines.push(name + ": " + (Array.isArray(value) ? value.join() : String(value))); }
var sum = { go(t, n) { var s = 0; for (var i = 0; i < n; i++) s += t[i & 7]; return s; } };
var joined = { go(t, n) { var s = ""; for (var i = 0; i < n; i++) s += t[i & 3] + ","; return s; } };
var byMask = { go(t, n, mask) { var s = 0; for (var i = 0; i < n; i++) s += t[i & mask]; return s; } };
var negative = { go(t, n) { var s = 0; for (var i = 0; i < n; i++) s += t[(i & 7) | -8] === undefined ? 1 : 0; return s; } };
var behind = { go(t, n) { var s = 0; for (var i = 0; i < n; i++) s += t[(i & 7) + 1]; return s; } };
var before = { go(t, n) { var s = 0; for (var i = 0; i < n; i++) s += t[(i & 7) - 1] === undefined ? 100 : t[(i & 7) - 1]; return s; } };
var shrinks = { go(t, n) { var s = 0; for (var i = 0; i < n; i++) { if (i === 5) t.length = 3; s += t[i & 7] === undefined ? 1000 : t[i & 7]; } return s; } };
var pops = { go(t, n) { var s = 0; for (var i = 0; i < n; i++) { s += t[i & 7] === undefined ? 1000 : t[i & 7]; if (i & 1) t.pop(); } return s; } };
var calls = { go(t, n, then) { var s = 0; for (var i = 0; i < n; i++) { s += t[i & 7] === undefined ? 1000 : t[i & 7]; then(i); } return s; } };
var stores = { go(t, n) { for (var i = 0; i < n; i++) t[i & 7] = t[(i + 1) & 7] + 1; return t; } };
var eight = () => [1, 2, 3, 4, 5, 6, 7, 8];
say("a list of eight", sum[key](eight(), 20));
say("a list of nine", sum[key](eight().concat(9), 20));
say("a list of seven", sum[key](eight().slice(1), 20));
say("an empty list", sum[key]([], 3));
say("no turn", sum[key]([], 0));
say("holes", sum[key]([1, , 3, , 5, , 7, 8], 16));
say("fractions", sum[key]([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5], 20));
say("texts", joined[key](["a", "b", "c", "d"], 6));
say("three texts", joined[key](["a", "b", "c"], 6));
say("a text", joined[key]("wxyz", 6));
for (var kind of [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array]) { say(kind.name + " of eight", sum[key](new kind(eight()), 20)); say(kind.name + " of seven", sum[key](new kind(7).fill(2), 20)); }
say("a mask that nobody wrote", byMask[key](eight(), 20, JSON.parse("7")));
say("a mask that is wider", byMask[key](eight(), 20, JSON.parse("15")));
say("a mask that is negative", byMask[key](eight(), 20, JSON.parse("-1")));
say("a key made negative", negative[key](eight(), 20));
say("one behind the mask", behind[key](eight(), 20));
say("one behind the mask, nine", behind[key](eight().concat(9), 20));
say("one before the mask", before[key](eight(), 20));
say("the list shrinks in the turn", shrinks[key](eight(), 20));
say("the list is popped in the turn", pops[key](eight(), 20));
var held = eight(); say("a call shortens it", calls[key](held, 20, i => { if (i === 9) held.length = 2; }));
var bytes = new ArrayBuffer(64, { maxByteLength: 64 }), follows = new Float64Array(bytes); follows.fill(1.5); say("a call makes the memory smaller", calls[key](follows, 20, i => { if (i === 9) bytes.resize(16); }));
var given = new Float64Array(8).fill(2.5); say("a call gives the memory away", calls[key](given, 20, i => { if (i === 9) structuredClone(given.buffer, { transfer: [given.buffer] }); }));
say("stores under the mask", stores[key](eight(), 20));
say("stores under the mask, seven", stores[key](eight().slice(1), 20));
say("stores into a view", Array.from(stores[key](new Int16Array(eight()), 20)));
say("stores into a view of seven", Array.from(stores[key](new Int16Array(7).fill(3), 20)));
console.log(lines.join("\n"));
