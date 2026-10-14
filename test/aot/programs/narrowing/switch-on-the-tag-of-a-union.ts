// `switch` on the string discriminant of a union of object types.
type E = { kind: "text"; n: number } | { kind: "tool"; name: string } | { kind: "end" };
function h(e: E): string { switch (e.kind) { case "text": return "t" + e.n; case "tool": return "x" + e.name; case "end": return "e"; } }
const l: E[] = [{ kind: "text", n: 1 }, { kind: "tool", name: "ls" }, { kind: "end" }];
console.log(l.map(h).join());
