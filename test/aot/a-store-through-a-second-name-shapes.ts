// Every shape reads a piece of memory, writes it through another name or in another form, and reads it again: `const x = a[i]; b[j] = v;
// s += a[i] - x` where `b` is `a`, a second view of its bytes, its prototype, a method that moves its elements. The second read
// has to see the store. Sixty-one kinds of memory, three ways to come by the two names, three bodies; nine more on variables.
export type Shape = { name: string; isSloppy: boolean; text: string };

// The name ~ how the memory is made ~ the second name ~ the read ~ the store ~ how the two reads are held against each other.
const kinds = String.raw`
list-of-integers ~ LIST(q) ~ A ~ (A[i] | 0) ~ B[j] = v;
list-of-integers-read-plainly ~ LIST(q) ~ A ~ A[i] ~ B[j] = v;
list-of-fractions ~ LIST(q + 0.5) ~ A ~ A[i] ~ B[j] = v + 0.25; ~ numbers
list-of-records-replaced ~ LIST({ n: q }) ~ A ~ A[i].n ~ B[j] = { n: v };
list-of-records-a-field-stored ~ LIST({ n: q }) ~ A ~ A[i].n ~ B[j].n = v;
list-of-integers-gets-a-fraction ~ LIST(q) ~ A ~ A[i] ~ B[j] = v + 0.5; ~ numbers
list-of-integers-gets-a-text ~ LIST(q) ~ A ~ Number(A[i]) ~ B[j] = k === 9 ? "9" : v; ~ numbers
list-of-integers-gets-a-hole ~ LIST(q) ~ A ~ (A[i] | 0) ~ if (k & 1) delete B[j]; else B[j] = v;
length-and-push ~ LIST(q) ~ A ~ A.length ~ B.push(v);
length-and-a-store-of-the-length ~ LIST(q) ~ A ~ A.length ~ B.length = j + 1;
length-and-a-store-past-the-end ~ LIST(q) ~ A ~ A.length ~ B[B.length] = v;
length-and-pop ~ LIST(q) ~ A ~ A.length ~ if (B.length > 2) B.pop(); else B.push(v, v, v);
element-and-a-store-of-the-length ~ LIST(q) ~ A ~ (A[i] | 0) ~ B.length = k & 1 ? 2 : 8;
list-of-integers-and-fill ~ LIST(q) ~ A ~ (A[i] | 0) ~ B.fill(v, j, j + 1);
list-of-integers-and-reverse ~ LIST(q) ~ A ~ (A[i] | 0) ~ B.reverse();
list-of-integers-and-copy-within ~ LIST(q) ~ A ~ (A[i] | 0) ~ B.copyWithin(j, 0, 1);
list-of-integers-and-splice ~ LIST(q) ~ A ~ (A[i] | 0) ~ B.splice(j, 1, v);
list-of-integers-and-sort ~ LIST(q) ~ A ~ (A[i] | 0) ~ B.sort((p, q) => (k & 1 ? q - p : p - q));
list-of-integers-and-unshift-and-pop ~ LIST(q) ~ A ~ (A[i] | 0) ~ B.unshift(v); B.pop();
view-of-int32-itself ~ VIEW(Int32Array) ~ A ~ A[i] ~ B[j] = v;
view-of-int32-and-a-second-of-its-kind ~ VIEW(Int32Array) ~ new Int32Array(A.buffer) ~ A[i] ~ B[j] = v;
view-of-int32-and-uint8 ~ VIEW(Int32Array) ~ new Uint8Array(A.buffer) ~ A[i] ~ B[j * 4] = v;
view-of-int32-and-int16 ~ VIEW(Int32Array) ~ new Int16Array(A.buffer) ~ A[i] ~ B[j * 2] = v;
view-of-int32-and-uint32 ~ VIEW(Int32Array) ~ new Uint32Array(A.buffer) ~ A[i] ~ B[j] = v;
view-of-int32-and-float32 ~ VIEW(Int32Array) ~ new Float32Array(A.buffer) ~ A[i] ~ B[j] = v;
view-of-uint8-and-int32 ~ const A = new Uint8Array(32); for (let q = 0; q < 32; q++) A[q] = q; ~ new Int32Array(A.buffer) ~ A[i * 4] ~ B[j] = v;
view-of-float64-and-int32 ~ VIEW(Float64Array) ~ new Int32Array(A.buffer) ~ A[i] ~ B[j * 2 + 1] = v + 1072693248; ~ the same or not
view-of-float64-and-float32 ~ VIEW(Float64Array) ~ new Float32Array(A.buffer) ~ A[i] ~ B[j * 2 + 1] = v; ~ the same or not
view-of-float32-and-int32 ~ VIEW(Float32Array) ~ new Int32Array(A.buffer) ~ A[i] ~ B[j] = v + 1065353216; ~ the same or not
view-of-clamped-and-int8 ~ VIEW(Uint8ClampedArray) ~ new Int8Array(A.buffer) ~ A[i] ~ B[j] = v;
view-of-big-int64-and-int32 ~ const A = new BigInt64Array(8); for (let q = 0; q < 8; q++) A[q] = BigInt(q); ~ new Int32Array(A.buffer) ~ Number(A[i]) ~ B[j * 2] = v; ~ numbers
view-of-int32-and-a-data-view ~ VIEW(Int32Array) ~ new DataView(A.buffer) ~ A[i] ~ B.setInt32(j * 4, v, true);
data-view-and-a-view-of-int32 ~ const A = new DataView(new ArrayBuffer(32)); ~ new Int32Array(A.buffer) ~ A.getInt32(i * 4, true) ~ B[j] = v;
view-of-uint8-and-a-data-view ~ VIEW(Uint8Array) ~ new DataView(A.buffer) ~ A[i] ~ B.setInt8(j, v);
view-of-int32-and-its-subarray ~ const A = new Int32Array(16); for (let q = 0; q < 16; q++) A[q] = q; ~ A.subarray(4) ~ A[i + 4] ~ B[j] = v;
view-of-uint8-and-a-buffer ~ VIEW(Uint8Array) ~ Buffer.from(A.buffer) ~ A[i] ~ B[j] = v;
view-of-uint8-and-a-write-of-a-buffer ~ VIEW(Uint8Array) ~ Buffer.from(A.buffer) ~ A[i] ~ B.writeUInt8(v & 255, j);
a-read-of-a-buffer-and-a-view-of-uint8 ~ const A = Buffer.alloc(8); ~ new Uint8Array(A.buffer, A.byteOffset, 8) ~ A.readUInt8(i) ~ B[j] = v;
view-of-int32-and-set ~ VIEW(Int32Array) ~ A ~ A[i] ~ B.set([v], j);
view-of-int32-and-fill ~ VIEW(Int32Array) ~ A ~ A[i] ~ B.fill(v, j, j + 1);
view-of-int32-and-copy-within ~ VIEW(Int32Array) ~ A ~ A[i] ~ B.copyWithin(j, 0, 1);
view-of-int32-and-reverse ~ VIEW(Int32Array) ~ A ~ A[i] ~ B.reverse();
view-of-int32-and-sort ~ VIEW(Int32Array) ~ A ~ A[i] ~ B.sort();
length-of-a-view-and-a-resize ~ const A = new Int32Array(new ArrayBuffer(32, { maxByteLength: 64 })); ~ A.buffer ~ A.length ~ B.resize(k & 1 ? 16 : 32);
element-of-a-view-and-a-resize ~ const A = new Int32Array(new ArrayBuffer(32, { maxByteLength: 64 })); for (let q = 0; q < 8; q++) A[q] = q + 1; ~ A.buffer ~ (A[i] | 0) ~ B.resize(k & 1 ? 8 : 32);
field-by-name ~ const A = { a: 1, b: 2 }; ~ A ~ A.a ~ B.a = v;
field-and-a-key-that-a-parse-gives ~ const A = { a: 1, b: 2 }; ~ A ~ A.a ~ B[KEY] = v;
field-and-reflect-set ~ const A = { a: 1, b: 2 }; ~ A ~ A.a ~ Reflect.set(B, "a", v);
field-and-object-assign ~ const A = { a: 1, b: 2 }; ~ A ~ A.a ~ Object.assign(B, { a: v });
field-and-define-property ~ const A = { a: 1, b: 2 }; ~ A ~ A.a ~ Object.defineProperty(B, "a", { value: v, writable: true, enumerable: true, configurable: true });
field-and-delete ~ const A = { a: 1, b: 2 }; ~ A ~ (A.a | 0) ~ if (k & 1) delete B.a; else B.a = v;
field-found-on-the-prototype ~ const A = Object.create({ a: 1 }); ~ Object.getPrototypeOf(A) ~ A.a ~ B.a = v;
field-that-comes-to-hide-the-prototype ~ const A = Object.create({ a: 1 }); ~ A ~ A.a ~ if (k & 1) B.a = v; else delete B.a;
field-of-a-fraction ~ const A = { a: 1.5, b: 2 }; ~ A ~ A.a ~ B.a = v + 0.5; ~ numbers
private-member ~ class Box { #a = 1; get() { return this.#a; } set(v) { this.#a = v; } }\nconst A = new Box(); ~ A ~ A.get() ~ B.set(v);
static-member ~ class Kept { static a = 1; }\nconst A = Kept; ~ A ~ A.a ~ B.a = v;
accessor-over-a-field ~ const A = { held: 1, get a() { return this.held; } }; ~ A ~ A.a ~ B.held = v;
map-entry ~ const A = new Map(); for (let q = 0; q < 8; q++) A.set(q, q); ~ A ~ A.get(i) ~ B.set(j, v);
map-size ~ const A = new Map(); for (let q = 0; q < 8; q++) A.set(q, q); ~ A ~ A.size ~ if (k & 1) B.delete(j); else B.set(j + 8, v);
set-has ~ const A = new Set([0, 1, 2, 3]); ~ A ~ (A.has(i) ? 1 : 0) ~ if (k & 1) B.delete(j); else B.add(j);
weak-map-entry ~ const KEYS = []; for (let q = 0; q < 8; q++) KEYS.push({}); globalThis.KEYS = KEYS;\nconst A = new WeakMap(); for (let q = 0; q < 8; q++) A.set(KEYS[q], q); ~ A ~ A.get(globalThis.KEYS[i]) ~ B.set(globalThis.KEYS[j], v);
`
  .trim()
  .split("\n")
  .map(line => {
    const [name, first, second, read, store, held] = line.split(" ~ ");
    return {
      name,
      first: first
        .replace(/^LIST\((.*)\)$/, "const A = []; for (let q = 0; q < 8; q++) A.push($1);")
        .replace(/^VIEW\((.*)\)$/, "const A = new $1(8); for (let q = 0; q < 8; q++) A[q] = q;")
        .replaceAll("\\n", "\n"),
      second,
      read,
      store,
      combine:
        held === "numbers"
          ? "s = s + ((READ) - x);"
          : held === "the same or not"
            ? "s += Object.is(READ, x) ? 0 : 1;"
            : "s = (s + (READ) - x) | 0;",
    };
  });

