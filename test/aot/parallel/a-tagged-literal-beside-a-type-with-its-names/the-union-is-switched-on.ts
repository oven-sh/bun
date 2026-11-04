interface Edge { source: number; target: number }
type Mapper = { kind: 0; source: string; target: string } | { kind: 1; list: string[] } | { kind: 2; inner: Mapper };
function map(m: Mapper, text: string): string { switch (m.kind) { case 0: return text === m.source ? m.target : text; case 1: return m.list.includes(text) ? "listed" : text; case 2: return map(m.inner, text) + "!"; } }
function span(e: Edge): number { return e.target - e.source; }
const mappers: Mapper[] = [{ kind: 0, source: "a", target: "b" }, { kind: 1, list: ["a", "c"] }, { kind: 2, inner: { kind: 0, source: "c", target: "d" } }];
let out = ""; for (let i = 0; i < 9; i++) out += map(mappers[i % 3], "abc"[i % 3 === 2 ? 2 : i % 2]) + ",";
console.log(out, span({ source: 2, target: 9 }));
