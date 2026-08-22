#!/usr/bin/env bun
// How much of AppKit / Metal does Bun.AppKit reach?
//
// Diffs the macOS SDK headers against the binding tables in src/appkit/objc
// and prints, per Objective-C class we bind: selectors declared in the SDK
// header (own declarations incl. categories; properties count as getter +
// setter), selectors bound and compiled, selectors transcribed but commented
// out, and which Rust modules use the class. Then a framework-level summary:
// classes bound vs classes declared.
//
//   bun scripts/appkit-coverage.ts            # markdown to stdout
//   bun scripts/appkit-coverage.ts --json     # machine-readable

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const SDK =
  process.env.SDKROOT ??
  "/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk";
const FRAMEWORKS: Record<string, string[]> = {
  "src/appkit/objc/appkit.rs": ["AppKit", "QuartzCore"],
  "src/appkit/objc/foundation.rs": ["Foundation"],
  "src/appkit/objc/metal.rs": ["Metal", "MetalKit"],
};
const root = join(import.meta.dir, "..");
const json = process.argv.includes("--json");

// ───────────────────────────── SDK side ─────────────────────────────

type Decl = {
  framework: string;
  header: string;
  selectors: Set<string>;
  isProtocol: boolean;
  superclass?: string;
  primary: boolean;
};
const sdk = new Map<string, Decl>(); // ObjC class/protocol name -> declared selectors

function selectorsOfMethod(line: string): string | null {
  // "- (void)setFrame:(NSRect)frameRect display:(BOOL)flag;" -> "setFrame:display:"
  const m = line.match(/^[-+]\s*\([^)]*(?:\([^)]*\)[^)]*)*\)\s*(.*)$/);
  if (!m) return null;
  let rest = m[1];
  const parts = [...rest.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)].map(x => x[1]);
  if (parts.length) {
    // keep only selector pieces that are followed by an argument "(type)name"; the regex above
    // also matches inside macros, so cut at the first attribute/semicolon.
    const cut = rest.search(/\b(NS_|API_|__|;)/);
    const head = cut >= 0 ? rest.slice(0, cut) : rest;
    const pieces = [...head.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\(/g)].map(x => x[1]);
    if (pieces.length) return pieces.map(p => p + ":").join("");
  }
  const bare = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
  return bare ? bare[1] : null;
}

function selectorsOfProperty(line: string): string[] {
  // "@property (nullable, copy, readonly, getter=isVisible) NSString *title;" -> ["title"] or ["title","setTitle:"]
  const attrs = line.match(/@property\s*\(([^)]*)\)/)?.[1] ?? "";
  const decl = line
    .replace(/@property\s*(\([^)]*\))?/, "")
    .replace(/\b(NS_|API_|__OSX|UI_APPEARANCE)\w*(\([^;]*?\))?/g, "");
  // last identifier before ';' is the name (handles "NSString *title", "BOOL hidden", block types crudely)
  const names = [...decl.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*(?:;|,)/g)].map(m => m[1]);
  const name = names[0];
  if (!name) return [];
  const getter = attrs.match(/getter\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/)?.[1] ?? name;
  const out = [getter];
  if (!/\breadonly\b/.test(attrs)) {
    const setter =
      attrs.match(/setter\s*=\s*([A-Za-z_][A-Za-z0-9_:]*)/)?.[1] ?? "set" + name[0].toUpperCase() + name.slice(1) + ":";
    out.push(setter);
  }
  return out;
}

