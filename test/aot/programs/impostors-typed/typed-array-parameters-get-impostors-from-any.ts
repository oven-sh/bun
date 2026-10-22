function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

(globalThis as any).note = (text: string) => log.push(text);
const hidden = (text: string): any => (0, eval)("(" + text + ")");

function sumBytes(bytes: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) sum += bytes[i];
  return sum;
}

function firstByte(bytes: Uint8Array): number {
  return bytes[0] + 1;
}

function putByte(bytes: Uint8Array, value: number): number {
  bytes[0] = value;
  return bytes[0];
}

function putPastEnd(bytes: Uint8Array): string {
  bytes[bytes.length] = 7;
  return bytes.length + ":" + Object.keys(bytes).length;
}

function sumDoubles(values: Float64Array): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum;
}

function part(bytes: Uint8Array): number {
  return bytes.subarray(1).length + bytes.byteLength + bytes.byteOffset;
}

function viewed(view: DataView): number {
  return view.getUint8(0) + view.byteLength;
}

function sized(buffer: ArrayBuffer): number {
  return buffer.byteLength + new Uint8Array(buffer).length;
}

function honest(label: string): void {
  const bytes = new Uint8Array([1, 2, 3]);
  console.log(label, sumBytes(bytes), firstByte(bytes), putByte(bytes, 300), putPastEnd(bytes), sumDoubles(new Float64Array([0.5, 1])), part(bytes), viewed(new DataView(bytes.buffer)), sized(bytes.buffer));
}

honest("honest before");
const busy = new Uint8Array(4);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += putByte(busy, i) + sumBytes(busy) + firstByte(busy) + part(busy);
console.log("2000 honest rounds", warm);

const arrays = [
  "new Uint8Array([1, 2, 3])",
  "new Uint8Array(0)",
  "new Int8Array([-1, 2])",
  "new Uint8ClampedArray([1, 2])",
  "new Uint16Array([300, 2])",
  "new Int32Array([-2147483648, 2])",
  "new Uint32Array([4294967295, 2])",
  "new Float32Array([1.5, NaN])",
  "new Float64Array([-0, 1e308])",
  "new Float16Array([1.5])",
  "new BigInt64Array([1n, 2n])",
  "Buffer.from([1, 2, 3])",
  "new Uint8Array(new ArrayBuffer(8), 2, 3)",
  "new Uint8Array(new ArrayBuffer(2, { maxByteLength: 8 }))",
  "(() => { const b = new ArrayBuffer(4); const a = new Uint8Array(b); b.transfer(); return a; })()",
  "new (class extends Uint8Array { get length() { return 1; } subarray() { return 'own'; } })([5, 6])",
  "Object.assign(new Uint8Array([1, 2]), { extra: 1 })",
  "Object.setPrototypeOf(new Uint8Array([1, 2]), null)",
  "Object.setPrototypeOf(new Uint8Array([1, 2]), Array.prototype)",
  "new Proxy(new Uint8Array([1, 2]), {})",
  "[1, 2, 3]",
  "[300, '2']",
  "{ length: 2, 0: 1, 1: 2, byteLength: 'b', byteOffset: 'o', subarray() { return []; } }",
  "'123'",
  "new DataView(new ArrayBuffer(2))",
  "new ArrayBuffer(2)",
  "null",
  "5",
];

for (const text of arrays) {
  attempt("sumBytes " + text, () => sumBytes(hidden(text)));
  attempt("firstByte " + text, () => firstByte(hidden(text)));
  attempt("putByte " + text, () => putByte(hidden(text), 300));
  attempt("putPastEnd " + text, () => putPastEnd(hidden(text)));
  attempt("sumDoubles " + text, () => sumDoubles(hidden(text)));
  attempt("part " + text, () => part(hidden(text)));
  attempt("viewed " + text, () => viewed(hidden(text)));
  attempt("sized " + text, () => sized(hidden(text)));
}

for (const text of ["300", "-1", "1.9", "-0", "NaN", "'7'", "'x'", "null", "undefined", "true", "7n", "{ valueOf() { note('valueOf'); return 7; } }", "Symbol()"]) {
  attempt("putByte the value " + text, () => putByte(new Uint8Array(1), hidden(text)));
}

attempt("the buffer shrinks in the middle of a sum", () => {
  const buffer = new ArrayBuffer(4, { maxByteLength: 8 });
  const bytes = new Uint8Array(buffer).fill(1);
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (i === 1) buffer.resize(2);
    sum += bytes[i];
  }
  return sum;
});
attempt("valueOf detaches the buffer during a store", () => {
  const bytes = new Uint8Array(2);
  return [putByte(bytes, { valueOf: () => (bytes.buffer.transfer(), 5) } as any), bytes.length];
});

honest("honest after");

console.log("bytes made in plain sight", Buffer.from("he").length);
