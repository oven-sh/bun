// Checks, on the machine that builds the image, what a person is going to build and run on Windows:
// with clang for the MSVC target and the headers and libraries of Microsoft's SDK
// (../tools/windows-sdk.ts). Everything is compiled and linked, and nothing is run.
//
//   bun check-windows.ts        after build.ts and test.ts. WORK as in build.ts.
//
//   libuv             bun's fork at the commit bun pins, with bun's patches, compiled with the flags
//                     of the commands for Windows (windows_build.ts)
//   host              host_win.c and host_win_uv.c, linked with libuv: a name of the table that this
//                     libuv does not define, or a function of Windows that no library has, fails here
//   headers of the C  check_on_windows.c: the constants, sizes and offsets that the C of the image for
//                     Windows was compiled against (uv_header.ts), against the SDK and libuv
//   layout            the structures and constants of bun's Rust bindings as the image has them
//                     against the SDK and libuv (../bindings/verify.ts --table, compare.ts)
//   imports           every import of the image against the import libraries of the SDK and the
//                     table of the host (../bindings/imports-libraries.ts)
//
// Under WORK/wincheck: the logs, host.exe, layout.headers.json, layout-compare.txt,
// imports-libraries.json and summary.json. Exit code 1 if a check fails.
//
// Environment: WORK, LLVM_BIN, SDK (default WORK/winsdk), LIBUV_GIT (where libuv is cloned from).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { headerCheckFlags, host, libuv } from "./windows_build.ts";

const here = dirname(import.meta.path);
const tree = resolve(here, "..");
const work = resolve(process.env.WORK ?? "/tmp/portable/n2");
const llvm = process.env.LLVM_BIN ?? "/usr/lib/llvm-current/bin";
const sdk = resolve(process.env.SDK ?? join(work, "winsdk"));
const out = join(work, "wincheck");
mkdirSync(out, { recursive: true });

function run(cmd: string[], log?: string, cwd?: string) {
  const result = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe", maxBuffer: 1 << 28 });
  const text = result.stdout.toString() + result.stderr.toString();
  if (log) writeFileSync(log, `+ ${cmd.join(" ")}\n${text}`);
  return { ok: result.exitCode === 0, code: result.exitCode, text, stdout: result.stdout.toString() };
}
const count = (text: string, what: RegExp) => [...text.matchAll(what)].length;

if (!existsSync(join(sdk, "windows-x64.cfg"))) {
  const fetched = run(["bun", join(tree, "tools/windows-sdk.ts"), sdk], join(out, "sdk.log"));
  if (!fetched.ok) throw new Error(`the SDK could not be fetched: ${join(out, "sdk.log")}`);
}
const versions = JSON.parse(readFileSync(join(sdk, "versions.json"), "utf8"));
const clang = [`${llvm}/clang`, `--config=${join(sdk, "windows-x64.cfg")}`];
const summary: Record<string, unknown> = {
  compiler: run([`${llvm}/clang`, "--version"]).stdout.split("\n")[0],
  target: run([...clang, "-dumpmachine"]).stdout.trim(),
  windows_sdk: versions.windows_sdk,
  visual_cpp_tools: versions.visual_cpp_tools,
  nothing_of_this_ran: true,
};
let failed = false;
const check = (name: string, ok: boolean, facts: Record<string, unknown>) => {
  summary[name] = { ok, ...facts };
  if (!ok) failed = true;
  console.log(`${ok ? "ok    " : "FAILED"} ${name}: ${JSON.stringify(facts)}`);
};

// ---- libuv ----
const checkout = join(out, "libuv");
const head = existsSync(join(checkout, ".git")) ? run(["git", "-C", checkout, "rev-parse", "HEAD"]).stdout.trim() : "";
if (head !== libuv.commit) {
  rmSync(checkout, { recursive: true, force: true });
  const cloned = run(["git", "clone", "-q", process.env.LIBUV_GIT ?? libuv.repository, checkout], join(out, "libuv-clone.log"));
  if (!cloned.ok) throw new Error(`libuv could not be cloned: ${join(out, "libuv-clone.log")}`);
  if (!run(["git", "-C", checkout, "-c", "advice.detachedHead=false", "checkout", "-q", libuv.commit]).ok) throw new Error(`libuv has no commit ${libuv.commit}`);
  for (const patch of libuv.patches)
    if (!run(["git", "-C", checkout, "apply", join(libuv.patchDirectory, patch)]).ok) throw new Error(`${patch} does not apply`);
}
const objects = join(out, "uv-objects");
rmSync(objects, { recursive: true, force: true });
mkdirSync(objects, { recursive: true });
{
  const compiled = run(
    [...clang, "-c", ...libuv.flags, `-I${join(checkout, "include")}`, `-I${join(checkout, "src")}`, ...libuv.sources.map(source => join(checkout, source))],
    join(out, "uv-compile.log"),
    objects,
  );
  check("libuv", compiled.ok && readdirSync(objects).length === libuv.sources.length, {
    commit: libuv.commit,
    patches: libuv.patches,
    sources: libuv.sources.length,
    objects: readdirSync(objects).length,
    errors: count(compiled.text, /\berror:/g),
    warnings: count(compiled.text, /\bwarning:/g),
    log: join(out, "uv-compile.log"),
  });
}

