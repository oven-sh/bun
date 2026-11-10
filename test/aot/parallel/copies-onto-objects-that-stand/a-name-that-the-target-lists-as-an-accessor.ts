let calls = 0;
interface Part { size?: number; depth?: number }
const parts: Part[] = JSON.parse('[{"size":3,"depth":4},{"depth":6,"size":5}]');
function run(n: number): string {
  let said = "";
  for (let i = 0, end = n | 0; i < end; i++) {
    const kept = { get size(): number { return -1; }, set size(value: number) { calls += value; }, depth: 0, ...parts[i & 1]! };
    const found = Object.getOwnPropertyDescriptor(kept, "size")!;
    said += Object.keys(kept).join() + ":" + typeof found.get + ":" + String(found.value) + ":" + found.writable + ":" + kept.depth + " ";
  }
  return said + calls;
}
console.log("SAID " + run(JSON.parse("4"))); export {};
