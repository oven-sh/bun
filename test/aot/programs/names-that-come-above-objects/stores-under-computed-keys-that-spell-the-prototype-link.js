// Each store below is written under a computed key, and at run time some of the keys spell `__proto__`: the stored object then comes above the receiver of that
// store, and above no other. What is read afterwards through each receiver is what lies in it and above it, whoever else holds the receiver or the stored object.
const names = JSON.parse('["__proto__", "plain", "__proto__", "other"]');
function put(target, key, value) { target[key] = value; return target; }

class Base { greet() { return "base " + this.tag; } get kind() { return "kind of base"; } }
class Other { greet() { return "other " + this.tag; } set tag2(v) { this.tag = "set " + v; } }
const parents = [new Base(), { greet() { return "literal " + this.tag; }, extra: 1 }, new Other(), function named() {}];

const first = { tag: "first" }, second = { tag: "second" }, third = { tag: "third" }, fourth = { tag: "fourth" };
globalThis.seenByEverybody = first;
const receivers = [first, second, third, fourth];
for (let i = 0; i < 4; i++) put(receivers[i], names[i], parents[i]);
for (const receiver of receivers)
  console.log(receiver.tag, typeof receiver.greet, receiver.greet ? receiver.greet() : "-", receiver.kind, Object.keys(receiver).join(), Object.getPrototypeOf(receiver) === Object.prototype);
third.tag2 = "through the setter above";
console.log(third.tag, Object.hasOwn(third, "tag2"), first instanceof Base, third instanceof Other, second instanceof Base);

// A prototype object of a function gets methods in a loop, and one of the names moves the prototype object itself.
function Router() { this.routes = 0; }
Router.prototype.lookup = function () { return "lookup " + this.routes; };
const above = { inherited() { return "inherited " + this.routes; }, lookup() { return "never found"; } };
for (const name of JSON.parse('["get", "post", "__proto__"]')) Router.prototype[name] = name === "__proto__" ? above : function () { return name + " " + ++this.routes; };
const router = new Router();
const bound = router.lookup.bind(router);
console.log(router.get(), router.post(), bound(), router.inherited(), Object.keys(Router.prototype).join(), Object.getPrototypeOf(Router.prototype) === above);

// What is no object and not null leaves the link alone; null takes everything away from above.
const bare = put({ own: 1 }, names[0], null), same = put({ own: 2 }, names[2], 7);
console.log(typeof bare.toString, Object.getPrototypeOf(bare), typeof same.toString, Object.keys(same).join());

// A function stored as the link: its members are found through the receiver, and calling one of them hands over the receiver.
function holder() {}
holder.describe = function () { return "described " + this.tag; };
console.log(put({ tag: "below a function" }, names[0], holder).describe(), typeof put({}, names[2], holder).call);

// Arrays, functions and instances of classes as receivers.
const list = put([1, 2, 3], names[0], { sum() { let n = 0; for (let i = 0; i < this.length; i++) n += this[i]; return n; } });
console.log(list.sum(), typeof list.map, Array.isArray(list), list.length);
const callable = put(function () { return "called"; }, names[2], { note: "above a function" });
console.log(callable(), callable.note, typeof callable.bind);
const instance = put(new Base(), names[0], Other.prototype);
instance.tag = "moved";
console.log(instance.greet(), instance instanceof Base, instance instanceof Other, instance.kind);
try { put(Object.preventExtensions({}), names[0], {}); console.log("no throw in sloppy code"); } catch (error) { console.log(error instanceof TypeError); }
try { const a = {}, b = put({}, names[0], a); put(a, names[2], b); } catch (error) { console.log(error instanceof TypeError, error.message); }
