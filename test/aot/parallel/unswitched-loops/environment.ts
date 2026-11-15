// Loops that call where an environment variable says so: variables that are there, empty and absent, made and deleted on the way, read by helpers that the loop copies, under handlers.
// STATISTIC: BranchesUnswitched >= 1
process.env.RTK_ON = "1"; process.env.RTK_EMPTY = ""; delete process.env.RTK_OFF;
const list: number[] = JSON.parse("[" + Array.from({ length: 24 }, (_, k) => (k * 37) % 13).join() + "]");
const halves = list.map(x => x / 2), mixed: any[] = JSON.parse('[1,2,"a",4,null,6,7.5,8]');
const said: string[] = []; let sink: any = 0;
function say(...rest: unknown[]): void { said.push(rest.map(String).join(" ")); if (said.length > 60) said.length = 0; }
function debug(...rest: unknown[]): void { if (!process.env.RTK_OFF) return; say(...rest); }
function trace(...rest: unknown[]): void { if (process.env.RTK_ON !== "1") return; say(...rest); }
function report(name: string, body: () => unknown): void {
  let got: unknown;
  try { got = body(); } catch (error) { got = (error as Error).name; }
  console.log(name, String(got), said.length, said.at(-1), String(sink)); said.length = 0; sink = 0;
}
function off(of: any[]): number { let s = 0; for (let r = 0; r < 4; r++) for (let i = 0; i < of.length; i++) { const x = of[i]!; debug("x", x); s = (s + x) | 0; } return s; }
function on(of: any[]): number { let s = 0; for (let r = 0; r < 2; r++) for (let i = 0; i < of.length; i++) { const x = of[i]!; trace("x", x); s = (s + x) | 0; } return s; }
function inline(of: any[]): number { let s = 0; for (let r = 0; r < 4; r++) for (let i = 0; i < of.length; i++) { const x = of[i]!; if (process.env.RTK_EMPTY) say(x); s = (s + x) | 0; } return s; }
function negated(of: any[]): number { let s = 0; for (let r = 0; r < 2; r++) for (let i = 0; i < of.length; i++) { const x = of[i]!; if (!process.env.RTK_OFF) say(x); s = (s + x) | 0; } return s; }
function stored(of: any[]): number { let s = 0; const kept: any[] = []; for (let r = 0; r < 4; r++) for (let i = 0; i < of.length; i++) { const x = of[i]!; kept[i & 7] = x; debug("x", x); s = (s + x) | 0; } return s + kept.length; }
function made(of: any[]): number { let s = 0; for (let r = 0; r < 4; r++) for (let i = 0; i < of.length; i++) { const x = of[i]!; if (process.env.RTK_LATE) say("late", x); if (r === 2 && i === 5) process.env.RTK_LATE = "now"; s = (s + x) | 0; } delete process.env.RTK_LATE; return s; }
function removed(of: any[]): number { let s = 0; for (let r = 0; r < 4; r++) for (let i = 0; i < of.length; i++) { const x = of[i]!; if (process.env.RTK_GONE) { say("there", x); if (i === 3) delete process.env.RTK_GONE; } s = (s + x) | 0; } return s; }
function thrown(of: any[]): number { let s = 0; try { for (let i = 0; i < of.length; i++) { const x = of[i]!; if (process.env.RTK_ON) { if (x === 11) throw new RangeError("eleven"); sink = x; } s = (s + x) | 0; } } catch (error) { s = -s; say((error as Error).name); } return s; }
function compared(of: any[]): number { let s = 0; for (let r = 0; r < 4; r++) for (let i = 0; i < of.length; i++) { const x = of[i]!; if (process.env.RTK_OFF === "1") say(x); s = (s + x) | 0; } return s; }
for (const [name, of] of [["ints", list], ["doubles", halves], ["mixed", mixed], ["empty", []]] as [string, any[]][]) {
  report("off " + name, () => off(of)); report("on " + name, () => on(of)); report("inline " + name, () => inline(of)); report("negated " + name, () => negated(of));
  report("stored " + name, () => stored(of)); report("made " + name, () => made(of)); process.env.RTK_GONE = "1"; report("removed " + name, () => removed(of));
  report("thrown " + name, () => thrown(of)); report("compared " + name, () => compared(of));
}
process.env.RTK_OFF = "1"; process.env.RTK_EMPTY = "full"; delete process.env.RTK_ON;
report("off set", () => off(list)); report("on gone", () => on(list)); report("inline set", () => inline(list)); report("negated set", () => negated(list)); report("compared set", () => compared(list)); report("stored set", () => stored(list)); report("thrown gone", () => thrown(list));
process.env = { RTK_OFF: "", RTK_ON: "1" };
report("off replaced", () => off(list)); report("on replaced", () => on(list)); report("inline replaced", () => inline(list)); report("negated replaced", () => negated(list));
