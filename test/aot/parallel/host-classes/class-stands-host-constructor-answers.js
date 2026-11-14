// The parent of a class is swapped for bun:ffi's CString, which answers `new` with a string. A compiled class needs an object for `this`: super() throws a TypeError, by whichever way the parent was swapped and whatever new.target is (docs/compiler/compatibility.mdx). Without a class in between, the string.
const ffi = require("bun:ffi");
const { CString, ptr } = ffi;
const bytes = Buffer.from("Hi\0");
const at = ptr(bytes);
function attempt(label, make) {
  try {
    const made = make();
    console.log(label, typeof made === "string", typeof made === "object", made === "Hi", Object(made) === made);
  } catch (error) {
    console.log(label, "threw", error.constructor.name, error.message);
  }
}

class Base {}
class BySetPrototypeOf extends Base {}
Object.setPrototypeOf(BySetPrototypeOf, CString);
attempt("Object.setPrototypeOf", () => new BySetPrototypeOf(at));
class ByReflect extends Base {}
Reflect.setPrototypeOf(ByReflect, CString);
attempt("Reflect.setPrototypeOf", () => new ByReflect(at));
class ByProto extends Base {}
ByProto.__proto__ = CString;
attempt("__proto__", () => new ByProto(at));
class TwoBelow extends ByProto {}
attempt("a class below such a class", () => new TwoBelow(at));
class ForUnknown extends Base {}
Object.setPrototypeOf(ForUnknown, ffi[["C", "String"].join("")]);
attempt("a parent under a computed name", () => new ForUnknown(at));
class BelowBound extends Base {}
Object.setPrototypeOf(BelowBound, CString.bind(null));
attempt("a bound parent", () => new BelowBound(at));
class Looks extends Base {
  constructor(address) {
    const got = super(address);
    console.log("never", typeof got, typeof this);
  }
}
Object.setPrototypeOf(Looks, CString);
attempt("a constructor that looks at what super() answers", () => new Looks(at));
attempt("new.target is the host constructor", () => Reflect.construct(BySetPrototypeOf, [at], CString));
attempt("new.target is a proxy of it", () => Reflect.construct(BySetPrototypeOf, [at], new Proxy(CString, {})));
class Untouched extends Base {}
attempt("the parent as it was written", () => new Untouched(at));

attempt("new", () => new CString(at));
attempt("bound", () => new (CString.bind(null))(at));
attempt("Reflect.construct", () => Reflect.construct(CString, [at]));
attempt("Reflect.construct for another new.target", () => Reflect.construct(CString, [at], Base));
attempt("a proxy", () => new (new Proxy(CString, {}))(at));
attempt("handed down", () => ((C, address) => new C(address))(CString, at));
// The address is good for as long as the bytes are held.
console.log("the bytes", bytes.join());
/* Output:
Object.setPrototypeOf threw TypeError The constructor did not return an object
Reflect.setPrototypeOf threw TypeError The constructor did not return an object
__proto__ threw TypeError The constructor did not return an object
a class below such a class threw TypeError The constructor did not return an object
a parent under a computed name threw TypeError The constructor did not return an object
a bound parent threw TypeError The constructor did not return an object
a constructor that looks at what super() answers threw TypeError The constructor did not return an object
new.target is the host constructor threw TypeError The constructor did not return an object
new.target is a proxy of it threw TypeError The constructor did not return an object
the parent as it was written false true false true
new true false true false
bound true false true false
Reflect.construct true false true false
Reflect.construct for another new.target true false true false
a proxy true false true false
handed down true false true false
the bytes 72,105,0
*/
