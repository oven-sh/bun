// A process that starts with 150 variables reads each of them once by key, as a loop over Object.keys(process.env) does. Behind that a read of process.env takes about what a read of a plain copy takes.
// Alone: it measures time, memory or what is collected, and that depends on what the compiler knows about the whole executable
if (!process.env.AOT_TEST_IS_THE_CHILD) {
  const env = { ...process.env, AOT_TEST_IS_THE_CHILD: "1" };
  for (let i = 0; i < 150; i++) env["AOT_TEST_VARIABLE_" + i] = "value " + i;
  const child = Bun.spawnSync({ cmd: Bun.main.startsWith("/$bunfs/") ? [process.execPath] : [process.execPath, Bun.main], env, stderr: "inherit" });
  console.log(child.stdout.toString().trim());
} else {
  let length = 0;
  for (const key of Object.keys(process.env)) length += process.env[key].length;
  const copy = { ...process.env };
  const names = ["AOT_TEST_VARIABLE_7", "AOT_TEST_NEVER_SET_ONE", "AOT_TEST_VARIABLE_99", "AOT_TEST_NEVER_SET_TWO"];
  function count(object, turns) {
    let set = 0;
    for (let i = 0; i < turns; i++) set += (object[names[i & 3]] ? 1 : 0) + (object.AOT_TEST_VARIABLE_3 ? 1 : 0) + (object.AOT_TEST_NEVER_SET_THREE ? 1 : 0);
    return set;
  }
  function fastestOf(runs, object) {
    let fastest = Infinity;
    for (let run = 0; run < runs; run++) {
      const began = performance.now();
      if (count(object, 20000) !== 30000) console.log("another count");
      fastest = Math.min(fastest, performance.now() - began);
    }
    return fastest;
  }
  const ofCopy = fastestOf(20, copy), ofEnvironment = fastestOf(20, process.env);
  console.log(length > 0 && ofEnvironment < ofCopy * 8 ? "a read of process.env takes under eight reads of a plain copy" : "a read of process.env takes over eight reads of a plain copy");
}
