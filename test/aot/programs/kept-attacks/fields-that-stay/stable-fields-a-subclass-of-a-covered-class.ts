// An instance of a class in a .ts file that extends another class in a .ts file is covered with the properties of both. Plain Bun does every operation.
// Columns: kinds types. Elsewhere: not compared (under fields and wide the deletes, redefinitions and prototypes throw as stored, and the stores of another kind are done).
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).constructor.name); }
}
class Animal { legs: number = 4; name?: string = "a"; describe() { return "animal"; } }
class Bird extends Animal { wings: number = 2; describe() { return "bird"; } }
class Owl extends Bird { constructor(public hoots: boolean) { super(); } }
const make = (): any => new Owl(true);
for (const name of ["legs", "wings", "hoots"]) {
  attempt("delete of " + name, () => delete make()[name]);
  attempt("a getter for " + name, () => Object.defineProperty(make(), name, { get() { return 7; } })[name]);
  attempt("a string into " + name, () => { const o = make(); o[name] = "text"; return o[name]; });
}
attempt("delete of the optional name", () => delete make().name);
attempt("the prototype of the base class", () => Object.setPrototypeOf(make(), Bird.prototype).describe());
attempt("a method of its own on the instance", () => { const o = make(); o.describe = () => "own"; return o.describe(); });
console.log(JSON.stringify(make()), make().describe(), make() instanceof Animal);
