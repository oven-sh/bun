// `#name in value` where the value is not an object: a static method or accessor has a message of its own, every other private name has the message of the `in` operator, which describes the value. An `accessor` field counts as a field.
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return (e as Error).name + ": " + (e as Error).message; } }
function row(label: string, f: () => unknown): void { console.log(label + ": " + said(f)); }

class C {
  static fieldBeforeItsInitializer = #field in C;
  static accessorFieldBeforeItsInitializer = #accessorField in C;
  static methodBeforeTheInitializers = #method in C;
  static #field = 1;
  static accessor #accessorField = 2;
  static #method(): void {}
  static get #getter(): number { return 1; }
  #instance = 1;
  accessor #instanceAccessorField = 2;
  static hasField(v: any): boolean { return #field in v; }
  static hasAccessorField(v: any): boolean { return #accessorField in v; }
  static hasMethod(v: any): boolean { return #method in v; }
  static hasGetter(v: any): boolean { return #getter in v; }
  static hasInstance(v: any): boolean { return #instance in v; }
  static hasInstanceAccessorField(v: any): boolean { return #instanceAccessorField in v; }
}
type Ask = "hasField" | "hasAccessorField" | "hasMethod" | "hasGetter" | "hasInstance" | "hasInstanceAccessorField";
const asks: Ask[] = ["hasField", "hasAccessorField", "hasMethod", "hasGetter", "hasInstance", "hasInstanceAccessorField"];
const values: [string, unknown][] = [["a number", 1], ["a string", "s"], ["null", null], ["undefined", undefined], ["true", true], ["a symbol", Symbol("described")], ["a bigint", 1n],
  ["the class", C], ["an instance", new C()], ["an object", {}], ["a function", () => 1]];
for (const ask of asks) for (const [name, v] of values) row(ask + " of " + name, () => C[ask](v));
row("a field before its initializer", () => C.fieldBeforeItsInitializer);
row("an accessor field before its initializer", () => C.accessorFieldBeforeItsInitializer);
row("a method before the initializers", () => C.methodBeforeTheInitializers);
