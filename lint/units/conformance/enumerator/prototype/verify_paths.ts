// Compares the path port with the Go ground truth, field by field (research probe).
import { readFileSync } from "node:fs";
import { combinePaths, getBaseFileName, getDirectoryPath, getNormalizedAbsolutePath, isRootedDiskPath, normalizePath, toPath } from "./tspath";
function unquote(q: string): string {
  // Go %q of a string
  let out = "";
  for (let i = 1; i < q.length - 1; i++) {
    const c = q[i];
    if (c !== "\\") { out += c; continue; }
    const n = q[++i];
    switch (n) {
      case "a": out += "\x07"; break;
      case "b": out += "\b"; break;
      case "f": out += "\f"; break;
      case "n": out += "\n"; break;
      case "r": out += "\r"; break;
      case "t": out += "\t"; break;
      case "v": out += "\v"; break;
      case "\\": out += "\\"; break;
      case '"': out += '"'; break;
      case "x": out += String.fromCharCode(parseInt(q.slice(i + 1, i + 3), 16)); i += 2; break;
      case "u": out += String.fromCodePoint(parseInt(q.slice(i + 1, i + 5), 16)); i += 4; break;
      case "U": out += String.fromCodePoint(parseInt(q.slice(i + 1, i + 9), 16)); i += 8; break;
      default: throw new Error("escape " + n);
    }
  }
  return out;
}
const lines = readFileSync(process.argv[2], "utf8").split("\n");
const fields = ["getNormalizedAbsolutePath", "normalizePath", "getDirectoryPath", "toPath", "isRootedDiskPath", "combinePaths", "getBaseFileName"];
const bad = new Map<string, number>();
let n = 0, shown = 0;
for (const line of lines) {
  if (line === "") continue;
  const f = line.split("\t");
  const [name, dir] = f;
  n++;
  const got = [getNormalizedAbsolutePath(name, dir), normalizePath(name), getDirectoryPath(name), toPath(name, dir), String(isRootedDiskPath(name)), combinePaths(dir, name), getBaseFileName(name)];
  for (let k = 0; k < fields.length; k++) {
    const want = k === 4 ? f[2 + k] : unquote(f[2 + k]);
    if (got[k] !== want) {
      bad.set(fields[k], (bad.get(fields[k]) ?? 0) + 1);
      if (shown++ < 15) console.log(fields[k], JSON.stringify({ name, dir, got: got[k], want }));
    }
  }
}
console.log("pairs", n, "mismatches", JSON.stringify([...bad]));
