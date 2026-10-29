// Evaluated text branches over long and short stretches of code, on values of every kind, as generated validators do.
const filler = (name, count) => Array.from({ length: count }, (_, i) => `${name} = (${name} * 31 + ${i}) % 1000003;`).join(" ");
const rope = n => "left" + n + "right";
const values = () => [
  undefined, null, true, false, 0, -0, 1, -1, 2147483647, -2147483648, 4294967296, 0.5, NaN, Infinity, 5e-324,
  "", "a", rope(1), "abc".slice(0, 0), ["", ""].join(""), String(""), new String(""), 0n, 1n, Symbol.iterator, {}, [], () => 1, new Proxy({}, {}), Object.create(null),
];
const name = value => typeof value === "string" ? JSON.stringify(value) : typeof value === "bigint" ? value + "n" : typeof value === "symbol" ? "symbol" : Object.is(value, -0) ? "-0" : typeof value === "object" && value !== null ? "object" : typeof value === "function" ? "function" : String(value);
const lines = [];
for (const length of [0, 1, 3, 8, 20, 200, 2500]) {
  const shapes = {
    "if": `let t = 1; if (c) { ${filler("t", length)} t += 1; } return t;`,
    "if not": `let t = 1; if (!c) { ${filler("t", length)} t += 1; } return t;`,
    "if else": `let t = 1; if (c) { ${filler("t", length)} t += 1; } else { ${filler("t", length)} t += 2; } return t;`,
    "and": `let t = 1; const r = c && (() => { ${filler("t", length)} return t; })(); return typeof r === "number" ? r : t;`,
    "conditional": `let t = 1; t = c ? (${length ? Array.from({ length }, (_, i) => "t = t * 31 + " + i + " | 0").join(", ") : "t"}, t + 1) : t + 2; return t;`,
    "while": `let t = 1, turns = 0; while (c) { ${filler("t", length)} if (++turns > 2) break; } return t + turns;`,
    "do while": `let t = 1, turns = 0; do { ${filler("t", length)} if (++turns > 2) break; } while (c); return t + turns;`,
    "nested": `let t = 1; if (c) { if (d) { ${filler("t", length)} t += 1; } else { t += 2; } ${filler("t", length)} } else if (d) { ${filler("t", length)} t += 3; } return t;`,
    "length": `let t = 1; if (list.length) { ${filler("t", length)} t += 1; } return t;`,
  };
  for (const [shape, body] of Object.entries(shapes)) {
    const run = new Function("c", "d", "list", body);
    const answers = new Map();
    for (let round = 0; round < 3; round++) {
      for (const c of values()) {
        const answer = [run(c, 1, []), run(c, 0, [1]), run(c, "", [])].join();
        const key = name(c);
        if (answers.has(key) && answers.get(key) !== answer) lines.push("CHANGED " + length + " " + shape + " " + key);
        answers.set(key, answer);
      }
    }
    const groups = new Map();
    for (const [key, answer] of answers) groups.set(answer, [...(groups.get(answer) ?? []), key]);
    lines.push(length + " " + shape + ": " + [...groups].map(([answer, keys]) => answer + " for " + keys.join(" ")).join(" | "));
  }
}
console.log(lines.join("\n"));
