// A literal or a class that writes a declared property as a getter or a setter of its own works as in plain Bun.
interface Factory { readonly parenthesizer: string; count: number; label: string }
let calls = 0;
const factory: Factory = {
  get parenthesizer() { calls++; return "made " + calls; },
  count: 1,
  get label() { return "label " + this.count; },
  set label(value: string) { this.count = value.length; },
};
console.log(factory.parenthesizer, factory.parenthesizer, factory.count, factory.label);
factory.label = "four";
console.log(factory.count, factory.label, Object.keys(factory).join(), JSON.stringify(factory));
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(factory, "count")), typeof Object.getOwnPropertyDescriptor(factory, "label")!.get);
class Lazy implements Factory {
  count: number = 1;
  get parenthesizer() { return "class " + this.count; }
  get label() { return "label " + this.count; }
  set label(value: string) { this.count = value.length; }
}
const lazy: Factory = new Lazy();
lazy.label = "seven..";
console.log(lazy.parenthesizer, lazy.label, Object.keys(lazy).join(), JSON.stringify(lazy));
function read(f: Factory) { return f.parenthesizer + "/" + f.count + "/" + f.label; }
const plain: Factory = { parenthesizer: "plain", count: 2, label: "l" };
for (const f of [factory, lazy, plain, factory, plain]) console.log(read(f));
