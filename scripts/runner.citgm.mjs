#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { getExecPathFromBuildKite } from "./utils.mjs";

function tmpdirSync(pattern = "bun.citgm.") {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), pattern));
}

// keep this in sync with .buildkite/ci.yml
const shards = [
  // 0
  [0, "binary-split"],
  [0, "blake2b-wasm"],
  [0, "flush-write-stream"],
  [0, "from2"],
  [0, "full-icu-test"],
  // 5
  [0, "pumpify"],
  [0, "thread-sleep"],
  [0, "isarray"],
];

let exec_path = process.argv[2];
console.log("exec path:", exec_path);
if (process.env.BUILDKITE_PARALLEL_JOB != null) {
  console.log("downloading bun from buildkite");
  exec_path = await getExecPathFromBuildKite("linux-x64-build-bun");
  console.log("exec path:", exec_path);
  console.log("---");
  console.log();
}

const shard_number = parseInt(process.argv[3] ?? process.env.BUILDKITE_PARALLEL_JOB ?? "0", 10);

let the_shard = shards[shard_number];

console.log("❯", the_shard);

const clone_url = await (async () => {
  if (shard_number === -1) the_shard = [0, process.argv[4]];
  if (shard_number === -2) the_shard = [1, process.argv[4]];
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
    case 1: {
      return the_shard[1];
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
  console.log("---");
}

{
  console.log();
  const cmd = exec_path;
  const args = ["--revision"];
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
  console.log("---");
}

{
  console.log(`${clone_dir}/package.json`);
  console.log();
  const cmd = exec_path;
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
  console.log("---");
}

{
  console.log(`${clone_dir}/package.json`);
  console.log();
  const cmd = exec_path;
  const args = ["pm", "trust", "--all"];
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
  console.log("---");
}

{
  console.log(`${clone_dir}/package.json`);
  console.log();
  const cmd = exec_path;
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
  console.log("---");
}

fs.rmSync(clone_dir, { recursive: true, force: true });
