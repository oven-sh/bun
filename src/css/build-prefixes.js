/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// const { execSync } = require("child_process");
const prefixes = require("autoprefixer/data/prefixes");
// Read the caniuse-lite copy that autoprefixer built `prefixes` from. Another copy lists other versions.
const requireFromAutoprefixer = require("module").createRequire(require.resolve("autoprefixer/data/prefixes"));
const caniuse = requireFromAutoprefixer("caniuse-lite");
const browsers = caniuse.agents;
const unpack = caniuse.feature;
const features = caniuse.features;
const mdn = require("@mdn/browser-compat-data");
const fs = require("fs");

const dataVersions = [
  `autoprefixer ${require("autoprefixer/package.json").version}`,
  `caniuse-lite ${requireFromAutoprefixer("caniuse-lite/package.json").version}`,
  `@mdn/browser-compat-data ${mdn.__meta.version}`,
].join(", ");

const BROWSER_MAPPING = {
  and_chr: "chrome",
  and_ff: "firefox",
  ie_mob: "ie",
  op_mob: "opera",
  and_qq: null,
  and_uc: null,
  baidu: null,
  bb: null,
  kaios: null,
  op_mini: null,
  oculus: null,
};

const MDN_BROWSER_MAPPING = {
  chrome_android: "chrome",
  firefox_android: "firefox",
  opera_android: "opera",
  safari_ios: "ios_saf",
  webview_ios: "ios_saf",
  samsunginternet_android: "samsung",
  webview_android: "android",
  oculus: null,
};

// The numbered versions that caniuse lists for each browser, oldest first.
const listed = {};
for (let b in browsers) {
  listed[b] = browsers[b].versions.filter(v => v != null && v != "all" && v != "TP");
}

// Caniuse data for clip-path is incorrect.
// https://github.com/Fyrd/caniuse/issues/6209
prefixes["clip-path"].browsers = prefixes["clip-path"].browsers.filter(b => {
  let [name, version] = b.split(" ");
  return !(
    (name === "safari" && parseVersion(version) >= ((9 << 16) | (1 << 8))) ||
    (name === "ios_saf" && parseVersion(version) >= ((9 << 16) | (3 << 8)))
  );
});

// MDN has both ends of `:-webkit-any()` and `:-moz-any()`: the first version with it, and the first with `:is()`.
const anyPseudoUntil = {};
prefixes["any-pseudo"] = {
  browsers: Object.entries(mdn.css.selectors.is.__compat.support).flatMap(([key, value]) => {
    if (Array.isArray(value)) {
      key = MDN_BROWSER_MAPPING[key] || key;
      let any = value.find(v => v.alternative_name?.includes("-any"))?.version_added;
      let supported = value.find(x => x.version_added && !x.alternative_name)?.version_added;
      if (any && supported) {
        anyPseudoUntil[key] = Math.max(anyPseudoUntil[key] ?? 0, parseVersion(supported));
        return [`${key} ${any}`];
      }
    }

    return [];
  }),
  until: anyPseudoUntil,
};

// caniuse no longer marks `background-clip: text` as prefixed in Safari. MDN has the version that dropped the prefix.
const backgroundClipText = mdn.css.properties["background-clip"].text.__compat.support;
prefixes["background-clip"].browsers.push("ios_saf 4");
prefixes["background-clip"].until = {
  safari: parseVersion(backgroundClipText.safari.find(v => v.version_removed).version_removed),
  ios_saf: parseVersion(backgroundClipText.safari_ios.find(v => v.version_removed).version_removed),
};

