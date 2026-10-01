// Applies the two rules that take a file for a test to a list of paths, one per line on stdin, and prints the paths they take.
// ci:   scripts/runner.node.ts:2459-2498 (isJavaScript, isTestStrict, isHidden; getTests walks every directory below test/)
// bun:  src/runtime/cli/test/Scanner.rs:239-255, :331-341, :426 (the name is lowercased; directories that start with "." and node_modules are not entered)
// usage: git ls-files test/cli/lint | bun names_check.ts
const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const dirname = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".");

export function ciTakes(path: string): boolean {
  const base = basename(path);
  const hidden = /node_modules|node.js/.test(dirname(path)) || /^\./.test(base);
  return !hidden && /\.(c|m)?(j|t)sx?$/.test(base) && /\.test|spec\./.test(base);
}

// The loaders that are "JavaScript-like" for the default extensions.
const javascriptLike = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
export function bunTakes(path: string): boolean {
  if (path.split("/").slice(0, -1).some(d => d.startsWith(".") || d === "node_modules")) return false;
  const name = basename(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || !javascriptLike.has(name.slice(dot))) return false;
  const stem = name.slice(0, dot);
  return [".test", "_test", ".spec", "_spec"].some(s => stem.endsWith(s));
}

if (import.meta.main) {
  const paths = (await Bun.stdin.text()).split("\n").filter(p => p !== "");
  let ci = 0;
  let bun = 0;
  for (const p of paths) {
    const a = ciTakes(p);
    const b = bunTakes(p);
    if (a) ci++;
    if (b) bun++;
    if (a || b) console.log(`${a ? "ci " : "   "} ${b ? "bun" : "   "}  ${p}`);
  }
  console.log(`${paths.length} paths: the CI runner takes ${ci}, bun test takes ${bun}`);
}
