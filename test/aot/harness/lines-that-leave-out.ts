// The lines in the head of a stored program by which something of it is compared with nothing or not built. run-parallel.ts reads them by this expression, and
// every-stored-program-is-built-once-more-where-guesses-fail.test.ts finds them by it over all stored programs and holds the list: no such line comes in without a diff there.
export const lineThatLeavesOut =
  /^\/\/ (Prints what the compiler saves|Prints what goes by the copy that runs|Skip on \w+ \w+(?: under .*?)?|Skip under .*?|No build under .*?):(?:[ \t]+(.*))?$/gm;

const platforms = ["linux", "darwin", "win32", "freebsd"];
const processors = ["x64", "arm64"];

/** Why a line is not read, or undefined. `ways`: the flags, joined by a blank, of the builds that a line may name. */
export function whyLineThatLeavesOutIsNotRead(what: string, why: string | undefined, isInHead: boolean, ways: string[]) {
  if (!isInHead) return "it stands below the head";
  if (!why?.trim()) return "it says no reason";
  const [, platform, processor, flagsOnPlatform] = /^Skip on (\w+) (\w+)(?: under (.*))?$/.exec(what) ?? [];
  if (platform !== undefined && !(platforms.includes(platform) && processors.includes(processor)))
    return `${platform} ${processor} is no process.platform and process.arch that Bun is built for`;
  if (what.startsWith("Skip under ") && what !== "Skip under ASAN") return "it names no platform";
  const flags = flagsOnPlatform ?? /^No build under (.*)$/.exec(what)?.[1];
  if (flags !== undefined && (!ways.includes(flags) || flags.includes("FailGuesses")))
    return "its flags are those of no way in which the program is built whatever the build of CI";
  return undefined;
}
