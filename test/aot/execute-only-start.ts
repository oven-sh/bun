/**
 * Whether the Bun under test was built with `--execute-only-start=off`: an executable that it compiles ahead of time does
 * not start where it cannot open its own file.
 */
export const refusesExecuteOnlyStart =
  process.platform === "linux" &&
  Bun.spawnSync([
    "grep",
    "-q",
    "-a",
    "execute-only start: where its file cannot be read, it does not start",
    process.execPath,
  ]).exitCode === 0;