let flexSpec = {};
let oldGradient = {};
let p = new Map();
for (let prop in prefixes) {
  let browserMap = {};
  for (let b of prefixes[prop].browsers) {
    let [name, version, variant] = b.split(" ");
    if (BROWSER_MAPPING[name] === null) {
      continue;
    }
    let prefix = browsers[name].prefix_exceptions?.[version] || browsers[name].prefix;

    // https://github.com/postcss/autoprefixer/blob/main/lib/hacks/backdrop-filter.js#L11
    if (prefix === "ms" && prop === "backdrop-filter") {
      prefix = "webkit";
    }

    let origName = name;
    name = BROWSER_MAPPING[name] || name;
    let v = parseVersion(version);
    if (v == null) {
      console.log("BAD VERSION", prop, name, version);
      continue;
    }
    let until = prefixes[prop].until?.[name];
    if (until == null && !listed[origName].includes(version)) {
      throw new Error(
        `build-prefixes.js: "${origName} ${version}" in the ${prop} list is not a version that caniuse-lite lists. Give prefixes["${prop}"].until an entry for ${name}.`,
      );
    }
    browserMap[name] ??= {};
    if (browserMap[name][prefix] == null) {
      let single = prefixes[prop].browsers.filter(b => b.startsWith(origName) || b.startsWith(name)).length === 1;
      browserMap[name][prefix] = newRange(single && until == null ? null : v);
    }
    addVersion(browserMap[name][prefix], origName, version);

    if (variant === "2009") {
      addVersion((flexSpec[name] ??= newRange(v)), origName, version);
    } else if (variant === "old" && prop.includes("gradient")) {
      addVersion((oldGradient[name] ??= newRange(v)), origName, version);
    }
  }
  for (let name in browserMap) {
    for (let prefix in browserMap[name]) {
      browserMap[name][prefix] = finishRange(name, browserMap[name][prefix], prefixes[prop].until?.[name]);
    }
  }
  addValue(p, browserMap, prop);
}
for (let name in flexSpec) {
  flexSpec[name] = finishRange(name, flexSpec[name]);
}
for (let name in oldGradient) {
  oldGradient[name] = finishRange(name, oldGradient[name]);
}

// `from` is null when the range has no lower bound. `newest` is, per caniuse browser, the index in `listed` of its newest version.
function newRange(from) {
  return { from, to: 0, plain: true, newest: {} };
}

function addVersion(range, origName, version) {
  let v = parseVersion(version);
  if (range.from != null && v < range.from) {
    range.from = v;
  }
  range.to = Math.max(range.to, v);
  range.plain &&= !version.includes("-");
  range.newest[origName] = Math.max(range.newest[origName] ?? -1, listed[origName].indexOf(version));
}

// Bun targets name exact versions. A range ends before the next version caniuse lists, so it covers "15.2-15.3" and patch releases.
function rangeEnd(name, range) {
  let end = 0;
  for (let origName in range.newest) {
    let versions = listed[origName];
    let newest = versions[range.newest[origName]];
    let next = versions[range.newest[origName] + 1];
    if (next != null && origName !== name) {
      // and_chr, and_ff, op_mob and ie_mob list few versions: take the next version of the browser they count as.
      next = listed[name].find(version => parseVersion(version) > parseVersion(newest));
    }
    if (next == null) {
      return null;
    }
    end = Math.max(end, parseVersion(next));
  }
  // caniuse lists Android up to 4.4.4, then only the newest WebView (Chrome's version, 37 or later): end after the last entry.
  if (name === "android" && end >= 37 << 16) {
    return range.to + 1;
  }
  return end;
}

function finishRange(name, range, until) {
  if (until != null) {
    return { from: range.from, until, exact: false };
  }
  until = rangeEnd(name, range);
  // A range of one plain version keeps its equality test: two comparisons make the flex arm too large to inline.
  return { from: range.from, until, exact: until != null && range.from === range.to && range.plain };
}

function addValue(map, value, prop) {
  let s = JSON.stringify(value);
  let found = false;
  for (let [key, val] of map) {
    if (JSON.stringify(val) === s) {
      key.push(prop);
      found = true;
      break;
    }
  }
  if (!found) {
    map.set([prop], value);
  }
}

let cssFeatures = [
  "css-sel2",
  "css-sel3",
  "css-gencontent",
  "css-first-letter",
  "css-first-line",
  "css-in-out-of-range",
  "form-validation",
  "css-any-link",
  "css-default-pseudo",
  "css-dir-pseudo",
  "css-focus-within",
  "css-focus-visible",
  "css-indeterminate-pseudo",
  "css-matches-pseudo",
  "css-optional-pseudo",
  "css-placeholder-shown",
  "dialog",
  "fullscreen",
  "css-marker-pseudo",
  "css-placeholder",
  "css-selection",
  "css-case-insensitive",
  "css-read-only-write",
  "css-autofill",
  "css-namespaces",
  "shadowdomv1",
  "css-rrggbbaa",
  "css-nesting",
  "css-not-sel-list",
  "css-has",
  "font-family-system-ui",
  "extended-system-fonts",
  "calc",
];

