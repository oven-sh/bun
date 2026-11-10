"use strict";
// STATISTIC: ArrayOrUint8ArrayLoopsVersioned >= 1
// `alphabet[text.charAt(at)] | 0`, `p[i & 1 ? "b" : "c"]`: numbers go through the element, but the key is the answer of a call or a text: the holder is a record, a Map's stand-in, a Proxy. Only a key that comes round a loop, a written whole number or what an operator makes of numbers speaks for a list or a view.
const key = JSON.parse('"go"');
const masks = { go(alphabet, text) { let m = 0; for (let at = 0; at < text.length; at++) m = ((m << 1) | 1) & (alphabet[text.charAt(at)] | 0); return m; } };
const picked = { go(p) { let s = 0; for (let i = 0; i < 8; i++) s += p.a + p[i & 1 ? "b" : "c"]; return s; } };
const byOrder = { go(d, order) { let s = 0; for (let i = 0; i < order.length; i++) s += d[order[i]] * 2; return s; } };
const byIndex = { go(d) { let s = 0; for (let i = 0; i + 2 < d.length; i += 3) s += d[i] + d[i + 1] * d[i + 2]; return s; } };
const proxy = new Proxy({ a: 1, b: 2 }, { get(target, name) { return name in target ? target[name] : 0; } });
for (let turn = 0; turn < 3; turn++) {
  console.log(masks[key]({ a: 5, b: 3 }, "abba"), masks[key](JSON.parse('{"x":1}'), "xyx"), masks[key]([7, 7, 7], "012"), masks[key](new Uint8Array([1, 3]), "01"), masks[key](new Map(), "a"));
  console.log(picked[key](proxy), picked[key]({ a: 1, b: 2, c: 3 }), picked[key](Object.assign([9], { a: 1, b: 1, c: 1 })));
  console.log(byOrder[key]([1, 2, 3], [2, 0]), byOrder[key](new Float64Array([0.5, 1.5]), [1, 1, 0]), byOrder[key]({ x: 4 }, ["x"]), byOrder[key](Buffer.from([9, 8]), JSON.parse("[1]")));
  console.log(byIndex[key]([1, 2, 3, 4, 5, 6]), byIndex[key](new Uint8Array([1, 2, 3])), byIndex[key](JSON.parse("[0.5,2,4]")));
}
