// So many definitions make a dictionary of Array.prototype, and the engine then gives up its own watch over "no index lies on the prototypes of arrays". In a compiled program the locks on those prototypes say that, and they stay: holes are read as before, and the validating build's look at every array behind a collection finds nothing.
// Flags: --aot-validate
const holes = [1, , 3];
for (let i = 0; i < 1000; i++) Object.defineProperty(Array.prototype, "extra", { get() { return i; }, configurable: true });
Bun.gc(true);
console.log(holes[1], holes.extra, [].extra, holes.length, 1 in holes);
console.log([, 2][0], holes.map(value => value * 2).join(), holes.indexOf(undefined), holes.includes(undefined));
Bun.gc(true);
