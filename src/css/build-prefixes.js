/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// const { execSync } = require("child_process");
const prefixes = require("autoprefixer/data/prefixes");
const browsers = require("caniuse-lite").agents;
const unpack = require("caniuse-lite").feature;
const features = require("caniuse-lite").features;
const mdn = require("@mdn/browser-compat-data");
const fs = require("fs");

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
  samsunginternet_android: "samsung",
  webview_android: "android",
  oculus: null,
};

const latestBrowserVersions = {};
for (let b in browsers) {
  let versions = browsers[b].versions.slice(-10);
  for (let i = versions.length - 1; i >= 0; i--) {
    if (versions[i] != null && versions[i] != "all" && versions[i] != "TP") {
      latestBrowserVersions[b] = versions[i];
      break;
    }
  }
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

prefixes["any-pseudo"] = {
  browsers: Object.entries(mdn.css.selectors.is.__compat.support).flatMap(([key, value]) => {
    if (Array.isArray(value)) {
      key = MDN_BROWSER_MAPPING[key] || key;
      let any = value.find(v => v.alternative_name?.includes("-any"))?.version_added;
      let supported = value.find(x => x.version_added && !x.alternative_name)?.version_added;
      if (any && supported) {
        let parts = supported.split(".");
        parts[0]--;
        supported = parts.join(".");
        return [`${key} ${any}}`, `${key} ${supported}`];
      }
    }

    return [];
  }),
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
    let isCurrentVersion = version === latestBrowserVersions[name];
    name = BROWSER_MAPPING[name] || name;
    let v = parseVersion(version);
    if (v == null) {
      console.log("BAD VERSION", prop, name, version);
      continue;
    }
    if (browserMap[name]?.[prefix] == null) {
      browserMap[name] = browserMap[name] || {};
      browserMap[name][prefix] =
        prefixes[prop].browsers.filter(b => b.startsWith(origName) || b.startsWith(name)).length === 1
          ? isCurrentVersion
            ? [null, null]
            : [null, v]
          : isCurrentVersion
            ? [v, null]
            : [v, v];
    } else {
      if (v < browserMap[name][prefix][0]) {
        browserMap[name][prefix][0] = v;
      }

      if (isCurrentVersion && browserMap[name][prefix][0] != null) {
        browserMap[name][prefix][1] = null;
      } else if (v > browserMap[name][prefix][1] && browserMap[name][prefix][1] != null) {
        browserMap[name][prefix][1] = v;
      }
    }

    if (variant === "2009") {
      if (flexSpec[name] == null) {
        flexSpec[name] = [v, v];
      } else {
        if (v < flexSpec[name][0]) {
          flexSpec[name][0] = v;
        }

        if (v > flexSpec[name][1]) {
          flexSpec[name][1] = v;
        }
      }
    } else if (variant === "old" && prop.includes("gradient")) {
      if (oldGradient[name] == null) {
        oldGradient[name] = [v, v];
      } else {
        if (v < oldGradient[name][0]) {
          oldGradient[name][0] = v;
        }

        if (v > oldGradient[name][1]) {
          oldGradient[name][1] = v;
        }
      }
    }
  }
  addValue(p, browserMap, prop);
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
  doublePositionGradients: mdn.css.types.image.gradient["radial-gradient"].doubleposition.__compat.support,
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
  gradientInterpolationHints: mdn.css.types.image.gradient["linear-gradient"].interpolation_hints.__compat.support,
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

for (let key in mdn.css.types.image.gradient) {
  if (key === "__compat") {
    continue;
  }

  let feat = key.replace(/-([a-z])/g, (_, l) => l.toUpperCase());
  mdnFeatures[feat] = mdn.css.types.image.gradient[key].__compat.support;
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
  if (key === "__compat" || key === "animatable") {
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

async function rustfmt(path) {
  await Bun.$`rustfmt ${path}`.nothrow();
}

// ─── targets.rs: rewrite the `bitflags! { ... Features ... }` block ───────
{
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
{
  const variants = [...new Set([...p.keys()].flat().map(enumify))].sort();
  const arms = [];
  for (const [features, versions] of p) {
    const pats = features.map(enumify).join("\n            | ");
    const body = [];
    for (const [name, pfx] of Object.entries(versions)) {
      const inner = [];
      for (const [prefix, [min, max]] of Object.entries(pfx)) {
        if (!prefixConst[prefix]) throw new Error("Missing prefix " + prefix);
        const add = `prefixes |= VendorPrefix::${prefixConst[prefix]};`;
        if (min == null && max == null) {
          inner.push(`                    let _ = version;\n                    ${add}`);
        } else {
          let cond;
          if (min == null) cond = `version <= ${max}`;
          else if (max == null) cond = `version >= ${min}`;
          else if (min === max) cond = `version == ${min}`;
          else cond = `version >= ${min} && version <= ${max}`;
          inner.push(`                    if ${cond} {\n                        ${add}\n                    }`);
        }
      }
      body.push(`                if let Some(version) = browsers.${name} {\n${inner.join("\n")}\n                }`);
    }
    arms.push(`            ${pats} => {\n${body.join("\n")}\n            }`);
  }

  const flex = Object.entries(flexSpec)
    .map(
      ([name, [min, max]]) =>
        `        if let Some(version) = browsers.${name} {\n            if version >= ${min} && version <= ${max} {\n                return true;\n            }\n        }`,
    )
    .join("\n");
  const grad = Object.entries(oldGradient)
    .map(
      ([name, [min, max]]) =>
        `        if let Some(version) = browsers.${name} {\n            if version >= ${min} && version <= ${max} {\n                return true;\n            }\n        }`,
    )
    .join("\n");

  const out = `// Autogenerated by build-prefixes.js. DO NOT EDIT!

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
    pub fn prefixes_for(self, browsers: &Browsers) -> VendorPrefix {
        use Feature::*;
        let mut prefixes = VendorPrefix::NONE;
        match self {
${arms.join("\n")}
        }
        prefixes
    }

    pub fn is_flex_2009(browsers: &Browsers) -> bool {
${flex}
        false
    }

    pub fn is_webkit_gradient(browsers: &Browsers) -> bool {
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
{
  const variants = [...new Set([...compat.keys()].flat().map(enumify))].sort();
  const arms = [];
  for (const [features, supported] of compat) {
    const pats = features.map(n => `Feature::${enumify(n)}`).join("\n            | ");
    const entries = Object.entries(supported);
    let body;
    if (entries.length === 0) {
      body = `                return false;`;
    } else {
      const checks = entries
        .map(
          ([browser, min]) =>
            `                if let Some(version) = browsers.${browser} {\n                    if version < ${min} {\n                        return false;\n                    }\n                }`,
        )
        .join("\n");
      const unsupported = allBrowsers.filter(b => supported[b] == null);
      const unsupCheck =
        unsupported.length === 0
          ? ""
          : `\n                if ${unsupported
              .map(b => `browsers.${b}.is_some()`)
              .join(" || ")} {\n                    return false;\n                }`;
      body = checks + unsupCheck;
    }
    arms.push(`            ${pats} => {\n${body}\n            }`);
  }

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
    #[allow(clippy::match_same_arms)]
    pub fn is_compatible(self, browsers: &Browsers) -> bool {
        match self {
${arms.join("\n")}
        }
        true
    }

    /// Returns whether *any* of the given browser targets supports this
    /// feature natively.
    pub fn is_partially_compatible(self, targets: &Browsers) -> bool {
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
