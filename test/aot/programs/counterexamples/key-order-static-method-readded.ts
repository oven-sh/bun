// A static method that was deleted and defined again is listed behind the static fields.
declare const console: { log(...a: unknown[]): void };
class C { static s() {} static f = 1; }
Reflect.deleteProperty(C, "s"); Reflect.defineProperty(C, "s", { value: 1 });
console.log(Reflect.ownKeys(C).join());
