// ../generators/library-modules-that-use-keys-of-one-another.ts: what goes through two modules of Bun's library, one of which uses a key that the
// other made, prints in an executable what it prints in plain Bun: whichever other module is in the executable beside it, and also where
// the build is told of a package that it does not see (--external), so that code from outside may run.
import {
  modulesBeside,
  programAbout,
  subjects,
  type Subject,
} from "../generators/library-modules-that-use-keys-of-one-another";
import { family, type Member } from "../family";

const external = "a-package-that-no-program-imports";

function program(subject: Subject, beside: string[], what: string, flags: string[], more: Partial<Member>): Member {
  return {
    name: `${subject.name}, beside ${what}${flags.length ? ", with an external package" : ""}.`,
    flags,
    make: () => ({
      file: "main.mjs",
      text: programAbout(subject, beside),
      files: subject.files,
      entryPoints: subject.entryPoints,
    }),
    ...more,
  };
}

// A build with an external package makes one program of all its entry points, so the programs that share its executable are beside one another too. A name of its own for the
// package keeps a program in an executable of its own.
export default family("modules of the library use keys of one another", [
  ...subjects
    .filter(({ name }) => /^a file handle is (read|written) as a stream$|^the lines of a file handle$/.test(name))
    .map((subject, index) =>
      program(subject, ["node:child_process"], "node:child_process alone", ["--external", `${external}-${index}`], {}),
    ),
  ...subjects
    .filter(({ name }) => name === "a file handle is handed to a worker")
    .map(subject => program(subject, [], "nothing else", [], {})),
  ...[[], ["--external", external]].flatMap(flags =>
    subjects.map(subject => program(subject, modulesBeside, "every module", flags, {})),
  ),
  ...subjects.flatMap((subject, index) =>
    ["nothing", ...modulesBeside].flatMap((module, number) =>
      [[], ["--external", `${external}-${index}-${number}`]].map(flags =>
        program(subject, module === "nothing" ? [] : [module], module, flags, {}),
      ),
    ),
  ),
]);
