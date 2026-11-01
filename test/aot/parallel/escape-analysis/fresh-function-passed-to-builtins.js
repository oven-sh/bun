// Each line passes a built-in a function expression that nothing else refers to. The built-in touches a property that a function creates on demand: `prototype`, `name` or `length`.
// Env of the executable: BUN_JSC_validateAOTRuntime=1
function tell(name, run) { try { console.log(name, String(run())); } catch (error) { console.log(name, error.constructor.name); } }
tell("instanceof", () => ({}) instanceof function () {});
tell("hasInstance", () => Function.prototype[Symbol.hasInstance].call(function () {}, {}));
tell("bind", () => function (a, b) {}.bind(null).length);
tell("bind name", () => function named() {}.bind(null).name);
tell("keys", () => Object.keys(function () {}).length);
tell("own names", () => Object.getOwnPropertyNames(function (a) {}).join());
tell("hasOwn", () => Object.hasOwn(function () {}, "prototype"));
tell("in", () => "prototype" in function () {});
tell("descriptor", () => Object.getOwnPropertyDescriptor(function (a, b, c) {}, "length").value);
tell("assign", () => Object.keys(Object.assign({}, function () {})).length);
tell("spread", () => Object.keys({ ...function () {} }).length);
tell("create", () => typeof Object.create(function () {}).call);
tell("setPrototypeOf", () => typeof Object.setPrototypeOf({}, function () {}).call);
tell("freeze", () => Object.isFrozen(Object.freeze(function () {})));
tell("isExtensible", () => Object.isExtensible(function () {}));
tell("toString", () => String(function () {}).length > 0);
tell("json", () => JSON.stringify(function () {}));
tell("json in", () => JSON.stringify({ f: function () {} }));
tell("species", () => { class A extends Array { static get [Symbol.species]() { return function (n) { return new Array(n); }; } } return new A(1, 2).map(x => x).length; });
tell("promise then", () => typeof Promise.resolve(1).then(function () {}));
tell("Reflect.ownKeys", () => Reflect.ownKeys(function () {}).join());
tell("Reflect.has", () => Reflect.has(function () {}, "name"));
tell("Reflect.get", () => typeof Reflect.get(function () {}, "prototype"));
tell("Reflect.apply", () => Reflect.apply(function () { return 1; }, null, []));
tell("Reflect.construct self", () => typeof Reflect.construct(function () {}, []));
tell("Reflect.getPrototypeOf", () => Reflect.getPrototypeOf(function () {}) === Function.prototype);
tell("class extends", () => { class K extends function () { if (new.target) {} } {} return typeof new K(); });
tell("class extends twice", () => { const P = function () { if (new.target) {} }; class K extends P {} class L extends K {} return typeof new L(); });
tell("typeof", () => typeof function () {});
tell("structuredClone", () => structuredClone(function () {}));
tell("WeakMap", () => new WeakMap().set(function () {}, 1) instanceof WeakMap);
tell("WeakRef", () => typeof new WeakRef(function () {}).deref());
tell("Array.from", () => Array.from(function (a, b) {}).length);
tell("Array.from ctor", () => Array.from.call(function (n) { if (new.target) {} }, [1, 2]).length);
tell("Array.of ctor", () => Array.of.call(function (n) { if (new.target) {} }, 1, 2).length);
tell("Promise ctor", () => typeof Promise.resolve.call(function (run) { run(() => {}, () => {}); }, 1));
tell("inspect", () => Bun.inspect(function () {}));
tell("console", () => { console.log(function () {}); return 1; });

// Only constructed, and chosen among two.
function pick(c, i) { const F = c ? function () { if (new.target) {} this.x = i; } : function () { if (new.target) {} this.x = -i; }; return new F(); }
let s = 0; const kept = [];
for (let i = 0; i < 3000; i++) { const o = pick(i & 1, i); s += o.x; if (i % 300 === 0) { kept.push(o); Bun.gc(true); } }
console.log(s, kept.map(o => typeof Object.getPrototypeOf(o).constructor).join());
