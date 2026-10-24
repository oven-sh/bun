// A program modifies its own class through a `const` whose declared type hides the class: `const prototype: any = C.prototype`.
function other() {}

class Deleted { method() { return "method"; } }
const deleted: any = Deleted.prototype;
console.log(delete deleted.constructor, new Deleted().constructor === Object, new Deleted().method());

class Assigned { method() { return "method"; } }
const assigned = Assigned.prototype as any;
assigned.constructor = other;
console.log(new Assigned().constructor === other, new Assigned().method());

class Client { get(path: string) { return "real " + path; } fetch(path: string) { return this.get(path); } }
const client: any = new Client();
client.get = (path: string) => "fake " + path;
console.log(client.get("/a"), client.fetch("/b"), new Client().fetch("/c"));

class Chained { method() { return "method"; } calls() { return this.method(); } }
const first: any = Chained.prototype;
const second = first;
second.method = function () { return "other"; };
console.log(delete second.constructor, new Chained().calls(), new Chained().constructor === Object);

class InFunction { method() { return "method"; } }
function strip() { const prototype: any = InFunction.prototype; return delete prototype.constructor; }
console.log(new InFunction().constructor === InFunction, strip(), new InFunction().constructor === Object);

class Base { method() { return "base"; } calls() { return this.method(); } }
class Derived extends Base { method() { return "derived"; } }
const held: Base = new Derived();
held.method = () => "replaced";
console.log(held.calls(), new Derived().calls(), new Base().calls());
