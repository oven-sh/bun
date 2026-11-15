"use strict";
const mark = Symbol("mark");
function marked(list) { list[mark] = { name: "rti" }; return list; }
function many(n) { let out = 0; for (let i = 0; i < n; i++) { const a = marked([i, i + 1, i + 2]); out += [...a, ...marked([1])].length + a.concat(marked([2, 3])).length + Math.max(...a) + Math.min.apply(null, a) + Array.from(a).length + a.slice().length + a.flat().length + Array.of(...a).length + new Set(a).size + new Map(a.map((x) => [x, x])).size; } return out; }
console.log(many(300));
const a = marked([104, 105, 33]);
console.log(Buffer.from(a).toString(), String.fromCharCode(...a), new Uint8Array(a).join(), Buffer.concat([Buffer.from(a), Buffer.from(marked([63]))]).toString(), JSON.stringify(a), structuredClone(a).join(), typeof structuredClone(a)[mark]);
console.log(require("node:path").join(...marked(["a", "b", "c"])), require("node:util").inspect(marked([1, 2])), require("node:util").isDeepStrictEqual(marked([1]), [1]), require("node:util").isDeepStrictEqual(marked([1]), marked([1])));
console.log(Object.assign([], a)[mark] === a[mark], { ...a }[mark] === a[mark], Object.entries(a).length, Object.getOwnPropertySymbols(a.slice()).length, Object.getOwnPropertySymbols(a.concat()).length, Object.getOwnPropertySymbols([...a]).length);
Promise.all(marked([Promise.resolve(1), 2])).then((v) => console.log(v.join(), typeof v[mark]));
const p = Promise.resolve(5); p[mark] = 1; p.then((v) => console.log(v, p[mark])); (async () => console.log(await p, await marked([1])[0]))();
const u = new Uint8Array(3); u[mark] = 2; console.log(u[mark], u.map((x) => x + 1).join(), Buffer.from(u.buffer).length); const it = [1, 2].values(); it[mark] = 3; console.log([...it].join(), it[mark]);
const spreadable = marked([1, 2]); spreadable[Symbol.isConcatSpreadable] = false; console.log([0].concat(spreadable).length, [0].concat(marked([1, 2])).length);
