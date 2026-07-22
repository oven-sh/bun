// The fleet-wide component catalog: (name, os) → component + the module and
// export that define it. Used on the HOST — by generate.ts to emit each
// image's static imports (only that image's components, only its OS), and
// by check.ts to validate every spec entry. Never imported into a generated
// bootstrap, so the whole catalog does not ride into any bundle.
//
// A thing that installs on both platforms (nodejs, rust, ...) is two entries
// sharing a name, each in its own <name>.<os>.ts module, so a linux bundle
// carries no windows code. A spec entry naming a component with no entry for
// its OS is a loud error, not a skip.

import { chrome, chromium } from "./browsers-linux.ts";
import { ciUser } from "./ci-user.ts";
import type { Component, LinuxComponent, WindowsComponent } from "./component.ts";
import {
  androidNdk,
  crossBinutils,
  freebsdSysroot,
  glibcSysroot,
  macosSdk,
  muslSysroot,
  windowsSysroot,
} from "./cross-linux.ts";
import { nodejs as nodejsLinux } from "./nodejs.linux.ts";
import { nodejs as nodejsWindows } from "./nodejs.windows.ts";
import { prefetch as prefetchLinux } from "./prefetch.linux.ts";
import { prefetch as prefetchWindows } from "./prefetch.windows.ts";
import {
  age,
  buildkiteAgent as buildkiteAgentLinux,
  bun as bunLinux,
  curlH3 as curlH3Linux,
} from "./runtimes.linux.ts";
import {
  buildkiteAgent as buildkiteAgentWindows,
  bun as bunWindows,
  curlH3 as curlH3Windows,
} from "./runtimes.windows.ts";
import { rust as rustWindows } from "./rust.windows.ts";
import { scoop } from "./scoop.ts";
import { baseSystem, cleanup, coreDumps } from "./system-linux.ts";
import { defenderRemoval, optimizeWindows } from "./system-windows.ts";
import { cmake, docker, llvm, pythonFuse, rust as rustLinux, tailscale } from "./toolchain-linux.ts";
import { ccache, intelSde, openssh, pdbAddr2line, powershell, visualStudio } from "./toolchain-windows.ts";

export type ComponentOs = "linux" | "windows";

/** Where a component is defined: the module (relative to components/) and
 * its export name, so the generator can write the import. */
export type CatalogEntry = {
  component: Component;
  module: string;
  export: string;
};

type Entry = { os: ComponentOs; component: Component; module: string; export: string };

function linux(component: LinuxComponent, module: string, exportName: string): Entry {
  return { os: "linux", component, module, export: exportName };
}
function windows(component: WindowsComponent, module: string, exportName: string): Entry {
  return { os: "windows", component, module, export: exportName };
}

const catalog: readonly Entry[] = [
  // linux
  linux(baseSystem, "./system-linux.ts", "baseSystem"),
  linux(ciUser, "./ci-user.ts", "ciUser"),
  linux(nodejsLinux, "./nodejs.linux.ts", "nodejs"),
  linux(bunLinux, "./runtimes.linux.ts", "bun"),
  linux(curlH3Linux, "./runtimes.linux.ts", "curlH3"),
  linux(age, "./runtimes.linux.ts", "age"),
  linux(buildkiteAgentLinux, "./runtimes.linux.ts", "buildkiteAgent"),
  linux(pythonFuse, "./toolchain-linux.ts", "pythonFuse"),
  linux(cmake, "./toolchain-linux.ts", "cmake"),
  linux(llvm, "./toolchain-linux.ts", "llvm"),
  linux(rustLinux, "./toolchain-linux.ts", "rust"),
  linux(docker, "./toolchain-linux.ts", "docker"),
  linux(tailscale, "./toolchain-linux.ts", "tailscale"),
  linux(chromium, "./browsers-linux.ts", "chromium"),
  linux(chrome, "./browsers-linux.ts", "chrome"),
  linux(prefetchLinux, "./prefetch.linux.ts", "prefetch"),
  linux(coreDumps, "./system-linux.ts", "coreDumps"),
  linux(cleanup, "./system-linux.ts", "cleanup"),
  linux(crossBinutils, "./cross-linux.ts", "crossBinutils"),
  linux(androidNdk, "./cross-linux.ts", "androidNdk"),
  linux(freebsdSysroot, "./cross-linux.ts", "freebsdSysroot"),
  linux(glibcSysroot, "./cross-linux.ts", "glibcSysroot"),
  linux(muslSysroot, "./cross-linux.ts", "muslSysroot"),
  linux(windowsSysroot, "./cross-linux.ts", "windowsSysroot"),
  linux(macosSdk, "./cross-linux.ts", "macosSdk"),
  // windows
  windows(optimizeWindows, "./system-windows.ts", "optimizeWindows"),
  windows(scoop, "./scoop.ts", "scoop"),
  windows(nodejsWindows, "./nodejs.windows.ts", "nodejs"),
  windows(powershell, "./toolchain-windows.ts", "powershell"),
  windows(openssh, "./toolchain-windows.ts", "openssh"),
  windows(bunWindows, "./runtimes.windows.ts", "bun"),
  windows(curlH3Windows, "./runtimes.windows.ts", "curlH3"),
  windows(ccache, "./toolchain-windows.ts", "ccache"),
  windows(visualStudio, "./toolchain-windows.ts", "visualStudio"),
  windows(rustWindows, "./rust.windows.ts", "rust"),
  windows(pdbAddr2line, "./toolchain-windows.ts", "pdbAddr2line"),
  windows(intelSde, "./toolchain-windows.ts", "intelSde"),
  windows(buildkiteAgentWindows, "./runtimes.windows.ts", "buildkiteAgent"),
  windows(prefetchWindows, "./prefetch.windows.ts", "prefetch"),
  windows(defenderRemoval, "./system-windows.ts", "defenderRemoval"),
];

const byKey = new Map<string, Entry>();
for (const entry of catalog) {
  const key = `${entry.os}:${entry.component.name}`;
  // Two entries for the same (name, os) would shadow each other; refuse.
  if (byKey.has(key)) {
    throw new Error(`two ${entry.os} components are named "${entry.component.name}"`);
  }
  byKey.set(key, entry);
}

/** Resolve a component's catalog entry for an OS, loudly. */
export function catalogEntry(name: string, os: ComponentOs): CatalogEntry {
  const found = byKey.get(`${os}:${name}`);
  if (!found) {
    const known = [...byKey.keys()].filter(key => key.startsWith(`${os}:`)).map(key => key.slice(os.length + 1));
    throw new Error(
      `spec lists component "${name}" but no ${os} component with that name is in the catalog.\n` +
        `Known ${os} components: ${known.join(", ")}\n` +
        `Add it to components/catalog.ts (or fix the spec entry).`,
    );
  }
  return found;
}
