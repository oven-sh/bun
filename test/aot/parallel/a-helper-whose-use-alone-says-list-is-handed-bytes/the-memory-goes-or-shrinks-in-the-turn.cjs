"use strict";
// In a file without types `d[i]` and `d.length` say "a list of numbers". What comes may as well be a Uint8Array or a Buffer: the loop asks in front which of the three it is.
var key = JSON.parse('"go"');
var T = { go(d, stop) { var h = 0, out = ""; for (var i = 0; i < 6; i++) { if (i === 2 && stop) stop(); h += d[i] === undefined ? 100 : d[i]; out += d.length + ","; } return h + " " + out; } };
var a = new Uint8Array([1, 2, 3, 4]), b = new ArrayBuffer(4, { maxByteLength: 8 }), c = new Uint8Array(b), l = [1, 2, 3, 4];
c.set([1, 2, 3, 4]); console.log(T[key](a, () => structuredClone(a.buffer, { transfer: [a.buffer] }))); console.log(T[key](c, () => b.resize(2))); console.log(T[key](c, () => b.resize(8))); console.log(T[key](l, () => { l.length = 1; })); console.log(T[key](l, () => { l.push(9, 9, 9, 9); }));
