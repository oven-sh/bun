// Vectors for the read side of the in-memory file system: files, links, probes. Deterministic.
// usage: bun gen.ts <count> <out.json>
import { writeFileSync } from "node:fs";

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const count = Number(process.argv[2] ?? 2000);
const rng = mulberry32(20260930);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
const chance = (p: number) => rng() < p;

// The first element of a path gives its level: a link of level 0 points to levels 1 and 2, a link of level 1 to level 2.
let tops = [
  ["x", "y", "X", "x-y", "x.y", "x y"],
  ["m", "n", "M"],
  ["a", "b", "A", "a.d"],
];
const topsLinksFirst = [
  ["a", "b", "A", "a-b", "a.b", "a b"],
  ["m", "n", "M"],
  ["x", "y", "X", "x.d"],
];
const topsTargetsFirst = tops;
const parts = ["d", "e", "D", "sub", "Sub", "x", "y", "a", "m", "k", "\u00e9", "\u00c9", "d-e", "d.e", "node_modules", "\u0130", "i"];
const fileNames = ["f.ts", "g.ts", "F.ts", "index.d.ts", "x", "d", "package.json", "h.TS", "\u00e9.ts", "f.ts.map"];
const linkNames = ["l", "L", "ln", "x", "y", "d", "sub", "m", "link.ts"];

interface Vector {
  name: string;
  files: string[];
  symlinks: Record<string, string>;
  ucsfn: boolean;
  probes: string[];
}

function dirOf(level: number, depthMax: number): string {
  let p = pick(tops[level]);
  const depth = Math.floor(rng() * (depthMax + 1));
  for (let i = 0; i < depth; i++) p += "/" + pick(parts);
  return p;
}