const waysToComeByTheNames = [
  ["two-parameters", "function sweep(A, B, n) {", "sweep(A, SECOND, TURNS)"],
  [
    "fields-of-a-holder",
    "function sweep(holder, n) { const A = holder.first, B = holder.second;",
    "sweep({ first: A, second: SECOND }, TURNS)",
  ],
  ["made-in-the-function", "function sweep(A, n) { const B = SECOND;", "sweep(A, TURNS)"],
];

const bodies = [
  [
    "positions-that-may-meet-in-a-loop",
    `  let s = 0;
  for (let k = 0; k < n; k++) { const i = k & 7, j = (k >> 1) & 7, v = (k * 5 + 3) & 127; const x = READ; STORE COMBINE }
  return s;
}`,
  ],
  [
    "straight-code-behind-a-loop-of-its-own",
    `  let s = 0, work = 0;
  for (let q = 0; q < 2; q++) work = (work + q) | 0;
  { const k = n, i = n & 7, j = (n >> 1) & 7, v = (n * 5 + 3) & 127; const x = READ; STORE COMBINE }
  { const k = n + 1, i = n & 7, j = n & 7, v = (n * 7 + 1) & 127; const x = READ; STORE COMBINE }
  return s + work;
}`,
  ],
  [
    "a-read-that-no-turn-seems-to-change",
    `  let s = 0;
  const i = 3;
  for (let k = 0; k < n; k++) { const j = k & 7, v = (k * 5 + 3) & 127; const x = 0; COMBINE STORE }
  return s;
}`,
  ],
];

