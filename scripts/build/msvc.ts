/**
 * The MSVC toolset and Windows SDK installed on a Windows host, and the
 * environment that points every tool at them.
 *
 * Building bun does not use them: it has a sysroot of its own (winsysroot.ts).
 * What does is what runs Visual Studio's own programs: a local WebKit build
 * (msbuild, WebKit's cmake), and with it the bun that links that WebKit; the
 * tests that compile native addons (node-gyp); the symbol-order tracer.
 *
 * clang-cl, lld-link, cl, link, llvm-rc, rustc, cmake, msbuild and node-gyp
 * all take the CRT/STL and SDK headers, libraries and tools from INCLUDE, LIB
 * and PATH. Visual Studio sets those with a developer shell (vcvarsall.bat,
 * Launch-VsDevShell.ps1), which costs seconds per process tree, also puts
 * Visual Studio's own LLVM, cmake and ninja ahead of ours on PATH, and follows
 * a default-toolset file the installer can leave naming a toolset it removed.
 * What it computes is a handful of paths, so this file computes them:
 *
 *   Visual Studio   %ProgramData%\Microsoft\VisualStudio\Packages\_Instances\<id>\state.json,
 *                   the installer's own record (what vswhere reads). Newest first.
 *   MSVC toolset    <vs>\VC\Tools\MSVC\<version>. The newest that is complete for
 *                   this machine's architecture: side-by-side toolsets are often partial.
 *   Windows SDK     <root>\{Include,Lib,bin}\<version>. The newest that is complete.
 *
 * A developer shell the caller happens to be in is not consulted: what is
 * installed decides, so every terminal builds with the same toolchain.
 *
 * Imported by scripts that node runs (runner.node.ts): node builtins and
 * erasable syntax only.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { BuildError } from "./error.ts";

type MsvcArch = "x64" | "arm64";

export interface Msvc {
  /** This machine's architecture, which is what the libraries are for. */
  arch: MsvcArch;
  /** What the toolset's executables run as: x64, emulated, where an arm64 machine has no native ones. */
  toolsHostArch: MsvcArch;
  /** `C:\Program Files\Microsoft Visual Studio\2022\Community` */
  vsDir: string;
  /** `17.14.37012.4` */
  vsVersion: string;
  /** `<vsDir>\VC\Tools\MSVC\14.44.35207` */
  toolsDir: string;
  /** `14.44.35207` */
  toolsVersion: string;
  /** `C:\Program Files (x86)\Windows Kits\10` */
  sdkDir: string;
  /** `10.0.26100.0` */
  sdkVersion: string;
}

/** Windows hosts only. Throws a BuildError naming what is missing. */
export function findMsvc(): Msvc {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return { ...findToolset(arch), ...findSdk(arch) };
}

function findToolset(arch: MsvcArch): Omit<Msvc, "sdkDir" | "sdkVersion"> {
  const workload = 'Install Visual Studio 2022 or newer with the "Desktop development with C++" workload.';
  const instances = visualStudioInstances();
  if (instances.length === 0) throw new BuildError("Visual Studio is not installed", { hint: workload });

  const incomplete: string[] = [];
  for (const { vsDir, vsVersion } of instances) {
    const toolsets = join(vsDir, "VC", "Tools", "MSVC");
    for (const toolsVersion of versionsIn(toolsets)) {
      const toolsDir = join(toolsets, toolsVersion);
      const complete = ["include/vcruntime.h", `lib/${arch}/msvcrt.lib`].every(f => existsSync(join(toolsDir, f)));
      for (const toolsHostArch of complete ? ([arch, "x64"] as const) : []) {
        if (existsSync(join(toolsDir, "bin", `Host${toolsHostArch}`, arch, "link.exe"))) {
          return { arch, toolsHostArch, vsDir, vsVersion, toolsDir, toolsVersion };
        }
      }
      incomplete.push(toolsDir);
    }
  }
  throw new BuildError(`No installed MSVC toolset has the ${arch} compiler and libraries`, {
    hint: [workload, ...incomplete.map(dir => `incomplete: ${dir}`)].join("\n        "),
  });
}

function visualStudioInstances(): { vsDir: string; vsVersion: string }[] {
  const root = join(
    process.env.ProgramData ?? "C:\\ProgramData",
    "Microsoft",
    "VisualStudio",
    "Packages",
    "_Instances",
  );
  const instances: { vsDir: string; vsVersion: string }[] = [];
  for (const id of namesIn(root)) {
    let state: { installationPath?: unknown; installationVersion?: unknown };
    try {
      state = JSON.parse(readFileSync(join(root, id, "state.json"), "utf8"));
    } catch {
      continue; // what an interrupted install or uninstall leaves
    }
    if (typeof state.installationPath === "string" && typeof state.installationVersion === "string") {
      instances.push({ vsDir: state.installationPath, vsVersion: state.installationVersion });
    }
  }
  return instances.sort((a, b) => compareVersions(b.vsVersion, a.vsVersion));
}

