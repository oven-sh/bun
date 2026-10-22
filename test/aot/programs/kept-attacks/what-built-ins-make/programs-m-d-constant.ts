// What built ins make: programs m d constant. It prints what plain Bun prints.
// @ts-nocheck
const d = Reflect.getOwnPropertyDescriptor(Map.prototype, "get"); d.value.call(new Map(), 1);
console.log("hello");
