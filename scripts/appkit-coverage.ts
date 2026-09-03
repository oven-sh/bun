#!/usr/bin/env bun
// How much of AppKit / Metal do bun:objc and bun:appkit reach, and how?
//
// Three layers, three numbers. The `objc` bridge reaches every class and
// selector of the frameworks it loads by name, so its reach is what the macOS
// SDK headers declare (counted here) plus the enumerations and constants in
// the enum tables the build generates. The curated elements in src/js/bun/appkit.ts
// are built on the bridge; this lists them and the AppKit classes they make.
// What is compiled in natively is the typed binding tables in src/appkit/objc
// (the app lifecycle, the Metal view, `gpu`, and the bridge's own machinery);
// those are diffed against the SDK per class: selectors declared in the header
// (own declarations incl. categories; properties count as getter + setter),
// selectors bound, selectors transcribed but commented out, and which Rust
// modules use the class.
//
//   bun scripts/appkit-coverage.ts            # markdown to stdout
//   bun scripts/appkit-coverage.ts --json     # machine-readable

import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { enumTables } from "./appkit-enums";
import { inFramework, readSdk, sdk as toolchain } from "./appkit-sdk";
import { BINDING_TABLES as FRAMEWORKS, treeCounts } from "./appkit-tree-counts";

const root = join(import.meta.dir, "..");
const json = process.argv.includes("--json");
const tree = treeCounts(root);
const found = toolchain();
if (found.sdk === null) {
  console.error(found.reason);
  process.exit(2);
}
const SDK = found.sdk;

// ───────────────────────────── SDK side ─────────────────────────────

type Decl = {
  framework: string;
  header: string;
  selectors: Set<string>;
  isProtocol: boolean;
  superclass?: string;
};
const sdk = new Map<string, Decl>(); // ObjC class/protocol name -> declared selectors

{
  const frameworks = [...new Set(Object.values(FRAMEWORKS).flat())];
  const frameworkOf = (file: string) => /\/([A-Za-z0-9_]+)\.framework\//.exec(file)?.[1] ?? "";
  const ast = readSdk("arm64");
  for (const container of [...ast.interfaces.values(), ...ast.protocols.values()]) {
    // A class belongs to the framework of its `@interface`, not of a category
    // some other framework declares on it (AppKit adds categories to
    // NSString, NSURL, NSObject...); its selectors are those any of these
    // frameworks declare on it, a property counting as its getter and setter.
    if (!inFramework(container.file, frameworks)) continue;
    sdk.set(container.name, {
      framework: frameworkOf(container.file!),
      header: basename(container.file!),
      selectors: new Set(container.methods.filter(m => inFramework(m.file, frameworks)).map(m => m.selector)),
      isProtocol: !("superclass" in container),
      superclass: "superclass" in container ? (container.superclass ?? undefined) : undefined,
    });
  }
}

// ───────────────────────────── our side ─────────────────────────────

type Bound = {
  rust: string;
  objc: string;
  file: string;
  active: Set<string>;
  commented: Set<string>;
  usedBy: Set<string>;
};
const bound = new Map<string, Bound>( // rust name -> binding
  [...tree.bound].map(([rust, b]) => [rust, { ...b, usedBy: new Set(b.parked ? ["(commented out)"] : []) }]),
);

// Which crate modules use each bound class.
const users = ["src/appkit", "src/appkit/gpu", "src/appkit/objc"].flatMap(dir =>
  readdirSync(join(root, dir))
    .filter(
      f =>
        f.endsWith(".rs") &&
        !(dir === "src/appkit/objc" && f in { "appkit.rs": 1, "foundation.rs": 1, "metal.rs": 1, "sdk.rs": 1 }),
    )
    .map(f => `${dir}/${f}`),
);
for (const file of users) {
  const text = readFileSync(join(root, file), "utf8");
  for (const b of bound.values()) {
    if (new RegExp(`\\b${b.rust}\\b`).test(text)) b.usedBy.add(basename(file, ".rs"));
  }
}

// ───────────────────────────── report ─────────────────────────────

type Row = {
  class: string;
  framework: string;
  declared: number;
  bound: number;
  commented: number;
  pct: number;
  usedBy: string[];
  missingSample: string[];
};
const rows: Row[] = [];
for (const b of bound.values()) {
  const decl = sdk.get(b.objc);
  const declared = decl?.selectors ?? new Set<string>();
  const framework = decl?.framework ?? "(runtime)";
  const boundHere = [...b.active].filter(s => declared.has(s) || declared.size === 0);
  const missing = [...declared].filter(s => !b.active.has(s));
  rows.push({
    class: b.objc,
    framework,
    declared: declared.size,
    bound: b.active.size,
    commented: b.commented.size,
    pct: declared.size ? Math.round((100 * boundHere.length) / declared.size) : 0,
    usedBy: [...b.usedBy].sort(),
    missingSample: missing.slice(0, 6),
  });
}
rows.sort((a, b) => a.framework.localeCompare(b.framework) || b.bound - a.bound);

