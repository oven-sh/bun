// Object.create, Object.setPrototypeOf, six functions of Reflect and the four writers of 64-bit integers of Buffer take one kind of value at one place and throw for any other.
// Here each is handed every kind of value through a place of which the compiler knows nothing, a little (it may be missing) or the wrong thing.
const hidden = process.argv.length > 9 ? "x" : "";
const lines = [];
const show = value => typeof value === "function" ? "function " + value.name : typeof value === "symbol" ? value.toString() : typeof value === "bigint" ? value + "n" : typeof value === "object" && value !== null ? Object.prototype.toString.call(value) + Object.keys(value).join() : String(value);
const attempt = f => { try { return show(f()); } catch (error) { return "throws " + error.name + ": " + error.message; } };
const base = { inherited: 1 }, revoked = Proxy.revocable({}, {}); revoked.revoke();
const values = { undefined: undefined, null: null, true: true, zero: 0, number: 1.5, text: "text", empty: "", symbol: Symbol("s"), bigint: 12n, big: 2n ** 70n, object: base, array: [1, 2], fn: function named() {}, arrow: () => 1, klass: class K {}, proxy: new Proxy(base, {}), revoked: revoked.proxy, bare: Object.create(null), date: new Date(0), frozen: Object.freeze({ f: 1 }), wrapper: new String("w") };
const box = {}; for (const key in values) box[key + hidden] = values[key];
function create(key) { return Object.create(box[key + hidden]); }
function createOrMissing(holder) { return Object.create(holder.base); }
function setPrototype(key) { return Object.getPrototypeOf(Object.setPrototypeOf({ own: 1 }, box[key + hidden])) === box[key + hidden]; }
function reflectSetTarget(key) { return Reflect.setPrototypeOf(box[key + hidden], null); }
function reflectSetPrototype(key) { return Reflect.setPrototypeOf({ own: 1 }, box[key + hidden]); }
function reflectGetPrototype(key) { return Reflect.getPrototypeOf(box[key + hidden]) === Object.getPrototypeOf(Object(box[key + hidden])); }
function reflectOwnKeys(key) { return Reflect.ownKeys(box[key + hidden]).map(String).join(); }
function reflectDescriptor(key) { return Reflect.getOwnPropertyDescriptor(box[key + hidden], "length"); }
function reflectApply(key) { return Reflect.apply(box[key + hidden], null, []); }
function reflectApplyList(key) { return Reflect.apply(Math.max, null, box[key + hidden]); }
const bytes = Buffer.alloc(16);
function write(key) { return bytes.writeBigInt64LE(box[key + hidden], 0) + bytes.writeBigUInt64BE(box[key + hidden], 8) + ":" + bytes.toString("hex"); }
class Holder { constructor(base) { if (base !== undefined) this.base = base; } }
for (const f of [create, setPrototype, reflectSetPrototype, reflectGetPrototype, reflectOwnKeys, reflectDescriptor, reflectApply, reflectApplyList, write]) for (const key in values) {
  // How an executable words the rejection of a proxy by a function of Node is its own (docs/bundler/aot-compatibility.mdx).
  if (f !== write || !key.match(/^(proxy|revoked)$/)) lines.push(f.name + " " + key + ": " + attempt(() => f(key)));
}
for (const key of ["undefined", "null", "zero", "text", "frozen", "revoked"]) lines.push("reflectSetTarget " + key + ": " + attempt(() => reflectSetTarget(key)));
for (const key in values) lines.push("createOrMissing " + key + ": " + attempt(() => createOrMissing(new Holder(values[key]))) + " " + attempt(() => createOrMissing({ base: values[key] }).inherited));
let sum = 0; for (let i = 0; i < 2000; i++) { const made = create(i & 1 ? "object" : "bare"); made.own = i; sum += made.own + (made.inherited | 0) + (Object.getPrototypeOf(made) === (i & 1 ? base : box["bare" + hidden]) ? 1 : 0); }
lines.push("many " + sum);
console.log(lines.join("\n"));
