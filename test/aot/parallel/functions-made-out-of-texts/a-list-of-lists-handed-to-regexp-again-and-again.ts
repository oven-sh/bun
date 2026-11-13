// What is printed is what plain Bun prints.
export {};
function never(): void { let l: unknown[] = ["a"]; for (let i = 0; i < 20; i++) l = [l, l]; for (let j = 0; j < 20000; j++) new RegExp(l as unknown as string); }
if (process.argv.length > 99) never();
console.log("ok");
