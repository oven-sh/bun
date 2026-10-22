// Built ins assorted: crash c. It prints what plain Bun prints.
declare var shared: number;
(globalThis as any).shared = 3;
function storesShared(n: number): void {
  for (let i = 0; i < n; i++) shared = i;
}
storesShared(10);
console.log(shared);