let cssFeatureMappings = {
  "css-dir-pseudo": "DirSelector",
  "css-rrggbbaa": "HexAlphaColors",
  "css-not-sel-list": "NotSelectorList",
  "css-has": "HasSelector",
  "css-matches-pseudo": "IsSelector",
  "css-sel2": "Selectors2",
  "css-sel3": "Selectors3",
  "calc": "CalcFunction",
};

let cssFeatureOverrides = {
  // Safari supports the ::marker pseudo element, but only supports styling some properties.
  // However this does not break using the selector itself, so ignore for our purposes.
  // https://bugs.webkit.org/show_bug.cgi?id=204163
  // https://github.com/parcel-bundler/lightningcss/issues/508
  "css-marker-pseudo": {
    safari: {
      "y #1": "y",
    },
  },
};

let compat = new Map();
for (let feature of cssFeatures) {
  let data = unpack(features[feature]);
  let overrides = cssFeatureOverrides[feature];
  let browserMap = {};
  for (let name in data.stats) {
    if (BROWSER_MAPPING[name] === null) {
      continue;
    }

    name = BROWSER_MAPPING[name] || name;
    let browserOverrides = overrides?.[name];
    for (let version in data.stats[name]) {
      let value = data.stats[name][version];
      value = browserOverrides?.[value] || value;
      if (value === "y") {
        let v = parseVersion(version);
        if (v == null) {
          console.log("BAD VERSION", feature, name, version);
          continue;
        }

        if (browserMap[name] == null || v < browserMap[name]) {
          browserMap[name] = v;
        }
      }
    }
  }

  let name = (cssFeatureMappings[feature] || feature).replace(/^css-/, "");
  addValue(compat, browserMap, name);
}

// No browser supports custom media queries yet.
addValue(compat, {}, "custom-media-queries");

