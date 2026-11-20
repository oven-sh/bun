// Writes to a full device fail. Failures of one turn emit one error, on the tick behind the first callback. A later failure emits again.
const fs = require("node:fs");
if (process.env.REPORT_OF_CHILD) {
  const seen = [];
  process.on("uncaughtException", error => seen.push("uncaught " + error.code));
  process.on("exit", () => fs.writeFileSync(process.env.REPORT_OF_CHILD, seen.join("\n")));
  process.stdout.write("a", error => {
    seen.push("a " + error.code);
    process.nextTick(() => seen.push("tick of a"));
    Promise.resolve().then(() => process.nextTick(() => seen.push("tick of a microtask")));
  });
  process.stdout.write("b", error => seen.push("b " + error.code));
  setTimeout(() => {
    process.stdout.write("c", error => {
      seen.push("c " + error.code);
      process.stdout.write("d", error => seen.push("d " + error.code));
    });
  }, 20);
} else if (fs.existsSync("/dev/full")) {
  const folder = fs.mkdtempSync(require("node:os").tmpdir() + "/full-");
  const report = folder + "/report";
  const { status } = require("node:child_process").spawnSync(process.execPath, Bun.main.includes("$bunfs") ? [] : [Bun.main], {
    stdio: ["ignore", fs.openSync("/dev/full", "w"), "ignore"],
    env: { ...process.env, REPORT_OF_CHILD: report },
  });
  console.log(status + "\n" + fs.readFileSync(report, "utf8"));
  fs.rmSync(folder, { recursive: true });
}
