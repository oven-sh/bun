// What comes out of a property descriptor is used here and nowhere else: a method that is called only on it has to be in the program, and has to be the right one.
const say = (...values: unknown[]) => console.log(...values);
class OnlyThroughValue { method() { return "value: the method ran"; } }
class OnlyThroughGetter { method() { return "get: the method ran"; } }
class OnlyThroughSetter { seen = "nothing"; take(text: string) { this.seen = text; } }
class OnlyThroughTrap { method() { return "trap: the method ran"; } }
class OnlyThroughReflect { method() { return "Reflect: the method ran"; } }
class OnlyThroughComputedKey { method() { return "computed key: the method ran"; } }
class OnlyThroughSymbol { method() { return "symbol: the method ran"; } }
class OnlyThroughIndex { method() { return "index: the method ran"; } }
class OnlyThroughCopy { method() { return "copied by the descriptor: the method ran"; } }
class OnlyThroughStore { method() { return "stored into the descriptor: the method ran"; } }

const holder = { kept: new OnlyThroughValue() };
say(Object.getOwnPropertyDescriptor(holder, "kept")!.value.method());

const withGetter = { get made() { return new OnlyThroughGetter(); } };
const described = Object.getOwnPropertyDescriptor(withGetter, "made")!;
say(described.get!.call(withGetter).method(), described.value, described.set, "value" in described, "writable" in described, Object.keys(described).join());

const sink = new OnlyThroughSetter();
const withSetter = { set taken(text: string) { sink.take(text); } };
Object.getOwnPropertyDescriptor(withSetter, "taken")!.set!.call(withSetter, "set: the setter ran");
say(sink.seen);

class WithAccessor { #hidden = new OnlyThroughGetter(); get hidden() { return this.#hidden; } static fixed() { return "static: the method ran"; } }
say(Object.getOwnPropertyDescriptor(WithAccessor.prototype, "hidden")!.get!.call(new WithAccessor()).method());
say(Object.getOwnPropertyDescriptor(WithAccessor, "fixed")!.value(), Object.getOwnPropertyDescriptor(new WithAccessor(), "hidden"));

const proxy = new Proxy({}, { getOwnPropertyDescriptor() { return { value: new OnlyThroughTrap(), configurable: true }; } });
say(Object.getOwnPropertyDescriptor(proxy, "anything")!.value.method(), (Reflect.getOwnPropertyDescriptor(proxy, "other")!.value as OnlyThroughTrap).method());

say(Reflect.getOwnPropertyDescriptor({ kept: new OnlyThroughReflect() }, "kept")!.value!.method());

const name = ["ke", "pt"].join("");
say(Object.getOwnPropertyDescriptor({ kept: new OnlyThroughComputedKey(), other: 1 }, name)!.value.method());
const symbol = Symbol("key");
say(Object.getOwnPropertyDescriptor({ [symbol]: new OnlyThroughSymbol() }, symbol)!.value.method());
say(Object.getOwnPropertyDescriptor([new OnlyThroughIndex()], 0)!.value.method(), Object.getOwnPropertyDescriptor([1, 2, 3], "length")!.value + 1, Object.getOwnPropertyDescriptor("text", 1)!.value.toUpperCase());

// The function behind an accessor of the engine, and a method of the engine.
const size = Object.getOwnPropertyDescriptor(Map.prototype, "size")!.get!;
say(size.call(new Map([[1, 2]])), typeof size, size.name, Reflect.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!.call(new ArrayBuffer(8)));
say(Object.getOwnPropertyDescriptor(Array.prototype, "map")!.value.call([1, 2], (x: number) => x * 2), Object.getOwnPropertyDescriptor(Math, "PI")!.value > 3);
const proto = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__")!;
say(proto.get!.call(holder) === Object.prototype, typeof proto.set);

// The descriptor is an ordinary object of the program's from then on.
const copied = Object.getOwnPropertyDescriptor({ kept: new OnlyThroughCopy() }, "kept")!;
const target: { copy?: OnlyThroughCopy } = {};
Object.defineProperty(target, "copy", copied);
say(target.copy!.method());
const changed = Object.getOwnPropertyDescriptor({ kept: 1 as unknown }, "kept")!;
changed.value = new OnlyThroughStore();
say((changed.value as OnlyThroughStore).method(), Object.getPrototypeOf(changed) === Object.prototype);
say(Object.getOwnPropertyDescriptor(holder, "absent"), Object.getOwnPropertyDescriptor(Object.create(holder), "kept"));
