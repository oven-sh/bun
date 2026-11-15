// Bun.Glob's scanSync() answers with the generator of a generator function of the library. An executable does not let the member above it be replaced; plain Bun does. Either way the generators hang below what it answers now
// COUNT: operation:operationAOTNewGenerator <= 40
const generatorFunctionPrototype = Object.getPrototypeOf(function* () {});
const generatorPrototype = generatorFunctionPrototype.prototype;
const scanner = new Bun.Glob("nothing-*.none");
const log: string[] = [];
function above(label: string) {
  let held = 0;
  let items = 0;
  for (let turn = 0; turn < 100; turn++) {
    const generator = scanner.scanSync({ cwd: import.meta.dir });
    held += Number(Object.getPrototypeOf(generator) === generatorFunctionPrototype.prototype);
    for (const item of generator) items += item.length;
  }
  log.push(`${label}: ${held} ${items}`);
}
function quietly(change: () => void) {
  try {
    change();
  } catch {}
}
above("as made");
quietly(() => Object.defineProperty(generatorFunctionPrototype, "prototype", { value: Object.create(generatorPrototype, { marker: { value: "replaced" } }) }));
above("with the member above replaced");
quietly(() => Object.defineProperty(generatorFunctionPrototype, "prototype", { value: generatorPrototype }));
above("with the member above put back");
const one = scanner.scanSync({ cwd: import.meta.dir });
console.log(log.join("\n"), Object.prototype.toString.call(one), JSON.stringify(one.next()), JSON.stringify(one.return!("x" as never)));
