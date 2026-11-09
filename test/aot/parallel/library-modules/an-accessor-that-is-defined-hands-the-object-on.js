// A getter that answers `this` hands `process` to whoever reads the name: all that `process` can do stays.
Object.defineProperty(process, "allOfIt", { get() { return this; }, configurable: true });
const all = process.allOfIt;
all.stdout.write("through a getter that answers this\n");
