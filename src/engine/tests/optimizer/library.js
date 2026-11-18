for (const name of ["abs", "floor", "ceil", "trunc", "round", "sqrt", "fround", "clz32", "sin", "log2", "min", "imul"]) {
  check(`a => Math.${name}(a)`, singles);
  check(`a => Math.${name}(a) | 0`, singles);
  check(`a => 1 / Math.${name}(a * 0.75)`, singles);
}
for (const name of ["min", "max", "imul", "pow"]) check(`(a, b) => Math.${name}(a, b)`, pairs);
check((a, b) => Math.max(a, 0, b), pairs);
check(a => Math.round(a), () => [[0.49999999999999994], [-0.5], [2.5], [-2.5], [2 ** 52 + 1], [-0.2]]);
check(() => { const r = Math.random(); return r >= 0 && r < 1 && r !== Math.random(); }, () => [[]]);
const texts = () => [["abc", 1], ["abc", 3], ["abc", -1], ["\u0100b", 0], ["a" + "b".repeat(40), 9], ["abc", 1.5], [5, 0], ["abc", "1"]];
check((s, i) => s.charCodeAt(i), texts);
check((s, i) => s.charAt(i), texts);
check(a => String.fromCharCode(a), singles);
