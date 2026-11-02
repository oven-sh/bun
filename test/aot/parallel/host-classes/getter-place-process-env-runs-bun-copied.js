// The program puts a getter in the place of `process.env`. A spread of `Bun` runs it, and the member of `Bun` that the getter reads comes first among the keys of the copy.
// Alone: the order of the keys follows from which members were read first, and the other programs of a joined executable read some
const environment = process.env;
let runs = 0;
Object.defineProperty(process, "env", {
  configurable: true,
  get() {
    runs++;
    globalThis.kept = Bun.inspect;
    return environment;
  },
});
const keys = Reflect.ownKeys({ ...Bun });
console.log(runs, keys.slice(0, 3).join(" "));
