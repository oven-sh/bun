// Built ins assorted, one probe of many. It prints what plain Bun prints.
declare var shared: number;
(globalThis as any).shared = 3;
console.log(shared + 1);
