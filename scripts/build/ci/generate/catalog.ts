// The fleet-wide component catalog: (name, os) → component + the module and
// export that define it. Used on the HOST by generate.ts, both to emit each
// image's static imports (only that image's components, only its OS) and to
// validate every spec entry. Never imported into a generated bootstrap, so
// the whole catalog does not ride into any bundle.
//
// A thing that installs on both platforms (nodejs, rust, ...) is two entries
// sharing a name, each in its own <name>.<os>.ts module, so a linux bundle
// carries no windows code. A spec entry naming a component with no entry for
// its OS is a loud error, not a skip.

import type { Component, LinuxComponent, WindowsComponent } from "../machine/components/component.ts";
import { chrome, chromium } from "../machine/components/linux/browsers.ts";
import { ciUser } from "../machine/components/linux/ci-user.ts";
import {
  androidNdk,
  crossBinutils,
  freebsdSysroot,
  glibcSysroot,
  macosSdk,
  muslSysroot,
  windowsSysroot,
} from "../machine/components/linux/cross.ts";
import { nodejs as nodejsLinux } from "../machine/components/linux/nodejs.ts";
import { prefetch as prefetchLinux } from "../machine/components/linux/prefetch.ts";
import {
  age,
  buildkiteAgent as buildkiteAgentLinux,
  bun as bunLinux,
  curlH3 as curlH3Linux,
} from "../machine/components/linux/runtimes.ts";
import { baseSystem, cleanup, coreDumps } from "../machine/components/linux/system.ts";
import {
  cmake,
  docker,
  llvm,
  pythonFuse,
  rust as rustLinux,
  tailscale,
} from "../machine/components/linux/toolchain.ts";
import { nodejs as nodejsWindows } from "../machine/components/windows/nodejs.ts";
import { prefetch as prefetchWindows } from "../machine/components/windows/prefetch.ts";
import {
  buildkiteAgent as buildkiteAgentWindows,
  bun as bunWindows,
  curlH3 as curlH3Windows,
} from "../machine/components/windows/runtimes.ts";
import { rust as rustWindows } from "../machine/components/windows/rust.ts";
import { scoop } from "../machine/components/windows/scoop.ts";
import { defenderRemoval, optimizeWindows } from "../machine/components/windows/system.ts";
import {
  ccache,
  intelSde,
  openssh,
  pdbAddr2line,
  powershell,
  visualStudio,
} from "../machine/components/windows/toolchain.ts";

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
  linux(baseSystem, "./linux/system.ts", "baseSystem"),
  linux(ciUser, "./linux/ci-user.ts", "ciUser"),
  linux(nodejsLinux, "./linux/nodejs.ts", "nodejs"),
  linux(bunLinux, "./linux/runtimes.ts", "bun"),
  linux(curlH3Linux, "./linux/runtimes.ts", "curlH3"),
  linux(age, "./linux/runtimes.ts", "age"),
  linux(buildkiteAgentLinux, "./linux/runtimes.ts", "buildkiteAgent"),
  linux(pythonFuse, "./linux/toolchain.ts", "pythonFuse"),
  linux(cmake, "./linux/toolchain.ts", "cmake"),
  linux(llvm, "./linux/toolchain.ts", "llvm"),
  linux(rustLinux, "./linux/toolchain.ts", "rust"),
  linux(docker, "./linux/toolchain.ts", "docker"),
  linux(tailscale, "./linux/toolchain.ts", "tailscale"),
  linux(chromium, "./linux/browsers.ts", "chromium"),
  linux(chrome, "./linux/browsers.ts", "chrome"),
  linux(prefetchLinux, "./linux/prefetch.ts", "prefetch"),
  linux(coreDumps, "./linux/system.ts", "coreDumps"),
  linux(cleanup, "./linux/system.ts", "cleanup"),
  linux(crossBinutils, "./linux/cross.ts", "crossBinutils"),
  linux(androidNdk, "./linux/cross.ts", "androidNdk"),
  linux(freebsdSysroot, "./linux/cross.ts", "freebsdSysroot"),
  linux(glibcSysroot, "./linux/cross.ts", "glibcSysroot"),
  linux(muslSysroot, "./linux/cross.ts", "muslSysroot"),
  linux(windowsSysroot, "./linux/cross.ts", "windowsSysroot"),
  linux(macosSdk, "./linux/cross.ts", "macosSdk"),
  // windows
  windows(optimizeWindows, "./windows/system.ts", "optimizeWindows"),
  windows(scoop, "./windows/scoop.ts", "scoop"),
  windows(nodejsWindows, "./windows/nodejs.ts", "nodejs"),
  windows(powershell, "./windows/toolchain.ts", "powershell"),
  windows(openssh, "./windows/toolchain.ts", "openssh"),
  windows(bunWindows, "./windows/runtimes.ts", "bun"),
  windows(curlH3Windows, "./windows/runtimes.ts", "curlH3"),
  windows(ccache, "./windows/toolchain.ts", "ccache"),
  windows(visualStudio, "./windows/toolchain.ts", "visualStudio"),
  windows(rustWindows, "./windows/rust.ts", "rust"),
  windows(pdbAddr2line, "./windows/toolchain.ts", "pdbAddr2line"),
  windows(intelSde, "./windows/toolchain.ts", "intelSde"),
  windows(buildkiteAgentWindows, "./windows/runtimes.ts", "buildkiteAgent"),
  windows(prefetchWindows, "./windows/prefetch.ts", "prefetch"),
  windows(defenderRemoval, "./windows/system.ts", "defenderRemoval"),
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
