// usage: <bun binary> p1out.mjs   prints one line per input: OK <output> or ERR <message>
const inputs = [
  "x = a ? (b) : c => d;",
  "x = a ? (b) : c => d : e;",
  "x = a ? y => (b) : c => d;",
  "x = a ? (y) => (b) : c => d;",
  "x = a ? async y => (b) : c => d;",
  "x = a ? async (y) => (b) : c => d;",
  "x = a ? (b, c) : d => e;",
  "x = a ? (b): c => d : e ? (f) : g => h : i;",
  "x = a ? <T>(b) : c => d;",
  "x = a ? async <T>(b) : c => d;",
  "x = a ? -<T>(b) : c;",
  "x = a ? !<T>(b) : c;",
  "x = a ? typeof <T>(b) : c;",
  "x = a ? 1 + async(b) : c;",
  "x = a ? -async(b) : c;",
  "x = a ? 1 + async<T>(b) : c;",
  "switch (x) { case -<T>(b): c; }",
  "switch (x) { case 1 + async(b): c; }",
  "x = a ? y => z => (b) : c => d;",
  "x = a ? (b) => (c) : d => e;",
  "x = a ? (b): c => (d) : e => f;",
  "x = a ? ((b) : c => d) : e;",
  "x = a ? (b) : (c) : d => e;",
  "x = a ? <T,>(b) : c => d : e;",
  "x = a ? (b = (c) : d => e) : f;",
  "x = a ? - (b) : c => d : e;",
  "x = -<T>(b) => c;",
  "x = 1 + (a): b => c;",
  "let v = (a): => a;",
  "x = (a) : b;",
  "x = a ? (b) ? (c) : d => e : f;",
  "y = (a: number, b?: string): void => {};",
  "z = async (a: T) : Promise<T> => a;",
];
const t = new Bun.Transpiler({ loader: "ts" });
for (const src of inputs) {
  let out;
  try { out = "OK  " + t.transformSync(src).trim().replace(/\s+/g, " "); } catch (e) { out = "ERR " + (e.errors?.[0]?.message ?? e.message).split("\n")[0]; }
  console.log(JSON.stringify(src).padEnd(50), out);
}
