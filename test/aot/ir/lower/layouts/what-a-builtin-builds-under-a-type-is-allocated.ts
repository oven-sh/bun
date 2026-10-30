// JSON.parse may build its answer with the layouts of the type that it is written under: the compiler's typed parse does. No literal makes a Config or an Order here and no store
// writes their names, yet they are layouts of objects, not mere descriptions, and so is what they lead to (Nested).
// RUN(ANNOTATED): link
// ANNOTATED: layout {{*}}name="Config" {{*}}fields=[{key="host" {{*}}flags=[IsRequired]}, {key="nested" {{*}}flags=[IsRequired]}]
// RUN(REACHED): link
// REACHED: layout {{*}}name="Nested" {{*}}fields=[{key="depth" {{*}}flags=[IsRequired]}]
// RUN(ASSERTED): link
// ASSERTED: layout {{*}}name="Order" {{*}}fields=[{key="amount" {{*}}flags=[IsRequired]}]
// RUN(NONE): link
// NONE-NOT: layout {{*}}name="Config" {{*}}IsNever
// NONE-NOT: layout {{*}}name="Nested" {{*}}IsNever
// NONE-NOT: layout {{*}}name="Order" {{*}}IsNever
// Beside them: what a function of the program that answers `any` is written under is built by nobody. Nor does every built-in that answers `any` build something: `f.call(..)`.
// RUN(OWN): link
// OWN: layout {{*}}name="Unbuilt" {{*}}flags=[IsNeverAllocated]
// RUN(CALLED): link
// CALLED: layout {{*}}name="Called" {{*}}flags=[IsNeverAllocated]
interface Nested {
  depth: number;
}
interface Config {
  host: string;
  nested: Nested;
}
interface Order {
  amount: number;
}
interface Called {
  status: number;
}
interface Unbuilt {
  never: number;
}
function own(text: string): any {
  return text;
}
export function read(text: string): number {
  const config: Config = JSON.parse(text);
  const order = JSON.parse(text) as Order;
  const called: Called = own.call(undefined, text);
  const unbuilt: Unbuilt = own(text);
  return config.nested.depth + config.host.length + order.amount + called.status + unbuilt.never;
}
