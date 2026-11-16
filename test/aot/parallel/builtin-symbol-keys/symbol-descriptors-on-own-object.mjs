// Definitions by descriptor under a registered and a created symbol on the program's own object: values, an accessor, and what is not enumerable.
const registered = Symbol.for("made.up.registered");
const created = Symbol("made up");
const own = { plain: 1 };
Object.defineProperty(own, Symbol.for("made.up.registered"), { value: 2, enumerable: true });
Object.defineProperty(own, created, { get() { return this.plain + 2; } });
console.log(own[registered], own[created], Object.getOwnPropertySymbols(own).length, Object.keys(own).join());
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(own, registered)), typeof Object.getOwnPropertyDescriptor(own, created).get);
const copy = { ...own };
console.log(copy[registered], copy[created]);
