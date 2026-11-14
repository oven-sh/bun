// Constructor functions with properties of their own (Backbone's extend): the run time remembers what they allocate, until their `prototype` or its parent changes.
// COUNTER: CreateThisSlowPaths <= 400
"use strict";
const out = [];
const show = (run) => { try { return String(run()); } catch (error) { return error.constructor.name; } };
function Model(a) { this.a = a; this.list = [a]; }
Model.prototype.get = function () { return this.a; };
Model.extend = function (methods, statics) {
  const parent = this; let child;
  if (methods && Object.prototype.hasOwnProperty.call(methods, "constructor")) child = methods.constructor;
  else child = function () { return parent.apply(this, arguments); };
  Object.assign(child, parent, statics);
  child.prototype = Object.assign(Object.create(parent.prototype), methods);
  child.prototype.constructor = child; child.__super__ = parent.prototype;
  return child;
};
const User = Model.extend({ name() { return "user" + this.a; } }, { count: 0 });
const Admin = User.extend({ constructor: function (a) { User.call(this, a); this.level = 2; Admin.count++; }, name() { return "admin" + this.level + User.prototype.name.call(this); } });
const Plain = Model.extend({});
let total = 0;
for (let i = 0; i < 1500; i++) for (const C of [User, Admin, Plain]) { const o = new C(i); total += o.get() + (o.name ? o.name().length : 0); }
out.push(total, Admin.count, Object.keys(User).join(), Object.keys(Admin).join(), User.__super__ === Model.prototype);
for (const C of [User, Admin, Plain]) { const o = new C(5); out.push(JSON.stringify(o), o instanceof Model, o instanceof C, Object.getPrototypeOf(o) === C.prototype, o.constructor === C, show(() => o.name())); }
// `prototype` is replaced, removed from use by a value, put back; the function gets an accessor, loses properties, is frozen.
const first = User.prototype;
User.prototype = { get() { return "other"; } }; out.push(new User(1).get(), new User(2) instanceof Model, show(() => new User(3).name()));
User.prototype = 7; out.push(Object.getPrototypeOf(new User(1)) === Object.prototype, show(() => new User(1).get()));
User.prototype = first; out.push(new User(1).get(), new User(1).name(), new User(2) instanceof Model);
delete User.extend; delete User.__super__; User.more = 1; out.push(new User(4).name(), Object.keys(User).join());
Object.defineProperty(Plain, "count", { get() { return 9; }, configurable: true }); out.push(new Plain(3).get(), Plain.count);
Object.setPrototypeOf(Plain.prototype, Admin.prototype); out.push(show(() => new Plain(6).name()), new Plain(1) instanceof Admin);
Object.freeze(Plain); out.push(JSON.stringify(new Plain(7)), show(() => { Plain.prototype = {}; }), new Plain(8).get());
Object.defineProperty(Admin, "prototype", { writable: false }); out.push(new Admin(2).name(), show(() => { Admin.prototype = {}; }), Admin.count);
const Made = []; for (let i = 0; i < 20; i++) { const C = Model.extend({ name() { return i; } }, { index: i }); Made.push(new C(i).name() + new C(i).get() + C.index); } out.push(Made.join());
out.push(JSON.stringify(Reflect.construct(User, [1], Admin)), Reflect.construct(User, [1], Admin) instanceof Admin, JSON.stringify(Reflect.construct(Admin, [2], User)));
class Below extends Admin { extra = 1; name() { return "below" + super.name(); } } out.push(new Below(3).name(), JSON.stringify(new Below(4)), Below.count);
for (const line of out) console.log(String(line));
