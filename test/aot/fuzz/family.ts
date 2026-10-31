// Helpers for sources that are lists. Most sources generate a program from a random number. Some programs are better
// enumerated: every position crossed with every value, every row of a table, a range of seeds with its own options. A
// file in ./sources writes such a list, and `family` turns it into a source: seed n picks member n, and seeds past the
// last member wrap around.
//
//   bun test/aot/fuzz/run.ts --sources <file name> --seconds 600
//   bun test/aot/fuzz/run.ts --replay <file name>:<n> --print-only
import type { Runner, Program } from "./runners";
import type { Generated } from "./sources";

/**
 * A program as its generator returns it. `file` is the entry point. `entryPoints` are extra files passed to the build.
 */
export interface Made {
  file: string;
  text: string;
  files?: Record<string, string>;
  entryPoints?: string[];
  links?: Record<string, string>;
}

export interface Member {
  /** What is special about this member. It goes into the notes of a finding. */
  name: string;
  make: () => Made;
  /** Extra build flags. */
  flags?: string[];
  /** Environment of the plain Bun run only. */
  plainEnv?: Record<string, string>;
  /** Why plain Bun prints different things from run to run without `plainEnv`. The executable may print any of them. */
  unstablePlainOutput?: string;
  /**
   * Lines in which plain Bun deviates from the specification: a line that starts with a key must end with its value.
   * The executable may print either.
   */
  specified?: Record<string, string>;
  /** Any other property of the list. Only the ones in `notComparedWithPlainBun` matter here. */
  [more: string]: unknown;
}

/** A source without its name. The name is its file name. */
export type Drawn = (seed: number, runner: Runner) => Omit<Generated, "source"> | undefined;

/**
 * A member with one of these properties is not expected to print what `bun <file>` prints: it follows an executable
 * built without --aot, or it differs today. The fuzzer only compares with plain Bun, so it skips such a member.
 */
const notComparedWithPlainBun = ["referenceIsCompiled", "linesDepartToday", "failsToday"];

/**
 * Converts to what a runner accepts, or returns nothing if the runner cannot lay out the files. The entry point becomes
 * `main.<extension>`, so imports of it are rewritten.
 */
export function asProgram(
  made: Made,
  flags: string[] = [],
  plainEnvironment?: Record<string, string>,
): Program | undefined {
  const extension = /^[^/]+\.([cm]?[jt]s|[jt]sx)$/.exec(made.file)?.[1];
  if (!extension || made.links) return;
  const stem = made.file.slice(0, -extension.length - 1);
  const renamed = (text: string) =>
    text
      .replaceAll(`./${made.file}`, `./main.${extension}`)
      .replaceAll(`"./${stem}"`, '"./main"')
      .replaceAll(`'./${stem}'`, "'./main'");
  const files =
    made.files && Object.keys(made.files).length
      ? Object.fromEntries(Object.entries(made.files).map(([path, text]) => [path, renamed(text)]))
      : undefined;
  return {
    text: files ? renamed(made.text) : made.text,
    extension: extension as Program["extension"],
    ...(files && { files, runsInOwnFolder: true as const }),
    ...(flags.length && { flags }),
    ...(made.entryPoints && { entryPoints: made.entryPoints }),
    ...(plainEnvironment && { plainEnvironment }),
  };
}

const corrected = (plain: string, specified: Record<string, string>) =>
  plain
    .split("\n")
    .map(line => {
      const start = Object.keys(specified).find(start => line.startsWith(start));
      return start === undefined ? line : start + specified[start];
    })
    .join("\n");

const drawn = (
  runner: Runner,
  seed: number,
  program: Program | undefined,
  notes: string,
  group: string,
  specified?: Record<string, string>,
) =>
  program && runner.accepts(program) && runner.allows(program.text)
    ? {
        seed,
        ...program,
        notes,
        group,
        ...(specified && {
          meant: (plain: string, compiled: string) =>
            compiled === corrected(plain, specified) ? "as specified, where plain Bun deviates" : undefined,
        }),
        // Only a plain single-file script or module can share a build with other programs.
        ...((program.files || program.flags || program.plainEnvironment || !/^[jt]s$/.test(program.extension)) && {
          needsOwnBuild: true as const,
        }),
      }
    : undefined;

const drawnMember = (runner: Runner, seed: number, member: Member, title: string) => {
  const program = asProgram(member.make(), member.flags, member.plainEnv);
  const { unstablePlainOutput } = member;
  return drawn(
    runner,
    seed,
    program && { ...program, ...(unstablePlainOutput && { unstablePlainOutput }) },
    member.name,
    title,
    member.specified,
  );
};

/** `title` says in a few words what the programs test. It is the group of their findings. */
export function family(title: string, members: Member[]): Drawn {
  const held = members.filter(member => !notComparedWithPlainBun.some(name => member[name]));
  return (seed, runner) => {
    if (runner.name !== "product" || !held.length) return;
    const member = held[seed % held.length];
    return drawnMember(runner, seed, member, title);
  };
}

/** An unbounded list: member n is created when seed n is used. */
export function endless(title: string, memberAt: (index: number) => Member): Drawn {
  return (seed, runner) => {
    if (runner.name !== "product") return;
    const member = memberAt(seed);
    if (notComparedWithPlainBun.some(name => member[name])) return;
    return drawnMember(runner, seed, member, title);
  };
}

/** A table too long to write out: a module that counts its programs and returns the one at an index. */
export function table(
  title: string,
  module: { programs: number; programOf: (index: number) => Made; flagsOf?: (index: number) => string[] },
): Drawn {
  return (seed, runner) => {
    if (runner.name !== "product") return;
    const index = seed % module.programs;
    return drawn(
      runner,
      seed,
      asProgram(module.programOf(index), module.flagsOf?.(index)),
      `program ${index} of ${module.programs}`,
      title,
    );
  };
}

/** A generator that returns whole multi-file programs for any random number. */
export function whole(title: string, generate: (random: never) => Made, random: (seed: number) => unknown): Drawn {
  return (seed, runner) =>
    runner.name === "product" ? drawn(runner, seed, asProgram(generate(random(seed) as never)), "", title) : undefined;
}
