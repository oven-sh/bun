// Packs the executable that `bun build --compile --target=bun-portable-<arch>` writes the module graph into:
// the packed file whose image is bun itself, built with `bun scripts/build.ts --profile=portable`.
//
//   bun tools/template.ts --arch x86_64 --image build/release-portable/bun \
//       --win-host host-x64.exe [--macos-stub macos-stub-x86_64] [--sign|--no-sign] \
//       [--work DIR] -o bun-portable-x64
//
// The Linux loader stub is built here from stub/linux_stub.c, into --work (default: beside the output). The
// Windows host and the macOS stub are input files that a person builds on those systems (tools/windows-host.ts
// and tools/mac-stub.ts print how).
//
// `bun build --compile` finds the result with --compile-executable-path, or under the name of the target and
// the version of bun ("bun-portable-x64-v1.4.3") in the working directory or in the install cache.
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildLinuxStub } from "./build.ts";
import { ELF_MACHINE, TOC_SIZE, type Arch } from "./format.ts";
import { pack } from "./pack.ts";

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt: Record<string, string> = {};
  let sign: boolean | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--sign") sign = true;
    else if (a === "--no-sign") sign = false;
    else if (a === "-o") opt.out = args[++i];
    else if (a.startsWith("--")) opt[a.slice(2)] = args[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  for (const need of ["arch", "image", "win-host", "out"]) {
    if (!opt[need]) throw new Error(`missing --${need}`);
  }
  const arch = opt.arch as Arch;
  if (!(arch in ELF_MACHINE)) throw new Error("--arch has to be x86_64 or aarch64");
  const out = resolve(opt.out);
  const work = resolve(opt.work ?? dirname(out));
  await mkdir(work, { recursive: true });
  await mkdir(dirname(out), { recursive: true });

  const stub = buildLinuxStub(arch, work);
  const read = async (p: string) => Buffer.from(await Bun.file(p).arrayBuffer());
  const { file, report: r } = pack({
    arch,
    image: await read(opt.image),
    winHost: await read(opt["win-host"]),
    linuxStub: await read(stub),
    macosStub: opt["macos-stub"] ? await read(opt["macos-stub"]) : undefined,
    sign: sign ?? arch === "aarch64",
  });
  await Bun.write(out, file);
  await Bun.$`chmod 755 ${out}`.quiet();
  if (opt.json) await Bun.write(opt.json, JSON.stringify(r, null, 2) + "\n");
  const hex = (n: number) => `0x${n.toString(16)}`;
  console.log(
    `packed ${out}: ${r.fileSize} bytes\n` +
      `  shell header   ${r.scriptSize} bytes of script, PE header at ${hex(r.headerSize)}\n` +
      `  windows host   up to ${hex(r.winHostEnd)}\n` +
      `  linux stub     ${hex(r.stubLinuxOff)} + ${r.stubLinuxLen} (${r.stubLinuxKey}), built as ${stub}\n` +
      `  macos stub     ${r.stubMacosLen ? `${hex(r.stubMacosOff)} + ${r.stubMacosLen} (${r.stubMacosKey})` : "absent"}\n` +
      `  image          ${hex(r.imageOff)} + ${r.imageLen}\n` +
      `  signature      ${r.sigLen ? `covers ${r.codeLen} bytes from ${hex(r.codeOff)}, blob ${hex(r.sigOff)} + ${r.sigLen}` : "none"}\n` +
      `  contents       ${hex(r.tocOff)} + ${TOC_SIZE}`,
  );
}
