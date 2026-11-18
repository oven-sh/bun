/**
 * ICU — Unicode and locale data: Intl, collation, normalization, IDNA.
 *
 * `bundled`: the release tarball, compiled here, with data made from the package in it (../icu/data.ts).
 * `system`: on macOS the SDK's headers and libicucore; on Linux the host's headers and shared libraries, or the
 * static ICU whose include/ and lib/ are under $BUN_ICU_ROOT.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config.ts";
import { assert, BuildError } from "../error.ts";
import { quote } from "../shell.ts";
import { depBuildDir, depSourceDir, LIBC_ALLOCATION_SYMBOLS, type Dependency, type DirectBuild } from "../source.ts";

const ICU_VERSION = "79.1";
const ICU_SHA256 = "06fa63ecb521048f8082f12ad988f6b678d90cbd88aafce24cbc94902b191d99";

// What the functions that Bun calls reach, out of source/{common,i18n}/sources.txt. An undefined ICU symbol at the
// link asks for one more name here.
// prettier-ignore
const COMMON_SOURCES = [
  "appendable", "bmpset", "brkeng", "brkiter", "bytesinkutil", "bytestream", "bytestrie", "bytestriebuilder",
  "caniter", "characterproperties", "chariter", "charstr", "cmemory", "cstring", "dictbe", "dictionarydata",
  "dtintrv", "edits", "emojiprops", "errorcode", "filteredbrk", "fixedstring", "loadednormalizer2impl",
  "localebuilder", "locavailable", "locbased", "locdispnames", "locdspnm", "locid", "loclikely", "loclikelysubtags",
  "locmap", "locresdata", "lsr", "lstmbe", "messagepattern", "normalizer2", "normalizer2impl", "parsepos",
  "patternprops", "propname", "punycode", "putil", "rbbi", "rbbi_cache", "rbbidata", "rbbinode", "rbbirb", "rbbiscan",
  "rbbisetb", "rbbistbl", "rbbitblb", "resbund", "resource", "ruleiter", "sharedobject", "simpleformatter",
  "static_unicode_sets", "stringpiece", "stringtriebuilder", "uarrsort", "ubidi_props", "ubrk", "ucase", "uchar",
  "ucharstrie", "ucharstriebuilder", "ucharstrieiterator", "uchriter", "ucln_cmn", "ucmndata", "ucol_swp", "ucptrie",
  "ucurr", "udata", "udatamem", "udataswp", "uenum", "uhash", "uinvchar", "uiter", "ulist", "uloc", "uloc_keytype",
  "uloc_tag", "umapfile", "umath", "umutablecptrie", "umutex", "unames", "unifiedcache", "unifilt", "unifunct",
  "uniset", "uniset_closure", "uniset_props", "unisetspan", "unistr", "unistr_case", "unistr_case_locale",
  "unistr_props", "unistr_titlecase_brkiter", "uobject", "uprops", "uresbund", "uresdata", "uscript_props", "uset",
  "uset_props", "usetiter", "ustack", "ustr_titlecase_brkiter", "ustrcase", "ustrcase_locale", "ustrenum", "ustrfmt",
  "ustring", "ustrtrns", "utext", "utf_impl", "util", "util_props", "utrace", "utrie", "utrie2", "utrie2_builder",
  "utrie_swap", "uts46", "utypes", "uvector", "uvectr32", "uvectr64",
];

// prettier-ignore
const I18N_SOURCES = [
  "astro", "basictz", "bocsu", "buddhcal", "calendar", "cecal", "chnsecal", "choicfmt", "coleitr", "coll",
  "collation", "collationbuilder", "collationcompare", "collationdata", "collationdatabuilder", "collationdatareader",
  "collationdatawriter", "collationfastlatin", "collationfastlatinbuilder", "collationfcd", "collationiterator",
  "collationkeys", "collationroot", "collationrootelements", "collationruleparser", "collationsets",
  "collationsettings", "collationtailoring", "collationweights", "compactdecimalformat", "coptccal", "curramt",
  "currpinf", "currunit", "dangical", "datefmt", "dayperiodrules", "dcfmtsym", "decContext", "decNumber", "decimfmt",
  "displayoptions", "double-conversion-bignum", "double-conversion-bignum-dtoa", "double-conversion-cached-powers",
  "double-conversion-double-to-string", "double-conversion-fast-dtoa", "double-conversion-string-to-double",
  "double-conversion-strtod", "dtfmtsym", "dtitvfmt", "dtitvinf", "dtptngen", "dtrule", "erarules", "ethpccal",
  "fmtable", "format", "formatted_string_builder", "formattedval_iterimpl", "formattedval_sbimpl", "formattedvalue",
  "fphdlimp", "fpositer", "gregocal", "gregoimp", "hebrwcal", "indiancal", "islamcal", "iso8601cal", "japancal",
  "listformatter", "measunit", "measunit_extra", "measure", "msgfmt", "nfrs", "nfrule", "nfsubs", "number_affixutils",
  "number_asformat", "number_capi", "number_compact", "number_currencysymbols", "number_decimalquantity",
  "number_decimfmtprops", "number_fluent", "number_formatimpl", "number_grouping", "number_integerwidth",
  "number_longnames", "number_mapper", "number_modifiers", "number_multiplier", "number_notation", "number_output",
  "number_padding", "number_patternmodifier", "number_patternstring", "number_rounding", "number_scientific",
  "number_simple", "number_skeletons", "number_symbolswrapper", "number_usageprefs", "number_utils", "numfmt",
  "numparse_affixes", "numparse_compositions", "numparse_currency", "numparse_decimal", "numparse_impl",
  "numparse_parsednumber", "numparse_scientific", "numparse_symbols", "numparse_validators", "numrange_capi",
  "numrange_fluent", "numrange_impl", "numsys", "olsontz", "persncal", "pluralranges", "plurfmt", "plurrule",
  "quantityformatter", "rbnf", "rbtz", "region", "reldatefmt", "reldtfmt", "rulebasedcollator", "selfmt",
  "sharedbreakiterator", "simpletz", "smpdtfmt", "smpdtfst", "sortkey", "standardplural", "string_segment",
  "taiwncal", "timezone", "tzfmt", "tzgnames", "tznames", "tznames_impl", "tzrule", "tztrans", "ucal", "ucln_in",
  "ucol", "ucol_res", "ucol_sit", "udat", "udateintervalformat", "udatpg", "ufieldpositer", "uitercollationiterator",
  "ulistformatter", "umsg", "units_complexconverter", "units_converter", "units_data", "units_router", "unum",
  "unumsys", "upluralrules", "utf16collationiterator", "utf8collationiterator", "vtzone", "zonemeta",
];

const WINDOWS_SOURCES = ["common/wintz", "i18n/utmscale", "i18n/windtfmt", "i18n/winnmfmt", "i18n/wintzimpl"];

const INCLUDES = ["source/common", "source/i18n"];

// prettier-ignore
const COMPRESSOR_ZSTD_SOURCES = [
  "common/entropy_common", "common/error_private", "common/fse_decompress", "common/pool", "common/xxhash",
  "common/zstd_common", "compress/fse_compress", "compress/hist", "compress/huf_compress", "compress/zstd_compress",
  "compress/zstd_compress_literals", "compress/zstd_compress_sequences", "compress/zstd_compress_superblock",
  "compress/zstd_double_fast", "compress/zstd_fast", "compress/zstd_lazy", "compress/zstd_ldm", "compress/zstd_opt",
  "compress/zstd_preSplit", "dictBuilder/divsufsort", "dictBuilder/fastcover", "dictBuilder/zdict",
];

/** Most of the time to compile zstd, and none is used at the level of compress.c. */
const UNUSED_ZSTD_STRATEGIES = ["DFAST", "GREEDY", "LAZY", "LAZY2", "BTLAZY2", "BTOPT"];

