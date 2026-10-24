interface Named { name: string; count: number; kind: "a" | "b" }
function make(part: string, kind: "a" | "b"): Named { return { name: part + part, count: 1, kind }; }
const good = make(JSON.parse(process.argv.length > 5 ? "1" : "\"x\""), JSON.parse("\"a\""));
const bad = make(JSON.parse(process.argv.length > 5 ? "\"x\"" : "2"), JSON.parse("7"));
console.log(good.name, typeof good.name, good.count, good.kind, Object.keys(good).join());
console.log(bad.name, typeof bad.name, bad.count, bad.kind, Object.keys(bad).join());
export {};
