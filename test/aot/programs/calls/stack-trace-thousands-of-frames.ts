// A stack trace of thousands of frames, with `Error.stackTraceLimit = Infinity`.
declare const console: { log(...args: unknown[]): void }
function names(e: unknown): string[] { return String((e as Error).stack).split("\n").map(l => /^(?:\s*at\s+)?(?:async\s+)?(?:([A-Za-z_$][\w$]*)(?: \(|@))?.*?:(\d+):\d+\)?$/.exec(l)).filter(m => m && m[1]).map(m => m![1]) }
function shape(e: unknown): string { const n = names(e); const downs = n.filter(x => x === "down").length; return n.length + " named frames; " + downs + " of down; the first " + n[0] + ", the last " + n[n.length - 1] }
let mode = 0
function bottom(): number { if (mode === 1) throw new Error("thrown"); kept = new Error("made"); return 0 }
let kept: Error | null = null
function down(d: number): number { if (d <= 0) return bottom() + 1; return down(d - 1) + 1 }
function top(d: number): number { return down(d) + 1 }
for (const limit of [Infinity, 100, 64, 65, 130, 1000]) {
    (Error as unknown as { stackTraceLimit: number }).stackTraceLimit = limit
    for (const d of [0, 1, 61, 62, 63, 64, 65, 66, 126, 127, 128, 129, 130, 500, 2000, 6000]) {
        mode = 0; top(d); const made = shape(kept)
        mode = 1; let caught = ""; try { top(d) } catch (e) { caught = shape(e) }
        console.log("the limit " + limit + ", the depth " + d + ": " + made + " | thrown: " + caught)
    }
}
