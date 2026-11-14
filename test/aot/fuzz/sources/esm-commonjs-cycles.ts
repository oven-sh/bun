// A list of programs from ../esm-commonjs-cycles.ts, which describes them.
import { asProgram, type Drawn } from "../family";
import { program, throwsForModuleThatThrew } from "../esm-commonjs-cycles";

const drawn: Drawn = (seed, runner) => {
  if (runner.name !== "product") return;
  const awaits = seed % 2 === 1;
  const { entry, files, notes } = program(Math.floor(seed / 2), awaits);
  // An import() at the top level of an ES module that a require() loads runs its module after that require() returns,
  // not within it as under plain Bun. And how soon a file is loaded is unspecified, and an await makes it visible.
  if (Object.values(files).some(text => /^import\(/m.test(text))) return;
  if (awaits && !Object.values(files).some(text => /^(.* )?(for )?await /m.test(text.split("setTimeout(async")[0])))
    return;
  const { [entry]: text, ...others } = files;
  // Plain Bun transpiles on one thread here, so files are read in request order.
  const made = asProgram({ file: entry, text, files: others }, [], { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" });
  return (
    made && {
      seed,
      ...made,
      notes,
      group: awaits ? "with awaits" : "without awaits",
      needsOwnBuild: true,
      unstablePlainOutput: "as plain Bun where it reads files on several threads",
      meant: (plain, compiled) =>
        throwsForModuleThatThrew(plain, compiled, notes)
          ? "a module that threw is asked for again and the executable throws"
          : undefined,
    }
  );
};
export default drawn;