const sweepOverKept = (between: string) =>
  `function sweep(n) { let s = 0; for (let k = 0; k < n; k++) { ${between} s = (s + kept - x) | 0; } return s; }`;
const aLoop = "let w = 0; for (let q = 0; q < 2; q++) w = (w + q) | 0;";
const sweepOverOnce =
  "function sweep(n) { let s = 0; for (let k = 0; k < n; k++) s = (s + once(k, (k * 5 + 3) & 127)) | 0; return s; }";
const variables: [string, boolean, string][] = [
  [
    "variable-of-a-scope-and-a-closure-copied-in",
    false,
    "function sweep(n) { let kept = 1; const set = (v) => { kept = v; }; let s = 0; for (let k = 0; k < n; k++) { const v = (k * 5 + 3) & 127; const x = kept; set(v); s = (s + kept - x) | 0; } return s; }",
  ],
  [
    "variable-of-a-scope-and-a-closure-with-a-loop",
    false,
    `function sweep(n) { let kept = 1; const set = (v) => { ${aLoop} kept = v + w; }; let s = 0; for (let k = 0; k < n; k++) { const v = (k * 5 + 3) & 127; const x = kept; set(v); s = (s + kept - x) | 0; } return s; }`,
  ],
  [
    "variable-of-the-module-and-a-function",
    false,
    `let kept = 1; function set(v) { ${aLoop} kept = v + w; }\n${sweepOverKept("const v = (k * 5 + 3) & 127; const x = kept; set(v);")}`,
  ],
  [
    "variable-of-the-module-and-a-getter",
    false,
    `let kept = 1; const box = { get v() { kept = (kept * 3 + 1) & 127; return 1; } };\n${sweepOverKept("const x = kept; s = (s + box.v) | 0;")}`,
  ],
  [
    "variable-of-the-module-and-a-value-of",
    false,
    `let kept = 1; const box = { valueOf() { kept = (kept * 3 + 1) & 127; return 1; } };\n${sweepOverKept("const x = kept; s = (s + box * 2) | 0;")}`,
  ],
  [
    "variable-of-the-module-is-the-bound",
    false,
    "let bound = 12; const box = { get v() { if (bound > 5) bound--; return 1; } };\nfunction sweep(n) { let s = 0; for (let k = 0; k < bound; k++) { s = (s + box.v + n) | 0; } return s; }",
  ],
  [
    "a-parameter-and-arguments",
    true,
    `function once(a, v) { ${aLoop} const x = a; arguments[0] = v; return a - x + w; }\n${sweepOverOnce}`,
  ],
  [
    "arguments-and-a-parameter",
    true,
    `function once(a, v) { ${aLoop} const x = arguments[0]; a = v; return arguments[0] - x + w; }\n${sweepOverOnce}`,
  ],
  [
    "a-global-by-name-and-by-global-this",
    true,
    "var kept = 1; globalThis.kept2 = 1;\nfunction sweep(n) { let s = 0; for (let k = 0; k < n; k++) { const v = (k * 5 + 3) & 127; const x = kept2; globalThis.kept2 = v; s = (s + kept2 - x) | 0; } return s; }",
  ],
];

