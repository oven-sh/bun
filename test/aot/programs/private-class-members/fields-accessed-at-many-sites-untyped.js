// Private fields of classes in JavaScript, read and written: by objects of one shape, of a few shapes and of very many shapes at one place in the text, by objects that lack the name, through methods and accessors, on frozen objects, and after the shape of an object has changed.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
const thrownBy = f => { try { return "no error: " + f(); } catch (error) { return error.constructor.name; } };
const names = ["operationAOTPrivateGet", "operationAOTPrivateSet"];
const callsOf = f => { const before = names.map(name => count(name)); f(); return names.map((name, i) => count(name) - before[i]).reduce((a, b) => a + b); };

class Response {
  #status = 200;
  #body;
  #headers = null;
  visible = "v";
  constructor(body) { this.#body = body; }
  status(value) { this.#status = value; return this; }
  read() { return this.#status + " " + this.#body + " " + (this.#headers ? Object.keys(this.#headers).join() : "none"); }
  header(name, value) { (this.#headers ??= {})[name] = value; return this; }
  bump() { this.#status++; this.#status += 2; return this.#status; }
  swap(other) { [this.#body, other.#body] = [other.#body, this.#body]; return this; }
  #secret() { return "secret " + this.#body; }
  get #length() { return String(this.#body).length; }
  set #length(value) { this.#body = String(this.#body).slice(0, value); }
  secret() { return this.#secret(); }
  cut(n) { this.#length = n; return this.#length; }
  assignToMethod() { this.#secret = 1; }
  static statusOf(object) { return object.#status; }
  static setStatusOf(object, value) { object.#status = value; return object; }
  static bodyOf(object) { return object?.#body; }
}
const said = new Set();
for (let i = 0; i < 300; i++) {
  const response = new Response("body" + (i & 1));
  said.add(response.read() + " | " + response.status(201 + (i & 1)).read() + " | " + response.header("a", 1).header("b", 2).read() + " | " + response.bump() + " | " + response.secret() + " | " + response.cut(3) + " | " + response.read());
}
console.log([...said].sort().join("\n"));
const calls = callsOf(() => { for (let i = 0; i < 1000; i++) { const response = new Response(i); response.status(i).bump(); Response.setStatusOf(response, Response.statusOf(response) + 1).read(); } });
console.log(calls < 100 ? "1,000 objects of one shape were read and written with under 100 calls of the run time" : "1,000 objects of one shape took " + calls + " calls of the run time");
console.log(new Response("x").swap(new Response("y")).read(), thrownBy(() => new Response("x").assignToMethod()), thrownBy(() => new Response("x").swap({})));
for (const object of [{}, null, undefined, 5, "text", Object.create(new Response("inherited")), new Proxy(new Response("behind a proxy"), {}), function () {}, [], Symbol.iterator])
  console.log(thrownBy(() => Response.statusOf(object)), thrownBy(() => Response.setStatusOf(object, 1) === object), thrownBy(() => Response.bodyOf(object)));

// A few shapes at one place: subclasses, and objects that were given properties before or after.
class Json extends Response { #kind = "json"; extra = 1; kind() { return this.#kind + " " + this.read(); } }
class Text extends Response { first = 0; #kind = "text"; kind() { return this.#kind + " " + this.read(); } }
class Empty extends Response {}
const shapes = new Set();
for (let i = 0; i < 400; i++) {
  const object = [new Json("j"), new Text("t"), new Empty("e"), new Response("r")][i & 3];
  if (i & 4) object.late = i & 8 ? 1 : "one";
  Response.setStatusOf(object, 300 + (i & 3));
  shapes.add(object.constructor.name + " " + Response.statusOf(object) + " " + (object.kind ? object.kind() : object.read()) + " " + Object.keys(object).join());
}
console.log([...shapes].sort().join("\n"));

// Very many shapes at one place.
let sum = 0;
for (let i = 0; i < 300; i++) {
  const object = new Response(i);
  object["own" + i] = i;
  sum += Response.statusOf(Response.setStatusOf(object, i)) + Response.bodyOf(object);
}
console.log(sum);
const back = callsOf(() => { for (let i = 0; i < 1000; i++) sum += Response.statusOf(Response.setStatusOf(new Response(i), i)); });
console.log(sum, back <= 2000 ? "a place that has seen very many shapes still answers" : "a place that has seen very many shapes took " + back + " calls for 1,000 objects");

// The shape changes under an object that has been read often.
const changing = new Response("changing");
for (let i = 0; i < 100; i++) changing.bump();
console.log(changing.read());
Object.freeze(changing);
console.log(changing.status(7).read(), changing.bump(), thrownBy(() => { "use strict"; changing.visible = 1; }), Object.isFrozen(changing));
const dictionary = new Response("dictionary");
for (let i = 0; i < 200; i++) dictionary["k" + i] = i;
for (let i = 0; i < 195; i++) delete dictionary["k" + i];
console.log(dictionary.status(8).read(), dictionary.bump(), Object.keys(dictionary).join());
delete dictionary.visible;
console.log(dictionary.status(9).read(), dictionary.bump(), Object.keys(dictionary).join());
const removed = new Response("removed");
delete removed.visible;
console.log(removed.status(10).read(), removed.bump(), Object.keys(removed).join());
Object.setPrototypeOf(removed, null);
console.log(Response.statusOf(removed), Response.bodyOf(removed));
collect();
console.log(new Response("after a collection").status(11).bump(), changing.read(), dictionary.read());

// What is stored is kept alive.
const holders = [];
for (let i = 0; i < 2000; i++) { const holder = new Response(null); holder.swap(new Response({ i })); holders.push(holder); if (i % 500 === 499) collect(); }
collect();
console.log(holders.reduce((total, holder) => total + Response.bodyOf(holder).i, 0));

// A class that is evaluated many times has names of its own each time.
const classes = [0, 1, 2].map(n => class { #n = n; get() { return this.#n; } set(value) { this.#n = value; return this; } static of(object) { return object.#n; } });
console.log(classes.map(C => new C().set(new C().get() + 10).get()).join(), classes.map((C, i) => thrownBy(() => C.of(new classes[(i + 1) % 3]()))).join(), classes.map(C => C.of(new C())).join());

// Classes that are declared at the top level in places that a compiler may lay out more than once.
let InFinally, InCatch, InSwitch;
try { throw new Error("thrown"); } catch (error) { InCatch = class { #c = error.message; #m() { return this.#c; } get() { return this.#m(); } }; } finally { InFinally = class { #f = "finally"; #m() { return this.#f; } get() { return this.#m(); } set(value) { this.#f = value; return this; } }; }
switch (classes.length) { case 3: InSwitch = class { #s = "switch"; get() { return this.#s; } }; break; default: InSwitch = class { #s = "default"; get() { return this.#s; } }; }
console.log(new InCatch().get(), new InFinally().get(), new InFinally().set("set").get(), new InSwitch().get());
