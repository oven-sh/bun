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

function messageLength(run: () => void): number {
  try {
    run();
    return -1;
  } catch (e: any) {
    return e.message.length;
  }
}

function describeCaught(run: () => void): string {
  try {
    run();
    return "nothing";
  } catch (e: any) {
    const message: string = e.message;
    const code: number = e.code;
    return typeof message + ":" + message + ":" + (code + 1);
  }
}

function asError(run: () => void): string {
  try {
    run();
    return "nothing";
  } catch (e) {
    const error = e as Error;
    return error.name + "/" + error.message + "/" + (error instanceof Error);
  }
}

function destructured(run: () => void): string {
  try {
    run();
    return "nothing";
  } catch ({ message, name }: any) {
    return name + "/" + message;
  }
}

function rethrown(run: () => void): number {
  try {
    try {
      run();
      return -1;
    } catch (e: any) {
      throw e.cause;
    }
  } catch (inner: any) {
    if (inner instanceof Error) return -2;
    const n: number = inner;
    return n + 1;
  }
}

function lengthOf(s: string): number {
  return s.length;
}

function passedOn(run: () => void): number {
  try {
    run();
    return -1;
  } catch (e: any) {
    return lengthOf(e.message) + lengthOf(e);
  }
}

class CodeError extends Error {
  code = 7;
}

function honest(label: string): void {
  const fail = () => {
    throw new CodeError("broken", { cause: 1 });
  };
  console.log(label, messageLength(fail), describeCaught(fail), asError(fail), destructured(fail), rethrown(fail), lengthOf("abc"));
}

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += messageLength(() => { throw new Error("e" + i); }) + lengthOf("ab");
console.log("2000 honest rounds", warm);

const thrown = [
  "new Error('plain')",
  "new TypeError('typed', { cause: '1' })",
  "'a string'",
  "5",
  "null",
  "undefined",
  "{}",
  "{ message: 5, code: '7', name: null, cause: 1n }",
  "{ message: ['a', 'b'], code: -0, cause: -0 }",
  "{ get message() { note('get-message'); return 'got'; }, length: 3 }",
  "Object.assign(new Error('changed'), { message: { length: 'long' }, code: 1.5 })",
  "Object.setPrototypeOf(new Error('no prototype'), null)",
  "new Proxy(new Error('proxied'), { get(t, k, r) { note('get:' + String(k)); return Reflect.get(t, k, r); } })",
  "Symbol('thrown')",
  "[1, 2]",
  "function message() {}",
];

for (const text of thrown) {
  const fail = () => {
    throw hidden(text);
  };
  attempt("messageLength " + text, () => messageLength(fail));
  attempt("describeCaught " + text, () => describeCaught(fail));
  attempt("asError " + text, () => asError(fail));
  attempt("destructured " + text, () => destructured(fail));
  attempt("rethrown " + text, () => rethrown(fail));
  attempt("passedOn " + text, () => passedOn(fail));
}

const rejected: string[] = [];
async function awaited(text: string): Promise<void> {
  try {
    await Promise.reject(hidden(text));
  } catch (e: any) {
    try {
      const n: number = e.message.length;
      rejected.push(text + " -> " + show(n + 1));
    } catch (inner) {
      rejected.push(text + " threw " + (inner instanceof Error ? inner.constructor.name : typeof inner));
    }
  }
}
Promise.all(thrown.map(awaited)).then(() => {
  for (const line of rejected) console.log("awaited", line);
  honest("honest after");
});
