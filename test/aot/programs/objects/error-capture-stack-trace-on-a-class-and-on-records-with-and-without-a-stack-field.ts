// Error.captureStackTrace defines stack on an instance whose class declares it as a string, on a record that has it and on a record that lacks it.
class Failure { stack: string; code: number; constructor(code: number) { this.stack = "none"; this.code = code; } describe(): string { return this.stack.length > 4 ? "long" : this.stack; } }
type Plain = { stack: string; n: number };
type Bare = { a: number; b: string };
function plain(i: number): Plain { return { stack: "s" + i, n: i }; }
function bare(i: number): Bare { return { a: i, b: "b" + i }; }
const out: string[] = [];
for (let i = 0; i < 4; i++) {
  const f = new Failure(i), p = plain(i), b = bare(i);
  if (i >= 2) { (Error as any).captureStackTrace(f); (Error as any).captureStackTrace(p); (Error as any).captureStackTrace(b); }
  out.push([f.describe(), typeof f.stack, f.code, typeof p.stack, p.stack.startsWith("Error") || p.stack, p.n, b.a, b.b, typeof (b as any).stack, Object.keys(f).join(), Object.keys(p).join(), Object.keys(b).join(), Object.getOwnPropertyNames(b).join()].join(" "));
  f.stack = "again"; p.stack = "again";
  out.push(f.describe() + " " + p.stack + " " + JSON.stringify(p) + JSON.stringify(b));
}
console.log(out.join("\n"));
