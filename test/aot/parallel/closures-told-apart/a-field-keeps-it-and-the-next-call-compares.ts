class Watcher {
  held: (() => number) | undefined;
  changes = 0;
  watch(f: () => number): number { if (this.held !== f) this.changes++; this.held = f; return f(); }
}
const watcher = new Watcher();
const steady = () => 1;
let sum = 0;
for (let i = 0; i < 3; i++) sum += watcher.watch(steady);
for (let i = 0; i < 3; i++) sum += watcher.watch(() => i);
console.log(sum, watcher.changes, watcher.held !== steady);
