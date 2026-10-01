import causes, { onlyMetadataDiffers, changedMetadataEqualsTsc, validForTsc } from "/tmp/gdo/gd/causes.mjs";
const own = d => { for (const c of causes) { const m = c.match(d); if (m) return typeof m === "string" ? c.id + " " + m : c.id; } return "unexplained"; };
const wrap = v => `import { __legacyDecorateClassTS as __legacyDecorateClassTS_3r173x8m, __legacyMetadataTS as __legacyMetadataTS_5qwxh4wk } from "bun:wrap";\n${v.imp ?? ""}\nclass C {\n}\n__legacyDecorateClassTS_3r173x8m([\n  d,\n  __legacyMetadataTS_5qwxh4wk("design:type", ${v.val})\n], C.prototype, "a", undefined);\n`;
const tsc = (meta, extra = {}) => ({ src: "", ts: [], tsx: [], meta, chk: { ts: [], tsx: [] }, oth: {}, ...extra });
const mk = (src, base, next, tscRec, api = "t.ts.deco", cls = "A>A") => ({ src, ctx: null, t: null, prod: "x", mut: null, api, cls, base, next, tsc: tscRec });
// 1. an import that only the old value used is dropped with it
console.log(1, own(mk(`import { A } from 'a'; class C { @d a: A.B | C.D }`, ["o", wrap({ imp: 'import { A } from "a";', val: 'typeof A === "undefined" || typeof A.B === "undefined" ? Object : A.B' })], ["o", wrap({ val: "Object" })], tsc([["design:type", "Object"]]))));
// 2. the new value differs from tsc
console.log(2, own(mk(`class C { @d a: A | B }`, ["o", wrap({ val: "Object" })], ["o", wrap({ val: "String" })], tsc([["design:type", "Object"]]))));
// 3. the new value equals tsc strict only
console.log(3, own(mk(`class C { @d a: A | null }`, ["o", wrap({ val: 'typeof A === "undefined" ? Object : A' })], ["o", wrap({ val: "Object" })], tsc([["design:type", "Object"]], { metaLoose: [["design:type", 'typeof (_a = typeof A !== "undefined" && A) === "function" ? _a : Object']] }))));
// 4. an output that differs outside the metadata
console.log(4, own(mk(`class C { @d a: A }`, ["o", wrap({ val: "Object" })], ["o", wrap({ val: "Object" }).replace("class C {\n}", "class C {\n  a;\n}")], tsc([["design:type", "Object"]]))));
// 5. base accepted, next rejects
console.log(5, own(mk(`let x: A`, ["o", "let x;\n"], ["e", [["Unexpected A", 1, 8]]], tsc(undefined), "t.ts.plain", "A>R")));
// 6. R>A, no oracle record
console.log(6, own(mk(`let x: if;`, ["e", [["Unexpected if", 1, 8]]], ["o", "let x;\n"], null, "t.ts.plain", "R>A")));
// 7. R>A, old oracle file without chk
console.log(7, own(mk(`let x: if;`, ["e", [["Unexpected if", 1, 8]]], ["o", "let x;\n"], { src: "", ts: [], tsx: [] }, "t.ts.plain", "R>A")));
// 8. R>A typeof #a
console.log(8, own(mk(`const a: typeof #a = 1;`, ["e", [['Expected identifier but found "#a"', 1, 17]]], ["o", "const a = 1;\n"], tsc(undefined, { chk: { ts: [[2304, 16, 2, "Cannot find name '#a'."]], tsx: [[2304, 16, 2, "Cannot find name '#a'."]] } }), "t.ts.plain", "R>A")));
// 9. legacy decorators: the list with experimentalDecorators decides
const pd = tsc(undefined, { chk: { ts: [[1206, 15, 2, "Decorators are not valid here."]], tsx: [[1206, 15, 2, "x"]], tsL: [], tsxL: [] } });
console.log(9, validForTsc(mk("", ["e", []], ["o", ""], pd, "t.ts.plain", "R>A")), validForTsc(mk("", ["e", []], ["o", ""], pd, "t.ts.deco", "R>A")), validForTsc(mk("", ["e", []], ["o", ""], pd, "s.tsx.plain", "R>A")), validForTsc(mk("", ["e", []], ["o", ""], pd, "t.tsx.exp", "R>A")));
