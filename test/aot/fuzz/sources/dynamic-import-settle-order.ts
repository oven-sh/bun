// A fixed list of seeds of ../dynamic-import-settle-order.ts, which describes the programs.
import { Random } from "../random";
import { forms, generate } from "../dynamic-import-settle-order";
import { family } from "../family";

// Where one call names what another call loads too, the later call leaves that load as it is and settles behind the
// earlier one, as in Node.js and in an executable built without --aot. In plain Bun on one thread it hurries the load
// along and may settle first. So the lines of such a load may stand elsewhere. Every line is still printed once, and
// every other line stands where plain Bun has it.
function meant(seed: number, form: (typeof forms)[number]) {
  return (plain: string, compiled: string) => {
    const { loadedByTwoCalls, loadedWithThem, callsUnderRequireOfModule } = generate(new Random(seed), form);
    if (callsUnderRequireOfModule)
      return "an import() is called under a require() of an ES module, where plain Bun takes its steps at once";
    const isOfSuchLoad = (line: string) => {
      const [, from, target] = /^(.+?): (\w+)(?: rejects .*)?$/.exec(line) ?? [];
      return target
        ? loadedByTwoCalls.has(target) || loadedWithThem.has(from)
        : loadedWithThem.has(/^(\w+) runs/.exec(line)?.[1] ?? "");
    };
    const others = (text: string) =>
      text
        .split("\n")
        .filter(line => !isOfSuchLoad(line))
        .join("\n");
    const sorted = (text: string) => text.split("\n").sort().join("\n");
    if (loadedByTwoCalls.size && others(plain) === others(compiled) && sorted(plain) === sorted(compiled))
      return "two calls load one module, and only the lines of that load stand elsewhere";
  };
}

export default family(
  "dynamic import settle order",
  Array.from({ length: 120 }, (_, index) => index + 1)
    // Seeds 87 and 90 call `import()` for a module that a load in progress has already requested. The tick in which
    // such a load finishes is unspecified, and plain Bun's order depends on its thread count and on the machine's load.
    .filter(seed => seed !== 87 && seed !== 90)
    .flatMap(seed =>
      forms.map(form => ({
        name: `seed ${seed}, ${form}.`,
        // Plain Bun transpiles on one thread here, so files are read in request order. Without the variable it reads
        // them on several threads and a file that `import()` asks for runs in a later turn, as it does in an
        // executable.
        plainEnv: { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" },
        unstablePlainOutput: "as plain Bun where it reads files on several threads",
        meant: meant(seed, form),
        make: () => {
          const { loadedByTwoCalls, loadedWithThem, callsUnderRequireOfModule, ...made } = generate(
            new Random(seed),
            form,
          );
          return made;
        },
      })),
    ),
);
