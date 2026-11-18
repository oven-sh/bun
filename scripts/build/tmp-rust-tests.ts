// Temporary: ships unit tests of Rust crates to the Windows test machines. Removed before the PR is ready.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.ts";
import { cargoBuildInvocation } from "./rust.ts";

const crates = ["bun_errno", "bun_iocp", "bun_sys", "bun_threading"];

/** Never fails the build: test/integration/tmp-bench/rust.test.ts reports a missing program. */
export function buildRustTests(cfg: Config): string[] {
  try {
    return build(cfg);
  } catch (error) {
    console.error(error);
    return [];
  }
}

function build(cfg: Config): string[] {
  if (!cfg.windows || cfg.hardened || cfg.cargo === undefined) return [];
  const { env, triple } = cargoBuildInvocation(cfg);
  const rustflags = [
    "-Ctarget-feature=+crt-static",
    "-Cforce-frame-pointers=yes",
    "-Clink-arg=/FORCE:UNRESOLVED",
    "-Alinker_messages",
    ...(cfg.winsysroot !== undefined ? [`-Clink-arg=/winsysroot:${cfg.winsysroot}`] : []),
  ];
  const args = ["test", "--no-run", "--lib", "--locked", "--message-format=json-render-diagnostics"];
  args.push("--target", triple, "--target-dir", join(cfg.buildDir, "rust-tests-target"));
  args.push(...crates.flatMap(crate => ["-p", crate]));
  const started = performance.now();
  const { stdout } = spawnSync(cfg.cargo, args, {
    cwd: cfg.cwd,
    env: {
      ...process.env,
      ...env,
      CARGO_ENCODED_RUSTFLAGS: rustflags.join("\x1f"),
      CARGO_PROFILE_DEV_DEBUG: "0",
      CARGO_INCREMENTAL: "0",
    },
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
    timeout: 240_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const staged = join(cfg.buildDir, "rust-tests");
  rmSync(staged, { recursive: true, force: true });
  mkdirSync(staged);
  for (const line of (stdout ?? "").split("\n")) {
    if (!line.startsWith("{") || !line.endsWith("}")) continue;
    const { reason, profile, executable, target } = JSON.parse(line);
    if (reason === "compiler-artifact" && profile.test && executable) {
      cpSync(executable, join(staged, `${target.name}.exe`));
    }
  }
  console.log(`Built the Rust unit tests in ${((performance.now() - started) / 1000).toFixed(0)} s`);
  return ["rust-tests"];
}
