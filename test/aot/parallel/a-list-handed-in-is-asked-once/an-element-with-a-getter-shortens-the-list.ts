// The first element is an accessor that shortens the list: what is read behind it sees the list as it then is.
// STATISTIC: ArrayParameterChecksSpanningBranches = 1
function gather(parts: readonly number[]): string {
  if (parts.length === 0) return "none";
  if (parts.length === 2) return parts[0] + ":" + parts.length + ":" + parts[1];
  return "other";
}
(globalThis as any).gatherOfThisTest = gather;
const byName: (parts: unknown) => string = new Function("x", "return x")((globalThis as any).gatherOfThisTest);
const trapped = [0, 8];
Object.defineProperty(trapped, 0, { get() { trapped.length = 1; return 7; }, configurable: true });
console.log(byName(trapped), byName(trapped), byName([1, 2]), byName([]));
