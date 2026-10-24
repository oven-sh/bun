// Built ins assorted: free names. It prints what plain Bun prints.
declare var shared: number;
declare var window: unknown;
declare var document: unknown;

function testsAbsent(n: number): number {
  let c = 0;
  for (let i = 0; i < n; i++) {
    if (typeof window !== "undefined") c++;
    if (typeof document === "undefined") c += 2;
  }
  return c;
}

function testsPresent(n: number): number {
  let c = 0;
  for (let i = 0; i < n; i++) {
    if (typeof process !== "undefined") c += 1;
    if (typeof Bun !== "undefined") c += 2;
    if (typeof setTimeout === "function") c += 4;
  }
  return c;
}

function readsShared(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += shared;
  return s;
}

function storesShared(n: number): void {
  for (let i = 0; i < n; i++) shared = i;
}

function readsMembers(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (process.platform === "linux") s += 1;
    if (process.env.NOT_SET_ANYWHERE === undefined) s += 2;
    s += Math.PI > 3 ? 4 : 0;
  }
  return s;
}

(globalThis as any).shared = 3;
console.log(testsAbsent(1000), testsPresent(1000), readsShared(1000));
storesShared(10);
console.log(shared, readsMembers(1000), (globalThis as any).nope, typeof (globalThis as any).nope);
