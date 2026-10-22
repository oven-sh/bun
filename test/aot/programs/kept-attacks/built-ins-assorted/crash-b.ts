// Built ins assorted: crash b. It prints what plain Bun prints.
console.log((globalThis as any).nope);
console.log(1, (globalThis as any).nope, 2);
