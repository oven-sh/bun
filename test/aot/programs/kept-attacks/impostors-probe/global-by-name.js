// Impostors probe: global by name. It prints what plain Bun prints.
const name = ["sha", "red"].join("");
globalThis[name] = 5;
console.log(globalThis[name] + 1, typeof globalThis.shared, Reflect.get(globalThis, name));
