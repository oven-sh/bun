// napi_run_script is an evaluator like eval, and so are eval and Function where the addon finds them on the global object: the text runs as in plain Bun, or, in an executable that admits no
// text the compiler has not seen, the call throws the EvalError that eval throws and changes nothing. Each line that begins with TEXT says what the call said, what the program reads
// afterwards, and what it read before.
const loaded = { exports: {} };
process.dlopen(loaded, process.env.ADDON);
const attack = loaded.exports;
let at = 0;
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  sum() {
    return this.x + this.y;
  }
}
const shared = new Point(1, 2);
globalThis.shared = shared;
globalThis.Point = Point;
globalThis.level = 1;
function look() {
  let sum = 0;
  for (let round = 0; round < 100; round++) sum += shared.x + shared.y + shared.sum() + level;
  return [sum, Object.keys(shared).join(), typeof globalThis.declared];
}
function row(label, text, use = value => value) {
  const before = JSON.stringify(look());
  let said;
  try {
    const value = typeof text === "function" ? text() : attack.runScript(text);
    said = typeof value === "string" && value.startsWith("threw ") ? value.replace(/:.*/, "") : use(value);
  } catch (error) {
    said = "threw " + error.constructor.name + " in the program";
  }
  console.log(String(++at).padStart(3) + " TEXT " + label + ": " + JSON.stringify(said) + " | after: " + JSON.stringify(look()) + " | before: " + before);
}
row("an expression", "1 + 1");
row("a global is read", "shared.x + level");
row("a field is stored", "shared.x = 50; 'done'");
row("a field is removed", "delete shared.y");
row("a field is stored again", "shared.y = 2; shared.x = 1; 'done'");
row("a method is replaced", "Point.prototype.sum = function () { return 1000; }; 'done'");
row("a global is stored", "level = 7; 'done'");
row("a global is declared", "var declared = 5; declared");
row("a function is handed back", "(function (o) { o.x = 60; return o.x; })", f => (typeof f === "function" ? f(shared) : typeof f));
row("a class is handed back", "(class Late extends Point { sum() { return -5; } })", C => (typeof C === "function" ? new C(1, 2).sum() : typeof C));
row("text that evaluates text", "eval('shared.x = 70')");
row("text that makes a function of text", "new Function('shared.x = 80; return 1')()");
row("eval found on the global object", () => attack.callGlobal("eval", "shared.x = 81"));
row("Function found on the global object", () => attack.constructGlobal("Function", "shared.x = 82; return 2"), f => (typeof f === "function" ? f() : typeof f));
row("Function found on the global object and called", () => attack.callGlobal("Function", "shared.x = 83; return 3"), f => (typeof f === "function" ? f() : typeof f));
row("a syntax error", "shared.x = = 1");
row("text that throws", "shared.x = 90; throw new RangeError('from the text')");
console.log(String(++at).padStart(3) + " not a string: " + JSON.stringify(attack.runScript(5)));
