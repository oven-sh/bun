// Stack traces through long runs of compiled frames and through inlined calls list every function once, in order.
declare const console: any;
const said: string[] = [];
function block(name: string, body: () => unknown) { try { said.push(name + ": " + body()); } catch (error) { said.push(name + ": THROWS " + String(error)); } }
function framesOf(stack: string | undefined): string[] {
  const frames: string[] = [];
  for (const line of (stack ?? "").split("\n")) {
    let m = /^\s*at (?:async )?(?:new )?([\w$.<>]+) \(.*?:(\d+):\d+\)$/.exec(line) ?? /^([\w$.<>]*)@.*?:(\d+):\d+$/.exec(line);
    if (m && m[1] && !/^(module|global|anonymous|<anonymous>|moduleEvaluation|evaluate|asyncFunctionResume|promiseReactionJob|loadAndEvaluateModule|block|forEach|map)/.test(m[1])) frames.push(m[1].replace(/^.*\./, "") + ":" + m[2]);
  }
  return frames;
}
function digest(frames: string[]): string { let h = 7; for (const f of frames) for (let i = 0; i < f.length; i++) h = (h * 31 + f.charCodeAt(i)) | 0; return frames.length + " frames, " + (h >>> 0).toString(16) + ", first " + (frames[0] ?? "-") + ", last " + (frames[frames.length - 1] ?? "-"); }
let how = "error"; let holder: { stack?: string } = {};
let from: Function | undefined;
function grab(): number {
  if (how === "error") { holder = new Error("made"); return 1; }
  if (how === "capture") { holder = {}; (Error as any).captureStackTrace(holder, from); return 1; }
  throw new Error("thrown");
}
function tiny3(x: number): number { return grab() + x; }
function tiny2(x: number): number { return tiny3(x + 1) + 1; }
function tiny1(x: number): number { return tiny2(x + 1) + 1; }
const table: ((depth: number) => number)[] = [];
function viaTable0(depth: number): number { return depth > 0 ? table[1]!(depth - 1) + 1 : tiny1(0) + 1; }
function viaTable1(depth: number): number { return depth > 0 ? chain1(depth - 1) + 1 : tiny1(1) + 1; }
function chain1(depth: number): number { return chain2(depth) + 1; }
function chain2(depth: number): number { return table[2]!(depth) + 1; }
function viaTable2(depth: number): number { return depth > 0 ? table[0]!(depth - 1) + 1 : tiny1(2) + 1; }
table.push(viaTable0, viaTable1, viaTable2);
function traceAt(depth: number): string[] { holder = {}; try { table[0]!(depth); } catch (error) { holder = error as Error; } return framesOf(holder.stack); }
const E = Error as any;
block("a short trace, whole", () => { E.stackTraceLimit = 100; how = "error"; return traceAt(4).join(" "); });
block("every limit from 0 to 20 at depth 9", () => { how = "error"; const all: string[] = []; for (let limit = 0; limit <= 20; limit++) { E.stackTraceLimit = limit; const f = traceAt(9); all.push(limit + "=" + f.length + "/" + (f[f.length - 1] ?? "-")); } return all.join(" "); });
for (const kind of ["error", "throw"]) {
  block("depths around the buffer, " + kind, () => { how = kind; E.stackTraceLimit = 1000; return [30, 40, 41, 42, 43, 44, 45, 46, 80, 84, 85, 86, 87, 88, 89, 90, 200].map(d => d + ": " + digest(traceAt(d))).join(" | "); });
  block("limits around the buffer at depth 200, " + kind, () => { how = kind; return [62, 63, 64, 65, 66, 67, 126, 127, 128, 129, 130, 191, 192, 193].map(limit => { E.stackTraceLimit = limit; return limit + ": " + digest(traceAt(200)); }).join(" | "); });
}
block("behind captureStackTrace's caller", () => { how = "capture"; E.stackTraceLimit = 12; return [undefined, grab, tiny3, tiny2, tiny1, viaTable0, viaTable1, chain1, chain2, viaTable2].map(f => { from = f; return (f ? f.name : "none") + ": " + traceAt(7).join(","); }).join(" | "); });
block("a caller that is not on the stack", () => { how = "capture"; E.stackTraceLimit = 12; from = digest; return traceAt(5).length; });
block("the same trace twice, and after others", () => { how = "error"; E.stackTraceLimit = 50; const a = traceAt(20).join(); traceAt(3); traceAt(33); const b = traceAt(20).join(); return a === b; });
E.stackTraceLimit = 10;
console.log(said.join("\n"));
export {};
