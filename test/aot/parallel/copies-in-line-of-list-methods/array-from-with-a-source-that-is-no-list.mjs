const said = [];
const show = (list) => Array.from(list, (v) => (Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v))).join("|");
for (let i = 0; i < 400; i++) { said.length = 0; said.push(show(Array.from({ length: 3 }, (_, k) => k + i)), show(Array.from({ length: 2 }, (_, k) => ({ k }))), show(Array.from({ length: 2, 0: "a", 1: "b" })), show(Array.from("ab", (c) => c + i)), show(Array.from([i, i + 1], (v) => v + 0.5)), show(Array.from(new Set([i, "x"]), (v) => v)), show(Array.from({ length: 0 }, () => 1))); }
console.log(said.join("\n"));
