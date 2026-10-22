import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface Probe {
  readonly name: string;
  readonly text: string;
  readonly hasTypes: boolean;
  readonly hasJsx: boolean;
}

const folder = path.join(import.meta.dir, "probes");

export const probes: readonly Probe[] = readdirSync(folder)
  .filter(file => file.endsWith(".txt"))
  .sort()
  .map(file => {
    const name = file.slice(0, -".txt".length);
    return {
      name,
      text: readFileSync(path.join(folder, file), "utf8"),
      hasTypes: name.endsWith("-with-types"),
      hasJsx: name.startsWith("jsx-"),
    };
  });

export function isNameOfProbe(name: string): boolean {
  return /probe|^default_\d+$/i.test(name);
}

export interface BundleProbe {
  readonly name: string;
  readonly files: readonly (readonly [string, string])[];
}

const bundleFolder = path.join(import.meta.dir, "bundle-probes");

export const bundleProbes: readonly BundleProbe[] = readdirSync(bundleFolder)
  .filter(file => file.endsWith(".txt"))
  .sort()
  .map(file => {
    const parts = readFileSync(path.join(bundleFolder, file), "utf8").split(/^\/\/\/\/ (.+)\n/m);
    const files: [string, string][] = [];
    for (let index = 1; index < parts.length; index += 2) files.push([parts[index], parts[index + 1]]);
    return { name: file.slice(0, -".txt".length), files };
  });

export function writeBundleProbe(probe: BundleProbe, folder: string): string {
  mkdirSync(folder, { recursive: true });
  for (const [name, text] of probe.files) writeFileSync(path.join(folder, name), text);
  return path.join(folder, probe.files[0][0]);
}
