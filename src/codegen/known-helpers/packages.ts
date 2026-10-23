export type VersionRule = "every" | "every-fifth-patch" | "last-of-each-minor" | "last-of-every-fifth-minor" | "latest";

export interface PackageRule {
  readonly name: string;
  readonly versions: VersionRule;
  readonly since?: string;
  readonly until?: string;
  readonly files?: readonly string[];
  readonly with?: readonly string[];
  readonly tool?: string;
  readonly prereleases?: boolean;
}

const babelCompanions = [
  "@babel/preset-env",
  "@babel/plugin-proposal-class-properties",
  "@babel/plugin-proposal-private-methods",
  "@babel/plugin-proposal-private-property-in-object",
  "@babel/plugin-proposal-class-static-block",
  "@babel/plugin-proposal-decorators",
  "@babel/plugin-proposal-export-namespace-from",
  "@babel/plugin-proposal-explicit-resource-management",
  "@babel/plugin-transform-react-jsx",
];

export const packageRules: readonly PackageRule[] = [
  { name: "@babel/parser", versions: "latest", files: ["lib/index.js"] },
  { name: "tslib", versions: "every", files: ["tslib.js", "tslib.es6.js", "tslib.es6.mjs"] },
  {
    name: "typescript",
    versions: "last-of-each-minor",
    since: "1.5.0",
    files: ["lib/typescript.js", "bin/typescript.js"],
  },
  {
    name: "esbuild-linux-64",
    versions: "last-of-each-minor",
    since: "0.8.0",
    until: "0.15.0",
    files: ["bin/esbuild"],
    tool: "esbuild",
  },
  {
    name: "@esbuild/linux-x64",
    versions: "last-of-each-minor",
    since: "0.15.0",
    files: ["bin/esbuild"],
    tool: "esbuild",
  },
  { name: "@oven/bun-linux-x64", versions: "every-fifth-patch", since: "1.0.0", files: ["bin/bun"], tool: "bun" },
  { name: "rolldown", versions: "last-of-each-minor", since: "1.0.0-beta.1", with: [], prereleases: true },
  { name: "rollup", versions: "last-of-every-fifth-minor", since: "1.0.0", with: [] },
  { name: "@babel/runtime", versions: "last-of-each-minor", since: "7.0.0", files: ["helpers"] },
  { name: "@babel/core", versions: "last-of-each-minor", since: "7.0.0", with: babelCompanions },
  { name: "@swc/helpers", versions: "every", since: "0.2.0" },
  { name: "@swc/core", versions: "last-of-each-minor", since: "1.2.0", with: [] },
];

export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly stage: number;
  readonly round: number;
}

const stages = ["alpha", "beta", "rc"];

export function parseVersion(text: string): Version | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/.exec(text);
  if (!match) return undefined;
  const stage = match[4] === undefined ? stages.length : stages.indexOf(match[4]);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    stage,
    round: Number(match[5] ?? 0),
  };
}

export function isRelease(version: Version): boolean {
  return version.stage === stages.length;
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return left < right ? -1 : left > right ? 1 : 0;
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch || a.stage - b.stage || a.round - b.round;
}

export function minorOf(version: string): string | undefined {
  const parsed = parseVersion(version);
  return parsed && `${parsed.major}.${parsed.minor}`;
}

export function chooseVersions(published: readonly string[], rule: PackageRule): string[] {
  const isWanted = (version: Version | undefined) =>
    version !== undefined && (isRelease(version) || rule.prereleases === true);
  let wanted = published.filter(version => isWanted(parseVersion(version))).sort(compareVersions);
  if (rule.since !== undefined) wanted = wanted.filter(version => compareVersions(version, rule.since!) >= 0);
  if (rule.until !== undefined) wanted = wanted.filter(version => compareVersions(version, rule.until!) < 0);
  if (rule.versions === "every") return wanted;
  if (rule.versions === "latest") return wanted.slice(-1);
  const lastOfMinor = new Map<string, string>();
  for (const version of wanted) {
    const parsed = parseVersion(version)!;
    const group = isRelease(parsed) ? "" : `-${parsed.stage}.${Math.floor(parsed.round / 4)}`;
    lastOfMinor.set(`${parsed.major}.${parsed.minor}${group}`, version);
  }
  const minors = [...lastOfMinor.values()];
  if (rule.versions === "last-of-each-minor") return minors;
  if (rule.versions === "every-fifth-patch")
    return wanted.filter(version => parseVersion(version)!.patch % 5 === 0 || minors.includes(version));
  const newest = minors.at(-1);
  return minors.filter(version => parseVersion(version)!.minor % 5 === 0 || version === newest);
}

export function folderNameOf(name: string, version: string): string {
  return `${name.replace("/", "+")}@${version}`;
}

export function toolOf(name: string): string {
  return packageRules.find(rule => rule.name === name)?.tool ?? name;
}

export function isChosen(name: string, only: readonly string[]): boolean {
  return only.length === 0 || only.includes(name) || only.includes(toolOf(name));
}
