// Disabled loggers, listeners that nobody set and callbacks that may be missing, in loops over numbers: off, on, and turned over in the middle.
// STATISTIC: LoopsUnswitched >= 8
const list: number[] = JSON.parse("[" + Array.from({ length: 64 }, (_, k) => (k * 37) % 101).join() + "]");
const doubles: number[] = JSON.parse("[" + Array.from({ length: 64 }, (_, k) => ((k * 37) % 101) / 8).join() + "]");
const holes: number[] = JSON.parse("[" + Array.from({ length: 64 }, (_, k) => k).join() + "]"); delete holes[9];
const texts: number[] = JSON.parse('[1,2,"3",4]');
const said: unknown[] = []; let turn: (() => void) | null = null;
function say(...what: unknown[]) { said.push(what.length, what[what.length - 1]); if (turn && said.length > 6) { const t = turn; turn = null; t(); } }
let enabled = process.argv.length > 9;
function debug(x: unknown) { if (!enabled) return; say(x); }
function debugRest(...args: unknown[]) { if (!enabled) return; say(...args); }
class Logger { level = process.argv.length > 9 ? 0 : 2; debug(text: string, x: unknown) { if (this.level > 0) return; say(text, x); } }
const logger = new Logger();
class Emitter { onChange: ((v: number) => void) | null = null; emit(n: string, v: number) { if (this.onChange) this.onChange(v); return true; } emitOptional(v: number) { this.onChange?.(v); return 1; } }
const emitter = new Emitter(); const tell: any = process.argv.length > 9 ? console.log : (x: any) => say("tell", x);
const cache = new Map<number, number>(); let useCache = process.argv.length > 9; for (const x of list) cache.set(x, x + 1);
function look(x: number) { return useCache ? cache.get(x)! : x + 1; }
function one(from: number[], n: number) { let s = 0; for (let i = 0; i < n; i++) { const x = from[i]!; debug(x); s = (s + x) | 0; } return s; }
function rest(from: number[], n: number) { let s = 0; for (let i = 0; i < n; i++) { const x = from[i]!; debugRest("x", x, i); s = (s + x) | 0; } return s; }
function method(from: number[], n: number) { let s = 0; for (let i = 0; i < n; i++) { const x = from[i]!; logger.debug("x", x); s = (s + x) | 0; } return s; }
function listener(from: number[], n: number) { let s = 0; for (let i = 0; i < n; i++) { const x = from[i]!; s = (s + (emitter.emit("a", x) ? 2 : 1)) | 0; } return s; }
function optional(from: number[], n: number) { let s = 0; for (let i = 0; i < n; i++) s = (s + emitter.emitOptional(from[i]!)) | 0; return s; }
function inLine(from: number[], n: number) { let s = 0; for (let i = 0; i < n; i++) { const x = from[i]!; if (enabled) say("x", x); s = (s + x) | 0; } return s; }
function unknownCallee(from: number[], n: number) { let s = 0; for (let i = 0; i < n; i++) { const x = from[i]!; if (enabled) tell(x); s = (s + x) | 0; } return s; }
function lookup(from: number[], n: number) { let s = 0; for (let i = 0; i < n; i++) { const x = from[i]!; s += look(x); s = (s + x) | 0; } return s; }
function nested(from: number[], n: number) { let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < n; i++) { const x = from[i]!; debug(x); s = (s + x) | 0; } return s; }
function behind(from: number[], n: number) { let i = 0, last: unknown = null; for (; i < n; i++) { const x = from[i]!; debug(x); if (x === 77) break; last = x; } return i + " " + last; }
function caught(from: number[], n: number) { let s = 0; try { for (let i = 0; i < n; i++) { const x = from[i]!; debug(x); s = (s + x) | 0; } } catch (e: any) { return "caught " + e.message + " at " + s; } return s; }
const on = () => { enabled = true; logger.level = 0; emitter.onChange = v => say("change", v); useCache = true; };
const off = () => { enabled = false; logger.level = 2; emitter.onChange = null; useCache = false; };
for (const [name, from] of [["ints", list], ["doubles", doubles], ["holes", holes], ["texts", texts], ["none", []], ["ints", list]] as [string, number[]][])
  for (const f of [one, rest, method, listener, optional, inLine, unknownCallee, lookup, nested, behind, caught])
    for (const way of ["off", "on", "off in the middle", "throws"]) {
      off(); said.length = 0; if (way !== "off") on();
      turn = way === "off in the middle" ? off : way === "throws" ? () => { throw new Error("told"); } : null;
      let r: unknown; try { r = f(from, from.length); } catch (e: any) { r = "threw " + e.message; }
      turn = null; off();
      console.log(name, f.name, way, String(r), said.length, String(said.slice(-4)));
    }
