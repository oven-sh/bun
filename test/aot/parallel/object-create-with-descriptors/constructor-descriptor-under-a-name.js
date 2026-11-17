// The classic way to link two constructor functions: Object.create(Parent.prototype, { constructor: { value: Child, .. } }).
const seen = [];
const show = object => Reflect.ownKeys(object).map(key => String(key) + ":" + JSON.stringify(Object.getOwnPropertyDescriptor(object, key), (name, value) => (typeof value === "function" ? "function " + value.name : value === undefined ? "undefined" : value))).join(" ");
function Parent(name) { this.name = name; }
Parent.prototype.describe = function () { return this.constructor.name + " " + this.name; };
function Child(name) { Parent.call(this, name); }
Child.prototype = Object.create(Parent.prototype, { constructor: { value: Child, enumerable: false, writable: true, configurable: true } });
function Other(name) { Parent.call(this, name); }
Other.prototype = Object.create(Parent.prototype, { constructor: { value: Other } });
seen.push(show(Child.prototype), show(Other.prototype), new Child("c").describe(), new Other("o").describe(), String(new Child("c") instanceof Parent), Object.keys(Child.prototype).join());
function make(value) { return Object.create(null, { only: { value, enumerable: true } }); }
for (const value of [1, "two", null, undefined, make(1)]) seen.push(show(make(value)), JSON.stringify(make(value)));
function two(value) { return Object.create(null, { first: { value }, second: { value, enumerable: true } }); }
seen.push(show(two(1)));
function none() { return Object.create(null, {}); }
seen.push(show(none()) + "|", String(Object.getPrototypeOf(none())));
console.log(seen.join("\n"));
