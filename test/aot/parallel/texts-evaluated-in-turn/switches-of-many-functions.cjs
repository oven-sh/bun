const { fullGC } = require("bun:jsc");
globalThis.collect = () => void fullGC();
const names = ["div", "span", "button", "input", "label", "section", "header", "footer", "article", "select", "option"];
// Functions that begin with the same instruction, so that their switches lie at the same place in their streams.
const functionText = k => `s => { switch (s) { ${names.slice(k % 7, k % 7 + 3 + k % 5).map((n, i) => `case "${n}": return ${k * 100 + i};`).join(" ")} default: return ${-k}; } }`;
const text = `
const all = [${Array.from({ length: 150 }, (_, k) => functionText(k)).join(", ")}];
const strings = ${JSON.stringify(names)}.concat(["zz", "di" + "v", "sp" + String("an"), "button".slice(0, 4) + "on", 5, null, undefined, {}, new String("div")]);
let hash = 0, sum = 0;
for (let t = 0; t < 10; t++) {
    if (t === 4) collect();
    for (const s of strings) for (const f of all) { const answer = f(s); sum += answer; hash = (Math.imul(hash, 31) + answer) | 0; }
    // Two switches that ask the same string in turn.
    for (const s of strings) for (let k = 0; k < 149; k++) { sum += all[k](s) - all[k + 1](s); }
}
[sum, hash].join();
`;
for (let t = 0; t < 2; t++) console.log((0, eval)("{" + text + "}"));
