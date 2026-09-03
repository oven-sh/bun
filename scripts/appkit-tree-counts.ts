// The bun:appkit numbers that depend only on this source tree (not on the
// macOS SDK): what src/js/bun/appkit.ts builds and how many typed
// Objective-C bindings are compiled in. scripts/appkit-coverage.ts prints
// them; docs/runtime/objc.mdx quotes them and test/js/bun/appkit checks the
// quote against this.

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The files holding the typed binding tables, with the frameworks each binds. */
export const BINDING_TABLES: Record<string, string[]> = {
  "src/appkit/objc/appkit.rs": ["AppKit", "QuartzCore"],
  "src/appkit/objc/foundation.rs": ["Foundation"],
  "src/appkit/objc/metal.rs": ["Metal", "MetalKit"],
};

export type BoundClass = {
  rust: string;
  objc: string;
  file: string;
  /** The whole `objc_class!` line is commented out. */
  parked: boolean;
  active: Set<string>;
  commented: Set<string>;
};

export type TreeCounts = {
  /** `Window` plus every class deriving from `View` except the abstract `Container`. */
  elements: string[];
  /** The Objective-C classes appkit.ts names as `classes.X`. */
  bridgedClasses: string[];
  bound: Map<string, BoundClass>;
  /** `objc_class!` declarations that are not commented out. */
  boundClasses: number;
  /** Selector lines inside `objc_methods!` blocks that are not commented out. */
  boundSelectors: number;
};

export function treeCounts(root: string): TreeCounts {
  const appkitJs = readFileSync(join(root, "src/js/bun/appkit.ts"), "utf8");
  const jsClasses = new Map(
    [...appkitJs.matchAll(/^class ([A-Z][A-Za-z]+) extends ([A-Z][A-Za-z]+) \{/gm)].map(m => [m[1], m[2]]),
  );
  const isView = (name: string): boolean => name === "View" || (jsClasses.has(name) && isView(jsClasses.get(name)!));
  const elements = ["Window", ...[...jsClasses.keys()].filter(n => n !== "Container" && isView(n))];
  const bridgedClasses = [...new Set([...appkitJs.matchAll(/\bclasses\.([A-Z][A-Za-z0-9]+)/g)].map(m => m[1]))].sort();

  const bound = new Map<string, BoundClass>();
  for (const file of Object.keys(BINDING_TABLES)) {
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
        parked: Boolean(commentedOut),
        active: new Set(),
        commented: new Set(),
      });
    }
    // objc_methods! { impl X { ... }} blocks, possibly commented out line by line
    for (const block of text.matchAll(
      /^(?:\/\/ )?objc_methods! \{ impl ([A-Za-z0-9_]+) \{([\s\S]*?)^(?:\/\/ )?\}\}/gm,
    )) {
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
  const live = [...bound.values()].filter(b => !b.parked);
  return {
    elements,
    bridgedClasses,
    bound,
    boundClasses: live.length,
    boundSelectors: live.reduce((n, b) => n + b.active.size, 0),
  };
}