// ---- the host ----
{
  const program = join(out, "host.exe");
  rmSync(program, { force: true });
  const linked = run(
    [
      ...clang, ...host.flags, "-Wall", "-Wextra", "-o", program,
      ...host.sources.map(source => join(tree, "host", source)),
      ...readdirSync(objects).sort().map(name => join(objects, name)),
      ...host.libraries.map(name => `-l${name}`),
    ],
    join(out, "host-compile.log"),
  );
  const imports = linked.ok ? run([`${llvm}/llvm-readobj`, "--coff-imports", program]).stdout : "";
  check("host", linked.ok && existsSync(program), {
    program,
    sha256: existsSync(program) ? createHash("sha256").update(readFileSync(program)).digest("hex") : null,
    errors: count(linked.text, /\berror:/g),
    warnings: [...linked.text.matchAll(/warning: (.*)$/gm)].map(match => match[1].slice(0, 120)),
    dlls: [...imports.matchAll(/^\s*Name: (.+)$/gm)].map(match => match[1]),
    log: join(out, "host-compile.log"),
  });
}

// ---- what the C of the image was compiled against ----
{
  const source = join(work, "usockets/windows-include/check_on_windows.c");
  const compiled = run([...clang, ...headerCheckFlags, "-ferror-limit=0", `-I${join(checkout, "include")}`, source], join(out, "check-windows-c.txt"));
  const text = readFileSync(source, "utf8");
  check("headers of the C of the image", compiled.ok, {
    source,
    constants: count(text, /^SAME\(/gm),
    sizes_and_offsets: count(text, /^_Static_assert\(/gm),
    functions_declared: count(text, /^static void \*bun_check_/gm),
    errors: [...compiled.text.matchAll(/error: (.*)$/gm)].map(match => match[1].slice(0, 160)),
    log: join(out, "check-windows-c.txt"),
  });
}

// ---- the layout of the bindings ----
{
  const image = join(work, "out/bun_fs_slice.img");
  const ours = run([image, "--layout"]);
  writeFileSync(join(out, "layout.image.json"), ours.stdout);
  const verified = run(
    ["bun", join(tree, "bindings/verify.ts"), "--libuv", checkout, "--table", "--cc", clang.join(" "), "--out", join(out, "layout.headers.json")],
    join(out, "layout-verify.log"),
  );
  const compared = verified.ok ? run(["bun", join(tree, "bindings/compare.ts"), join(out, "layout.image.json"), join(out, "layout.headers.json")]) : undefined;
  if (compared) writeFileSync(join(out, "layout-compare.txt"), compared.text);
  const last = /(\d+) facts are the same, (\d+) differ, (\d+) could not be compared/.exec(compared?.text ?? "");
  check("layout of the bindings", ours.ok && verified.ok && compared?.ok === true, {
    the_same: Number(last?.[1] ?? 0),
    differ: last ? Number(last[2]) : null,
    not_compared: Number(last?.[3] ?? 0),
    different: [...(compared?.text ?? "").matchAll(/^DIFFERENT\s+(.*)$/gm)].map(match => match[1]),
    report: join(out, "layout-compare.txt"),
  });
}

// ---- the imports ----
for (const [name, image] of [
  ["imports of the loop slice", "bun_loop_slice.img"],
  ["imports of the file system slice", "bun_fs_slice.img"],
]) {
  const listed = run([join(work, "out/host-linux"), join(work, "out", image), "--imports"]);
  const list = join(out, `${image}.imports.jsonl`);
  writeFileSync(list, listed.stdout);
  const checked = run(["bun", join(tree, "bindings/imports-libraries.ts"), list, "--sdk", sdk]);
  writeFileSync(join(out, `${image}.imports-libraries.json`), checked.stdout);
  const report = checked.stdout.startsWith("{") ? JSON.parse(checked.stdout) : { imports: 0, not_found: [{ why: checked.text.slice(0, 300) }] };
  check(name, checked.ok && report.imports > 0, { imports: report.imports, by_library: report.by_library, not_found: report.not_found });
}

writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 1) + "\n");
console.log(`${join(out, "summary.json")}: ${failed ? "a check FAILED" : "every check passed"}. Nothing of this ran: it was compiled and linked.`);
process.exit(failed ? 1 : 0);
