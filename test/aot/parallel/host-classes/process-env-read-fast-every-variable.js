// A process that starts with 150 variables reads each of them once by key, as a loop over Object.keys(process.env) does. Behind that a read of process.env is answered where a read of a plain copy is: the run time is not asked at every read.
// Two thousand turns of three reads on each. How many variables the machine sets besides is not known: there is room for a thousand.
// COUNT: operations <= 3000
if (!process.env.AOT_TEST_IS_THE_CHILD) {
  const env = { ...process.env, AOT_TEST_IS_THE_CHILD: "1" };
  for (let i = 0; i < 150; i++) env["AOT_TEST_VARIABLE_" + i] = "value " + i;
  const child = Bun.spawnSync({
    cmd: Bun.main.startsWith("/$bunfs/") ? [process.execPath] : [process.execPath, Bun.main],
    env,
    stderr: "inherit",
  });
  console.log(child.stdout.toString().trim());
} else {
  let length = 0;
  for (const key of Object.keys(process.env)) length += process.env[key].length;
  const copy = { ...process.env };
  const names = ["AOT_TEST_VARIABLE_7", "AOT_TEST_NEVER_SET_ONE", "AOT_TEST_VARIABLE_99", "AOT_TEST_NEVER_SET_TWO"];
  function count(object, turns) {
    let set = 0;
    for (let i = 0; i < turns; i++)
      set +=
        (object[names[i & 3]] ? 1 : 0) +
        (object.AOT_TEST_VARIABLE_3 ? 1 : 0) +
        (object.AOT_TEST_NEVER_SET_THREE ? 1 : 0);
    return set;
  }
  console.log(length > 0, count(copy, 2000), count(process.env, 2000));
}
