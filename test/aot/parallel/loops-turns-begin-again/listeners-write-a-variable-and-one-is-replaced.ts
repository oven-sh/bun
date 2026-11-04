// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
type Listener = (value: number) => void;
let seen = 0;
class Emitter {
  listeners: Listener[] = [];
  emit(value: number) { for (let i = 0; i < this.listeners.length; i++) this.listeners[i](value); }
}
function main() {
  const emitter = new Emitter();
  emitter.listeners.push((value) => { seen += value; });
  emitter.listeners.push((value) => { seen ^= value; if (value === 70) emitter.listeners[0] = (v) => { seen -= v; }; });
  (globalThis as any).emitter = emitter;
  (0, eval)("1");
  for (let i = 0; i < 200; i++) emitter.emit(i);
  console.log(seen);
}
main();
