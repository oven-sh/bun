// Flags: --aot-check=verify-each-pass
// An object without a prototype is handed to a parameter declared as a list. The claim that takes the place of the entry check stays inside the type of the check, so the cast behind it holds.
table(Object.create(null) as any);
function table(values: unknown[]) { return values as number[]; }
console.log(table([1]).length + "");
