// The environment of a child process: the parent's, some names unset, some pinned, the path rewritten.
const UNSET_KEYS = Array.from({ length: 24 }, (_, index) => "TOOL_SETTING_TO_UNSET_" + index);
const FIXED: Readonly<Record<string, string>> = { TOOL_TERMINAL_PROMPT: "0", TOOL_OPTIONAL_LOCKS: "0", TOOL_PAGER: "cat", LC_ALL: "C" };

function pinsFor(extra: Record<string, string> | undefined, repository: string | undefined): Record<string, string> {
  return { ...FIXED, ...(repository !== undefined && { TOOL_DIRECTORY: repository }), ...extra };
}

function scopedEnvironment(extra: Record<string, string> | undefined, repository: string | undefined, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const pins = pinsFor(extra, repository);
  const unset: Record<string, undefined> = {};
  for (const key of UNSET_KEYS) unset[key] = undefined;
  for (const key of Object.keys(base)) {
    if (key.toUpperCase().startsWith("TOOL_CONFIG_")) unset[key] = undefined;
  }
  return { ...base, ...unset, ...pins };
}

function withAbsolutePath(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const kept = (value: string | undefined) => value === undefined ? undefined : value.split(":").filter(entry => entry.startsWith("/")).join(":");
  const pathKeys = Object.keys(environment).filter(key => key === "PATH");
  return { ...environment, ...Object.fromEntries(pathKeys.map(key => [key, kept(environment[key])])) };
}

const rounds = Number(process.argv[2] ?? 3);
let sum = 0;
for (let round = 0; round < rounds; round++) {
  const environment = withAbsolutePath(scopedEnvironment(round & 1 ? { TOOL_EXTRA: "x" + (round & 3) } : undefined, round & 2 ? "/repository" : undefined));
  // How many variables there are besides differs from run to run: a shell that starts the program adds its own.
  sum += Object.keys(environment).filter(key => key.startsWith("TOOL_")).length + (environment.PATH ?? "").length;
  if (round < 4) console.log(Object.keys(environment).filter(key => key.startsWith("TOOL_") || key === "PATH" || key === "LC_ALL").join(","), environment.PATH, environment.TOOL_DIRECTORY, environment.TOOL_EXTRA, "TOOL_SETTING_TO_UNSET_3" in environment, environment.TOOL_SETTING_TO_UNSET_3);
}
console.log(sum);
