for (const op of ["+", "-", "*", "/", "%", "&", "|", "^", "<<", ">>", ">>>", "<", "<=", ">", ">=", "==", "!=", "===", "!=="]) {
  check(`(a, b) => a ${op} b`, pairs);
  check(`(a, b) => (a ${op} b) | 0`, pairs);
  check(`(a, b) => (a ${op} b ? 1 : 2)`, pairs);
}
for (const body of ["-a", "+a", "~a", "!a", "typeof a", "a++", "++a", "a--", "a == null", "a ?? 1", "1 / (a * 0)", "1 / -a"])
  check(`a => ${body}`, singles);
check((a, b) => (a / b + 1) | 0, pairs);
check((a, b) => ((a % b) + 1) | 0, pairs);
check((a, b) => (a + b + 1) | 0, pairs);
check((a, b) => { const t = [1]; t[0] = a * b; return 1 / t[0]; }, pairs);
check((a, b) => (a + "x").substring(0, 30) === (a + "y").substring(0, 30), () => [["a".repeat(29)], ["a".repeat(30)], ["b"]]);
