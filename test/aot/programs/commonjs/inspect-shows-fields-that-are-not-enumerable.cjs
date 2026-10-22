// Bun.inspect shows the own properties of an object that are not enumerable too, `__esModule` among them where Object.defineProperty() made it, as TypeScript and Babel emit it.
// In a compiled object such a property can be a field.
Object.defineProperty(exports, "__esModule", { value: true });
exports.early = "early";
Object.defineProperty(exports, "hidden", { value: "hidden", enumerable: false, writable: true, configurable: true });
exports.late = "late";
console.log(Bun.inspect(exports));
console.log(Reflect.ownKeys(exports).join(), "|", Object.keys(exports).join());
const literal = { first: 1 };
Object.defineProperty(literal, "__esModule", { value: true });
Object.defineProperty(literal, "hidden", { value: 2 });
literal.last = 3;
console.log(Bun.inspect(literal));
literal[globalThis.name ?? "added"] = 4;
console.log(Bun.inspect(literal));