function findSdk(arch: MsvcArch): Pick<Msvc, "sdkDir" | "sdkVersion"> {
  // The registry is what says where the SDK is, and reading it takes a process. It is nearly always here.
  const usual = join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Windows Kits", "10");
  for (const root of [() => usual, sdkDirFromRegistry]) {
    const sdkDir = root();
    if (sdkDir === undefined) continue;
    for (const sdkVersion of versionsIn(join(sdkDir, "Include"))) {
      const complete = [
        `Include/${sdkVersion}/um/windows.h`,
        `Include/${sdkVersion}/ucrt/stdio.h`,
        `Lib/${sdkVersion}/um/${arch}/kernel32.lib`,
        `Lib/${sdkVersion}/ucrt/${arch}/ucrt.lib`,
      ].every(f => existsSync(join(sdkDir, f)));
      if (complete) return { sdkDir, sdkVersion };
    }
  }
  throw new BuildError(`No installed Windows SDK has the ${arch} headers and libraries`, {
    hint: 'Add a "Windows 11 SDK" to Visual Studio with the Visual Studio Installer.',
  });
}

function sdkDirFromRegistry(): string | undefined {
  const key = "HKLM\\SOFTWARE\\Microsoft\\Windows Kits\\Installed Roots";
  const { stdout } = spawnSync("reg", ["query", key, "/v", "KitsRoot10", "/reg:32"], { encoding: "utf8" });
  return /KitsRoot10\s+REG_SZ\s+(.+?)\\?\s*$/m.exec(stdout ?? "")?.[1];
}

function namesIn(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** The subdirectories of `dir` named for a version, newest first. */
function versionsIn(dir: string): string[] {
  return namesIn(dir)
    .filter(name => /^\d+(\.\d+)+$/.test(name))
    .sort((a, b) => compareVersions(b, a));
}

function compareVersions(a: string, b: string): number {
  const [x, y] = [a, b].map(v => v.split(".").map(Number)) as [number[], number[]];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * What a developer shell for `msvc` would set, less what only the IDE reads.
 * `path` goes ahead of PATH. Directory variables end in a backslash because
 * vcvarsall's do, and their readers (msbuild property files) append to them.
 */
export function msvcEnv(msvc: Msvc): { vars: Record<string, string>; path: string[] } {
  const { arch, toolsHostArch, vsDir, vsVersion, toolsDir, toolsVersion, sdkDir, sdkVersion } = msvc;
  const list = (dirs: string[]) => dirs.filter(existsSync).join(delimiter);
  const sdk = (kind: string, ...rest: string[]) => join(sdkDir, kind, sdkVersion, ...rest);

  const include = list([
    join(toolsDir, "include"),
    join(toolsDir, "ATLMFC", "include"),
    join(vsDir, "VC", "Auxiliary", "VS", "include"),
    ...["ucrt", "um", "shared", "winrt", "cppwinrt"].map(dir => sdk("Include", dir)),
  ]);
  return {
    vars: {
      INCLUDE: include,
      EXTERNAL_INCLUDE: include,
      LIB: list([
        join(toolsDir, "ATLMFC", "lib", arch),
        join(toolsDir, "lib", arch),
        sdk("Lib", "ucrt", arch),
        sdk("Lib", "um", arch),
      ]),
      VSINSTALLDIR: `${vsDir}\\`,
      VCINSTALLDIR: `${join(vsDir, "VC")}\\`,
      VCToolsInstallDir: `${toolsDir}\\`,
      VCToolsVersion: toolsVersion,
      VisualStudioVersion: `${vsVersion.split(".")[0]}.0`,
      // Where node-gyp reads the version of the Visual Studio that VCINSTALLDIR names.
      VSCMD_VER: vsVersion,
      // rustc and the `cc` crate use the environment as it is only when this names their target.
      VSCMD_ARG_HOST_ARCH: toolsHostArch,
      VSCMD_ARG_TGT_ARCH: arch,
      WindowsSdkDir: `${sdkDir}\\`,
      WindowsSDKVersion: `${sdkVersion}\\`,
      WindowsSDKLibVersion: `${sdkVersion}\\`,
      WindowsSdkBinPath: `${join(sdkDir, "bin")}\\`,
      WindowsSdkVerBinPath: `${sdk("bin")}\\`,
      UniversalCRTSdkDir: `${sdkDir}\\`,
      UCRTVersion: sdkVersion,
    },
    path: [
      join(toolsDir, "bin", `Host${toolsHostArch}`, arch),
      // A cross toolset's executables load DLLs (mspdbcore, …) that only the native one's directory has.
      join(toolsDir, "bin", `Host${toolsHostArch}`, toolsHostArch),
      sdk("bin", arch),
      join(vsDir, "MSBuild", "Current", "Bin", arch === "arm64" ? "arm64" : "amd64"),
    ].filter((dir, i, dirs) => dirs.indexOf(dir) === i && existsSync(dir)),
  };
}

/** Put `msvcEnv()` in this process's environment, for it and everything it spawns. */
export function loadMsvcEnv(): void {
  const { vars, path } = msvcEnv(findMsvc());
  Object.assign(process.env, vars);
  const rest = (process.env.PATH ?? "").split(delimiter).filter(dir => !path.includes(dir));
  process.env.PATH = [...path, ...rest].join(delimiter);
}