let mdnFeatures = {
  doublePositionGradients: mdn.css.types.gradient["radial-gradient"].doubleposition.__compat.support,
  clampFunction: mdn.css.types.clamp.__compat.support,
  placeSelf: mdn.css.properties["place-self"].__compat.support,
  placeContent: mdn.css.properties["place-content"].__compat.support,
  placeItems: mdn.css.properties["place-items"].__compat.support,
  overflowShorthand: mdn.css.properties["overflow"].multiple_keywords.__compat.support,
  mediaRangeSyntax: mdn.css["at-rules"].media.range_syntax.__compat.support,
  mediaIntervalSyntax: Object.fromEntries(
    Object.entries(mdn.css["at-rules"].media.range_syntax.__compat.support).map(([browser, value]) => {
      // Firefox supported only ranges and not intervals for a while.
      if (Array.isArray(value)) {
        value = value.filter(v => !v.partial_implementation);
      } else if (value.partial_implementation) {
        value = undefined;
      }

      return [browser, value];
    }),
  ),
  logicalBorders: mdn.css.properties["border-inline-start"].__compat.support,
  logicalBorderShorthand: mdn.css.properties["border-inline"].__compat.support,
  logicalBorderRadius: mdn.css.properties["border-start-start-radius"].__compat.support,
  logicalMargin: mdn.css.properties["margin-inline-start"].__compat.support,
  logicalMarginShorthand: mdn.css.properties["margin-inline"].__compat.support,
  logicalPadding: mdn.css.properties["padding-inline-start"].__compat.support,
  logicalPaddingShorthand: mdn.css.properties["padding-inline"].__compat.support,
  logicalInset: mdn.css.properties["inset-inline-start"].__compat.support,
  logicalSize: mdn.css.properties["inline-size"].__compat.support,
  logicalTextAlign: mdn.css.properties["text-align"].start.__compat.support,
  labColors: mdn.css.types.color.lab.__compat.support,
  oklabColors: mdn.css.types.color.oklab.__compat.support,
  colorFunction: mdn.css.types.color.color.__compat.support,
  spaceSeparatedColorNotation: mdn.css.types.color.rgb.space_separated_parameters.__compat.support,
  textDecorationThicknessPercent: mdn.css.properties["text-decoration-thickness"].percentage.__compat.support,
  textDecorationThicknessShorthand: mdn.css.properties["text-decoration"].includes_thickness.__compat.support,
  cue: mdn.css.selectors.cue.__compat.support,
  cueFunction: mdn.css.selectors.cue.selector_argument.__compat.support,
  anyPseudo: Object.fromEntries(
    Object.entries(mdn.css.selectors.is.__compat.support).map(([key, value]) => {
      if (Array.isArray(value)) {
        value = value.filter(v => v.alternative_name?.includes("-any")).map(({ alternative_name, ...other }) => other);
      }

      if (value && value.length) {
        return [key, value];
      } else {
        return [key, { version_added: false }];
      }
    }),
  ),
  partPseudo: mdn.css.selectors.part.__compat.support,
  imageSet: mdn.css.types.image["image-set"].__compat.support,
  xResolutionUnit: mdn.css.types.resolution.x.__compat.support,
  nthChildOf: mdn.css.selectors["nth-child"].of_syntax.__compat.support,
  minFunction: mdn.css.types.min.__compat.support,
  maxFunction: mdn.css.types.max.__compat.support,
  roundFunction: mdn.css.types.round.__compat.support,
  remFunction: mdn.css.types.rem.__compat.support,
  modFunction: mdn.css.types.mod.__compat.support,
  absFunction: mdn.css.types.abs.__compat.support,
  signFunction: mdn.css.types.sign.__compat.support,
  hypotFunction: mdn.css.types.hypot.__compat.support,
  gradientInterpolationHints: mdn.css.types.gradient["linear-gradient"].interpolation_hints.__compat.support,
  borderImageRepeatRound: mdn.css.properties["border-image-repeat"].round.__compat.support,
  borderImageRepeatSpace: mdn.css.properties["border-image-repeat"].space.__compat.support,
  fontSizeRem: mdn.css.properties["font-size"].rem_values.__compat.support,
  fontSizeXXXLarge: mdn.css.properties["font-size"]["xxx-large"].__compat.support,
  fontStyleObliqueAngle: mdn.css.properties["font-style"]["oblique-angle"].__compat.support,
  fontWeightNumber: mdn.css.properties["font-weight"].number.__compat.support,
  fontStretchPercentage: mdn.css.properties["font-stretch"].percentage.__compat.support,
  lightDark: mdn.css.types.color["light-dark"].__compat.support,
  accentSystemColor: mdn.css.types.color["system-color"].accentcolor_accentcolortext.__compat.support,
  animationTimelineShorthand: mdn.css.properties.animation["animation-timeline_included"].__compat.support,
};

for (let key in mdn.css.types.length) {
  if (key === "__compat") {
    continue;
  }

  let feat = key.includes("_") ? key.replace(/_([a-z])/g, (_, l) => l.toUpperCase()) : key + "Unit";

  mdnFeatures[feat] = mdn.css.types.length[key].__compat.support;
}

for (let key in mdn.css.types.gradient) {
  if (key === "__compat") {
    continue;
  }

  let feat = key.replace(/-([a-z])/g, (_, l) => l.toUpperCase());
  mdnFeatures[feat] = mdn.css.types.gradient[key].__compat.support;
}

const nonStandardListStyleType = new Set([
  // https://developer.mozilla.org/en-US/docs/Web/CSS/list-style-type#non-standard_extensions
  "ethiopic-halehame",
  "ethiopic-halehame-am",
  "ethiopic-halehame-ti-er",
  "ethiopic-halehame-ti-et",
  "hangul",
  "hangul-consonant",
  "urdu",
  "cjk-ideographic",
  // https://github.com/w3c/csswg-drafts/issues/135
  "upper-greek",
]);

for (let key in mdn.css.properties["list-style-type"]) {
  if (
    key === "__compat" ||
    nonStandardListStyleType.has(key) ||
    mdn.css.properties["list-style-type"][key].__compat.support.chrome.version_removed
  ) {
    continue;
  }

  let feat = key[0].toUpperCase() + key.slice(1).replace(/-([a-z])/g, (_, l) => l.toUpperCase()) + "ListStyleType";
  mdnFeatures[feat] = mdn.css.properties["list-style-type"][key].__compat.support;
}

