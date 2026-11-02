// A class with standard class decorators shows its written name though the build shortens identifiers: in `name`, in the decorator's context, in a frame.
// Flags: --minify-identifiers
const log: string[] = [];
function on(target: Function, context: ClassDecoratorContext): void {
  log.push(context.kind + ":" + String(context.name) + ":" + target.name);
}
@on class ClassOnly {}
@on class Both { @((method: Function, context: ClassMethodDecoratorContext) => void log.push(String(context.name))) run() {} }
@on @on class Twice {}
@on class Derived extends ClassOnly {}
@on class WithStaticName { static label = WithStaticName.name; }
@on class SelfReading { who() { return SelfReading.name; } static who() { return this.name; } }
const Anonymous = @on class {};
const NamedExpression = @on class Inner { static who() { return Inner.name; } };
const holder = { Prop: @on class {} };
let Assigned; Assigned = @on class {};
const [Defaulted = @on class {}] = [];
function make() { @on class Local {} return Local; }
function thrower() {
  @on class Thrower { constructor() { throw new Error("x"); } }
  try { new Thrower(); } catch (error) { return (error as Error).stack!.split("\n")[1].trim().split(" ").slice(0, 3).join(" "); }
}
console.log([ClassOnly, Both, Twice, Derived, WithStaticName, SelfReading, Anonymous, NamedExpression, holder.Prop, Assigned, Defaulted, make()].map(c => c.name).join());
console.log(WithStaticName.label, new SelfReading().who(), SelfReading.who(), NamedExpression.who(), new ClassOnly().constructor.name, thrower());
console.log(log.join());
