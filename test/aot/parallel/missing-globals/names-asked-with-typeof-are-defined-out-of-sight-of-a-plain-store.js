// A program asks `typeof` of names that no table lists. The build takes such a name for what statements store. Here each is defined out of sight of a plain store:
// under a key that is read at run time, by a copy, by a definition, through Reflect, through `this` of sloppy code and through another name of the global object.
const source = JSON.parse('{"window": 1, "define": 2}');
console.log("before", typeof window, typeof define, typeof document, typeof navigatorLike);
for (const key of Object.keys(source)) globalThis[key] = source[key];
console.log("by key", typeof window, typeof define);
Object.assign(globalThis, { document: {} });
console.log("assign", typeof document);
Object.defineProperty(globalThis, "navigatorLike", { get: () => "x", configurable: true });
console.log("getter", typeof navigatorLike);
Reflect.set(globalThis, "byReflect", () => 1);
console.log("reflect", typeof byReflect);
(function () {
  this.bySloppyThis = 1;
}).call(globalThis);
console.log("this", typeof bySloppyThis);
const alias = globalThis;
alias.byAlias = "s";
console.log("alias", typeof byAlias);
delete globalThis.window;
console.log("deleted", typeof window);
console.log("never", typeof neverThere, typeof neverThere === "function" && neverThere.amd ? "amd" : "none");
