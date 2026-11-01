// Code from eval and new Function calls a compiled function, and declares functions of its own.
function compiled(a: number) {
  return a + 1;
}
(globalThis as any).compiled = compiled;
console.log((0, eval)("compiled(1) + 1"), new Function("a", "return compiled(a) * 3")(4));
const made = new Function("a", "function inner(b) { return compiled(b) * 2; } return inner(a) + inner(a + 1);");
console.log(
  made(1),
  (0, eval)("(function () { function later(x) { return compiled(x); } return later(5); })()"),
  [3, 1, 2].sort().join(),
);
