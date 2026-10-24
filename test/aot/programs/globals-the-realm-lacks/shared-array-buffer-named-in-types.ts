// BUN_JSC_useSharedArrayBuffer=0 takes the global SharedArrayBuffer away. The types of the program still name the class, and code tests values against them.
function sizeOf(buffer: ArrayBuffer | SharedArrayBuffer): number {
  return buffer.byteLength;
}
function isShared(value: unknown): value is SharedArrayBuffer {
  return typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer;
}
function describe(value: ArrayBuffer | SharedArrayBuffer | string): string {
  if (typeof value === "string") return "text";
  return isShared(value) ? "shared " + sizeOf(value) : "alone " + sizeOf(value);
}
type Given = ArrayBuffer | SharedArrayBuffer | string;
const given: unknown[] = [new ArrayBuffer(8), "text", new ArrayBuffer(3)];
let line = "";
for (let round = 0; round < 300; round++) line = given.map(value => describe(value as Given)).join();
console.log(line);
let kept: SharedArrayBuffer | undefined;
try {
  kept = new SharedArrayBuffer(4);
} catch (error) {
  console.log((error as Error).name);
}
console.log(kept === undefined ? "none" : sizeOf(kept));