function gen(i: number): Vector {
  const ucsfn = chance(0.5);
  // Where the links sort before their targets, an entry below a link finds no directory yet and the reference panics.
  tops = chance(0.15) ? topsLinksFirst : topsTargetsFirst;
  const root = chance(0.12) ? pick(["c:/", "C:/", "d:/"]) : "/";
  const abs = (p: string) => root + p;
  const files = new Set<string>();
  const symlinks: Record<string, string> = {};
  const dirs: string[][] = [[], [], []];
  const nFiles = 1 + Math.floor(rng() * 7);
  for (let k = 0; k < nFiles; k++) {
    const level = pick([0, 0, 1, 2, 2]);
    const d = chance(0.5) && dirs[level].length > 0 ? pick(dirs[level]) : dirOf(level, 3);
    dirs[level].push(d);
    files.add(abs(d + "/" + pick(fileNames)));
  }
  const allFiles = () => [...files];
  const nLinks = chance(0.25) ? 0 : 1 + Math.floor(rng() * 4);
  const linkPaths: string[] = [];
  for (let k = 0; k < nLinks; k++) {
    const level = pick([0, 0, 0, 1]);
    const where = chance(0.6) && dirs[level].length > 0 ? pick(dirs[level]) : dirOf(level, 2);
    const link = abs(where + "/" + pick(linkNames));
    const targetLevel = level === 0 ? pick([1, 2, 2]) : 2;
    let target: string;
    const r = rng();
    if (r < 0.45 && dirs[targetLevel].length > 0) target = abs(pick(dirs[targetLevel]));
    else if (r < 0.6) {
      const candidates = allFiles().filter(f => tops[targetLevel].includes(f.slice(root.length).split("/")[0]));
      target = candidates.length > 0 ? pick(candidates) : abs(dirOf(targetLevel, 2));
    } else if (r < 0.75 && dirs[targetLevel].length > 0) {
      // a directory on the way to a directory of files
      const d = pick(dirs[targetLevel]).split("/");
      target = abs(d.slice(0, 1 + Math.floor(rng() * d.length)).join("/"));
    } else if (r < 0.8 && linkPaths.length > 0 && targetLevel > 0) {
      target = abs(dirOf(targetLevel, 1));
    } else target = abs(dirOf(targetLevel, 2));
    if (chance(0.008)) target = target + "/";
    if (chance(0.008)) target = target.slice(root.length);
    if (chance(0.008)) target = "//server/share";
    symlinks[link] = target;
    linkPaths.push(link);
    dirs[level].push(where);
  }
  // Entries below a link, and entries where the link would lead if its target were read from the directory of the link.
  for (const link of linkPaths) {
    if (chance(0.3)) files.add(link + "/" + (chance(0.5) ? pick(parts) + "/" : "") + pick(fileNames));
    if (chance(0.3)) {
      const rel = symlinks[link].startsWith(root) ? symlinks[link].slice(root.length) : symlinks[link];
      const dir = link.slice(0, link.lastIndexOf("/"));
      files.add(dir + "/" + rel + "/" + (chance(0.5) ? pick(parts) + "/" : "") + pick(fileNames));
    }
    if (chance(0.15) && linkPaths.length > 1) {
      const other = pick(linkPaths);
      if (other !== link && !(link + "/inner" in symlinks)) symlinks[link + "/inner"] = symlinks[other];
    }
  }
  if (chance(0.01)) files.add(chance(0.5) ? "rel/f.ts" : abs("a/./f.ts"));
  if (chance(0.008)) files.add(root === "/" ? "c:/a/f.ts" : "/a/f.ts");
  if (chance(0.004)) files.add("//server/share/f.ts");
  if (chance(0.01)) files.add("//server");
  // A file and a directory of one name, and a directory spelled in two cases.
  if (chance(0.02) && files.size > 0) files.add(pick(allFiles()) + "/below.ts");
  if (chance(0.15) && files.size > 0) {
    const f = pick(allFiles());
    const flipped = f.replace(/[a-zA-Z]/, c => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    files.add(flipped.slice(0, flipped.lastIndexOf("/")) + "/" + pick(fileNames));
  }
  for (const link of Object.keys(symlinks)) files.delete(link);

  const probes = new Set<string>([root]);
  const addWithPrefixes = (p: string) => {
    probes.add(p);
    let rest = p;
    while (rest.length > root.length) {
      const cut = rest.lastIndexOf("/");
      if (cut < root.length) break;
      rest = rest.slice(0, cut);
      if (rest.length > 0) probes.add(rest);
    }
  };
  for (const f of files) addWithPrefixes(f);
  for (const [link, target] of Object.entries(symlinks)) {
    addWithPrefixes(link);
    addWithPrefixes(target);
    for (const f of files) {
      // the tail of a file below the target, read through the link
      if (f.startsWith(target + "/")) addWithPrefixes(link + f.slice(target.length));
      if (chance(0.1)) probes.add(link + "/" + f.slice(f.lastIndexOf("/") + 1));
    }
    probes.add(link + "/" + pick(parts));
    probes.add(link + "/inner/" + pick(fileNames));
  }
  const base = [...probes];
  for (const p of base) {
    if (chance(0.08)) probes.add(p.toUpperCase());
    if (chance(0.08)) probes.add(p.toLowerCase());
    if (chance(0.04) && p !== root) probes.add(p + "/");
    if (chance(0.04) && p !== root) probes.add(p + "/../" + p.slice(p.lastIndexOf("/") + 1));
    if (chance(0.03)) probes.add(p.replaceAll("/", "\\"));
    if (chance(0.03) && p !== root) probes.add(p + "/nope");
  }
  if (chance(0.05)) probes.add("relative/path");
  if (chance(0.05)) probes.add("//server/share/f.ts");
  if (chance(0.05)) probes.add("http://server/a/f.ts");
  if (chance(0.05)) probes.add(root === "/" ? "c:/" : "/");
  if (chance(0.03)) probes.add("^/untitled/x");
  if (chance(0.03)) probes.add("file:///c:/a");
  return { name: "v" + i, files: [...files], symlinks, ucsfn, probes: [...probes] };
}

const hand: Vector[] = [
  {
    name: "beneath-link",
    files: ["/b/x.ts", "/z/link/file.ts", "/z/b/file.ts"],
    symlinks: { "/z/link": "/b" },
    ucsfn: true,
    probes: ["/", "/z", "/z/link", "/z/link/file.ts", "/z/link/x.ts", "/b", "/b/file.ts", "/z/b/file.ts", "/z/b"],
  },
  {
    name: "beneath-link-to-a-directory-below",
    files: ["/b/x.ts", "/z/link/d/file.ts", "/z/b/d/other.ts", "/z/b/e.ts"],
    symlinks: { "/z/link": "/b" },
    ucsfn: true,
    probes: ["/z/link/d", "/z/link/d/file.ts", "/z/link/d/other.ts", "/z/link", "/z/b/d", "/z", "/b", "/b/d"],
  },
  {
    name: "beneath-link-case",
    files: ["/B/x.ts", "/z/Link/file.ts", "/z/B/file.ts", "/z/b/g.ts"],
    symlinks: { "/z/link": "/B" },
    ucsfn: false,
    probes: ["/z/link/file.ts", "/z/LINK/FILE.ts", "/z/link", "/z/B", "/z/b/file.ts", "/z", "/"],
  },
  {
    name: "link-at-top",
    files: ["/real/pkg/index.ts", "/real/pkg/sub/x.ts", "/zz/sub/file.ts"],
    symlinks: { "/zz": "/real/pkg" },
    ucsfn: true,
    probes: ["/", "/zz", "/zz/sub", "/zz/sub/file.ts", "/zz/sub/x.ts", "/real/pkg/sub", "/real/pkg/sub/file.ts", "/zz/index.ts"],
  },
  {
    name: "dos",
    files: ["c:/b/x.ts", "c:/z/link/file.ts", "c:/z/b/file.ts"],
    symlinks: { "c:/z/link": "c:/b" },
    ucsfn: false,
    probes: ["c:/", "c:", "C:/", "c:/z", "c:/z/link", "c:/z/link/file.ts", "c:/z/link/x.ts", "C:/B/X.TS", "d:/", "/", "c:/z/c:/b"],
  },
  {
    name: "unc-root-file",
    files: ["//server", "/a/f.ts"],
    symlinks: { "/a/l": "//server" },
    ucsfn: true,
    probes: ["/", "/a", "/a/l", "//server", "/server", "/a/l/x"],
  },
  {
    name: "chain",
    files: ["/x/d/f.ts", "/m/e/g.ts"],
    symlinks: { "/a/l": "/m/e", "/m/e/l2": "/x/d", "/a/l3": "/a-b/nowhere" },
    ucsfn: true,
    probes: ["/a/l", "/a/l/g.ts", "/a/l/l2", "/a/l/l2/f.ts", "/m/e/l2/f.ts", "/a/l3", "/a/l3/x", "/a", "/m/e", "/"],
  },
  {"name": "file-over-dir", "files": ["/A/below.ts", "/a"], "symlinks": {}, "ucsfn": false, "probes": ["/", "/a", "/A", "/a/below.ts", "/A/below.ts", "/a/", "/A/BELOW.TS"]},
  {"name": "link-over-dir", "files": ["/A/b/f.ts", "/x/g.ts", "/x/b/h.ts"], "symlinks": {"/a": "/x"}, "ucsfn": false, "probes": ["/", "/a", "/A", "/A/b", "/a/b", "/a/b/f.ts", "/x/b/f.ts", "/a/g.ts", "/a/b/h.ts", "/x", "/x/b"]},
  {"name": "link-over-dir-then-below", "files": ["/A/b/f.ts", "/X/g.ts", "/a/c/new.ts"], "symlinks": {"/a": "/X"}, "ucsfn": false, "probes": ["/", "/a", "/a/c", "/a/c/new.ts", "/X/c/new.ts", "/x/c", "/A/b/f.ts", "/a/b"]},
  {"name": "link-to-file", "files": ["/x/f.ts"], "symlinks": {"/y/l.ts": "/x/f.ts", "/y/d": "/x"}, "ucsfn": true, "probes": ["/y", "/y/l.ts", "/y/l.ts/below", "/y/d", "/y/d/f.ts", "/x", "/"]},
  {"name": "link-to-nothing", "files": ["/x/f.ts"], "symlinks": {"/y/l": "/nowhere", "/y/l2": "/x/none/deeper"}, "ucsfn": true, "probes": ["/y", "/y/l", "/y/l/a", "/y/l2", "/", "/nowhere"]},
  {"name": "two-links-one-prefix", "files": ["/x/f.ts", "/x/in/g.ts", "/m/h.ts"], "symlinks": {"/y/l": "/x", "/x/in/up": "/m"}, "ucsfn": true, "probes": ["/y/l/in/up", "/y/l/in/up/h.ts", "/y/l/in", "/x/in/up/h.ts", "/y/l/in/g.ts", "/y"]},
  {"name": "untitled-root", "files": ["/x/f.ts"], "symlinks": {}, "ucsfn": true, "probes": ["^/untitled/a", "^/", "/^/x", "/x/f.ts"]},
  {"name": "dos-only", "files": ["c:/x/f.ts", "c:/x/D/g.ts", "d:/y.ts"], "symlinks": {"c:/l": "c:/x"}, "ucsfn": false, "probes": ["c:/", "c:", "C:/X", "c:/l", "c:/l/f.ts", "c:/L/d/G.TS", "d:/", "d:/y.ts", "e:/", "c:/l/D", "c:\\x\\f.ts"]},
  {"name": "dos-drive-case", "files": ["c:/x/f.ts", "C:/y/g.ts"], "symlinks": {}, "ucsfn": true, "probes": ["c:/", "C:/", "c:/x/f.ts", "C:/x/f.ts", "c:/y/g.ts", "C:/y/g.ts"]},
  {"name": "empty", "files": [], "symlinks": {}, "ucsfn": true, "probes": ["/", "/a", "c:/"]},
  {"name": "only-link", "files": [], "symlinks": {"/l": "/t"}, "ucsfn": true, "probes": ["/", "/l", "/t", "/l/x"]},
  {"name": "deep", "files": ["/a/b/c/d/e/f/g/h/i/j/k.ts"], "symlinks": {"/z": "/a/b/c/d/e"}, "ucsfn": true, "probes": ["/z/f/g/h/i/j/k.ts", "/z/f/g/h/i/j", "/z", "/a/b/c/d/e/f", "/z/../z/f"]},
  {"name": "kelvin", "files": ["/\u212a/f.ts", "/k/g.ts"], "symlinks": {}, "ucsfn": false, "probes": ["/", "/k", "/K", "/\u212a", "/\u212a/f.ts", "/k/f.ts", "/K/G.TS"]},
  {"name": "dotted-i", "files": ["/\u0130/f.ts", "/i/g.ts", "/I/h.ts"], "symlinks": {}, "ucsfn": false, "probes": ["/", "/i", "/I", "/\u0130", "/\u0130/f.ts", "/i/h.ts", "/I/g.ts", "/i\u0307/f.ts"]},
  {"name": "sort-cycle", "files": ["/a.ts", "/a/x.ts", "/a-b/y.ts", "/a b/z.ts", "/A/w.ts"], "symlinks": {}, "ucsfn": true, "probes": ["/", "/a", "/a-b", "/a b", "/A"]},
  {"name": "sort-cycle-insensitive", "files": ["/d/a.ts", "/d/a/x.ts", "/d/a-b/y.ts", "/D/A/w.ts", "/d/A-B/v.ts"], "symlinks": {}, "ucsfn": false, "probes": ["/", "/d", "/D", "/d/a", "/d/A", "/d/a-b", "/D/A-B"]},
];

const vectors = [...hand];
for (let i = 0; i < count; i++) vectors.push(gen(i));
writeFileSync(process.argv[3] ?? "vectors.json", JSON.stringify(vectors));
console.log(`${vectors.length} vectors, ${vectors.reduce((n, v) => n + v.probes.length, 0)} probes, ${vectors.filter(v => Object.keys(v.symlinks).length > 0).length} with links`);
