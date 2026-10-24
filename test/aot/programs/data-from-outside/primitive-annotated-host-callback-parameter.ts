// A parameter of a function handed straight to the host, or to untyped code, that is annotated with a primitive type or a built-in type: `req.on("data", (chunk: string) => { body += chunk })`, where a Buffer arrives. The parameter is tested on entry, whoever calls: a value of another kind throws a TypeError, undefined and null pass, and any object passes `Error`.
declare const hostEmitter: { on(name: string, listener: (...args: any[]) => void): void; once: (name: string, listener: (value: any, more?: any) => void) => void };
const given: Record<string, unknown> = { bytes: { toString() { return "bytes"; }, length: 5 }, seven: 7, text: "text", yes: true, nothing: null, none: undefined };
(globalThis as any).hostEmitter = { on(name: string, f: Function) { f(given[name]); }, once(name: string, f: Function) { f(given[name], given[name]); } };
const untyped: any = (globalThis as any).hostEmitter;
const row = (name: string, f: () => unknown) => { let r: unknown; try { r = f(); } catch (e) { r = "THROWS " + (e as Error).constructor.name; } console.log(name + ": " + JSON.stringify(r)); };
const kind = (v: unknown) => typeof v + " " + String(v);
for (const name of ["bytes", "seven", "text", "yes", "nothing", "none"]) {
  row("the host, string, " + name, () => { let body = ""; hostEmitter.on(name, (chunk: string) => { body += chunk; }); return body; });
  row("untyped code, string, " + name, () => { let body = ""; untyped.on(name, (chunk: string) => { body += chunk; }); return body; });
  row("the host, number, " + name, () => { let seen = ""; hostEmitter.on(name, (n: number) => { seen = kind(n); }); return seen; });
  row("untyped code, boolean, " + name, () => { let seen = ""; untyped.on(name, (flag: boolean) => { seen = kind(flag) + (flag ? " yes" : " no"); }); return seen; });
  row("the host, two of them, " + name, () => { let seen = ""; hostEmitter.once(name, (a: string, b?: number) => { seen = kind(a) + " " + kind(b); }); return seen; });
  row("a function expression, " + name, () => { let seen = ""; untyped.on(name, function (chunk: string | undefined) { seen = kind(chunk); }); return seen; });
}
for (const name of ["text", "seven", "nothing", "bytes"]) {
  row("the host, a built-in type, " + name, () => { let seen = ""; hostEmitter.once(name, (code: number, reason: Uint8Array) => { seen = kind(code) + " " + String(reason); }); return seen; });
  row("untyped code, an Error, " + name, () => { let seen = ""; untyped.on(name, (error: Error) => { seen = kind(error) + " " + (error instanceof Error); }); return seen; });
  row("the host, a Date or nothing, " + name, () => { let seen = ""; hostEmitter.on(name, (when?: Date | null) => { seen = kind(when); }); return seen; });
}
row("a built-in type, as it says", () => { const seen: unknown[] = []; given.array = new Uint8Array([1, 2]); given.error = new RangeError("r"); hostEmitter.on("array", (bytes: Uint8Array) => { seen.push(bytes.length, bytes[1]); }); untyped.on("error", (error: Error) => { seen.push(error.message, error.name); }); return seen; });
row("used as the type says", () => { const seen: unknown[] = []; hostEmitter.on("text", (chunk: string) => { seen.push(chunk.length, chunk.toUpperCase(), chunk + "!"); }); hostEmitter.on("seven", (n: number) => { seen.push(n + 1, n.toFixed(1)); }); return seen; });
row("used as the type says though it is not", () => { const seen: unknown[] = []; hostEmitter.on("bytes", (chunk: string) => { seen.push(chunk.length, typeof chunk, chunk + "!"); }); untyped.on("text", (n: number) => { seen.push(String(n), typeof n); }); return seen; });
row("kept", () => { const chunks: unknown[] = []; untyped.on("bytes", (chunk: string) => { chunks.push(chunk); }); return [chunks.length, chunks[0] === given.bytes]; });
row("hot", () => { let total = 0; for (let i = 0; i < 3000; i++) hostEmitter.on("seven", (n: number) => { total += n; }); return total; });
