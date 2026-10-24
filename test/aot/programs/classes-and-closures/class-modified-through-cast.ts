// A program modifies its own class through a cast: `delete (C.prototype as any).constructor`, `(C.prototype as any).method = f`, `(instance as any).method = f`.
function other() {}

class Deleted { method() { return "method"; } }
console.log(delete (Deleted.prototype as any).constructor, new Deleted().constructor === Object, Object.hasOwn(Deleted.prototype, "constructor"), new Deleted().method());

class Assigned { method() { return "method"; } }
(Assigned.prototype as any).constructor = other;
console.log(new Assigned().constructor === other, Object.hasOwn(Assigned.prototype, "constructor"), new Assigned().method(), new Assigned() instanceof Assigned);

class Viewed { method() { return "method"; } }
console.log(delete (Viewed.prototype as { constructor?: unknown }).constructor, new Viewed().constructor === Object);

class Plainly { method() { return "method"; } }
Plainly.prototype.constructor = other;
console.log(new Plainly().constructor === other, new Plainly().method());

class InFunction1 {}
class InFunction2 {}
function drop() { return delete (InFunction1.prototype as any).constructor; }
function put() { (InFunction2.prototype as any).constructor = other; }
console.log(new InFunction1().constructor === InFunction1, new InFunction2().constructor === InFunction2);
console.log(drop(), put(), new InFunction1().constructor === Object, new InFunction2().constructor === other);

class InBlock1 { static { delete (InBlock1.prototype as any).constructor; } }
class InBlock2 { static { (InBlock2.prototype as any).constructor = other; } }
class InBlock3 { static { delete (this.prototype as any).constructor; } }
console.log(new InBlock1().constructor === Object, new InBlock2().constructor === other, new InBlock3().constructor === Object);

class ByIndex1 {}
class ByIndex2 {}
delete (ByIndex1.prototype as any)["constructor"];
(ByIndex2.prototype as any)["constructor"] = other;
console.log(new ByIndex1().constructor === Object, new ByIndex2().constructor === other);

class Base { method() { return "base"; } }
class Sub extends Base { method() { return "sub"; } }
delete (Sub.prototype as any).constructor;
console.log(new Sub().constructor === Base, new Base().constructor === Base, new Sub().method());
(Base.prototype as any).constructor = other;
console.log(new Sub().constructor === other, new Base().constructor === other, new Sub() instanceof Base);

class Twice {}
class NonNull {}
class Satisfied {}
delete (Twice.prototype as unknown as { constructor?: unknown }).constructor;
(NonNull.prototype! as any).constructor = other;
((Satisfied.prototype satisfies Satisfied) as any).constructor = other;
console.log(new Twice().constructor === Object, new NonNull().constructor === other, new Satisfied().constructor === other);

class MethodDeleted { method() { return "method"; } calls() { return this.method(); } }
console.log(delete (MethodDeleted.prototype as any).method, typeof (new MethodDeleted() as any).method, Object.hasOwn(MethodDeleted.prototype, "method"));
try { console.log(new MethodDeleted().calls()); } catch (e) { console.log((e as Error).name); }

class MethodAssigned { method() { return "method"; } calls() { return this.method(); } }
(MethodAssigned.prototype as any).method = function () { return "other"; };
console.log(new MethodAssigned().method(), new MethodAssigned().calls());

class Client { get(path: string) { return "real " + path; } fetch(path: string) { return this.get(path); } }
const client = new Client();
(client as any).get = (path: string) => "fake " + path;
console.log(client.get("/a"), client.fetch("/b"), new Client().fetch("/c"));

class AccessorDeleted { get got() { return "got"; } }
console.log(delete (AccessorDeleted.prototype as any).got, (new AccessorDeleted() as any).got);

class Untouched { method() { return "method"; } }
console.log(new Untouched().constructor === Untouched, new Untouched().constructor.name, new Untouched().method(), Object.getOwnPropertyNames(Untouched.prototype).join());
