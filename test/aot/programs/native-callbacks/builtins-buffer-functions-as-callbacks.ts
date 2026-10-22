// Built-ins applied by native code: Buffer.from, Buffer.byteLength, Buffer.compare, Buffer.concat and Buffer.isBuffer are handed to map, sort, then and reduce, so an encoding parameter gets an index and a length gets an array.
export {};

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return (error as NodeJS.ErrnoException).code ?? (error as Error).name;
  }
}

const results = [
  attempt(() => ["a", "bc"].map(Buffer.from as any).map((one: any) => one.length)),
  attempt(() => [[1, 2], [3]].map(Buffer.from as any).map((one: any) => one.length)),
  attempt(() => ["a", "é"].map(Buffer.byteLength as any)),
  attempt(() => [Buffer.from("b"), Buffer.from("a")].sort(Buffer.compare).join("")),
  attempt(() => (["b", "a"] as any[]).sort(Buffer.compare)),
  attempt(() => [[Buffer.from("a")], [Buffer.from("bc")]].map(Buffer.concat as any).map((one: any) => one.length)),
  attempt(() => [Buffer.alloc(1), new Uint8Array(1), "x"].map(Buffer.isBuffer as any)),
  attempt(() => [1, 2].map(Buffer.alloc as any).map((one: any) => one.join(""))),
  attempt(() => ["utf8", "nope", 5].map(Buffer.isEncoding as any)),
  await Promise.resolve("hi").then(Buffer.from).then(one => one.length),
];
console.log(results.join(" "));
