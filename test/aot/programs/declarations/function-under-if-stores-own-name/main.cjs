// A function declared as the body of `if` in sloppy code is in a block of its own (Annex B.3.3). Its name in that block is an ordinary variable: the function can store to it, the store stays for the next call, each evaluation of the `if` has a variable of its own, and the `var` of the same name around it keeps the function. Plain Bun's transpiler declares no such `var`, so there nothing can call the function: the expected output follows ECMAScript.
function storesOwnName(a) {
  if (a) function f() { f = 1; return f; }
  return [typeof f, f(), typeof f, f()];
}
console.log(storesOwnName(true));

function keepsTheStore(a) {
  if (a) function f() { const before = typeof f; f = "stored"; return before; }
  return [f(), f()];
}
console.log(keepsTheStore(true));

function underElse(a) {
  if (a) ; else function f() { f = 2; return f; }
  return typeof f === "function" ? f() : typeof f;
}
console.log(underElse(false), underElse(true));

function oneVariablePerEvaluation() {
  const made = [];
  for (var i = 0; i < 2; i++) {
    if (i >= 0) function f(value) { if (value !== undefined) f = value; return f; }
    made.push(f);
  }
  const [first, second] = made;
  const before = [first() === first, second() === second, first === second];
  first("only the first");
  return [...before, first(), second() === second];
}
console.log(oneVariablePerEvaluation());

function storedByAnInnerFunction(a) {
  if (a) function f() { (() => { f = "inner"; })(); return f; }
  return f();
}
console.log(storedByAnInnerFunction(true));

function storedByEvaluatedText(a) {
  if (a) function f() { eval("f = 'text'"); return f; }
  return f();
}
console.log(storedByEvaluatedText(true));

function incremented(a) {
  if (a) function f() { f = typeof f === "number" ? f + 1 : 0; return f; }
  return [f(), f(), f()];
}
console.log(incremented(true));

function neverStored(a) {
  if (a) function f() { return f; }
  return f() === f;
}
console.log(neverStored(true));

if (typeof module === "object") function atTheTop() { atTheTop = "top"; return atTheTop; }
console.log(atTheTop(), typeof atTheTop);

const expression = function named() { named = 1; return typeof named; };
console.log(expression());
{
  function inABlock() { inABlock = "block"; return inABlock; }
}
console.log(inABlock(), typeof inABlock);
