import { Glob } from "bun";
const root = "/workspace/wt/cli";
const t = new Bun.Transpiler({ loader: "ts" });
let total = 0, bad = 0; const msgs = new Map(); const examples = []; const byPkg = new Map();
const LIMIT = 4000;
outer: for (const base of ["node_modules", "test/node_modules"]) {
  for (const f of new Glob("**/*.d.{ts,mts,cts}").scanSync({ cwd: root + "/" + base, absolute: true, followSymlinks: true })) {
    if (f.includes("/typescript/lib/")) continue;
    let code; try { code = await Bun.file(f).text(); } catch { continue; }
    total++;
    try { t.transformSync(code); } catch (e) {
      bad++;
      const m = String(e.errors?.[0]?.message ?? e.message).replace(/"[^"]*"/g, '"…"').slice(0, 70);
      msgs.set(m, (msgs.get(m) ?? 0) + 1);
      const pkg = f.split("node_modules/").pop().split("/").slice(0, 2).join("/");
      byPkg.set(pkg, (byPkg.get(pkg) ?? 0) + 1);
      if (examples.length < 8) examples.push(f.replace(root + "/", "") + ": " + String(e.errors?.[0]?.message ?? e.message).slice(0, 80));
    }
    if (total >= LIMIT) break outer;
  }
}
console.log("TOTAL", total, "with errors", bad);
console.log([...msgs].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([m, c]) => c + "  " + m).join("\n"));
console.log([...byPkg].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([m, c]) => c + "  " + m).join("\n"));
console.log(examples.join("\n"));
