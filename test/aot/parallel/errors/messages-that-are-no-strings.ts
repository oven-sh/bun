// error.message and error.cause of errors that the program makes itself, where something else than the declared type was stored: typeof, comparisons, sums and reads of what is there.
export {};
const lines: string[] = [];
const say = (...values: unknown[]) => { lines.push(values.map(value => typeof value + ":" + String(value)).join(" ")); };
function made(value: any) { const error = new Error("text"); (error as any).message = value; return error; }
function kinds(value: any) { const error = new TypeError("text"); Object.assign(error, { message: value }); let r = ""; for (let i = 0; i < 4; i++) r += typeof error.message + (error.message === "text") + (error.message == null) + (error.message ? 1 : 0); return r; }
function sums(value: any) { const error = made(value); let r: any = 0; for (let i = 0; i < 3; i++) r = r + (error.message as any); return r; }
function lengths(value: any) { const error = made(value); let r: any = 0; for (let i = 0; i < 3; i++) r += error.message.length; return r; }
function known(value: any) { const error = new Error("text"); say(error.message, error.message.length); (error as any).message = value; say(error.message, typeof error.message === "string" ? "string" : "other"); return error.message; }
function causes(value: any) { const error = new Error("text", { cause: value }); let r = ""; for (let i = 0; i < 3; i++) r += typeof error.cause + (error.cause === undefined) + ((error.cause as any)?.message ?? "none"); (error as any).cause = i32(value); return r + typeof error.cause; }
function i32(value: any) { return value | 0; }
function removed() { const error: any = new Error("text", { cause: 1 }); delete error.message; delete error.cause; return typeof error.message + error.message.length + typeof error.cause; }
function caught(value: any) { try { throw made(value); } catch (error) { const held = error as Error; return typeof held.message + held.message; } }
const attempt = (read: () => unknown) => { try { return read(); } catch (error) { return (error as Error).constructor.name; } };
for (let turn = 0; turn < 3; turn++) {
  for (const value of [5, 1.5, null, undefined, true, "other", "", { length: 3, toString: () => "object" }, [1, 2], 7n, () => 1, new Error("inner")]) {
    say(attempt(() => kinds(value)), attempt(() => sums(value)), attempt(() => lengths(value)), attempt(() => known(value)), attempt(() => causes(value)), attempt(() => caught(value)), removed());
  }
}
for (const line of lines) console.log(line);
