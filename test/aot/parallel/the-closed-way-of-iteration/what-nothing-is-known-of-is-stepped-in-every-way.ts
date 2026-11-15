function* made(): Generator<number> { yield 1; yield 2; yield 3; }
(globalThis as any).shelf = { all: [new Set([1, 2, 3]), new Map([["a", 1], ["b", 2]]), "ab\u{1F600}c", [4, 5, 6], new Set([7]).values(), new Map([["k", 8]]).keys(), new Map([["k", 8]]).values(), new Map([["k", 8]]).entries(), [9, 10].values(), [9, 10].entries(), [9, 10].keys(), new Uint8Array([11, 12]), new Uint8Array([11, 12]).values(), made, [1, 2, 3].values().map(x => x * 2), "", new Set(), new Map(), []] };
const shelf: any = (globalThis as any).shelf;
function seen(items: any): string { let text = ""; for (const item of items) text += String(item) + ";"; return text; }
let out = "";
for (let round = 0; round < 3; round++) for (const one of shelf.all) out += seen(one === made ? made() : one) + "|";
console.log(out);
