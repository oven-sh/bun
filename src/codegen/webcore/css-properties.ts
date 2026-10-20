// Makes the CSS property tables of bun:dom, for C++ and for Rust, from one list, so that the property numbers agree:
//   src/jsc/bindings/webcore/css/CSSPropertyNames.h
//   src/jsc/bindings/webcore/css/CSSPropertyNames.cpp
//   src/css/dom/properties.rs
// generate.ts runs this. The inputs are:
//   - upstream's css/CSSProperties.json, and the defaults in WTF's UnifiedWebPreferences.yaml;
//   - the names that Bun's CSS parser has a type for (src/css/properties/properties_generated.rs);
//   - css-initial-values.json: for each property, the computed value of an element with no style in WebKit, Chromium and Firefox,
//     as `getComputedStyle()` gives it. A browser that does not have the property is left out.
import fs from "node:fs";
import path from "node:path";
import measured from "./css-initial-values.json";
import { type Files } from "./util.ts";

type Json = Record<string, any>;
type Syntax =
  | { kind: "All" | "Expanded" | "Verbatim" | "Typed" | "TypedVerbatim" }
  | { kind: "Simple"; keywords: string[]; kinds: Set<string> }
  | { kind: "Tokens"; keywords: string };

const words = (text: string) => text.split(/\s+/).filter(Boolean);
const sides = (name: (side: string) => string) => ["top", "right", "bottom", "left"].map(name);
const logicalSides = ["block-start", "block-end", "inline-start", "inline-end"];

// ---- The shorthands that are expanded. Each has an arm in src/css/dom/declarations.rs, with its longhands in this order.
const shorthands = new Map<string, { pattern: string; longhands: string[] }>();
const shorthand = (name: string, pattern: string, longhands: string[]) => shorthands.set(name, { pattern, longhands });
for (const p of ["margin", "padding", "scroll-margin", "scroll-padding"]) {
  shorthand(
    p,
    "Quad",
    sides(s => `${p}-${s}`),
  );
  shorthand(`${p}-block`, "Pair", [`${p}-block-start`, `${p}-block-end`]);
  shorthand(`${p}-inline`, "Pair", [`${p}-inline-start`, `${p}-inline-end`]);
}
shorthand(
  "inset",
  "Quad",
  sides(s => s),
);
shorthand("inset-block", "Pair", ["inset-block-start", "inset-block-end"]);
shorthand("inset-inline", "Pair", ["inset-inline-start", "inset-inline-end"]);
const borderParts = ["width", "style", "color"];
for (const part of borderParts) {
  shorthand(
    `border-${part}`,
    "Quad",
    sides(s => `border-${s}-${part}`),
  );
  shorthand(`border-block-${part}`, "Pair", [`border-block-start-${part}`, `border-block-end-${part}`]);
  shorthand(`border-inline-${part}`, "Pair", [`border-inline-start-${part}`, `border-inline-end-${part}`]);
}
for (const side of ["top", "right", "bottom", "left", ...logicalSides])
  shorthand(
    `border-${side}`,
    "OmitInitial",
    borderParts.map(part => `border-${side}-${part}`),
  );
shorthand("border", "Border", [...borderParts.flatMap(part => sides(s => `border-${s}-${part}`)), "border-image"]);
for (const axis of ["block", "inline"])
  shorthand(
    `border-${axis}`,
    "BorderAxis",
    borderParts.flatMap(part => ["start", "end"].map(end => `border-${axis}-${end}-${part}`)),
  );
shorthand("outline", "OmitInitial", ["outline-width", "outline-style", "outline-color"]);
// prettier-ignore
shorthand("border-radius", "BorderRadius", ["border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"]);
shorthand("gap", "Pair", ["row-gap", "column-gap"]);
shorthand("overflow", "Pair", ["overflow-x", "overflow-y"]);
shorthand("place-content", "Pair", ["align-content", "justify-content"]);
shorthand("place-items", "Pair", ["align-items", "justify-items"]);
shorthand("place-self", "Pair", ["align-self", "justify-self"]);
shorthand("flex", "AllValues", ["flex-grow", "flex-shrink", "flex-basis"]);
shorthand("flex-flow", "OmitInitial", ["flex-direction", "flex-wrap"]);
// prettier-ignore
shorthand("background", "Background", ["background-image", "background-position-x", "background-position-y", "background-size", "background-repeat", "background-attachment", "background-origin", "background-clip", "background-color"]);
shorthand("background-position", "AllValues", ["background-position-x", "background-position-y"]);
// prettier-ignore
shorthand("font", "AsSet", ["font-style", "font-variant-caps", "font-weight", "font-stretch", "font-size", "line-height", "font-family"]);
// prettier-ignore
shorthand("transition", "AsSet", ["transition-property", "transition-duration", "transition-timing-function", "transition-delay"]);
// prettier-ignore
shorthand("animation", "AsSet", ["animation-duration", "animation-timing-function", "animation-delay", "animation-iteration-count", "animation-direction", "animation-fill-mode", "animation-play-state", "animation-name"]);
// Bun's parser has no type for these. src/css/dom/declarations.rs takes them apart.
const expanded = new Set(["text-decoration", "list-style", "grid-row", "grid-column", "grid-area"]);
// prettier-ignore
shorthand("text-decoration", "OmitInitial", ["text-decoration-line", "text-decoration-style", "text-decoration-color", "text-decoration-thickness"]);
shorthand("list-style", "OmitInitial", ["list-style-position", "list-style-image", "list-style-type"]);
shorthand("grid-row", "GridLines", ["grid-row-start", "grid-row-end"]);
shorthand("grid-column", "GridLines", ["grid-column-start", "grid-column-end"]);
shorthand("grid-area", "GridLines", ["grid-row-start", "grid-column-start", "grid-row-end", "grid-column-end"]);

