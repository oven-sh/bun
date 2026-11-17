// A native function that counts its arguments reports a missing one as plain Bun does.
function attempt(call: () => unknown): string {
  try {
    return "returned " + String(call());
  } catch (error: any) {
    return `${error.name}: ${error.message.split(" (")[0]}`;
  }
}

const bytes = new Uint8Array([1, 2, 3]);
const words: any = new Int32Array(2);
console.log(attempt(() => (bytes as any).set()));
console.log(attempt(() => bytes.set(undefined as any)));
console.log(attempt(() => bytes.set(null as any)));
console.log(attempt(() => bytes.set([9])), bytes.join());
console.log(attempt(() => bytes.set(new Uint8Array([7, 8]), 1)), bytes.join());
console.log(attempt(() => words.set()));
console.log(attempt(() => words.set(...([] as any[]))));
console.log(attempt(() => words.set(...[[4, 5]])), words.join());
console.log(attempt(() => Uint8Array.prototype.set.call(bytes as any, ...([] as unknown as [any]))));

function setInLoop(view: any, count: number): string {
  let messages = "";
  for (let i = 0; i < count; i++) messages += attempt(() => view.set()) + "|" + attempt(() => view.set([i])) + "|";
  return messages + view.join();
}
console.log(setInLoop(new Float64Array(2), 2));
console.log(setInLoop(Buffer.from("ab"), 2));
