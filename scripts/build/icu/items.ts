/** What becomes of each item of ICU's data package. A `*` stands for any text without a slash. */

import { assert } from "../error.ts";
import type { Item } from "./package.ts";

/** The data of services that deps/icu.ts does not compile, or that nothing calls. */
const unused = [
  "*.cnv", // charset conversion
  "cnvalias.icu",
  "*.spp", // StringPrep
  "*.cfu", // confusables
  "translit/*",
  "unames.icu",
  "rbnf/*", // but for the locales below
];

/** Dates and numbers in an algorithmic numbering system are spelled by the rules of these locales, or of root. */
const spelloutLocales = ["ja", "zh", "zh_Hant"];

/** Read at startup, by every call to a service, or too large to inflate at the first call. */
const uncompressed = [
  // Character properties and normalization
  "*.icu",
  "*.nrm",
  // The strings that all bundles of a tree share
  "pool.res",
  "*/pool.res",
  // Formats of the default locale, and the only other one over 40 KB
  "root.res",
  "en.res",
  "en_*.res",
  "ko.res",
  // Tables that do not depend on the locale
  "dayPeriods.res",
  "genderList.res",
  "keyTypeData.res",
  "langInfo.res",
  "metaZones.res",
  "metadata.res",
  "numberingSystems.res",
  "pluralRanges.res",
  "plurals.res",
  "supplementalData.res",
  "timezoneTypes.res",
  "units.res",
  "windowsZones.res",
  "zoneinfo64.res",
  // The root collation and the tailorings over 100 KB
  "coll/ucadata.icu",
  "coll/root.res",
  "coll/ja.res",
  "coll/ko.res",
  "coll/zh.res",
  // Word lists for text without spaces
  "brkitr/*.dict",
];

function matcher(patterns: string[]): (name: string) => boolean {
  const expression = new RegExp(`^(${patterns.join("|").replaceAll(".", "\\.").replaceAll("*", "[^/]*")})$`);
  return name => expression.test(name);
}

const isUnused = matcher(unused);
const isSpelloutInUse = matcher(["root", "res_index", ...spelloutLocales].map(locale => `rbnf/${locale}.res`));

export const isShipped = (name: string): boolean => !isUnused(name) || isSpelloutInUse(name);

export const staysUncompressed = matcher(uncompressed);

/** A numbering system names its rules as "%rules" of root, or as "locale/group/%rules". */
export function checkSpelloutLocales(items: Item[]): void {
  const systems = items.find(item => item.name === "numberingSystems.res");
  assert(systems !== undefined, "the ICU data package has no numberingSystems.res");
  const references = systems.data.toString("utf16le").matchAll(/([A-Za-z_]+)\/\w+\/%/g);
  const named = [...new Set(Array.from(references, match => match[1]!))].sort();
  assert(
    named.join() === spelloutLocales.join(),
    `ICU's numbering systems use the rules of [${named}], and the data keeps those of [${spelloutLocales}]`,
    { file: import.meta.filename, hint: "Update spelloutLocales. A locale needs the locales it inherits from too." },
  );
}
