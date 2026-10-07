// Runs the features named in ORDERFILE_FEATURES (comma-separated), then exits.
// "startup" names none, so only the app's own start is traced; "list" prints
// every feature.
//
// A feature is one small unit of what a large compiled TUI/CLI application
// does: one kind of request, one fs pattern, one shape of hot JavaScript. The
// generator traces each in a process of its own, in the order features.txt
// gives, so the order file can place what the features share before what only
// one of them reaches. A module is imported only when one of its features
// runs, so a trace holds the feature and not its neighbours.
import { cleanTmp, stopServers } from "./ctx.js";

const GROUPS = [
  { prefix: "tui_", strip: true, load: () => import("./tui.js") },
  { prefix: "mix_", strip: true, load: () => import("./jsmix.js") },
  { prefix: "net_", strip: true, load: () => import("./net.js") },
  { prefix: "idm_", strip: false, load: () => import("./idioms.js") },
  { prefix: "hot_", strip: false, load: () => import("./idioms.js") },
  { prefix: "gap_", strip: false, load: () => import("./gaps.js") },
  { prefix: "lib_", strip: false, load: () => import("./lib.js") },
];

async function listFeatures() {
  const names = new Set();
  for (const group of GROUPS) {
    const module = await group.load();
    for (const key of Object.keys(module.features)) {
      const name = group.strip ? group.prefix + key : key;
      if (name.startsWith(group.prefix)) names.add(name);
    }
  }
  return [...names];
}

export async function main() {
  const spec = process.env.ORDERFILE_FEATURES ?? "startup";
  if (spec === "list") {
    console.log((await listFeatures()).join("\n"));
    process.exit(0);
  }
  const byModule = new Map();
  for (const name of spec.split(",").filter(name => name && name !== "startup")) {
    const group = GROUPS.find(group => name.startsWith(group.prefix));
    if (!group) throw new Error(`unknown feature ${name}`);
    if (!byModule.has(group.load)) byModule.set(group.load, []);
    byModule.get(group.load).push(group.strip ? name.slice(group.prefix.length) : name);
  }
  // A feature that throws ends the process with its error, and the generator leaves the run's trace out.
  try {
    for (const [load, names] of byModule) {
      const module = await load();
      // tui.js and jsmix.js interleave their features; the rest run one after another.
      const unknown = names.find(name => !(name in module.features));
      if (unknown !== undefined) throw new Error(`unknown feature ${unknown}`);
      if (module.run) await module.run(names);
      else for (const name of names) await module.features[name]();
      if (module.checksum) console.log(`${names.join(",")}: ${module.checksum() % 997}`);
    }
  } finally {
    await stopServers();
    await cleanTmp();
  }
  process.exit(0);
}
