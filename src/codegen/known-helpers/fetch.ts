import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { chooseVersions, compareVersions, folderNameOf, isChosen, packageRules, type PackageRule } from "./packages.ts";

export interface FetchedVersion {
  readonly name: string;
  readonly version: string;
  readonly publishedAt: string;
}

interface Distribution {
  readonly tarball: string;
  readonly integrity?: string;
  readonly shasum: string;
}

interface Packument {
  readonly versions: Record<string, { readonly dist: Distribution }>;
  readonly time: Record<string, string>;
}

const registry = "https://registry.npmjs.org";

export const versionsFileName = "versions.json";

export function comparePublications(left: FetchedVersion, right: FetchedVersion): number {
  if (left.publishedAt !== right.publishedAt) return left.publishedAt < right.publishedAt ? -1 : 1;
  if (left.name !== right.name) return left.name < right.name ? -1 : 1;
  return compareVersions(left.version, right.version);
}

async function inBatches<T>(items: readonly T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  const waiting = [...items];
  const workers = Array.from({ length: Math.min(size, waiting.length) }, async () => {
    for (let item = waiting.shift(); item !== undefined; item = waiting.shift()) await run(item);
  });
  await Promise.all(workers);
}

function verify(bytes: Uint8Array, distribution: Distribution): void {
  if (distribution.integrity?.startsWith("sha512-")) {
    const found = new Bun.CryptoHasher("sha512").update(bytes).digest("base64");
    if (`sha512-${found}` !== distribution.integrity) throw new Error("the archive does not have the published sha512");
    return;
  }
  const found = new Bun.CryptoHasher("sha1").update(bytes).digest("hex");
  if (found !== distribution.shasum) throw new Error("the archive does not have the published sha1");
}

async function unpack(archive: string, into: string, files: readonly string[] | undefined): Promise<void> {
  const members = files?.flatMap(file => [`*/${file}`, `*/${file}/*`]) ?? [];
  const command = ["tar", "-xzf", archive, "-C", into, "--strip-components=1", "--no-same-owner"];
  if (members.length > 0) command.push("--wildcards", "*/package.json", ...members);
  const tar = Bun.spawn(command, { stdout: "ignore", stderr: "pipe" });
  const complaint = await new Response(tar.stderr).text();
  const missingOnly = complaint.split("\n").every(line => line === "" || /Not found in archive|previous errors/.test(line));
  if ((await tar.exited) !== 0 && !missingOnly) throw new Error(complaint.trim());
}

async function download(into: string, rule: PackageRule, distribution: Distribution): Promise<string | undefined> {
  const response = await fetch(distribution.tarball);
  if (!response.ok) return String(response.status);
  const bytes = new Uint8Array(await response.arrayBuffer());
  verify(bytes, distribution);
  const archive = `${into}.tgz`;
  await Bun.write(archive, bytes);
  await mkdir(into, { recursive: true });
  try {
    await unpack(archive, into, rule.files);
  } finally {
    await rm(archive);
  }
  return undefined;
}

const packuments = new Map<string, Promise<Packument | number>>();

function readPackument(name: string): Promise<Packument | number> {
  let reading = packuments.get(name);
  if (reading === undefined) {
    reading = fetch(`${registry}/${name.replace("/", "%2f")}`).then(response => (response.ok ? response.json() : response.status));
    packuments.set(name, reading);
  }
  return reading;
}

async function wasPublishedBy(name: string, time: number): Promise<boolean> {
  const packument = await readPackument(name);
  if (typeof packument === "number") return false;
  return Object.keys(packument.versions).some(version => /^\d+\.\d+\.\d+$/.test(version) && Date.parse(packument.time[version]) <= time);
}

const oneDay = 24 * 60 * 60 * 1000;

async function install(into: string, rule: PackageRule, version: string, publishedAt: string): Promise<string | undefined> {
  const cutoff = Date.parse(publishedAt) + oneDay;
  const companions: string[] = [];
  for (const companion of rule.with!) if (await wasPublishedBy(companion, cutoff)) companions.push(companion);
  await mkdir(into, { recursive: true });
  await Bun.write(path.join(into, "package.json"), JSON.stringify({ private: true }) + "\n");
  const age = Math.max(0, Math.floor((Date.now() - cutoff) / 1000));
  const command = [process.execPath, "add", "--ignore-scripts", "--minimum-release-age", String(age), `${rule.name}@${version}`, ...companions];
  const adding = Bun.spawn(command, { cwd: into, stdout: "ignore", stderr: "pipe" });
  const complaint = await new Response(adding.stderr).text();
  return (await adding.exited) === 0 ? undefined : complaint.trim().split("\n").slice(-3).join(" ");
}

async function fetchRule(folder: string, rule: PackageRule, fetched: FetchedVersion[], failed: string[]): Promise<void> {
  const packument = await readPackument(rule.name);
  if (typeof packument === "number") {
    failed.push(`${rule.name}: ${packument}`);
    return;
  }
  const versions = chooseVersions(Object.keys(packument.versions), rule);
  await inBatches(versions, 8, async version => {
    const into = path.join(folder, folderNameOf(rule.name, version));
    const entry = { name: rule.name, version, publishedAt: packument.time[version] };
    if (existsSync(path.join(into, rule.with ? `node_modules/${rule.name}/package.json` : "package.json"))) {
      fetched.push(entry);
      return;
    }
    let complaint: string | undefined;
    try {
      complaint = rule.with ? await install(into, rule, version, entry.publishedAt) : await download(into, rule, packument.versions[version].dist);
    } catch (error) {
      complaint = error instanceof Error ? error.message : String(error);
    }
    if (complaint === undefined) {
      fetched.push(entry);
      return;
    }
    failed.push(`${rule.name}@${version}: ${complaint}`);
    await rm(into, { recursive: true, force: true });
  });
}

export async function fetchPackages(folder: string, only: readonly string[]): Promise<void> {
  await mkdir(folder, { recursive: true });
  const versionsFile = path.join(folder, versionsFileName);
  const known: FetchedVersion[] = existsSync(versionsFile) ? await Bun.file(versionsFile).json() : [];
  const fetched = known.filter(entry => packageRules.some(rule => rule.name === entry.name) && !isChosen(entry.name, only));
  const failed: string[] = [];
  for (const rule of packageRules.filter(rule => isChosen(rule.name, only))) {
    const before = fetched.length;
    await fetchRule(folder, rule, fetched, failed);
    console.log(`${rule.name}: ${fetched.length - before} versions`);
  }
  await Bun.write(versionsFile, JSON.stringify(fetched.sort(comparePublications), null, 2) + "\n");
  for (const line of failed.sort()) console.error(`not fetched: ${line}`);
  if (failed.length > 0) process.exitCode = 1;
}
