function tread(n: number): number { const a = n * 3, b = n ^ 5, c = n + 7, d = n - 9, e = n | 1, f = n & 6; return n > 0 ? tread(n - 1) + ((a + b + c + d + e + f) & 1) : 0; }
function settle(): number { let t = 0; for (let i = 0; i < 40; i++) t += tread(60); (globalThis as any).Bun?.gc?.(true); const junk: any[] = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "x" + i }); return t + junk.length; }
type Listener = () => number;
class Emitter {
  private listeners = new Map<string, Listener[]>();
  private every = new Set<Listener>();
  on(name: string, listener: Listener): number { let list = this.listeners.get(name); if (!list) this.listeners.set(name, list = []); list.push(listener); this.every.add(listener); return list.length; }
  off(name: string, listener: Listener): boolean { const list = this.listeners.get(name) ?? []; const at = list.indexOf(listener); if (at < 0) return false; list.splice(at, 1); return this.every.delete(listener); }
  emit(name: string): number { let sum = 0; for (const listener of this.listeners.get(name) ?? []) sum += listener(); return sum; }
  at(name: string, index: number): Listener { return this.listeners.get(name)![index]; }
  get size(): number { return this.every.size; }
}
function listen(emitter: Emitter, k: number): number { const count = emitter.on("end", () => k * 2); return count + 1; }
function listenToAnything(emitter: any, k: number): number { const count = emitter.on("data", () => k * 3); return count + 1; }

const emitter = new Emitter();
let all = 0;
for (let i = 0; i < 150; i++) all += listen(emitter, i) + listenToAnything(emitter, i);
settle();
console.log(all, emitter.size, emitter.emit("end"), emitter.emit("data"), emitter.emit("none"));
const tenth = emitter.at("end", 10), other = emitter.at("data", 10);
console.log(tenth === emitter.at("end", 10), tenth === other, tenth(), other(), emitter.off("end", other), emitter.off("end", tenth), emitter.off("end", tenth), emitter.off("data", other));
console.log(emitter.size, emitter.emit("end"), emitter.emit("data"), emitter.at("end", 10)(), emitter.off("end", () => 20));
