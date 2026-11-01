// An error quotes the text that `bun <file>` runs, and there the value of a constant stands in place of its name: `o[k]` is 'o.name', `holder.x` is 'null.x', `f(1 + 2)` is 'f(3)'.
// A key that only the compiler knows, because a caller hands it in, is quoted as it is written.
const moduleKey = "x";
const moduleNull = null;
const moduleNumber = 1 + 2;
let variable = 1;
const behindVariable = "y";
function tell(cases) {
  for (const [label, run] of Object.entries(cases)) {
    try {
      run();
      console.log(label + ": nothing thrown");
    } catch (error) {
      console.log(label + ": " + error.message);
    }
  }
}
function keyOfModule(o) { return o[moduleKey]; }
function keyBehindVariable(o) { return o[behindVariable] + variable; }
function baseOfModule() { return moduleNull.x; }
function base() { const holder = null; return holder.x; }
function undefinedBase() { const holder = undefined; return holder.x; }
function trueBase() { const holder = true; return holder.x.y; }
function numberBase() { const holder = 5; return holder.x.y; }
function negativeBase() { const holder = -5; return holder.x.y; }
function textBase() { const holder = "text"; return holder.x.y; }
function key(o) { const k = "name"; return o[k]; }
function numberKey(o) { const k = 3; return o[k]; }
function negativeKey(o) { const k = -1; return o[k]; }
function keyThatIsNoName(o) { const k = "a-b"; return o[k]; }
function templateKey(o) { const k = `t`; return o[k]; }
function keyBehindStatement(o) { tell; const k = "name"; return o[k]; }
function variableKey(o) { let k = "name"; return o[k]; }
function parameterKey(o, k) { return o[k]; }
function parameterNamedAsConstant(o, moduleKey) { return o[moduleKey]; }
function constantNamedAsConstant(o) { const moduleKey = "z"; return o[moduleKey]; }
function copied(o) { const a = "p"; const b = a; return o[b]; }
function computed(o) { const a = 1; const b = a + 1; return o.run(b); }
function inBlock(o) { if (o === null) { const k = "q"; return o[k]; } }
function inClosure(o) { const k = "c"; return (() => o[k])(); }
function inFunctionExpression(o) { const k = "a"; const inner = function () { return o[k]; }; return inner(); }
function chain(o) { const k = "inner"; return o[k].deep.x; }
function optionalChain(o) { const k = "inner"; return o?.[k].deep.x; }
function argument(o) { const a = 5; return o.run(a, moduleNumber, 1 + 2, "a" + "b"); }
function argumentOfCall(f) { const a = "text"; return f(a, moduleKey); }
function booleans(o) { const yes = true; return o.run(yes, !yes); }
function joined(o) { const k = "a"; return o.run(`x${k}y`); }
function folded(o) { return o.run(typeof 1, void 0, !1, -(-1)); }
function literals(o) { return o.run(true, false, undefined, null, 0.5, 1e3, 10000, 0x10, 'single', `tick`, { true: 1, a: o ? true : false }); }
function stored(o) { const v = 7; o.x = v; }
function storedUnderKey(o) { const k = "name"; o[k] = 1; }
function deleted(o) { const k = "d"; delete o[k]; }
function tested(o) { const k = "e"; return k in o; }
function called(o) { const k = "m"; return o[k](); }
function onLines(o) {
  const k = "d";
  const holder = null;
  if (o)
    return o[k].x;
  return holder.x;
}
tell({
  keyOfModule: () => keyOfModule(null),
  keyBehindVariable: () => keyBehindVariable(null),
  baseOfModule: () => baseOfModule(),
  base: () => base(),
  undefinedBase: () => undefinedBase(),
  trueBase: () => trueBase(),
  numberBase: () => numberBase(),
  negativeBase: () => negativeBase(),
  textBase: () => textBase(),
  key: () => key(null),
  numberKey: () => numberKey(null),
  negativeKey: () => negativeKey(null),
  keyThatIsNoName: () => keyThatIsNoName(null),
  templateKey: () => templateKey(null),
  keyBehindStatement: () => keyBehindStatement(null),
  variableKey: () => variableKey(null),
  parameterKey: () => parameterKey(undefined, "name"),
  parameterNamedAsConstant: () => parameterNamedAsConstant(null, "w"),
  constantNamedAsConstant: () => constantNamedAsConstant(null),
  copied: () => copied(null),
  computed: () => computed({}),
  inBlock: () => inBlock(null),
  inClosure: () => inClosure(null),
  inFunctionExpression: () => inFunctionExpression(null),
  chain: () => chain({ inner: {} }),
  optionalChain: () => optionalChain({ inner: {} }),
  argument: () => argument({}),
  argumentOfCall: () => argumentOfCall(null),
  booleans: () => booleans({}),
  joined: () => joined({}),
  folded: () => folded({}),
  literals: () => literals({}),
  stored: () => stored(null),
  storedUnderKey: () => storedUnderKey(null),
  deleted: () => deleted(null),
  tested: () => tested(null),
  called: () => called({}),
  "on lines, the key": () => onLines({}),
  "on lines, the base": () => onLines(null),
});
