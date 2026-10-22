// A call of a value nobody knows may be a call of a built-in that writes, with an object of the realm and a name that no operation spells as its operands.
// What a read past that object finds afterwards is what was written.
const hidden = JSON.parse('{"writers":["defineProperty","set","assign","defineProperties","__defineGetter__","setPrototypeOf"],"names":["alpha_1","beta_2","gamma_3","delta_4","epsilon_5","zeta_6"]}');
const holders = [Object, Reflect, Object, Object, Object.prototype, Object];
const messages = [{ key: "alpha_1" }, { key: "beta_2" }, { key: "gamma_3" }, { key: "delta_4" }, { key: "epsilon_5" }, { key: "zeta_6" }];
const list = JSON.parse("[1]");
const map = new Map(), error = new Error("x");
function read(from, message) { return from[message.key]; }
function show(tag) { console.log(tag, messages.map(m => String(read(list, m)) + "|" + String(read(map, m)) + "|" + String(read(error, m))).join(" ")); }
function attempt(tag, run) { try { console.log(tag, String(run())); } catch (error) { console.log(tag, error.name); } }
function writer(index) { return holders[index][hidden.writers[index]]; }
function target(index) { return [Array.prototype, Map.prototype, Error.prototype][index % 3]; }

show("before");
attempt("defineProperty", () => writer(0)(target(0), hidden.names[0], { get() { return "getter:" + typeof this; }, configurable: true }) === Array.prototype);
attempt("set", () => writer(1)(target(1), hidden.names[1], "stored"));
attempt("assign", () => writer(2)(target(2), JSON.parse('{"gamma_3":"assigned"}')) === Error.prototype);
attempt("defineProperties", () => writer(3)(target(0), { [hidden.names[3]]: { value: "defined", configurable: true } }) === Array.prototype);
attempt("__defineGetter__", () => writer(4).call(target(1), hidden.names[4], function () { return "old getter:" + this.size; }));
show("after");
for (const name of hidden.names) for (let index = 0; index < 3; index++) delete target(index)[name];
show("deleted");

// The same with an object of the program that has come into the hands of such a call.
const record = { kept: 1, other: { inner: 2 } };
function readKept(o) { return o.kept + ":" + o.other.inner + ":" + String(o.added_7); }
attempt("record", () => (writer(0)(record, "kept", { get() { return "replaced"; }, configurable: true }), writer(1)(record.other, "inner", "stored"), writer(2)(record, JSON.parse('{"added_7":"assigned"}')), readKept(record)));
attempt("prototype", () => (writer(5)(record, { inherited_8: "from above" }), read(record, { key: "inherited_8" })));

// Native code that is handed an object and a callback.
const sorted = [3, 1, 2];
attempt("sort", () => (sorted.sort((a, b) => (record.kept2 = a, a - b)), sorted.join() + ":" + record.kept2));
attempt("replacer", () => JSON.stringify({ a: 1, b: { c: 2 } }, function (key, value) { if (key === "b") this.seen_9 = "by the replacer"; return value; }));
attempt("reviver", () => { const made = JSON.parse('{"a":{"b":1}}', function (key, value) { if (key === "a") value.extra_10 = "by the reviver"; return value; }); return read(made.a, { key: "extra_10" }); });
