// Which binds of a function that the compiler can see still make the engine's bound function (96 B)?
const N = 20000;
const kept = [];
function usesThis(x) { return this.base + x; }
function usesNothing(a, b) { return a + b; }
function usesRest(...all) { return all.length; }
function usesArguments() { return arguments.length; }
const arrow = (a, b) => a * b;
class Holder {
  base = 1;
  #secret(x) { return this.base + x; }
  method(x) { return this.base - x; }
  bindDeclared() { return usesThis.bind(this); }
  bindMethod() { return this.method.bind(this); }
  bindPrivate() { return this.#secret.bind(this); }
}
function plain(o) { return usesThis.bind(o); }
const app = function () {}; app.base = 5;
app.handle = function handle() { return usesThis.bind(this); };
const ways = {
  declaredWithThisOfClass: h => h.bindDeclared(),
  methodOfClass: h => h.bindMethod(),
  privateMethod: h => h.bindPrivate(),
  declaredWithLiteral: () => plain({ base: 2 }),
  declaredWithFunctionObject: () => app.handle(),
  nullAndOneArgument: (h, i) => usesNothing.bind(null, i),
  undefinedAndTwoArguments: (h, i) => usesNothing.bind(undefined, i, i),
  restParameter: (h, i) => usesRest.bind(null, i),
  argumentsObject: (h, i) => usesArguments.bind(null, i),
  arrowFunction: (h, i) => arrow.bind(null, i),
};
const only = process.env.WAYS_ONLY;
let sum = 0;
const holder = new Holder();
for (const name in ways) {
  if (only && only !== name) continue;
  const way = ways[name];
  for (let i = 0; i < N; i++) { const f = way(holder, i); if ((i & 1023) === 0) { kept.push(f); sum += f(1, 2); } }
}
console.log(sum, kept.length);
