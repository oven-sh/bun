// A constructor fills `this` one store after the other, and a class that inherits from it has setters for some of the names, as Node's ServerResponse has for three names that OutgoingMessage stores to.
// What the objects have, and in which order things happen.
const log = [];
function note(text, object) { if (log.length < 12) log.push(text + " behind " + Object.keys(object).join()); }
function heirsInheritFrom(constructor) { return Object.getPrototypeOf(Object.create(constructor.prototype)); }
function describe(object) { return Object.keys(object).map(key => key + "=" + JSON.stringify(object[key])).join() + " | " + object.writable + " " + object.keepAlive; }

function Message(options) {
  this.outputData = [];
  this.outputSize = 0;
  this.first = 1;
  this.writable = true;
  this.destroyed = false;
  this.last = false;
  this.sendDate = false;
  this.keepAlive = options;
  this.contentLength = null;
  this.hasBody = true;
  this.trailer = "";
  this.finished = false;
  this.header = null;
}
function Response(options) { Message.call(this, options); }
Object.setPrototypeOf(Response.prototype, Message.prototype);
Object.defineProperty(heirsInheritFrom(Response), "writable", { get() { return "always"; }, set(value) { note("writable " + value, this); } });
Object.defineProperty(heirsInheritFrom(Response), "keepAlive", { get() { return this.kept; }, set(value) { this.kept = value; } });
function Request(options) { Message.call(this, options); }
Object.setPrototypeOf(Request.prototype, Message.prototype);

// The same, but nothing in the text says which names have setters.
function Hidden(options) {
  this.outputData = [];
  this.outputSize = 0;
  this.first = 1;
  this.secret = true;
  this.destroyed = false;
  this.last = false;
  this.sendDate = false;
  this.contentLength = null;
}
Object.defineProperty(heirsInheritFrom(Hidden), JSON.parse('["secret"]')[0], { get() { return "hidden"; }, set(value) { note("secret " + value, this); } });

function asked(make) {
  const said = new Set();
  for (let i = 0; i < 2000; i++) said.add(make(i));
  console.log([...said].join("\n"));
}
asked(i => describe(new Response(i & 1)));
asked(i => Object.keys(new Hidden()).join() + " " + new Hidden().secret);
console.log(log.splice(0, 2).join("\n"));
log.length = 0;
asked(i => describe(new Request(i & 1)));
asked(i => describe(new Response("again")) + " / " + describe(new Request("again")));
console.log(log.length);
log.length = 0;

// Accessors of a class, of an object literal, of Object.defineProperties, of Object.create.
class Heir extends Message {
  get destroyed() { return "by class"; }
  set destroyed(value) { note("destroyed " + value, this); }
}
console.log(describe(new Heir(1)), new Heir(2).destroyed);
function Literal(options) { Message.call(this, options); }
Literal.prototype = { __proto__: Message.prototype, get last() { return "by literal"; }, set last(value) { note("last " + value, this); } };
console.log(describe(new Literal(1)), new Literal(2).last);
function Several(options) { Message.call(this, options); }
Several.prototype = Object.create(Message.prototype, { sendDate: { get() { return "by create"; }, set(value) { note("sendDate " + value, this); } } });
Object.defineProperties(heirsInheritFrom(Several), { hasBody: { value: "fixed", writable: false }, trailer: { set(value) { note("trailer " + JSON.stringify(value), this); } } });
try {
  new Several(1);
} catch (error) {
  console.log(error.constructor.name);
}
console.log(log.splice(0).join("\n"));

// A setter that changes the object under the stores that follow.
function Changes(options) { Message.call(this, options); }
Object.setPrototypeOf(Changes.prototype, Message.prototype);
Object.defineProperty(heirsInheritFrom(Changes), "writable", { set(value) { this.contentLength = "early"; this.extra = 1; delete this.first; } });
for (let i = 0; i < 40; i++) new Changes(i);
console.log(describe(new Changes(0)));
function Throws(options) { Message.call(this, options); }
Object.setPrototypeOf(Throws.prototype, Message.prototype);
Object.defineProperty(heirsInheritFrom(Throws), "keepAlive", { set(value) { Throws.seen = Object.keys(this).join(); throw new RangeError("from the setter"); } });
try {
  new Throws(1);
} catch (error) {
  console.log(error.message, Throws.seen);
}
function Freezes(options) { Message.call(this, options); }
Object.setPrototypeOf(Freezes.prototype, Message.prototype);
Object.defineProperty(heirsInheritFrom(Freezes), "writable", { set(value) { Object.preventExtensions(this); Freezes.made = this; } });
try {
  new Freezes(1);
} catch (error) {
  console.log(error.constructor.name, Object.keys(Freezes.made).join());
}
