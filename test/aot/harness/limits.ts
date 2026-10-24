// The limits of the compiler and of its run time, as the compiler lists them. A limit decides how fast and how large the code is, never what a program prints.
export type Limit = { name: string; value: number; stage: string; protects: string; degradesTo: string };

/** The limits that a build can lower with --aot-limit=<name>:<value>. One in a build. */
export function limitsThatCanBeLowered(bun: string, env: Record<string, string | undefined> = process.env): Limit[] {
  const listed = Bun.spawnSync({ cmd: [bun, "build", "--aot-list=registry"], env, stdout: "pipe", stderr: "pipe" });
  const limits: Limit[] = JSON.parse(listed.stdout.toString()).limits;
  return limits.filter(limit => limit.degradesTo !== "buildError");
}

/** Each of them at 0, 1 and 2, from the smallest value that it takes. */
export function limitsLowered(bun: string, env?: Record<string, string | undefined>): { name: string; flags: string[] }[] {
  return limitsThatCanBeLowered(bun, env).flatMap(limit =>
    [0, 1, 2]
      .filter(value => value < limit.value && value >= (smallestValues[limit.name] ?? 0))
      .map(value => ({ name: `${limit.name}:${value}`, flags: [`--aot-limit=${limit.name}:${value}`] })),
  );
}

/** Below these the compiler cannot build its own library. AOT_WAYS=<name> in joined-programs.ts asks for them all the same. */
export const smallestValues: Record<string, number> = {};
