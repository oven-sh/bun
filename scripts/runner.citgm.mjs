#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

function tmpdirSync(pattern = "bun.citgm.") {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), pattern));
}

// keep this in sync with .buildkite/ci.yml
const shards = [
  // 0
  [0, "binary-split"],
  [0, "blake2b-wasm"],
  [0, "bufferutil"],
  [0, "crc32-stream"],
  [0, "dicer"],
  // 5
  [0, "duplexer2"],
  [0, "duplexify"],
  [0, "flush-write-stream"],
  [0, "from2"],
  [0, "full-icu-test"],
  // 10
  [0, "iconv"],
  [0, "pumpify"],
  [0, "thread-sleep"],
  [0, "throughv"],
];

const shard_number = parseInt(process.argv[2] ?? process.env["BUILDKITE_PARALLEL_JOB"] ?? "0", 10);

const the_shard = shards[shard_number];

console.log("❯", the_shard);

const clone_url = await (async () => {
  switch (the_shard[0]) {
    case 0: {
      let result = await fetch(`https://registry.npmjs.org/${the_shard[1]}`);
      result = await result.json();
      result = result.repository.url;
      result = result.replace("git:", "https:");
      result = result.replace("git+", "");
      result = result.replace("ssh://git@", "https://");
      return result;
    }
    default: {
      console.log("invalid shard kind:", the_shard[0]);
      process.exit(1);
    }
  }
})();

const clone_dir = tmpdirSync();

{
  console.log();
  const cmd = "git";
  const args = ["clone", clone_url, clone_dir];
  console.log("❯", [cmd, ...args]);

  const result = spawnSync(cmd, args, { stdio: ["ignore", "inherit", "inherit"] });
  if (result.signal) {
    console.log("-", "command exited with abnormal signal:", result.signal);
    process.exit(1);
  }
  if (result.status) {
    console.log("-", "command exited with non-zero status:", result.signal);
    process.exit(1);
  }
}

{
  console.log();
  const cmd = process.argv0;
  const args = ["install"];
  console.log("❯", [cmd, ...args]);

  const result = spawnSync(cmd, args, { stdio: ["ignore", "inherit", "inherit"], cwd: clone_dir });
  if (result.signal) {
    console.log("-", "command exited with abnormal signal:", result.signal);
    process.exit(1);
  }
  if (result.status) {
    console.log("-", "command exited with non-zero status:", result.status);
    process.exit(1);
  }
}

{
  console.log();
  const cmd = process.argv0;
  const args = ["--bun", "run", the_shard[2] ?? "test"];
  console.log("❯", [cmd, ...args]);

  const result = spawnSync(cmd, args, { stdio: ["ignore", "inherit", "inherit"], cwd: clone_dir });
  if (result.signal) {
    console.log("-", "command exited with abnormal signal:", result.signal);
    process.exit(1);
  }
  if (result.status) {
    console.log("-", "command exited with non-zero status:", result.status);
    process.exit(1);
  }
}