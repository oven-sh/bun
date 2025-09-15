test("test timeout kills dangling processes", async () => {
  Bun.spawnSync({
    cmd: ["bun", "--eval", "Bun.sleepSync(100); console.log('This should not be printed!');"],
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  await Bun.sleep(1);
  Bun.spawnSync({
    cmd: ["bun", "--eval", "Bun.sleepSync(100); console.log('This should not be printed!');"],
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  // await Bun.sleep(1000);
}, 10);

test("test after the timeout one still runs", async () => {
  await Bun.sleep(500);
  console.log("Ran slow test");
}, 1000);
