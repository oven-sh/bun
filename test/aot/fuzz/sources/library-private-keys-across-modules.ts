// A list of programs from ../generators/library-private-keys-across-modules.ts, which describes them.
import {
  modulesBeside,
  programAbout,
  subjects,
  type Subject,
} from "../generators/library-private-keys-across-modules";
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

// A build with an external package treats all its entry points as one program, so programs that share its executable
// affect each other. Giving the package a unique name keeps a program in its own executable.
export default family("library private keys across modules", [
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
