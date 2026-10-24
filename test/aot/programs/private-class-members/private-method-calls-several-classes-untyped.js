// Calls of private methods in JavaScript: on `this`, on another object of the class, on an object that lacks the method, in classes that are evaluated once and many times, with more and fewer arguments than parameters, and of a private field that holds a function.
const thrownBy = f => { try { return "no error: " + f(); } catch (error) { return error.constructor.name; } };
class Router {
  #routes = [];
  #handler = (path) => "field " + path;
  #match(method, path) { return method + " " + path + " " + this.#routes.length; }
  #rest(first, ...others) { return first + ":" + others.join(); }
  #defaulted(a, b = a + 1) { return a + b; }
  async #later(value) { return value + 1; }
  *#each() { yield* this.#routes; }
  static #count(router) { return router.#routes.length; }
  add(route) { this.#routes.push(route); return this; }
  match(method, path) { return this.#match(method, path); }
  matchOn(other, method, path) { return other.#match(method, path); }
  few() { return this.#match("GET"); }
  many() { return this.#match("GET", "/", "ignored", "too"); }
  rest() { return this.#rest(1) + " " + this.#rest(1, 2, 3); }
  defaulted() { return this.#defaulted(1) + this.#defaulted(1, 5); }
  later() { return this.#later(1); }
  each() { return [...this.#each()].join(); }
  handler(path) { return this.#handler(path); }
  replaceHandler(f) { this.#handler = f; return this; }
  optional(other) { return other?.#match("GET", "/o"); }
  detached() { const f = this.#match; return f.call(this, "GET", "/d") + " " + (f === this.#match) + " " + f.name + " " + f.length; }
  static count(router) { return Router.#count(router); }
}
const router = new Router().add("a").add("b"), other = new Router();
let said = new Set();
for (let i = 0; i < 2000; i++) said.add(router.match("GET", "/x") + " | " + router.matchOn(other, "PUT", "/y") + " | " + router.few() + " | " + router.many() + " | " + router.rest() + " | " + router.defaulted() + " | " + router.each() + " | " + router.handler("/h"));
console.log([...said].join("\n"));
console.log(thrownBy(() => router.matchOn({}, "GET", "/")), thrownBy(() => router.matchOn(null, "GET", "/")), thrownBy(() => router.matchOn(Object.create(router), "GET", "/")), thrownBy(() => Router.prototype.match.call({}, "GET", "/")), router.optional(undefined), router.optional(other), thrownBy(() => router.optional({})));
console.log(router.detached(), Router.count(router), thrownBy(() => Router.count({})), router.replaceHandler(path => "replaced " + path).handler("/r"), thrownBy(() => router.replaceHandler(5).handler("/r")));
// A class that is evaluated many times: each has a method of its own, which captures what is around it.
const classes = [1, 2, 3].map(n => class {
  #scaled(x) { return x * n; }
  scale(x) { return this.#scaled(x); }
  scaleOn(object, x) { return object.#scaled(x); }
});
const objects = classes.map(C => new C());
console.log(objects.map(object => object.scale(10)).join(), objects.map((object, i) => thrownBy(() => object.scaleOn(objects[(i + 1) % 3], 10))).join(), objects[1].scaleOn(new classes[1](), 4));
// Two classes that use the same spelling.
class Left { #name() { return "left"; } name() { return this.#name(); } static on(object) { return object.#name(); } }
class Right { #name() { return "right"; } name() { return this.#name(); } static on(object) { return object.#name(); } }
console.log(new Left().name(), new Right().name(), thrownBy(() => Left.on(new Right())), thrownBy(() => Right.on(new Left())), Left.on(new Left()));
router.later().then(value => console.log("later", value));
