import { parseArgs } from "node:util";
import fs from "node:fs";
import { basename, join } from "node:path";
import { debug } from "node:console";

// usage: bun debug-coredump.ts
// -p <PID of the test that crashed> (buildkite should show this)
// -b <URL to the bun-profile.zip artifact for the appropriate platform>
// -c <URL to the bun-cores.tar.gz.age artifact for the appropriate platform>
// -i <path to age identity to decrypt the cores>
// -d <debugger> (default: lldb)
const {
  values: {
    pid: stringPid,
    ["build-url"]: buildUrl,
    ["cores-url"]: coresUrl,
    ["identity-file"]: identityFile,
    debugger: debuggerPath,
  },
} = parseArgs({
  options: {
    pid: { type: "string", short: "p" },
    ["build-url"]: { type: "string", short: "b" },
    ["cores-url"]: { type: "string", short: "c" },
    ["identity-file"]: { type: "string", short: "i" },
    debugger: { type: "string", short: "d", default: "lldb" },
  },
});

if (stringPid === undefined) throw new Error("no PID given");
const pid = parseInt(stringPid);
if (buildUrl === undefined) throw new Error("no build-url given");
if (coresUrl === undefined) throw new Error("no cores-url given");
if (identityFile === undefined) throw new Error("no identity-file given");

const id = Bun.hash(buildUrl + coresUrl).toString(36);
const dir = join(import.meta.dir, "..", `debug-coredump-${id}.tmp`);
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
  await Bun.$`age -d -i ${identityFile} < ${cores} | tar -zxvC ${dir}`;

  console.log("moving cores out of nested directory");
  for await (const file of new Bun.Glob("bun-cores-*/bun-*.core").scan(dir)) {
    fs.renameSync(join(dir, file), join(dir, basename(file)));
  }
} else {
  console.log(`already downloaded in ${dir}`);
}

const proc = await Bun.spawn([debuggerPath, "--core", join(dir, `bun-${pid}.core`), join(dir, "bun-profile")], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
await proc.exited;
process.exit(proc.exitCode);