export function shapes(): Shape[] {
  const all: Shape[] = [];
  for (const { name: ofKind, first, second, read, store, combine } of kinds)
    for (const [way, head, call] of waysToComeByTheNames)
      for (const [ofBody, body] of bodies) {
        const name = `${ofKind}--${way}--${ofBody}`;
        const called = call.replaceAll("SECOND", second);
        all.push({
          name,
          isSloppy: false,
          text:
            `const KEY = JSON.parse('"a"');\nconst TURNS = JSON.parse("17");\n${first}\n` +
            `${head.replaceAll("SECOND", second)}\n` +
            `${body.replaceAll("COMBINE", combine).replaceAll("READ", read).replaceAll("STORE", store)}\n` +
            (ofBody.startsWith("straight")
              ? `let all = 0; for (let t = 0; t < TURNS; t++) all += ${called.replaceAll("TURNS", "t")};\nconsole.log(${JSON.stringify(name)}, all);\n`
              : `console.log(${JSON.stringify(name)}, ${called});\n`),
        });
      }
  for (const [ofVariable, isSloppy, text] of variables) {
    const name = `${ofVariable}--no-names--in-a-loop`;
    all.push({ name, isSloppy, text: `${text}\nconsole.log(${JSON.stringify(name)}, sweep(JSON.parse("17")));\n` });
  }
  return all;
}
