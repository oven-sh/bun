// The limits of the compiler and of its run time, as the compiler lists them. A limit decides how fast and how large the code is, never what a program prints.
export type Limit = { name: string; value: number; smallest: number; stage: string; protects: string; degradesTo: string };

/** The limits that a build can lower with --aot-limit=<name>:<value>. One in a build; the name All is all of them, each at no less than its `smallest`. */
export function limitsThatCanBeLowered(bun: string, env: Record<string, string | undefined> = process.env): Limit[] {
  const listed = Bun.spawnSync({ cmd: [bun, "build", "--aot-list=registry"], env, stdout: "pipe", stderr: "pipe" });
  const limits: Limit[] = JSON.parse(listed.stdout.toString()).limits;
  return limits.filter(limit => limit.degradesTo !== "buildError");
}

/**
 * Each of them at 0, 1 and 2, from the smallest value that it takes, and at that value. Below that a build with the compiler's own checks on does not come through, or two readers of one limit
 * no longer agree: each row of limits.def whose `smallest` is not 0 is work to do. AOT_WAYS=<name> in joined-programs.ts asks for all values of a limit all the same.
 */
export function limitsLowered(bun: string, env?: Record<string, string | undefined>, isAskedForAll = false): { name: string; flags: string[] }[] {
  return limitsThatCanBeLowered(bun, env).flatMap(limit =>
    [0, 1, 2, ...(limit.smallest > 2 ? [limit.smallest] : [])]
      .filter(value => value < limit.value && (isAskedForAll || value >= limit.smallest))
      .map(value => ({ name: `${limit.name}:${value}`, flags: [`--aot-limit=${limit.name}:${value}`] })),
  );
}

