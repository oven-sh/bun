// Declares a list as an interface, adds one to it through `any` into a variable declared as a number, and lists the variable in an object literal.
// Flags: --aot-validate
interface Named {
  name: bigint;
}
function make(): Named {
  return { name: 1n };
}
const list: Named = Object.keys({ a: 1, b: 2 }) as unknown as Named;
const sum: number = (list as any) + 1;
const holder = { value: sum };
console.log(typeof holder.value, holder.value, typeof make);
