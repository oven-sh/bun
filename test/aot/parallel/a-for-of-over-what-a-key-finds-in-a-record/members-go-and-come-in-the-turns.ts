// A for-of over what a key finds in a record whose fields all name Set: the class is a guess, its test stands in front.
type Names = "a" | "b";
class Bus {
  readonly held: { a: Set<(n: number) => void>; b: Set<(n: number) => void> } = { a: new Set(), b: new Set() };
  emit(name: Names, n: number): void { for (const h of this.held[name]) h(n); }
}
const names: Names[] = JSON.parse('["a","b","a"]');
const bus = new Bus(), out: number[] = [];
bus.held.a.add(n => { out.push(n); });
bus.held.b.add(n => { out.push(-n); });
bus.held.a.add(function f(n) { out.push(3); bus.held.a.delete(f); bus.held.a.add(m => { if (out.length < 40) out.push(m + 9); }); });
for (const name of names) { try { bus.emit(name, out.length); } catch (e) { out.push((e as Error).name.length * 1000); } }
console.log(out.join());
