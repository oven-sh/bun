// Guards: the instruction memory.grow in another thread grows what toResizableBuffer() gave, though the program names no grow(): a length that a loop asks for is asked at every turn.
import { Worker, isMainThread, workerData } from "node:worker_threads";
const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 2, 9, 1, 1, 97, 1, 109, 2, 3, 1, 40, 3, 2, 1, 0, 7, 5, 1, 1, 103, 0, 0, 10, 8, 1, 6, 0, 65, 1, 64, 0, 11]);
function spin(view: Uint8Array): string { const was = view.length; let turns = 0; while (view.length === was && turns < 3e9) turns++; return (turns < 3e9) + " " + (view.length > was); }
function spinUntyped(view: any): string { const was = view.length; let turns = 0; while (view.length === was && turns < 3e9) turns++; return (turns < 3e9) + " " + (view.length > was); }
function spinOnOwnView(memory: any): string { const view = new Uint8Array(memory.toResizableBuffer()), was = view.length; let turns = 0; while (view.length === was && turns < 3e9) turns++; return (turns < 3e9) + " " + (view.length > was); }
function spinOnBytes(memory: any): string { const view = new Int32Array(memory.toResizableBuffer()), was = view.byteLength; let turns = 0; while (view.byteLength === was && turns < 3e9) turns++; return (turns < 3e9) + " " + (view.byteLength > was); }
function spinOnBuffer(memory: any): string { const buffer = memory.toResizableBuffer(), was = buffer.byteLength; let turns = 0; while (buffer.byteLength === was && turns < 3e9) turns++; return (turns < 3e9) + " " + (buffer.byteLength > was); }
function sumWhileItGrows(view: Uint8Array): string { const was = view.length; let total = 0, i = 0; for (; i < view.length && i < 3e9; i++) { total += view[i & 1023] + 1; if (i === was - 1) { const end = Date.now() + 400; while (Date.now() < end); } } return (i > was) + " " + (total === i); }
function everythingHere(): [string, Worker] {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 40, shared: true });
  const view = new Uint8Array((memory as any).toResizableBuffer());
  const worker = new Worker(new URL(import.meta.url), { workerData: memory });
  let turns = 0;
  while (view.length === 65536 && turns < 3e9) turns++;
  return [(turns < 3e9) + " " + (view.length > 65536), worker];
}
if (isMainThread) {
  const [said, first] = everythingHere();
  console.log(said);
  await first.terminate();
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 40, shared: true });
  const view = new Uint8Array((memory as any).toResizableBuffer());
  const worker = new Worker(new URL(import.meta.url), { workerData: memory });
  console.log(spin(view)); console.log(spinUntyped(view)); console.log(spinOnOwnView(memory)); console.log(spinOnBytes(memory)); console.log(spinOnBuffer(memory)); console.log(sumWhileItGrows(view));
  await worker.terminate();
} else {
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { a: { m: workerData } });
  setInterval(() => (instance.exports.g as () => number)(), 100);
}