// ---- How the value of a property that Bun has a type for is written back. By default: from the typed value.
// Verbatim: checked by the typed parser, kept as the author wrote it (what jsdom does, and no browser agrees with Bun's printer here).
// prettier-ignore
const verbatim = new Set([
  "box-shadow", "text-shadow", "transform", "transform-origin", "perspective-origin", "translate", "rotate", "scale",
  "transition", "transition-property", "transition-duration", "transition-delay", "transition-timing-function",
  "animation", "animation-name", "background-position", "border-image", "border-image-source", "border-image-outset",
  "border-image-repeat", "border-image-width", "border-image-slice", "view-transition-name", "view-transition-class",
  "view-transition-group", "-webkit-box-shadow", "-webkit-border-image",
]);
const verbatimPrefixes = ["mask", "-webkit-mask"];
// ... but these print like background-image.
const notVerbatim = new Set(["mask-image"]);
// Properties without a type whose strings and url()s browsers and jsdom normalize: written back from the token list.
// prettier-ignore
const tokens = new Set(["content", "quotes", "list-style-image", "cursor", "list-style-type", "font-feature-settings", "font-variation-settings", "grid-template-areas"]);

const nonNegative = new Set(
  words(`width height min-width min-height max-width max-height block-size inline-size min-block-size min-inline-size
max-block-size max-inline-size padding-top padding-right padding-bottom padding-left padding-block-start padding-block-end
padding-inline-start padding-inline-end border-top-width border-right-width border-bottom-width border-left-width
border-block-start-width border-block-end-width border-inline-start-width border-inline-end-width outline-width
border-top-left-radius border-top-right-radius border-bottom-right-radius border-bottom-left-radius border-start-start-radius
border-start-end-radius border-end-start-radius border-end-end-radius font-size line-height flex-grow flex-shrink flex-basis
row-gap column-gap perspective border-spacing scroll-padding-top scroll-padding-right scroll-padding-bottom scroll-padding-left
scroll-padding-block-start scroll-padding-block-end scroll-padding-inline-start scroll-padding-inline-end`),
);
// Bun's type for these is LengthPercentageOrAuto, but `auto` is not in their grammar.
const noAuto = new Set([
  ...[...nonNegative].filter(n => n.startsWith("padding-")),
  ...["top", "right", "bottom", "left", ...logicalSides].map(s => `scroll-margin-${s}`),
]);

// The canonical name here, by upstream's name. Chrome, jsdom and Bun's parser say font-stretch.
const renamed: Record<string, string> = { "font-width": "font-stretch" };
// A shorthand of its own upstream, with the longhands of the other. All three browsers write the other's name back.
const moreAliases: Record<string, string> = { "-webkit-border-radius": "border-radius" };

const enabledFeatures = new Set(["ENABLE_VARIATION_FONTS", "ENABLE_DARK_MODE_CSS", "ENABLE_CSS_TAP_HIGHLIGHT_COLOR"]);
// Off in the preferences file, but at least two of the three browsers have them.
// prettier-ignore
const forced = new Set(["backdrop-filter", "scrollbar-color", "overflow-clip-margin", "text-justify", "font-variant-emoji", "d"]);

const initialOverrides: Record<string, string> = {
  "font-family": "serif",
  "transform-origin": "50% 50%",
  "perspective-origin": "50% 50%",
  "width": "auto",
  "height": "auto",
  "inline-size": "auto",
  "block-size": "auto",
  "-webkit-tap-highlight-color": "rgba(0, 0, 0, 0.4)",
  "border-image": "none",
  "font-stretch": "100%",
};

const kindNames = ["COLOR", "LENGTH", "PERCENTAGE", "NUMBER", "INTEGER", "NON_NEGATIVE", "LENIENT"];

// Written by hand, for properties that tests read and whose grammar upstream does not spell out in the JSON.
// LENIENT: a single keyword of the list is put in lower case, everything else is kept as written. The grammar has more than the list.
const blendModes =
  "normal multiply screen overlay darken lighten color-dodge color-burn hard-light soft-light difference exclusion hue saturation color luminosity plus-darker plus-lighter";
