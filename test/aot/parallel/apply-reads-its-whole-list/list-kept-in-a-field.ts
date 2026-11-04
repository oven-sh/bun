let calls = 0, reads = 0;
function tick(): void { calls++; }
class Shelf {
  rows: number[] = [1, 2];
  disturb(): void { Object.defineProperty(this.rows, 1, { get(): number { reads++; return 2; }, configurable: true }); }
  run(): void { tick.apply(null, this.rows as []); }
}
const shelf = new Shelf();
for (let i = 0; i < 300; i++) shelf.run();
console.log(calls, reads);
shelf.disturb();
for (let i = 0; i < 300; i++) shelf.run();
console.log(calls, reads);
