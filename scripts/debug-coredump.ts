import fs from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";

// usage: bun debug-coredump.ts
// -p <PID of the test that crashed> (buildkite should show this)
// -b <URL to the bun-profile.zip artifact for the appropriate platform>
// -c <URL to the bun-cores.tar.gz.age artifact for the appropriate platform>
// -d <debugger> (default: lldb)
const {
  values: { pid: stringPid, ["build-url"]: buildUrl, ["cores-url"]: coresUrl, debugger: debuggerPath },
} = parseArgs({
  options: {
    pid: { type: "string", short: "p" },
    ["build-url"]: { type: "string", short: "b" },
    ["cores-url"]: { type: "string", short: "c" },
    debugger: { type: "string", short: "d", default: "lldb" },
  },
});

if (stringPid === undefined) throw new Error("no PID given");
const pid = parseInt(stringPid);
if (buildUrl === undefined) throw new Error("no build-url given");
if (coresUrl === undefined) throw new Error("no cores-url given");
if (!process.env.AGE_CORES_IDENTITY?.startsWith("AGE-SECRET-KEY-"))
  throw new Error("no identity given in $AGE_CORES_IDENTITY");

const id = Bun.hash(buildUrl + coresUrl).toString(36);
const dir = join(tmpdir(), `debug-coredump-${id}.tmp`);
fs.mkdirSync(dir, { recursive: true });

if (!fs.existsSync(join(dir, "bun-profile")) || !fs.existsSync(join(dir, `bun-${pid}.core`))) {
  console.log("downloading bun-profile.zip");
  const zip = await (await fetch(buildUrl)).arrayBuffer();
  await Bun.write(join(dir, "bun-profile.zip"), zip);
  // -j: junk paths (don't create directories when extracting)
  // -o: overwrite without prompting
  // -d: extract to this directory instead of cwd
  await Bun.$`unzip -j -o ${join(dir, "bun-profile.zip")} -d ${dir}`;

  console.log("downloading cores");
  const cores = await (await fetch(coresUrl)).arrayBuffer();
  await Bun.$`bash -c ${`age -d -i <(echo "$AGE_CORES_IDENTITY")`} < ${cores} | tar -zxvC ${dir}`;

  console.log("moving cores out of nested directory");
  for await (const file of new Bun.Glob("bun-cores-*/*.core").scan(dir)) {
    fs.renameSync(join(dir, file), join(dir, basename(file)));
  }
} else {
  console.log(`already downloaded in ${dir}`);
}

const desiredCore = join(dir, (await new Bun.Glob(`*${pid}.core`).scan(dir).next()).value);

const args = [debuggerPath, "--core", desiredCore, join(dir, "bun-profile")];

console.log("launching debugger:");
console.log(args.map(Bun.$.escape).join(" "));

const proc = Bun.spawn(args, {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
await proc.exited;
process.exit(proc.exitCode);
