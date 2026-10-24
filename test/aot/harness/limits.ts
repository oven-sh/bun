// The limits of the compiler and of its run time, as the compiler lists them. A limit decides how fast and how large the code is, never what a program prints.
export type Limit = { name: string; value: number; stage: string; protects: string; degradesTo: string };

/** The limits that a build can lower with --aot-limit=<name>:<value>. One in a build. */
export function limitsThatCanBeLowered(bun: string, env: Record<string, string | undefined> = process.env): Limit[] {
  const listed = Bun.spawnSync({ cmd: [bun, "build", "--aot-list=registry"], env, stdout: "pipe", stderr: "pipe" });
  const limits: Limit[] = JSON.parse(listed.stdout.toString()).limits;
  return limits.filter(limit => limit.degradesTo !== "buildError");
}

/** Each of them at 0, 1 and 2, from the smallest value that it takes. */
export function limitsLowered(bun: string, env?: Record<string, string | undefined>, isAskedForAll = false): { name: string; flags: string[] }[] {
  return limitsThatCanBeLowered(bun, env).flatMap(limit =>
    [0, 1, 2]
      .filter(value => value < limit.value && (isAskedForAll || value >= (smallestValues[limit.name] ?? 0)))
      .map(value => ({ name: `${limit.name}:${value}`, flags: [`--aot-limit=${limit.name}:${value}`] })),
  );
}

/**
 * The smallest values that are tried. Below them a build with the compiler's own checks on does not come through, or two readers of one limit no longer agree.
 * 3 leaves a limit out. AOT_WAYS=<name> in joined-programs.ts asks for all values of a limit all the same: each line here is work to do.
 */
export const smallestValues: Record<string, number> = {
  DirectCallReach: 3,
  FieldsInKeyOrder: 3,
  InlineFramesPerFunction: 3,
  KeyOrdersPerLayout: 3,
  MaxArgumentRegisters: 3,
  MaxArrayLiteralBatch: 3,
  MaxBuiltinCallArguments: 3,
  MaxCachedKeyLength: 2,
  MaxCaptures: 3,
  MaxClassesInType: 3,
  MaxFunctionsInType: 3,
  MaxLayoutsInType: 3,
  MaxLiteralsInType: 3,
  MaxSelectionGroupMembers: 1,
  MaxTypeValuesRounds: 3,
  RegExpSectionSize: 3,
};