const checkoutHint = "See ICU in scripts/build/deps/README.md";

/** The major version of the ICU that the graph compiles: the suffix of its symbols. */
export function bundledIcuMajorVersion(cfg: Config): string {
  const checkout = cfg.localDeps.icu;
  if (checkout === undefined) return ICU_VERSION.split(".")[0]!;
  const header = join(checkout, "source", "common", "unicode", "uvernum.h");
  assert(existsSync(header), `--local-deps: ${header} is missing`, { hint: checkoutHint });
  const major = /^#define U_ICU_VERSION_MAJOR_NUM (\d+)/m.exec(readFileSync(header, "utf8"))?.[1];
  assert(major !== undefined, "no major version of ICU", { file: header });
  return major;
}

function bundled(cfg: Config): DirectBuild {
  const major = bundledIcuMajorVersion(cfg);
  const scripts = join(cfg.cwd, "scripts", "build", "icu");
  const zstd = join(depSourceDir(cfg, "zstd"), "lib");
  const out = depBuildDir(cfg, "icu");
  const release = join(depSourceDir(cfg, "icu"), "source", "data", "in", `icudt${major}l.dat`);
  const compressor = join(out, `compress${cfg.host.exeSuffix}`);
  const data = [join(out, "icudt.dat"), join(out, "icudt.dict")];
  const q = (path: string) => quote(path, cfg.host.os === "windows");

  const checkout = cfg.localDeps.icu;
  if (checkout !== undefined) {
    assert(existsSync(release), `--local-deps: ${release} is missing`, { hint: checkoutHint });
    const loader = readFileSync(join(checkout, "source", "common", "udata.cpp"), "utf8");
    assert(loader.includes("bun_icu_maybe_decompress"), `--local-deps: patches/icu is not applied to ${checkout}`, {
      hint: checkoutHint,
    });
  }

  return {
    kind: "direct",
    lang: "cxx",
    sources: [
      {
        path: join(scripts, "data.S"),
        cflags: [`-DICU_DATA_ENTRY_POINT=icudt${major}_dat`, `-I${q(out)}`],
        implicitInputs: data,
      },
      ...[
        ...COMMON_SOURCES.map(name => `common/${name}`),
        ...I18N_SOURCES.map(name => `i18n/${name}`),
        ...(cfg.windows ? WINDOWS_SOURCES : []),
      ].map(name => `source/${name}.cpp`),
    ],
    includes: INCLUDES,
    // ICU's configure finds nothing on these targets that platform.h and putilimp.h do not assume without it.
    defines: {
      U_STATIC_IMPLEMENTATION: true,
      U_COMMON_IMPLEMENTATION: true,
      U_I18N_IMPLEMENTATION: true,
      // On by itself with the debug C runtime of Windows.
      U_DEBUG: 0,
      // The default on Linux. Elsewhere four ASCII literals would go through a converter for the host's code page.
      U_CHARSET_IS_UTF8: 1,
      UCONFIG_NO_CONVERSION: 1,
      // Registration of an application's own collators, calendars and currencies.
      UCONFIG_NO_SERVICE: 1,
      ...(cfg.windows && { WINVER: 0x0601, _WIN32_WINNT: 0x0601, _HAS_EXCEPTIONS: 0 }),
    },
    // Optimized in every profile. ICU uses dynamic_cast and typeid.
    cflags: ["-w", ...(cfg.windows ? ["/clang:-O2", "/std:c++20", "/GR"] : ["-Os", "-std=c++20", "-frtti"])],
    hostTools: [
      {
        output: compressor,
        sources: [join(scripts, "compress.c"), ...COMPRESSOR_ZSTD_SOURCES.map(name => join(zstd, `${name}.c`))],
        flags: ["-O2", `-I${q(zstd)}`, ...UNUSED_ZSTD_STRATEGIES.map(s => `-DZSTD_EXCLUDE_${s}_BLOCK_COMPRESSOR`)],
      },
    ],
    steps: [
      {
        outputs: data,
        inputs: [release, compressor, ...["data.ts", "items.ts", "package.ts"].map(script => join(scripts, script))],
        cmd: [join(scripts, "data.ts"), release, compressor, ...data],
        cwd: out,
        desc: "ICU data",
      },
    ],
    // cmemory.cpp falls back to them until u_setMemoryFunctions is called.
    forbidUndefined: { symbols: LIBC_ALLOCATION_SYMBOLS, except: ["source/common/cmemory.cpp"] },
  };
}

