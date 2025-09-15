test("test timeout kills dangling processes", async () => {
  Bun.spawnSync({
    cmd: ["bun", "--eval", "Bun.sleepSync(5000); console.log('This should not be printed!');"],
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  await Bun.sleep(1);
  Bun.spawnSync({
    cmd: ["bun", "--eval", "Bun.sleepSync(5000); console.log('This should not be printed!');"],
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
}, 10);
