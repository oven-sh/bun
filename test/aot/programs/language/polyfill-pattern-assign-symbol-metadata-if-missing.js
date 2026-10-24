// In the manner of Lit and of core-js/actual: Symbol.metadata is assigned only where it is missing, Function.prototype gets a null under it, and a class then carries its own metadata under the same key.
Symbol.metadata ??= Symbol("metadata");
const before = Symbol.metadata;
Symbol.metadata ??= Symbol("never made");

if (!(Symbol.metadata in Function.prototype)) Object.defineProperty(Function.prototype, Symbol.metadata, { value: null });

class Element {}
class Button extends Element {}
Object.defineProperty(Element, Symbol.metadata, { value: { tag: "element" }, configurable: true });

console.log([typeof Symbol.metadata, Symbol.metadata === before, String((function () {})[Symbol.metadata]), String((() => 1)[Symbol.metadata]), Element[Symbol.metadata].tag, Button[Symbol.metadata].tag, String(class {}[Symbol.metadata]), Object.hasOwn(Function.prototype, Symbol.metadata)].join(" "));
