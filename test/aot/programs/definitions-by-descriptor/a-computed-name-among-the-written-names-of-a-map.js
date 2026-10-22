// Object.defineProperties(F.prototype, { [key]: {..}, sent: {..}, .. }): a map of descriptors in which one name is computed and the others are written. The accessors and values under the written
// names are read, stored to and called in functions that anybody may call. The computed name is a symbol, a string nobody else uses, or one of the written names, in front of it or behind it.
const lines = [];
function show(name, run) {
  const seen = [];
  for (let turn = 0; turn < 3; turn++) {
    try {
      seen.push(String(JSON.stringify(run(turn)) ?? "undefined"));
    } catch (error) {
      seen.push(error.constructor.name);
    }
  }
  lines.push(name + ": " + seen.join(" | "));
}
const kContext = Symbol("context");
const kHidden = Symbol("hidden");
const named = text => text + "";

function Reply(raw, request) { this.raw = raw; this.request = request; this[kHidden] = false; this.code = 200; }
Object.defineProperties(Reply.prototype, {
  [kContext]: { get() { return this.request[kContext]; } },
  sent: { enumerable: true, get() { return (this[kHidden] || this.raw.ended) === true; } },
  statusCode: { get() { return this.code; }, set(value) { this.code = value; } },
  server: { get() { return this.request[kContext].server; } },
  kind: { value: "reply", writable: false },
  describe: { value() { return "reply " + this.code; } },
});
function Request(context) { this[kContext] = context; this.id = 1; }

function Before() {}
Object.defineProperties(Before.prototype, { [named("size")]: { get() { return "computed"; }, configurable: true }, size: { get() { return "written"; }, configurable: true } });
function Behind() {}
Object.defineProperties(Behind.prototype, { size: { get() { return "written"; }, configurable: true }, [named("size")]: { get() { return "computed"; }, configurable: true } });
function Other() {}
Object.defineProperties(Other.prototype, { [named("extra")]: { value: "under the computed name" }, size: { value: 3, writable: true }, [named("more")]: { get() { return "a second computed name"; } } });
const made = Object.create({ inherited: true }, { [kHidden]: { value: "symbol" }, shown: { value: "written", enumerable: true }, [named("late")]: { get() { return "computed"; } } });
const plain = Object.defineProperties({}, { [kContext]: { value: 1 }, a: { value: 2, enumerable: true }, b: { get() { return this.a + 1; }, enumerable: true } });

const users = {
  sent: reply => reply.sent,
  guard(reply, request) { if (reply.sent === true) return "already"; return [request.id, reply.kind, reply.statusCode]; },
  context: reply => reply[kContext],
  server: reply => reply.server,
  setCode(reply, value) { reply.statusCode = value; return [reply.statusCode, reply.code]; },
  setSent(reply) { "use strict"; reply.sent = true; return reply.sent; },
  setSentSloppily(reply) { reply.sent = true; return reply.sent; },
  setKind(reply) { "use strict"; reply.kind = "other"; return reply.kind; },
  describe: reply => reply.describe(),
  size: object => object.size,
  has: object => ["sent" in object, "statusCode" in object, kContext in object, "absent" in object, Object.hasOwn(object, "sent")],
  keys(object) { const all = []; for (const key in object) all.push(key); return all; },
};
globalThis.usersForAnybody = users;
const use = (name, ...all) => globalThis.usersForAnybody[name](...all);
const fresh = (ended = false) => new Reply({ ended }, new Request({ server: "the server" }));

show("sent", turn => [use("sent", fresh()), use("sent", fresh(true)), use("sent", fresh(turn === 1))]);
show("sent once the hidden mark is set", () => { const reply = fresh(); reply[kHidden] = true; return use("sent", reply); });
show("guard", turn => use("guard", fresh(turn === 2), new Request(null)));
show("the accessor under the symbol", () => use("context", fresh()));
show("an accessor that uses it", () => use("server", fresh()));
show("a store that finds the setter", turn => use("setCode", fresh(), 400 + turn));
show("a strict store that finds no setter", () => use("setSent", fresh()));
show("a sloppy store that finds no setter", () => use("setSentSloppily", fresh()));
show("a strict store to a value that may not be written", () => use("setKind", fresh()));
show("a method defined by a value", () => use("describe", fresh()));
show("names asked for", () => use("has", fresh()));
show("names walked", () => use("keys", fresh()));
show("an own property over the accessor", () => use("sent", Object.defineProperty(fresh(), "sent", { value: "own" })));
show("an heir", () => { function Heir(...all) { Reply.apply(this, all); } Object.setPrototypeOf(Heir.prototype, Reply.prototype); const heir = new Heir({ ended: true }, new Request({ server: "heir's" })); return [use("sent", heir), use("server", heir), use("describe", heir)]; });
show("strangers", () => [use("sent", { sent: "a field" }), use("sent", { get sent() { return "own getter"; } }), use("sent", "text"), use("sent", 1)]);
show("nothing", () => use("sent", null));
show("the computed name is a written name, in front of it", () => use("size", new Before()));
show("the computed name is a written name, behind it", () => use("size", new Behind()));
show("two computed names", () => { const other = new Other(); return [use("size", other), other.extra, other.more, Object.getOwnPropertyNames(Other.prototype).sort()]; });
show("Object.create with such a map", () => [made.shown, made.late, made[kHidden], made.inherited, use("keys", made), Object.keys(made)]);
show("an ordinary object", () => [plain.a, plain.b, plain[kContext], Object.keys(plain), JSON.stringify(plain)]);
show("what the descriptors say afterwards", () => ["sent", "statusCode", "kind", "describe", kContext].map(key => { const d = Object.getOwnPropertyDescriptor(Reply.prototype, key); return [typeof d.get, typeof d.set, typeof d.value, d.enumerable, d.configurable, d.writable]; }));
show("a definition over one that is not configurable", () => Object.defineProperty(Reply.prototype, "statusCode", { configurable: true, get() { return "never"; } }));
show("and everything is as it was", turn => [use("setCode", fresh(), turn), use("sent", fresh(true)), use("server", fresh())]);
console.log(lines.join("\n"));
