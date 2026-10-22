// Putting a property with the name of a declared instance property into the prototype object of a class in a .ts file, through a value the compiler cannot follow, throws a TypeError: an instance without an own property of that name reads undefined. Plain Bun stores it.
// Columns: fields wide kinds types
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).constructor.name); }
}
class Holder { limit?: number; name: string = "n"; describe() { return this.name; } }
const prototype: any = Holder.prototype;
attempt("a store", () => { prototype.limit = 5; return new Holder().limit; });
attempt("Object.defineProperty with a getter", () => { Object.defineProperty(prototype, "name", { get() { return "inherited"; }, configurable: true }); return "defined"; });
attempt("another name", () => { prototype.other = 1; return (new Holder() as any).other; });
attempt("a method replaced", () => { prototype.describe = function () { return "patched"; }; return new Holder().describe(); });
const holder = new Holder();
delete holder.limit;
console.log(holder.limit, "limit" in holder, holder.name);
