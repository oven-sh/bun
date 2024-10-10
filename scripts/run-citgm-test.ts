#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

function tmpdirSync(pattern = "bun.citgm.") {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), pattern));
}

const exec_path = Bun.argv[2];
console.log("exec path:", exec_path);
console.log("---");

const clone_url = Bun.argv[3];
const clone_dir = tmpdirSync();
const test_script = Bun.argv[4] ?? "test";

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
  if (result.error) {
    process.exit(1);
  }
  console.log("---");
}

const package_json = require(`${clone_dir}/package.json`);
const deps = Object.keys(package_json.dependencies ?? {});
const devDeps = Object.keys(package_json.devDependencies ?? {});

if (deps.length || devDeps.length) {
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
  if (result.error) {
    process.exit(1);
  }
  console.log("---");
}

{
  console.log(`${clone_dir}/package.json`);
  console.log();
  const cmd = exec_path;
  const args = ["--bun", "run", test_script];
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
  if (result.error) {
    process.exit(1);
  }
  console.log("---");
}

fs.rmSync(clone_dir, { recursive: true, force: true });
