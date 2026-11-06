// Programs of three to seven files in which ES modules and CommonJS modules need each other, in cycles too: ../modules-of-both-kinds-that-need-each-other.ts says how they are made and which
// differences from plain Bun are meant. Every second seed draws a graph in which half of the ES modules await at their top.
import { asProgram, type Drawn } from "../family";
import { program, runsModuleAgain, throwsForModuleThatThrew } from "../modules-of-both-kinds-that-need-each-other";

const drawn: Drawn = (seed, bed) => {
  if (bed.name !== "product") return;
  const awaits = seed % 2 === 1;
  const { entry, files, notes } = program(Math.floor(seed / 2), awaits);
  // How soon a file is loaded is not specified, and beside an await it shows.
  if (awaits && Object.values(files).some(text => /^import\(/m.test(text))) return;
  if (awaits && !Object.values(files).some(text => /^(.* )?(for )?await /m.test(text.split("setTimeout(async")[0])))
    return;
  const { [entry]: text, ...others } = files;
  // The reference transpiles on one thread: the texts are read in the order in which they are asked for.
  const made = asProgram({ file: entry, text, files: others }, [], { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" });
  return (
    made && {
      seed,
      ...made,
      notes,
      group: awaits ? "with awaits" : "without awaits",
      standsAlone: true,
      plainWavers: "as plain Bun where it reads files on several threads",
      meant: (plain, compiled) =>
        runsModuleAgain(plain)
          ? "a CommonJS module that threw runs again under plain Bun"
          : throwsForModuleThatThrew(plain, compiled, notes)
            ? "a module that threw is asked for again and the executable throws"
            : undefined,
    }
  );
};
export default drawn;
