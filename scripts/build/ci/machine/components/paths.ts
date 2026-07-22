// Derived locations, composed from an image's root paths.
//
// spec.ts writes each ROOT once per image (bin, opt, home, system32,
// programFiles, ...). Everything under a root is DERIVED here, so a
// location string is never restated across components: change
// image.paths.bin and node, bun, curl-h3, age and the agent all move.
// These are pure functions of the spec entry — no host state, no defaults.

import type { LinuxImage, WindowsImage } from "../../types.ts";

// ---------------------------------------------------------------------------
// Linux
// ---------------------------------------------------------------------------

/** A binary in the image's bin dir (`/usr/local/bin/<name>`). */
export function linuxBin(image: LinuxImage, name: string): string {
  return `${image.paths.bin}/${name}`;
}

/** A tree under the opt root (`/opt/<name>`). */
export function linuxOpt(image: LinuxImage, name: string): string {
  return `${image.paths.opt}/${name}`;
}

/** buildkite-agent's home; also where its hooks/build dirs live. */
export function agentHome(image: LinuxImage): string {
  return image.paths.buildkiteHome;
}

/** The bundled agent the systemd/openrc unit runs. The filename is a
 * spec fact (machine.mjs names its bundle output the same), so a rename
 * of the agent source propagates everywhere from one field. */
export function agentEntry(image: LinuxImage): string {
  return `${agentHome(image)}/${image.paths.buildkiteAgentEntry}`;
}

/**
 * node-gyp's header cache under a home directory. node-gyp looks in a
 * platform-specific relative location; the difference is exactly one path
 * segment, so it is one function with that segment isolated.
 *   linux:   <home>/.cache/node-gyp/<version>
 *   windows: <home>\\node-gyp\\Cache\\<version>
 */
export function nodeGypCache(os: "linux" | "windows", home: string, nodeVersion: string): string {
  return os === "windows" ? `${home}\\node-gyp\\Cache\\${nodeVersion}` : `${home}/.cache/node-gyp/${nodeVersion}`;
}

/** The core-dump directory the test runner reads (from the pattern). */
export function coresDir(image: LinuxImage): string {
  return image.paths.coresDirPattern
    .replace("{distro}", image.distro)
    .replace("{release}", image.release)
    .replace("{arch}", image.arch);
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

/** A tool that must survive Sysprep (`C:\Windows\System32\<name>.exe`). */
export function windowsSystem32(image: WindowsImage, fileName: string): string {
  return `${image.paths.system32}\\${fileName}`;
}

/** A multi-file install under Program Files. */
export function windowsProgramFiles(image: WindowsImage, dirName: string): string {
  return `${image.paths.programFiles}\\${dirName}`;
}

/** The bundled agent the nssm service runs (filename from the spec). */
export function windowsAgentEntry(image: WindowsImage): string {
  return `${image.paths.buildkiteHome}\\${image.paths.buildkiteAgentEntry}`;
}