for (const fw of new Set(Object.values(FRAMEWORKS).flat())) {
  const dir = join(SDK, "System/Library/Frameworks", `${fw}.framework/Headers`);
  if (!existsSync(dir)) continue;
  for (const h of readdirSync(dir).filter(f => f.endsWith(".h"))) {
    const text = readFileSync(join(dir, h), "utf8");
    let current: Decl | null = null;
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      const iface = line.match(
        /^@(interface|protocol)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(\()?(?::\s*([A-Za-z_][A-Za-z0-9_]*))?/,
      );
      if (iface) {
        const [, kind, name, category, superclass] = iface;
        current = sdk.get(name) ?? {
          framework: fw,
          header: h,
          selectors: new Set(),
          isProtocol: kind === "protocol",
          superclass,
          primary: false,
        };
        // A class belongs to the framework of its primary @interface, not of the
        // first category some other framework declares on it (AppKit adds
        // categories to NSString, NSURL, NSObject...).
        if (!category && kind === "interface" && !current.primary) {
          current.framework = fw;
          current.header = h;
          current.primary = true;
          if (superclass) current.superclass = superclass;
        }
        sdk.set(name, current);
        continue;
      }
      if (line.startsWith("@end")) {
        current = null;
        continue;
      }
      if (!current) continue;
      if (line.startsWith("- (") || line.startsWith("+ (") || line.startsWith("-(") || line.startsWith("+(")) {
        const sel = selectorsOfMethod(line);
        if (sel) current.selectors.add(sel);
      } else if (line.startsWith("@property")) {
        for (const sel of selectorsOfProperty(line)) current.selectors.add(sel);
      }
    }
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
const bound = new Map<string, Bound>(); // rust name -> binding

for (const file of Object.keys(FRAMEWORKS)) {
  const text = readFileSync(join(root, file), "utf8");
  for (const m of text.matchAll(
    /^(\/\/ )?objc_class!\((?:pub(?:\([a-z]+\))? )?struct ([A-Za-z0-9_]+)(?:: [A-Za-z0-9_]+)? = "([A-Za-z0-9_]+)"\);/gm,
  )) {
    const [, commentedOut, rust, objc] = m;
    // Protocol-typed Metal objects bind as NSObject; use the Rust name (which is the protocol name).
    bound.set(rust, {
      rust,
      objc: objc === "NSObject" && rust !== "NSObject" ? rust : objc,
      file,
      active: new Set(),
      commented: new Set(),
      usedBy: new Set(),
    });
    if (commentedOut) bound.get(rust)!.usedBy.add("(commented out)");
  }
  // objc_methods! { impl X { ... }} blocks, possibly commented out line by line
  for (const block of text.matchAll(/^(?:\/\/ )?objc_methods! \{ impl ([A-Za-z0-9_]+) \{([\s\S]*?)^(?:\/\/ )?\}\}/gm)) {
    const [, rust, body] = block;
    const b = bound.get(rust);
    if (!b) continue;
    for (const line of body.split("\n")) {
      const sel = line.match(/=\s*"([^"]+)";\s*$/)?.[1];
      if (!sel) continue;
      (line.trim().startsWith("//") ? b.commented : b.active).add(sel);
    }
  }
}

// Which crate modules use each bound class (a rough "surfaces in JS through…").
const users = [
  ...readdirSync(join(root, "src/appkit"))
    .filter(f => f.endsWith(".rs"))
    .map(f => "src/appkit/" + f),
  ...readdirSync(join(root, "src/appkit/view")).map(f => "src/appkit/view/" + f),
  ...readdirSync(join(root, "src/appkit/gpu")).map(f => "src/appkit/gpu/" + f),
];
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
// The React host component table lists every element name once: `  Name: appkit.Name,`.
const jsElements = [
  ...readFileSync(join(root, "src/js/bun/appkit.react.ts"), "utf8").matchAll(/^\s*([A-Z][A-Za-z]+): appkit\.\1,$/gm),
].map(m => m[1]);

if (json) {
  console.log(JSON.stringify({ summary, rows, viewClasses: viewClasses.length, boundViews, jsElements }, null, 2));
  process.exit(0);
}

const pad = (s: string | number, n: number) => String(s).padEnd(n);
console.log("# Bun.AppKit — Objective-C surface coverage\n");
console.log(
  `SDK: ${SDK.split("/").slice(-1)[0]}  ·  generated ${new Date().toISOString().slice(0, 10)} by scripts/appkit-coverage.ts\n`,
);
console.log(`## Headline\n`);
console.log(`- JavaScript elements: **${jsElements.length}** (${jsElements.join(", ")}).`);
console.log(
  `- AppKit \`NSView\` subclasses reachable through them: **${boundViews.length} of ${viewClasses.length}** in the SDK (${boundViews.join(", ")}).`,
);
console.log(
  `- \`NSView\` subclasses without a JavaScript element: ${viewClasses.filter(n => !boundViews.includes(n)).join(", ")}.`,
);
console.log(
  `- Beyond this table, the \`objc\` export is a dynamic bridge: every class and selector of these frameworks is reachable from JS by name (\`objc.classes.NSAlert\`, \`view.native.setWantsLayer_(true)\`). The rows below count only the static bindings the curated layer compiles in; a curated prop is still a binding line plus a prop.\n`,
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
