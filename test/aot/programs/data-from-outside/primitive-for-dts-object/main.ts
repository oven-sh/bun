// A declaration file says that a function of a package yields an object. The package, or a mock that stands in for it in a test, yields a primitive. The program only keeps the value and hands it back, which plain JavaScript allows: nothing throws.
import { type Handle, open, startTimer, stopTimer, type Timer } from "./host.js";
class Debounce {
  private timer: ReturnType<typeof startTimer> | null = null;
  start(): void { this.timer = startTimer(() => {}, 0); }
  stop(): boolean { if (this.timer !== null) { stopTimer(this.timer); this.timer = null; return true; } return false; }
}
function later(): ReturnType<typeof startTimer> { return startTimer(() => {}, 5); }
function keep(): { id: Timer | undefined } { const held: { id: Timer | undefined } = { id: undefined }; held.id = startTimer(() => {}, 7); return held; }
function pass(timer: Timer): Timer { return timer; }
function attempt(name: string, f: () => unknown): void { try { console.log(name, String(f())); } catch (e) { console.log(name, (e as Error).name + ": " + (e as Error).message.split("\n")[0].replace(/ \(bun compile[^)]*\)/, "")); } }
attempt("a field:", () => { const d = new Debounce(); d.start(); return d.stop(); });
attempt("a result:", () => later());
attempt("a member:", () => keep().id);
attempt("a parameter:", () => pass(startTimer(() => {}, 9)));
attempt("a variable:", () => { const timer: Timer = startTimer(() => {}, 11); return timer; });
attempt("an element:", () => { const list: Timer[] = [startTimer(() => {}, 13)]; return list[0]; });
attempt("a class of the declaration file, a string:", () => { const handle: Handle = open("text"); return handle; });
attempt("a class of the declaration file, an instance:", () => { const handle: Handle = open("real"); handle.close(); return typeof handle; });