for (let key in mdn.css.properties["width"]) {
  if (key === "__compat" || key === "is_animatable") {
    continue;
  }

  let feat = key[0].toUpperCase() + key.slice(1).replace(/[-_]([a-z])/g, (_, l) => l.toUpperCase()) + "Size";
  mdnFeatures[feat] = mdn.css.properties["width"][key].__compat.support;
}

Object.entries(mdn.css.properties.width.stretch.__compat.support)
  .filter(([, v]) => v.alternative_name)
  .forEach(([k, v]) => {
    let name = v.alternative_name.slice(1).replace(/[-_]([a-z])/g, (_, l) => l.toUpperCase()) + "Size";
    mdnFeatures[name] ??= {};
    mdnFeatures[name][k] = { version_added: v.version_added };
  });

for (let feature in mdnFeatures) {
  let browserMap = {};
  for (let name in mdnFeatures[feature]) {
    if (MDN_BROWSER_MAPPING[name] === null) {
      continue;
    }

    let feat = mdnFeatures[feature][name];
    let version;
    if (Array.isArray(feat)) {
      version = feat
        .filter(x => x.version_added && !x.alternative_name && !x.flags)
        .sort((a, b) => (parseVersion(a.version_added) < parseVersion(b.version_added) ? -1 : 1))[0].version_added;
    } else if (!feat.alternative_name && !feat.flags) {
      version = feat.version_added;
    }

    if (!version) {
      continue;
    }

    let v = parseVersion(version);
    if (v == null) {
      console.log("BAD VERSION", feature, name, version);
      continue;
    }

    name = MDN_BROWSER_MAPPING[name] || name;
    browserMap[name] = v;
  }

  addValue(compat, browserMap, feature);
}

addValue(
  compat,
  {
    safari: parseVersion("10.1"),
    ios_saf: parseVersion("10.3"),
  },
  "p3Colors",
);

addValue(
  compat,
  {
    // https://github.com/WebKit/WebKit/commit/baed0d8b0abf366e1d9a6105dc378c59a5f21575
    safari: parseVersion("10.1"),
    ios_saf: parseVersion("10.3"),
  },
  "LangSelectorList",
);

const allBrowsers = ["android", "chrome", "edge", "firefox", "ie", "ios_saf", "opera", "safari", "samsung"];

let flags = [
  "nesting",
  "not_selector_list",
  "dir_selector",
  "lang_selector_list",
  "is_selector",
  "text_decoration_thickness_percent",
  "media_interval_syntax",
  "media_range_syntax",
  "custom_media_queries",
  "clamp_function",
  "color_function",
  "oklab_colors",
  "lab_colors",
  "p3_colors",
  "hex_alpha_colors",
  "space_separated_color_notation",
  "font_family_system_ui",
  "double_position_gradients",
  "vendor_prefixes",
  "logical_properties",
  ["selectors", ["nesting", "not_selector_list", "dir_selector", "lang_selector_list", "is_selector"]],
  ["media_queries", ["media_interval_syntax", "media_range_syntax", "custom_media_queries"]],
  [
    "colors",
    ["color_function", "oklab_colors", "lab_colors", "p3_colors", "hex_alpha_colors", "space_separated_color_notation"],
  ],
];

// ──────────────────────────────────────────────────────────────────────────
// Rust emission
// ──────────────────────────────────────────────────────────────────────────

// snake_case → PascalCase for enum variants.
function pascal(s) {
  return s.replace(/(?:^|[-_])([a-z0-9])/gi, (_, c) => c.toUpperCase());
}

// CSS property name → Rust enum variant.
let enumify = f =>
  pascal(
    f
      .replace(/^@([a-z])/, (_, x) => "At_" + x)
      .replace(/^::([a-z])/, (_, x) => "PseudoElement_" + x)
      .replace(/^:([a-z])/, (_, x) => "PseudoClass_" + x)
      .replace(/(^|-)([a-z])/g, (_, a, x) => (a === "-" ? "_" + x : x)),
  );

const prefixConst = { webkit: "WEBKIT", moz: "MOZ", ms: "MS", o: "O" };