const frameworks = [...new Set(Object.values(FRAMEWORKS).flat())];
const summary = frameworks.map(fw => {
  const classes = [...sdk.entries()].filter(([, d]) => d.framework === fw && !d.isProtocol);
  const protocols = [...sdk.entries()].filter(([, d]) => d.framework === fw && d.isProtocol);
  const ours = rows.filter(r => r.framework === fw);
  const declaredSelectors = classes.concat(protocols).reduce((n, [, d]) => n + d.selectors.size, 0);
  const boundSelectors = ours.reduce((n, r) => n + r.bound, 0);
  return {
    framework: fw,
    sdkClasses: classes.length,
    sdkProtocols: protocols.length,
    boundTypes: ours.length,
    declaredSelectors,
    boundSelectors,
  };
});

function inherits(name: string, base: string): boolean {
  for (let c: string | undefined = name, i = 0; c && i < 32; c = sdk.get(c)?.superclass, i++)
    if (c === base) return true;
  return false;
}
const viewClasses = [...sdk.entries()]
  .filter(([n, d]) => !d.isProtocol && d.framework === "AppKit" && inherits(n, "NSView"))
  .map(([n]) => n);
const boundViews = viewClasses.filter(n => [...bound.values()].some(b => b.objc === n && b.active.size > 0));
const jsElements = tree.elements;
const bridgedClasses = tree.bridgedClasses;
const bridgedAppKit = bridgedClasses.filter(n => sdk.get(n)?.framework === "AppKit");
const enums = enumTables();
const bridge = {
  frameworks: summary.map(s => s.framework),
  classes: summary.reduce((n, s) => n + s.sdkClasses, 0),
  protocols: summary.reduce((n, s) => n + s.sdkProtocols, 0),
  selectors: summary.reduce((n, s) => n + s.declaredSelectors, 0),
  enumTypes: enums.enums.size,
  enumMembers: [...enums.enums.values()].reduce((n, e) => n + e.members.length, 0),
  looseConstants: enums.loose.size,
  typedConstants: enums.constants.size,
};

if (json) {
  console.log(
    JSON.stringify(
      { summary, rows, bridge, viewClasses: viewClasses.length, boundViews, jsElements, bridgedClasses, bridgedAppKit },
      null,
      2,
    ),
  );
  process.exit(0);
}

console.log("# bun:objc / bun:appkit — Objective-C surface coverage\n");
console.log(
  `SDK: ${SDK.split("/").slice(-1)[0]}  ·  generated ${new Date().toISOString().slice(0, 10)} by scripts/appkit-coverage.ts\n`,
);
console.log(`## Headline\n`);
console.log(
  `- The \`objc\` bridge reaches by name every class and selector the loaded frameworks register: the SDK headers for ${bridge.frameworks.join(", ")} declare **${bridge.classes} classes, ${bridge.protocols} protocols and ${bridge.selectors} selectors**; \`objc.enums\` knows **${bridge.enumTypes} enumerations (${bridge.enumMembers} members)** and ${bridge.looseConstants} loose constants of Foundation and AppKit, \`objc.constants\` any exported global (${bridge.typedConstants} typed as numbers or structs, the rest as objects).`,
);
console.log(
  `- Curated JavaScript elements written on the bridge: **${jsElements.length}** (${jsElements.join(", ")}), built out of **${bridgedAppKit.length} AppKit classes** (${bridgedAppKit.join(", ")}).`,
);
console.log(
  `- \`NSView\` subclasses in the SDK: ${viewClasses.length}; with a curated element or used by one: ${viewClasses.filter(n => bridgedAppKit.includes(n) || boundViews.includes(n)).length}. Every other one is an \`objc.classes.X\` away.`,
);
console.log(
  `- Compiled in natively (the rows below): the typed bindings the app lifecycle, the event-loop integration, \`MetalView\`, \`gpu\` and the bridge's own machinery use. A curated prop is not a binding line any more; it is a send through the bridge.\n`,
);
console.log("## By framework\n");
console.log(
  "| framework | classes in SDK | protocols in SDK | types we bind | selectors declared (SDK) | selectors we bind |",
);
console.log("|---|---:|---:|---:|---:|---:|");
for (const s of summary) {
  console.log(
    `| ${s.framework} | ${s.sdkClasses} | ${s.sdkProtocols} | ${s.boundTypes} | ${s.declaredSelectors} | ${s.boundSelectors} (${s.declaredSelectors ? ((100 * s.boundSelectors) / s.declaredSelectors).toFixed(1) : 0}%) |`,
  );
}
console.log("\n## By bound class\n");
console.log(
  "`declared` = selectors the SDK header declares on that class itself (properties count getter+setter; inherited ones are on the superclass row). `bound` = compiled bindings; `parked` = transcribed but commented out until something needs them.\n",
);
console.log("| class | framework | declared | bound | parked | % | used by |");
console.log("|---|---|---:|---:|---:|---:|---|");
for (const r of rows) {
  console.log(
    `| ${r.class} | ${r.framework} | ${r.declared} | ${r.bound} | ${r.commented} | ${r.declared ? r.pct + "%" : "–"} | ${r.usedBy.join(", ")} |`,
  );
}
const totalDeclared = rows.reduce((n, r) => n + r.declared, 0);
const totalBound = rows.reduce((n, r) => n + r.bound, 0);
console.log(
  `\n**Bound classes: ${rows.length}. On those classes: ${totalBound} of ${totalDeclared} declared selectors bound (${((100 * totalBound) / Math.max(1, totalDeclared)).toFixed(1)}%), ${rows.reduce((n, r) => n + r.commented, 0)} more parked as comments.**`,
);