/** The C functions that came after ICU 70, the libicucore of macOS 13.0: with an import of one, Bun does not start there. */
export const newerThanOldestIcucore: readonly string[] = [
  "u_getIDTypes",
  "u_hasIDType",
  "ubidi_getMFOption",
  "ubidi_isolate",
  "ucal_getIanaTimeZoneID",
  "ucnv_clone",
  "ucol_clone",
  "udatpg_*DateTimeFormatForStyle",
  "udispopt_*",
  "ulocale_*",
  "ulocbld_*",
  "unorm2_getNFKCSimpleCasefoldInstance",
  "unum_hasAttribute",
  "uset_getString*",
  "usnum_*",
  "usnumf_*",
  "uspoof_*Bidi*",
];

/** In link order. */
const libraries = ["icui18n", "icuuc", "icudata"];

export const icu: Dependency = {
  name: "icu",
  fetchDeps: ["zstd"],

  source: cfg =>
    cfg.icu === "system"
      ? { kind: "system" }
      : {
          kind: "tarball",
          url: `https://github.com/unicode-org/icu/releases/download/release-${ICU_VERSION}/icu4c-${ICU_VERSION}-sources.tgz`,
          sha256: ICU_SHA256,
        },

  patches: [
    "patches/icu/calendar-known-region.patch",
    "patches/icu/chinese-published-dates.patch",
    "patches/icu/data-item-hook.patch",
    "patches/icu/decnum-resize-status.patch",
    "patches/icu/likely-subtags-lazy.patch",
    "patches/icu/round-to-five-carry.patch",
  ],

  build: cfg => (cfg.icu === "system" ? { kind: "none" } : bundled(cfg)),

  provides: cfg => {
    if (cfg.icu === "bundled") return { libs: [], includes: INCLUDES };
    if (cfg.darwin) return { libs: [], includes: [], linkFlags: ["-licucore"] };
    const root = process.env.BUN_ICU_ROOT;
    if (cfg.linux && root) {
      return { libs: libraries.map(name => join(root, "lib", `lib${name}.a`)), includes: [join(root, "include")] };
    }
    if (cfg.linux && cfg.abi !== "android") {
      return { libs: [], includes: [], linkFlags: libraries.map(name => `-l${name}`) };
    }
    throw new BuildError(`--icu=system: ${cfg.abi ?? cfg.os} has no ICU of its own to link`, {
      ...(cfg.linux && { hint: "Name a static ICU built for the target (include/, lib/) in BUN_ICU_ROOT" }),
    });
  },
};
