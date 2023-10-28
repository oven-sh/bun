import fs from "fs";
import path from "path";

let OUTDIR: string | null = null;
let TAG: string | null = null;
let PKG: string | null = null;

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--outdir=")) OUTDIR = arg.slice("--outdir=".length);
  if (arg.startsWith("--tag=")) TAG = arg.slice("--tag=".length);
  if (arg.startsWith("--package=")) PKG = arg.slice("--package=".length);
}

if (!OUTDIR) {
  console.error(`Missing --outdir`);
  process.exit();
}
if (!TAG) {
  console.error(`Missing --tag`);
  process.exit();
}
if (!PKG) {
  console.error(`Missing --package`);
  process.exit();
}

fs.mkdirSync(OUTDIR, { recursive: true });

const url = `https://github.com/oven-sh/WebKit/releases/download/autobuild-${TAG}/${PKG}.tar.gz`;
const tar_dir = path.join(import.meta.dir, "../../.webkit-cache");
const tar = path.join(tar_dir, `./${PKG}-${TAG}.tar.gz`);

fs.mkdirSync(tar_dir, { recursive: true });

try {
  if (fs.existsSync(OUTDIR + "/package.json")) {
    const read = JSON.parse(fs.readFileSync(OUTDIR + "/package.json", "utf-8"));
    if (read.version === "0.0.1-" + TAG && read.name === PKG) {
      process.exit();
    }
  }
} catch {}

fs.rmSync(OUTDIR, { force: true, recursive: true });

if (!fs.existsSync(tar)) {
  console.log(`-- Downloading WebKit`);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
    process.exit();
  }
  await Bun.write(tar, res);
}

Bun.spawnSync(["tar", "-xzf", tar], { cwd: path.dirname(OUTDIR) });
