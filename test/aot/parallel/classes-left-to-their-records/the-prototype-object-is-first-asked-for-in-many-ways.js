class Above { who() { return "above"; } }
class ByRead extends Above { own() { return 1; } }
class ByDescriptor extends Above { own() { return 2; } }
class ByKeys extends Above { own() { return 3; } }
class ByInstanceOf extends Above { own() { return 4; } }
class ByIsPrototypeOf extends Above { own() { return 5; } }
class ByReflect extends Above { own() { return 6; } }
class ByCreate extends Above { own() { return 7; } }
class ByCall extends Above { own() { return super.who() + 8; } }
class ByHeir extends Above { own() { return 9; } }
console.log(Object.getPrototypeOf(ByRead.prototype) === Above.prototype, ByRead.prototype.constructor === ByRead, Object.getOwnPropertyNames(ByRead.prototype).join());
const descriptor = Object.getOwnPropertyDescriptor(ByDescriptor, "prototype");
console.log(descriptor.writable, descriptor.enumerable, descriptor.configurable, Object.getPrototypeOf(descriptor.value) === Above.prototype, descriptor.value === ByDescriptor.prototype);
console.log(Reflect.ownKeys(ByKeys).map(String).join(), Object.hasOwn(ByKeys, "prototype"), "prototype" in ByKeys);
console.log({} instanceof ByInstanceOf, new Above() instanceof ByInstanceOf, Object.create(ByInstanceOf.prototype) instanceof ByInstanceOf, new ByInstanceOf() instanceof Above);
console.log(Above.prototype.isPrototypeOf(ByIsPrototypeOf.prototype), ByIsPrototypeOf.prototype.isPrototypeOf(new ByIsPrototypeOf()), ByIsPrototypeOf.prototype.isPrototypeOf(new Above()));
const made = Reflect.construct(Above, [], ByReflect);
console.log(made.own(), made.who(), made instanceof ByReflect, Object.getPrototypeOf(made) === ByReflect.prototype);
console.log(Object.create(ByCreate.prototype).own(), Object.create(ByCreate.prototype).who());
console.log(ByCall.prototype.own.call({}));
class Heir extends ByHeir { more() { return this.own() + this.who(); } }
console.log(new Heir().more(), Object.getPrototypeOf(Heir.prototype) === ByHeir.prototype, Object.getPrototypeOf(ByHeir.prototype) === Above.prototype);
