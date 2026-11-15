const spawn = Bun.spawn;

Bun.spawn = ((options: { cmd?: string[] }, ...rest: unknown[]) => {
  const cmd = options?.cmd;
  const compiled = cmd?.[1] === "test" ? { ...options, cmd: [cmd[0], "test", "--aot", ...cmd.slice(2)] } : options;
  return (spawn as (...all: unknown[]) => unknown)(compiled, ...rest);
}) as typeof Bun.spawn;