// The Rust test for one range of versions, or null when every version is in the range.
function condition({ from, until, exact }) {
  if (exact) return `version == ${from}`;
  if (from == null) return until == null ? null : `version < ${until}`;
  return until == null ? `version >= ${from}` : `version >= ${from} && version < ${until}`;
}

// `cargo fmt` formats with the workspace edition. A bare rustfmt uses 2015 and sorts the imports differently.
async function rustfmt(path) {
  await Bun.$`rustfmt --edition 2024 ${path}`;
}

// Usage: bun src/css/build-prefixes.js [targets] [prefixes] [compat]. No argument writes all three.
const outputs = ["targets", "prefixes", "compat"];
const selected = process.argv.slice(2);
for (const name of selected) {
  if (!outputs.includes(name)) {
    throw new Error(`build-prefixes.js: unknown output "${name}". The outputs are ${outputs.join(", ")}.`);
  }
}
const wants = name => selected.length === 0 || selected.includes(name);

// ─── targets.rs: rewrite the `bitflags! { ... Features ... }` block ───────
if (wants("targets")) {
  const scalar = flags.filter(f => !Array.isArray(f));
  const groups = flags.filter(f => Array.isArray(f));
  const pad = Math.max(...scalar.map(f => f.length));
  const lines = [
    `bitflags::bitflags! {`,
    `    /// Autogenerated by build-prefixes.js`,
    `    /// Features to explicitly enable or disable.`,
    `    #[derive(Debug, Clone, Copy, PartialEq, Eq)]`,
    `    pub struct Features: u32 {`,
    ...scalar.map((f, i) => `        const ${f.toUpperCase().padEnd(pad)} = 1 << ${i};`),
    ``,
    ...groups.flatMap(([name, members], i) => {
      const body = members.map(m => `Self::${m.toUpperCase()}.bits()`).join("\n            | ");
      const line = `        const ${name.toUpperCase()} = ${body};`;
      return i > 0 ? [``, line] : [line];
    }),
    `    }`,
    `}`,
  ].join("\n");

  let targets = fs.readFileSync("src/css/targets.rs", "utf8");
  const re = /bitflags::bitflags! \{\n    \/\/\/ Autogenerated by build-prefixes\.js(?:.|\n)+?\n    \}\n\}/;
  if (!re.test(targets)) {
    throw new Error("build-prefixes.js: could not find the Features bitflags! block in src/css/targets.rs");
  }
  targets = targets.replace(re, lines);
  fs.writeFileSync("src/css/targets.rs", targets);
  await rustfmt("src/css/targets.rs");
  console.log("wrote src/css/targets.rs (Features block)");
}

// ─── prefixes.rs ──────────────────────────────────────────────────────────
if (wants("prefixes")) {
  const variants = [...new Set([...p.keys()].flat().map(enumify))].sort();
  const arms = [];
  for (const [features, versions] of p) {
    const pats = features.map(enumify).join("\n            | ");
    const body = [];
    for (const [name, pfx] of Object.entries(versions)) {
      const inner = [];
      let needsVersion = false;
      for (const [prefix, range] of Object.entries(pfx)) {
        if (!prefixConst[prefix]) throw new Error("Missing prefix " + prefix);
        const add = `prefixes |= VendorPrefix::${prefixConst[prefix]};`;
        const cond = condition(range);
        if (cond == null) {
          inner.push(`                    ${add}`);
        } else {
          needsVersion = true;
          inner.push(`                    if ${cond} {\n                        ${add}\n                    }`);
        }
      }
      const test = needsVersion ? `let Some(version) = browsers.${name}` : `browsers.${name}.is_some()`;
      body.push(`                if ${test} {\n${inner.join("\n")}\n                }`);
    }
    arms.push(`            ${pats} => {\n${body.join("\n")}\n            }`);
  }

  const anyBrowser = spec =>
    Object.entries(spec)
      .map(
        ([name, range]) =>
          `        if let Some(version) = browsers.${name} {\n            if ${condition(range)} {\n                return true;\n            }\n        }`,
      )
      .join("\n");
  const flex = anyBrowser(flexSpec);
  const grad = anyBrowser(oldGradient);

  const out = `// Autogenerated by build-prefixes.js. DO NOT EDIT!
// Data: ${dataVersions}.

#![allow(clippy::manual_range_contains)]

use crate::VendorPrefix;
use crate::targets::Browsers;

/// CSS features that may require a vendor prefix on one or more browsers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum Feature {
    ${variants.join(",\n    ")},
}

impl Feature {
    pub(crate) fn prefixes_for(self, browsers: &Browsers) -> VendorPrefix {
        use Feature::*;
        let mut prefixes = VendorPrefix::NONE;
        match self {
${arms.join("\n")}
        }
        prefixes
    }

    pub(crate) fn is_flex_2009(browsers: &Browsers) -> bool {
${flex}
        false
    }

    pub(crate) fn is_webkit_gradient(browsers: &Browsers) -> bool {
${grad}
        false
    }
}
`;
  fs.writeFileSync("src/css/prefixes.rs", out);
  await rustfmt("src/css/prefixes.rs");
  console.log("wrote src/css/prefixes.rs");
}