const manual: Record<string, [string, string[]]> = {
  "vertical-align": [
    "baseline sub super top text-top middle bottom text-bottom -webkit-baseline-middle",
    ["LENGTH", "PERCENTAGE"],
  ],
  "outline-offset": ["", ["LENGTH"]],
  "column-count": ["auto", ["INTEGER", "NON_NEGATIVE"]],
  "orphans": ["auto", ["INTEGER", "NON_NEGATIVE"]],
  "widows": ["auto", ["INTEGER", "NON_NEGATIVE"]],
  "-webkit-line-clamp": ["none", ["INTEGER", "NON_NEGATIVE"]],
  "page-break-after": ["auto always avoid left right", []],
  "page-break-before": ["auto always avoid left right", []],
  "page-break-inside": ["auto avoid", []],
  "fill": ["none context-fill context-stroke", ["COLOR", "LENIENT"]],
  "stroke": ["none context-fill context-stroke", ["COLOR", "LENIENT"]],
  "text-indent": ["", ["LENGTH", "PERCENTAGE", "LENIENT"]],
  "text-transform": ["none capitalize uppercase lowercase full-width full-size-kana", ["LENIENT"]],
  "white-space": ["normal pre nowrap pre-wrap pre-line break-spaces", ["LENIENT"]],
  "text-wrap": ["wrap nowrap balance pretty stable", ["LENIENT"]],
  "text-decoration-line": ["none underline overline line-through blink", ["LENIENT"]],
  "touch-action": ["auto none manipulation pan-x pan-y pinch-zoom", ["LENIENT"]],
  "overscroll-behavior": ["auto contain none", ["LENIENT"]],
  "contain": ["none strict content size layout style paint inline-size", ["LENIENT"]],
  "container-type": ["normal size inline-size", ["LENIENT"]],
  "will-change": ["auto", ["LENIENT"]],
  "font-variant": ["normal none small-caps", ["LENIENT"]],
  "grid-auto-flow": ["row column dense", ["LENIENT"]],
  "scroll-snap-align": ["none start end center", ["LENIENT"]],
  "scroll-snap-type": ["none", ["LENIENT"]],
  "background-blend-mode": [blendModes, ["LENIENT"]],
  "animation-direction": ["normal reverse alternate alternate-reverse", ["LENIENT"]],
  "animation-fill-mode": ["none forwards backwards both", ["LENIENT"]],
  "animation-play-state": ["running paused", ["LENIENT"]],
  "animation-iteration-count": ["infinite", ["LENIENT"]],
  "animation-timing-function": ["ease linear ease-in ease-out ease-in-out step-start step-end", ["LENIENT"]],
  "clip": ["auto", ["LENIENT"]],
  "clip-path": ["none", ["LENIENT"]],
  "filter": ["none", ["LENIENT"]],
  "backdrop-filter": ["none", ["LENIENT"]],
  "-webkit-backdrop-filter": ["none", ["LENIENT"]],
  "grid-template-columns": ["none", ["LENIENT"]],
  "grid-template-rows": ["none", ["LENIENT"]],
  "columns": ["auto", ["LENIENT"]],
};

// `Property::parse` names these and takes no value for them (measured on a built binary).
// prettier-ignore
const noTypeAfterAll = new Set(["transform-origin", "perspective-origin", "mask-position", "-webkit-mask-position", "-webkit-mask-composite", "-webkit-transform-origin", "-webkit-perspective-origin"]);
// Keywords that are a whole value of the property and that the type Bun's parser uses does not know (measured the same way).
const extraKeywords: Record<string, string> = {
  "box-shadow": "none",
  "-webkit-box-shadow": "none",
  "text-shadow": "none",
  "flex-basis": "content min-content max-content fit-content",
  "overflow-x": "overlay",
  "overflow-y": "overlay",
  "font-size": "math",
};

const compare = <T>(a: T, b: T) => (a < b ? -1 : a > b ? 1 : 0);
// Names with a prefix come last.
const byName = (a: string, b: string) => compare(a.startsWith("-"), b.startsWith("-")) || compare(a, b);
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`css-properties.ts: ${message}`);
};

/** One block of text with NUL after each entry, and the offsets into it. */
class Blob {
  private entries: string[] = [];
  private offsets = new Map<string, number>();
  size = 0;

  add(text: string): number {
    let offset = this.offsets.get(text);
    if (offset === undefined) {
      offset = this.size;
      this.offsets.set(text, offset);
      this.entries.push(text);
      this.size += Buffer.byteLength(text) + 1;
    }
    return offset;
  }

  toCpp(width = 110): string {
    const lines: string[] = [];
    let line = "";
    for (const entry of this.entries) {
      // Three digits: "\0" followed by "1px" would be the escape \01.
      const piece = entry.replaceAll("\\", "\\\\").replaceAll('"', '\\"') + "\\000";
      if (line.length + piece.length > width) {
        lines.push(line);
        line = "";
      }
      line += piece;
    }
    if (line) lines.push(line);
    return lines.map(l => `    "${l}"`).join("\n");
  }
}

function fnv1a(text: string): number {
  let hash = 2166136261;
  for (const byte of Buffer.from(text)) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return hash;
}

function rows(items: (string | number)[], perLine = 16): string {
  const lines: string[] = [];
  for (let i = 0; i < items.length; i += perLine) lines.push("    " + items.slice(i, i + perLine).join(", ") + ",");
  return lines.join("\n");
}

