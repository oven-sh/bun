// Sources that are lists. Most sources make a program out of a random number. Some kinds of program are better written down one by one: every place crossed with every thing that may
// stand there, every row of a table, a run of seeds with the options that go with each. A file of ./sources writes such a list down, and `family` makes a source of it: seed n draws
// member n, and the seeds behind the last member begin again at the first.
//
//   bun test/aot/fuzz/run.ts --sources <name of the file> --seconds 600
//   bun test/aot/fuzz/run.ts --replay <name of the file>:<n> --print-only
import type { Bed, Program } from "./beds";
import type { Generated } from "./sources";

/** A program as its generator hands it over. `file` is what runs. `entryPoints` are files that the build is given behind it. */
export interface Made {
  file: string;
  text: string;
  files?: Record<string, string>;
  entryPoints?: string[];
  links?: Record<string, string>;
}

export interface Member {
  /** What is special about it. It stands in the notes of a finding. */
  name: string;
  make: () => Made;
  /** More flags for the build. */
  flags?: string[];
  /** Set where plain Bun runs the program for reference, and nowhere else. */
  plainEnv?: Record<string, string>;
  /** Whatever else its list says of it. `notHeldToPlainBun` names what counts. */
  [more: string]: unknown;
}

/** A source without its name, which is the name of its file. */
export type Drawn = (seed: number, bed: Bed) => Omit<Generated, "source"> | undefined;

/**
 * A member that says one of these of itself is not meant to print what `bun <file>` prints: it tries what --aot refuses, it follows an executable that is built without --aot, its lines
 * come in another order, or it departs today. The fuzzer knows one rule, "as plain Bun", so it does not draw such a member.
 */
const notHeldToPlainBun = [
  "mayBeRefused",
  "groupsMayBeRefused",
  "referenceIsCompiled",
  "flagsOfBothBuilds",
  "written",
  "printsInThisOrder",
  "linesDepartToday",
  "failsToday",
  "startsItself",
  "mayStopOutOfMemory",
];

/** What a bed takes, or nothing where it cannot lay the files out. The file that runs is `main.<extension>` there, so the other files name it so. */
export function asProgram(
  made: Made,
  flags: string[] = [],
  plainEnvironment?: Record<string, string>,
): Program | undefined {
  const extension = /^[^/]+\.([cm]?[jt]s|[jt]sx)$/.exec(made.file)?.[1];
  if (!extension || made.links) return;
  const renamed = (text: string) => text.replaceAll(`./${made.file}`, `./main.${extension}`);
  const files =
    made.files && Object.keys(made.files).length
      ? Object.fromEntries(Object.entries(made.files).map(([path, text]) => [path, renamed(text)]))
      : undefined;
  return {
    text: files ? renamed(made.text) : made.text,
    extension: extension as Program["extension"],
    ...(files && { files, runsInItsFolder: true as const }),
    ...(flags.length && { flags }),
    ...(made.entryPoints && { entryPoints: made.entryPoints }),
    ...(plainEnvironment && { plainEnvironment }),
  };
}

const drawn = (bed: Bed, seed: number, program: Program | undefined, notes: string, group: string) =>
  program && bed.accepts(program) && bed.allows(program.text)
    ? {
        seed,
        ...program,
        notes,
        group,
        // What is not a plain script or module of its own cannot be one module of many in a shared build.
        ...((program.files || program.flags || program.plainEnvironment || !/^[jt]s$/.test(program.extension)) && {
          standsAlone: true as const,
        }),
      }
    : undefined;

/** `title` says in a few words what the programs are about. */
export function family(title: string, members: Member[]): Drawn {
  const held = members.filter(member => !notHeldToPlainBun.some(name => member[name]));
  return (seed, bed) => {
    if (bed.name !== "product" || !held.length) return;
    const member = held[seed % held.length];
    return drawn(bed, seed, asProgram(member.make(), member.flags, member.plainEnv), member.name, title);
  };
}

/** A list without an end: member n is made when seed n is drawn. */
export function endless(title: string, memberAt: (index: number) => Member): Drawn {
  return (seed, bed) => {
    if (bed.name !== "product") return;
    const member = memberAt(seed);
    if (notHeldToPlainBun.some(name => member[name])) return;
    return drawn(bed, seed, asProgram(member.make(), member.flags, member.plainEnv), member.name, title);
  };
}

/** A table too long to write down: a module that counts its programs and makes the one at an index. */
export function table(
  title: string,
  module: { programs: number; programOf: (index: number) => Made; flagsOf?: (index: number) => string[] },
): Drawn {
  return (seed, bed) => {
    if (bed.name !== "product") return;
    const index = seed % module.programs;
    return drawn(
      bed,
      seed,
      asProgram(module.programOf(index), module.flagsOf?.(index)),
      `program ${index} of ${module.programs}`,
      title,
    );
  };
}

/** A generator that hands over whole programs, files and all, for any random number. */
export function whole(title: string, generate: (random: never) => Made, random: (seed: number) => unknown): Drawn {
  return (seed, bed) =>
    bed.name === "product" ? drawn(bed, seed, asProgram(generate(random(seed) as never)), "", title) : undefined;
}