// ─── compat.rs ────────────────────────────────────────────────────────────
if (wants("compat")) {
  const variants = [...new Set([...compat.keys()].flat().map(enumify))].sort();
  // One row of per-browser minimum versions per variant: 0 = any version,
  // UNSUPPORTED = never shipped. A feature with no data at all is a row of
  // all-UNSUPPORTED, which `is_compatible` special-cases to `false`.
  const rowFor = new Map();
  for (const [features, supported] of compat) {
    const entries = Object.entries(supported);
    const row =
      entries.length === 0
        ? allBrowsers.map(() => "UNSUPPORTED")
        : allBrowsers.map(b => (supported[b] == null ? "UNSUPPORTED" : String(supported[b])));
    for (const f of features) rowFor.set(enumify(f), row);
  }
  const rows = variants.map(v => `    [${rowFor.get(v).join(", ")}], // ${v}`).join("\n");
  const targetFields = allBrowsers.map(b => `            browsers.${b},`).join("\n");
  const probes = allBrowsers.map(b => `        probe!(${b});`).join("\n");

  const out = `// Autogenerated by build-prefixes.js. DO NOT EDIT!

use crate::targets::Browsers;

/// CSS feature → browser-compatibility lookup (caniuse / MDN tables).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum Feature {
    ${variants.join(",\n    ")},
}

impl Feature {
    /// Returns whether every browser in \`browsers\` supports this feature
    /// natively, without fallback.
    pub(crate) fn is_compatible(self, browsers: &Browsers) -> bool {
        let min_versions = &MIN_VERSIONS[self as usize];
        if min_versions.iter().all(|&v| v == UNSUPPORTED) {
            // No support data at all for this feature.
            return false;
        }
        let targets = [
${targetFields}
        ];
        targets
            .iter()
            .zip(min_versions)
            .all(|(target, &min)| target.is_none_or(|version| version >= min))
    }

    /// Returns whether *any* of the given browser targets supports this
    /// feature natively.
    pub(crate) fn is_partially_compatible(self, targets: &Browsers) -> bool {
        // Generic implementation in terms of \`is_compatible\` —
        // probe each browser field one at a time.
        macro_rules! probe {
            ($field:ident) => {
                if targets.$field.is_some() {
                    let mut browsers = Browsers::default();
                    browsers.$field = targets.$field;
                    if self.is_compatible(&browsers) {
                        return true;
                    }
                }
            };
        }
${probes}
        false
    }
}

/// A browser that never shipped the feature.
const UNSUPPORTED: u32 = u32::MAX;

/// Minimum version of each browser (${allBrowsers.join(", ")}) that supports
/// each \`Feature\`, indexed by discriminant. \`0\` = every version,
/// \`UNSUPPORTED\` = none.
#[rustfmt::skip]
static MIN_VERSIONS: [[u32; ${allBrowsers.length}]; ${variants.length}] = [
${rows}
];
`;
  fs.writeFileSync("src/css/compat.rs", out);
  await rustfmt("src/css/compat.rs");
  console.log("wrote src/css/compat.rs");
}

function parseVersion(version) {
  version = version.replace("≤", "");
  let [major, minor = "0", patch = "0"] = version
    .split("-")[0]
    .split(".")
    .map(v => parseInt(v, 10));

  if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
    return null;
  }

  return (major << 16) | (minor << 8) | patch;
}
