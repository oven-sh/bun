// The name of a class is read while its decorators run.
const out = [];
const attempt = (label, work) => { try { out.push(label + " " + typeof work()); } catch (e) { out.push(label + " " + e.name); } };
const callsIt = (value, context) => { attempt("while " + context.kind + " " + String(context.name) + " is decorated", value); };
const replace = (cls) => { attempt("while the class is decorated", () => cls.m()); return class extends cls {}; };
const keeps = (cls) => { attempt("while the class is decorated and kept", () => cls.m()); };
@replace class C {
  @callsIt static m() { return C; }
  @callsIt n() { return C; }
  static late = (() => { attempt("in a static field", () => C.m()); return 1; })();
}
@keeps class K {
  @callsIt static m() { return K; }
  static late = (() => { attempt("in a static field", () => K.m()); return 1; })();
}
const E = @replace class Inner { static m() { return Inner; } };
console.log(out.join("\n"));
console.log(C.m() === C, new C().n() === C, K.m() === K, E.m() === E);
function typed() {
  @replace class T { x = 1; static make() { return new T(); } get() { return this.x; } }
  const made = T.make();
  return [made instanceof T, made.get(), Object.getPrototypeOf(made) === T.prototype].join();
}
console.log(typed(), typed());
/* Output:
while method m is decorated ReferenceError
while method n is decorated ReferenceError
while the class is decorated ReferenceError
in a static field function
while method m is decorated ReferenceError
while the class is decorated and kept ReferenceError
in a static field function
while the class is decorated ReferenceError
true true true true
true,1,true true,1,true
*/