/** `webcore` is Source/WebCore of a WebKit checkout. The result maps a path relative to the repository to the file's text. */
export function makeCSSPropertyTables(webcore: string, repository: string): Files {
  const json: Json = JSON.parse(fs.readFileSync(path.join(webcore, "css/CSSProperties.json"), "utf8"));
  const properties: Record<string, Json> = json.properties;

  const codegen = (property: Json): Json => {
    const c = property["codegen-properties"] ?? {};
    // font-width: one variant for each value of ENABLE_VARIATION_FONTS.
    return Array.isArray(c) ? c.filter(x => !(x["enable-if"] ?? "").startsWith("!"))[0] : c;
  };

  // ---- Which properties exist. A preference counts as on when it is on by default, or on for Cocoa: that is, on in the Safari that ships.
  const preferences = new Map<string, string>();
  const yaml = fs.readFileSync(path.resolve(webcore, "../WTF/Scripts/Preferences/UnifiedWebPreferences.yaml"), "utf8");
  for (const [, name, body] of yaml.matchAll(/^(\w+):\n((?:[ \t]+.*\n)+)/gm)) {
    const defaultValue = body.match(/^  defaultValue:[ ]*(.*)\n((?:    .*\n)*)/m);
    if (!defaultValue || preferences.has(name.toLowerCase())) continue;
    if (defaultValue[1].trim()) {
      preferences.set(name.toLowerCase(), defaultValue[1].trim());
      continue;
    }
    let value = "false";
    // The top level, not WebKitLegacy's.
    for (const line of defaultValue[2].split("\n").filter(l => /^    \S/.test(l))) {
      const text = line.trim();
      const colon = text.lastIndexOf(":");
      const key = text.slice(0, Math.max(colon, 0)).trim();
      if (text.slice(colon + 1).trim() === "true" && (key === "default" || key.includes("COCOA"))) value = "true";
    }
    preferences.set(name.toLowerCase(), value);
  }
  // CSSFooEnabled is spelled cssFooEnabled in the JSON.
  const preference = (flag: string) => preferences.get(flag.toLowerCase());
  const isExposed = (name: string) => {
    const c = codegen(properties[name]);
    if (forced.has(name)) return true;
    if (c["internal-only"]) return false;
    if (c["enable-if"] && !enabledFeatures.has(c["enable-if"])) return false;
    return !c["settings-flag"] || preference(c["settings-flag"]) === "true";
  };

  // ---- What Bun's parser has a type for.
  const generated = fs.readFileSync(path.join(repository, "src/css/properties/properties_generated.rs"), "utf8");
  const typed = new Set(Array.from(generated.matchAll(/PropertyIdTag::\w+ => b"([a-z-]+)"/g), m => m[1]));
  for (const name of ["all", "unparsed", "custom", "composes"]) typed.delete(name);
  const prefixes = new Map<string, Set<string>>(); // name -> the prefixes Bun's parser accepts for it
  for (const [, name, list] of generated.matchAll(
    /b"([a-z-]+)" => \((VendorPrefix::[^)]*(?:\([^)]*\)[^)]*)*)\s*,\s*(?:\|_\| )?PropertyId::/g,
  ))
    prefixes.set(name, new Set(Array.from(list.matchAll(/VendorPrefix::(\w+)/g), m => m[1])));
  const hasType = (name: string) => {
    if (typed.has(name) && (prefixes.get(name)?.has("NONE") ?? true)) return true;
    if (name.startsWith("-webkit-") && typed.has(name.slice(8)) && prefixes.get(name.slice(8))?.has("WEBKIT"))
      return true;
    return typed.has(name) && name.startsWith("-");
  };

  // ---- The list.
  const values = measured as Record<string, Record<string, string>>;
  let names: string[] = [];
  const aliases = new Map(Object.entries(moreAliases));
  for (const upstreamName in properties) {
    if (!isExposed(upstreamName) || upstreamName in moreAliases) continue;
    assert(upstreamName in values, `css-initial-values.json has no entry for ${upstreamName}: measure it`);
    if (!Object.keys(values[upstreamName]).length) continue; // No browser has it yet.
    const name = renamed[upstreamName] ?? upstreamName;
    names.push(name);
    for (const alias of codegen(properties[upstreamName]).aliases ?? [])
      if (!alias.startsWith("-epub-")) aliases.set(alias, name);
    if (name !== upstreamName) {
      aliases.delete(name);
      aliases.set(upstreamName, name);
    }
  }
  const upstreamNames = new Map(Object.keys(properties).map(n => [renamed[n] ?? n, n]));
  names = names.filter(n => n !== "all");

  for (const [name, { longhands }] of shorthands) {
    assert(names.includes(name), `${name} is not a property`);
    for (const l of longhands)
      assert((names.includes(l) && !shorthands.has(l)) || l === "border-image", `${l} of ${name} is not a longhand`);
    assert(hasType(name) || expanded.has(name), `nothing expands ${name}`);
  }

  const longhandNames = names.filter(n => !shorthands.has(n)).sort(byName);
  const shorthandNames = [...[...shorthands.keys()].sort(byName), "all"];
  const ordered = [...longhandNames, ...shorthandNames];
  const first = 2;
  const id = new Map(ordered.map((n, i) => [n, i + first]));

  const upstream = (n: string) => properties[upstreamNames.get(n)!];
  const upstreamLonghands = (n: string): string[] =>
    n === "all"
      ? []
      : (codegen(upstream(n)).longhands ?? [])
          .map((l: any) => (typeof l === "object" ? l.value : l))
          .map((l: string) => renamed[l] ?? l);
  const isInherited = (n: string) => {
    if (n === "all") return false;
    const u = upstream(n);
    if ("inherited" in u) return Boolean(u.inherited);
    const longhands = upstreamLonghands(n).filter(l => upstreamNames.has(l) && l !== n);
    return longhands.length > 0 && Boolean(upstream(longhands[0]).inherited);
  };
  const jsonInitial = (n: string) => (n === "all" ? "" : String(upstream(n).initial ?? ""));
  const initial = (n: string) => {
    if (shorthands.has(n) || n === "all") return "";
    if (n in initialOverrides) return initialOverrides[n];
    for (const browser of ["webkit", "chromium", "firefox"]) {
      const value = values[upstreamNames.get(n)!]?.[browser];
      if (value) return value;
    }
    return jsonInitial(n);
  };
  const initialIsCurrentColor = (n: string) => jsonInitial(n).toLowerCase() === "currentcolor" || n === "caret-color";
  const grammar = (n: string): string | undefined => (n === "all" ? undefined : codegen(upstream(n))["parser-grammar"]);
  const isColor = (n: string) => {
    if (shorthands.has(n) || n === "all") return false;
    const g = grammar(n) ?? "";
    return (
      Boolean(codegen(upstream(n))["color-property"]) ||
      g === "<color>" ||
      g === "auto | <color>" ||
      n === "fill" ||
      n === "stroke"
    );
  };

  // ---- The syntax of the properties that Bun has no type for.
  const keywordValues = (n: string) => {
    const keywords: string[] = [];
    for (let v of upstream(n).values ?? []) {
      if (typeof v === "object") {
        if (v.status === "unimplemented" || v.status === "removed" || v["enable-if"]) continue;
        if (v["settings-flag"] && preference(v["settings-flag"]) !== "true") continue;
        v = v.value;
      }
      if (!v.startsWith("-internal-")) keywords.push(v.toLowerCase());
    }
    return keywords;
  };
  const sharedRules: Json = json["shared-grammar-rules"] ?? {};
  /** Keywords and kinds when the grammar is one component: keywords and at most a few numeric types. */
  const simpleSyntax = (n: string): { keywords: string[]; kinds: Set<string> } | undefined => {
    const g = grammar(n);
    if (!g) return undefined;
    if (g === "<<values>>") return { keywords: keywordValues(n), kinds: new Set() };
    const keywords: string[] = [];
    const kinds = new Set<string>();
    const alternative = (text: string, depth = 0): boolean => {
      const a = text.trim();
      if (/^[a-zA-Z-]+$/.test(a)) {
        keywords.push(a.toLowerCase());
        return true;
      }
      const m = a.match(/^<([a-z-]+)((?: [^>]*)?)>$/);
      if (!m) return false;
      const [, type, args] = m;
      if (args.includes("[0,inf]")) kinds.add("NON_NEGATIVE");
      else if (args.includes("[")) return false;
      const kindsOfType: Record<string, string[]> = {
        "color": ["COLOR"],
        "length": ["LENGTH"],
        "length-percentage": ["LENGTH", "PERCENTAGE"],
        "percentage": ["PERCENTAGE"],
        "number": ["NUMBER"],
        "integer": ["INTEGER"],
        "opacity-value": ["NUMBER", "PERCENTAGE"],
      };
      if (type in kindsOfType) {
        for (const kind of kindsOfType[type]) kinds.add(kind);
        return true;
      }
      if (depth === 0 && `<${type}>` in sharedRules) {
        const shared: string = sharedRules[`<${type}>`].grammar ?? "";
        if (shared.replace(/<[^>]*>/g, "").includes("[") || shared.replace(/<[^>]*>|\s*\|\s*/g, "").includes(" "))
          return false;
        return shared.split("|").every(x => alternative(x, 1));
      }
      return false;
    };
    const stripped = g.replace(/<[^>]*>/g, "T");
    if (/[\[\]{}#?*+&@,/]/.test(stripped) || /[A-Za-z-] +[A-Za-z-]/.test(stripped)) return undefined;
    if (!g.split("|").every(x => alternative(x))) return undefined;
    if (kinds.has("NON_NEGATIVE") && !["LENGTH", "NUMBER", "INTEGER", "PERCENTAGE"].some(k => kinds.has(k)))
      return undefined;
    return { keywords, kinds };
  };
  // A value of these that is one identifier has to be one of the keywords.
  const tokenKeywords: Record<string, string> = {
    cursor: (properties.cursor.values ?? []).map((v: any) => (typeof v === "string" ? v : v.value)).join(" "),
    content: "normal none open-quote close-quote no-open-quote no-close-quote",
  };
  const syntax = (n: string): Syntax => {
    if (n === "all") return { kind: "All" };
    if (expanded.has(n)) return { kind: "Expanded" };
    if (noTypeAfterAll.has(n)) return { kind: "Verbatim" };
    if (n in manual) {
      assert(!hasType(n), `${n} has a type now: take it out of \`manual\``);
      return { kind: "Simple", keywords: words(manual[n][0]), kinds: new Set(manual[n][1]) };
    }
    if (hasType(n))
      return {
        kind:
          !notVerbatim.has(n) && (verbatim.has(n) || verbatimPrefixes.some(p => n.startsWith(p)))
            ? "TypedVerbatim"
            : "Typed",
      };
    const simple = simpleSyntax(n);
    if (simple && !tokens.has(n)) return { kind: "Simple", ...simple };
    if (tokens.has(n)) return { kind: "Tokens", keywords: tokenKeywords[n] ?? "" };
    return { kind: "Verbatim" };
  };

  // ---- Output
  const enumerator = (n: string) =>
    n
      .split("-")
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join("");
  const cppName = (n: string) => "CSSPropertyID::" + enumerator(n);
  const rustName = (n: string) =>
    n
      .replace(/^-+|-+$/g, "")
      .replaceAll("-", "_")
      .toUpperCase();
  const heading =
    "Generated by src/codegen/webcore/css-properties.ts from WebKit's CSSProperties.json. Do not edit: change the script and run it again.\n";

  const nameBlob = new Blob();
  const initialBlob = new Blob();
  const nameOffsets = ordered.map(n => nameBlob.add(n));
  const entries: [string, number][] = [
    ...ordered.map((n): [string, number] => [n, id.get(n)!]),
    ...[...aliases]
      .map(([alias, target]): [string, number] => [alias, id.get(target)!])
      .sort(([a], [b]) => compare(a, b)),
  ];
  const entryOffsets = entries.map(([n]) => nameBlob.add(n));
  const tableSize = 2048;
  assert(entries.length * 2 < tableSize, "the table of names is too small");
  const table: number[] = new Array(tableSize).fill(0);
  entries.forEach(([n], i) => {
    let slot = fnv1a(n) & (tableSize - 1);
    while (table[slot]) slot = (slot + 1) & (tableSize - 1);
    table[slot] = i + 1;
  });
  const initialOffsets = longhandNames.map(n => initialBlob.add(initial(n)));
  assert(nameBlob.size < 65536 && initialBlob.size < 65536, "an offset does not fit in 16 bits");

  const flags = (n: string) =>
    [
      isInherited(n) && "Inherited",
      isColor(n) && "Color",
      initialIsCurrentColor(n) && !shorthands.has(n) && n !== "all" && "InitialIsCurrentColor",
    ]
      .filter(Boolean)
      .join(" | ") || "0";

  const longhandLists: string[] = [];
  const shorthandRows: string[] = [];
  for (const s of shorthandNames) {
    const { pattern, longhands } = shorthands.get(s) ?? { pattern: "AsSet", longhands: [] };
    shorthandRows.push(`{ ${longhandLists.length}, ${longhands.length}, ShorthandPattern::${pattern} }`);
    longhandLists.push(...longhands.map(cppName));
  }
  // longhand -> the shorthands it belongs to, the one with the most longhands first
  const containing = new Map<string, string[]>();
  for (const [s, { longhands }] of shorthands)
    for (const l of longhands) containing.set(l, [...(containing.get(l) ?? []), s]);
  const containingLists: string[] = [];
  const containingRows: string[] = [];
  for (const l of longhandNames) {
    const list = [...(containing.get(l) ?? [])].sort(
      (a, b) => shorthands.get(b)!.longhands.length - shorthands.get(a)!.longhands.length || id.get(a)! - id.get(b)!,
    );
    containingRows.push(`{ ${containingLists.length}, ${list.length} }`);
    containingLists.push(...list.map(cppName));
  }
  const longestName = Math.max(...entries.map(([n]) => n.length));
  const lastLonghand = first + longhandNames.length - 1;
  const last = first + ordered.length - 1;

  const header = `// ${heading}
#pragma once

#include <span>
#include <utility>
#include <wtf/Forward.h>
#include <wtf/text/ASCIILiteral.h>

namespace WebCore {

enum class CSSPropertyID : uint16_t {
    Invalid = 0,
    Custom = 1,
${ordered.map(n => `    ${enumerator(n)} = ${id.get(n)},\n`).join("")}};

// Longhands come first, in the order getComputedStyle() lists them. A shorthand that Bun's CSS parser cannot expand counts as a longhand.
constexpr uint16_t firstCSSProperty = ${first};
constexpr uint16_t lastCSSProperty = ${last};
constexpr uint16_t numCSSProperties = ${ordered.length};
constexpr uint16_t firstLonghandProperty = ${first};
constexpr uint16_t lastLonghandProperty = ${lastLonghand};
constexpr uint16_t numLonghandProperties = ${longhandNames.length};
constexpr uint16_t firstShorthandProperty = ${lastLonghand + 1};
constexpr uint16_t lastShorthandProperty = ${last};
constexpr unsigned maxCSSPropertyNameLength = ${longestName};
// Names and aliases, which is what CSSStyleProperties has attributes for.
constexpr unsigned numCSSPropertyNames = ${entries.length};

constexpr bool isLonghand(CSSPropertyID id) { return std::to_underlying(id) >= firstLonghandProperty && std::to_underlying(id) <= lastLonghandProperty; }
constexpr bool isShorthand(CSSPropertyID id) { return std::to_underlying(id) >= firstShorthandProperty && std::to_underlying(id) <= lastShorthandProperty; }

// How a shorthand is put together again from longhands that were not all set by one declaration of it.
enum class ShorthandPattern : uint8_t {
    AsSet, // It cannot be.
    Quad,
    Pair,
    OmitInitial,
    AllValues,
    Border,
    BorderAxis,
    BorderRadius,
    Background,
    GridLines,
};

// \`name\` has to be in lower case.
CSSPropertyID findCSSProperty(std::span<const Latin1Character> name);
// Takes any case. CSSPropertyID::Invalid for a custom property name.
CSSPropertyID cssPropertyID(StringView);
bool isCustomPropertyName(StringView);

ASCIILiteral nameLiteral(CSSPropertyID);
String nameString(CSSPropertyID);
// The nth name or alias, and the property it stands for.
ASCIILiteral cssPropertyNameAt(unsigned index, CSSPropertyID&);

bool isInheritedProperty(CSSPropertyID);
// The computed value is a color: never a keyword other than the ones that are not colors.
bool isColorProperty(CSSPropertyID);
bool initialValueIsCurrentColor(CSSPropertyID);
// The computed value an element has when nothing is declared, as browsers serialize it.
ASCIILiteral initialValueTextForLonghand(CSSPropertyID);

std::span<const CSSPropertyID> longhandsForShorthand(CSSPropertyID);
ShorthandPattern patternForShorthand(CSSPropertyID);
// The one with the most longhands first.
std::span<const CSSPropertyID> matchingShorthandsForLonghand(CSSPropertyID);

} // namespace WebCore
`;

  const implementation = `// ${heading}
#include "config.h"
#include "CSSPropertyNames.h"

#include <array>
#include <wtf/text/StringView.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

// One block of text and offsets into it, so that the tables need no relocations.
static constexpr char propertyNames[] =
${nameBlob.toCpp()};

static_assert(sizeof(propertyNames) == ${nameBlob.size + 1});

// Every offset is where an entry of the block begins, and the entry has the length the table says.
template<size_t size> constexpr bool isStartOfEntry(const char (&block)[size], size_t offset)
{
    return offset < size - 1 && (!offset || !block[offset - 1]);
}

template<size_t size> constexpr bool isEntry(const char (&block)[size], size_t offset, size_t length)
{
    if (!isStartOfEntry(block, offset) || offset + length >= size || block[offset + length])
        return false;
    for (size_t i = 0; i < length; ++i) {
        if (!block[offset + i])
            return false;
    }
    return true;
}

static constexpr uint16_t propertyNameOffsets[numCSSProperties] = {
${rows(nameOffsets)}
};

static constexpr uint8_t propertyNameLengths[numCSSProperties] = {
${rows(
  ordered.map(n => n.length),
  24,
)}
};

struct PropertyNameEntry {
    uint16_t offset;
    uint16_t id;
    uint8_t length;
};

static constexpr PropertyNameEntry propertyNameEntries[numCSSPropertyNames] = {
${rows(
  entries.map(([n, i], index) => `{ ${entryOffsets[index]}, ${i}, ${n.length} }`),
  6,
)}
};

static_assert([] {
    for (unsigned i = 0; i < numCSSProperties; ++i) {
        if (!isEntry(propertyNames, propertyNameOffsets[i], propertyNameLengths[i]))
            return false;
    }
    for (auto& entry : propertyNameEntries) {
        if (!isEntry(propertyNames, entry.offset, entry.length))
            return false;
    }
    return true;
}());

// Open addressing with linear probing, keyed by FNV-1a of the name. 0 is empty, otherwise 1 + the index of the entry.
static constexpr unsigned propertyNameTableSize = ${tableSize};
static constexpr uint16_t propertyNameTable[propertyNameTableSize] = {
${rows(table, 24)}
};

enum PropertyFlag : uint8_t {
    Inherited = 1 << 0,
    Color = 1 << 1,
    InitialIsCurrentColor = 1 << 2,
};

static constexpr uint8_t propertyFlags[numCSSProperties] = {
${rows(ordered.map(flags), 8)}
};

static constexpr char initialValues[] =
${initialBlob.toCpp()};

static constexpr uint16_t initialValueOffsets[numLonghandProperties] = {
${rows(initialOffsets)}
};

static_assert(sizeof(initialValues) == ${initialBlob.size + 1});
static_assert([] {
    for (auto offset : initialValueOffsets) {
        if (!isStartOfEntry(initialValues, offset))
            return false;
    }
    return true;
}());

static constexpr CSSPropertyID shorthandLonghands[] = {
${rows(longhandLists, 4)}
};

struct ShorthandEntry {
    uint16_t first;
    uint8_t count;
    ShorthandPattern pattern;
};

static constexpr ShorthandEntry shorthands[lastShorthandProperty - firstShorthandProperty + 1] = {
${rows(shorthandRows, 4)}
};

static constexpr CSSPropertyID containingShorthands[] = {
${rows(containingLists, 4)}
};

struct ContainingShorthandsEntry {
    uint16_t first;
    uint8_t count;
};

static constexpr ContainingShorthandsEntry containingShorthandEntries[numLonghandProperties] = {
${rows(containingRows, 10)}
};

CSSPropertyID findCSSProperty(std::span<const Latin1Character> name)
{
    if (name.empty() || name.size() > maxCSSPropertyNameLength)
        return CSSPropertyID::Invalid;

    uint32_t hash = 2166136261u;
    for (auto character : name)
        hash = (hash ^ character) * 16777619u;

    for (unsigned slot = hash & (propertyNameTableSize - 1); propertyNameTable[slot]; slot = (slot + 1) & (propertyNameTableSize - 1)) {
        auto& entry = propertyNameEntries[propertyNameTable[slot] - 1];
        if (entry.length == name.size() && !memcmp(propertyNames + entry.offset, name.data(), name.size()))
            return static_cast<CSSPropertyID>(entry.id);
    }
    return CSSPropertyID::Invalid;
}

CSSPropertyID cssPropertyID(StringView string)
{
    unsigned length = string.length();
    if (!length || length > maxCSSPropertyNameLength)
        return CSSPropertyID::Invalid;

    std::array<Latin1Character, maxCSSPropertyNameLength> buffer;
    for (unsigned i = 0; i < length; ++i) {
        char16_t character = string[i];
        if (!character || !isASCII(character))
            return CSSPropertyID::Invalid;
        buffer[i] = toASCIILower(static_cast<Latin1Character>(character));
    }
    return findCSSProperty(std::span { buffer }.first(length));
}

bool isCustomPropertyName(StringView name)
{
    return name.length() > 2 && name[0] == '-' && name[1] == '-';
}

ASCIILiteral nameLiteral(CSSPropertyID id)
{
    if (std::to_underlying(id) < firstCSSProperty || std::to_underlying(id) > lastCSSProperty)
        return { };
    unsigned index = std::to_underlying(id) - firstCSSProperty;
    return ASCIILiteral::fromLiteralUnsafe(propertyNames + propertyNameOffsets[index]);
}

String nameString(CSSPropertyID id)
{
    return nameLiteral(id);
}

ASCIILiteral cssPropertyNameAt(unsigned index, CSSPropertyID& id)
{
    RELEASE_ASSERT(index < numCSSPropertyNames);
    auto& entry = propertyNameEntries[index];
    id = static_cast<CSSPropertyID>(entry.id);
    return ASCIILiteral::fromLiteralUnsafe(propertyNames + entry.offset);
}

static bool hasFlag(CSSPropertyID id, PropertyFlag flag)
{
    auto number = std::to_underlying(id);
    return number >= firstCSSProperty && number <= lastCSSProperty && (propertyFlags[number - firstCSSProperty] & flag);
}

bool isInheritedProperty(CSSPropertyID id)
{
    return id == CSSPropertyID::Custom || hasFlag(id, Inherited);
}

bool isColorProperty(CSSPropertyID id)
{
    return hasFlag(id, Color);
}

bool initialValueIsCurrentColor(CSSPropertyID id)
{
    return hasFlag(id, InitialIsCurrentColor);
}

ASCIILiteral initialValueTextForLonghand(CSSPropertyID id)
{
    if (!isLonghand(id))
        return ""_s;
    return ASCIILiteral::fromLiteralUnsafe(initialValues + initialValueOffsets[std::to_underlying(id) - firstLonghandProperty]);
}

std::span<const CSSPropertyID> longhandsForShorthand(CSSPropertyID id)
{
    if (!isShorthand(id))
        return { };
    auto& entry = shorthands[std::to_underlying(id) - firstShorthandProperty];
    return std::span { shorthandLonghands }.subspan(entry.first, entry.count);
}

ShorthandPattern patternForShorthand(CSSPropertyID id)
{
    if (!isShorthand(id))
        return ShorthandPattern::AsSet;
    return shorthands[std::to_underlying(id) - firstShorthandProperty].pattern;
}

std::span<const CSSPropertyID> matchingShorthandsForLonghand(CSSPropertyID id)
{
    if (!isLonghand(id))
        return { };
    auto& entry = containingShorthandEntries[std::to_underlying(id) - firstLonghandProperty];
    return std::span { containingShorthands }.subspan(entry.first, entry.count);
}

} // namespace WebCore
`;

  const rustSyntax = (n: string) => {
    const s = syntax(n);
    if (s.kind === "Tokens") return `Syntax::Tokens { keywords: b"${s.keywords}" }`;
    if (s.kind !== "Simple") return `Syntax::${s.kind}`;
    const kinds =
      kindNames
        .filter(k => s.kinds.has(k))
        .map(k => `kind::${k}`)
        .join(" | ") || "0";
    return `Syntax::Simple { keywords: b"${s.keywords.join(" ")}", kinds: ${kinds} }`;
  };
  const rustFlags = (n: string) =>
    [nonNegative.has(n) && "flag::NON_NEGATIVE", noAuto.has(n) && "flag::NO_AUTO"].filter(Boolean).join(" | ") || "0";
  const rustLonghands = (n: string) =>
    `&[${(shorthands.get(n)?.longhands ?? []).map(l => `id::${rustName(l)}`).join(", ")}]`;
  assert(new Set(ordered.map(rustName)).size === ordered.length, "two properties get the same Rust name");

  const rust = `//! ${heading}
//! The numbers are those of \`CSSPropertyID\` in \`src/jsc/bindings/webcore/css/CSSPropertyNames.h\`, which the same script writes.

/// How the value of a property is checked and written back.
#[derive(Clone, Copy)]
pub(crate) enum Syntax {
    /// \`Property::parse\` has a type for it. The value is printed from that.
    Typed,
    /// \`Property::parse\` has a type for it. The value stays as it was written.
    TypedVerbatim,
    /// One component: one of \`keywords\` (separated by spaces), or one of \`kinds\`.
    Simple { keywords: &'static [u8], kinds: u8 },
    /// Any tokens, printed from the token list. If \`keywords\` is not empty, a value that is one identifier has to be one of them.
    Tokens { keywords: &'static [u8] },
    /// Any tokens. The value stays as it was written.
    Verbatim,
    /// A shorthand without a type in Bun's parser, taken apart in \`declarations.rs\`. The value stays as it was written.
    Expanded,
    /// \`all\`, which only takes the CSS-wide keywords.
    All,
}

pub(crate) mod kind {
    pub(crate) const COLOR: u8 = 1 << 0;
    pub(crate) const LENGTH: u8 = 1 << 1;
    pub(crate) const PERCENTAGE: u8 = 1 << 2;
    pub(crate) const NUMBER: u8 = 1 << 3;
    pub(crate) const INTEGER: u8 = 1 << 4;
    pub(crate) const NON_NEGATIVE: u8 = 1 << 5;
    /// The grammar has more than this says: what does not fit is kept as it was written.
    pub(crate) const LENIENT: u8 = 1 << 6;
}

pub(crate) mod flag {
    /// The type Bun's parser uses takes negative numbers, the property does not.
    pub(crate) const NON_NEGATIVE: u8 = 1 << 0;
    /// The type Bun's parser uses takes \`auto\`, the property does not.
    pub(crate) const NO_AUTO: u8 = 1 << 1;
}

pub(crate) struct PropertyInfo {
    pub(crate) name: &'static [u8],
    pub(crate) syntax: Syntax,
    pub(crate) flags: u8,
    /// \`Typed\`, \`TypedVerbatim\`: keywords (separated by spaces) that are a value of the property and that the type does not know.
    pub(crate) extra_keywords: &'static [u8],
    /// Empty unless the property is a shorthand.
    pub(crate) longhands: &'static [u16],
}

pub(crate) const CUSTOM: u16 = 1;
pub(crate) const FIRST: u16 = ${first};
pub(crate) const COUNT: usize = ${ordered.length};

pub(crate) fn info(property: u16) -> Option<&'static PropertyInfo> {
    PROPERTIES.get(usize::from(property.checked_sub(FIRST)?))
}

/// The property a name or an alias stands for, in any case.
pub(crate) fn find(name: &[u8]) -> Option<u16> {
    NAMES.get_ascii_case_insensitive(name).copied()
}

pub(crate) mod id {
    #![allow(dead_code)]

${ordered.map(n => `    pub(crate) const ${rustName(n)}: u16 = ${id.get(n)};\n`).join("")}}

static PROPERTIES: [PropertyInfo; COUNT] = [
${ordered.map(n => `    PropertyInfo { name: b"${n}", syntax: ${rustSyntax(n)}, flags: ${rustFlags(n)}, extra_keywords: b"${extraKeywords[n] ?? ""}", longhands: ${rustLonghands(n)} },\n`).join("")}];

bun_core::comptime_string_map! {
    static NAMES: u16 = {
${entries.map(([n, i]) => `        b"${n}" => ${i},\n`).join("")}    };
}
`;

  return new Map([
    ["src/jsc/bindings/webcore/css/CSSPropertyNames.h", header],
    ["src/jsc/bindings/webcore/css/CSSPropertyNames.cpp", implementation],
    ["src/css/dom/properties.rs", rust],
  ]);
}
