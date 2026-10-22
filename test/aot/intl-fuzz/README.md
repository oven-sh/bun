# Constant Intl formatters against ICU

`bun build --compile --aot` gives `new Intl.DateTimeFormat("de", { month: "long" })`, `new Intl.NumberFormat(..)`,
`date.toLocaleString("de", { .. })` and `number.toLocaleString(..)` with a constant locale and constant options a _format pattern_:
read-only data in the executable from which our own code writes the text, without ICU
(`Source/JavaScriptCore/aot/runtime/AOTFormatPatterns.h` and `aot/builtins/AOTFormatPattern*.cpp` in the WebKit fork).

The pattern's data (field order, literals, month names, separators, group sizes) is read from ICU: `udat_toPattern`,
`udat_getSymbols`, `unum_getSymbol`, `unum_getAttribute`, the formatter's resolved options. A pattern letter or an option that the
writer does not implement gets no pattern, and ICU formats as before. What is ours, and can go stale, is the writer: digits,
grouping, rounding, hour cycles, two-digit years. These tests compare it with ICU, byte for byte.

## Which ICU

Linux and Windows link ICU and its data statically, so the ICU that plans a pattern is the ICU in the executable. macOS uses the
system's ICU, and an executable for macOS can be built on Linux. So an image carries one stamp: ICU's code, data, CLDR and time
zone data versions, and on macOS the build of the system. It is compared once, when the first pattern is used. If it differs, each
pattern is planned again from the ICU that runs, when it is first used, and kept for the process; a plan that cannot be made leaves
that formatter to ICU. Nothing depends on the machine that built the executable: the default time zone, the default locale and the
rules of named time zones are read when the program runs.

## The tests

- `generate.ts` writes programs that hold some hundreds of constant formatters, each beside a twin whose locale and options the
  compiler cannot see, and compare what both say for about 900 values: years 1 to 275760, first and last milliseconds, ties in
  rounding, 15 to 17 significant digits, and so on. Options are drawn at random (`<seed>`), or enumerated (`sweep:<part>`): every
  combination of the options that can have a pattern, for every locale ICU lists, in over 9,000 parts.
- `intl-fuzz.test.ts` is what CI runs: three random programs, two parts of the sweep, and what programs usually ask for in 45 common
  locales, where all but three known formatters must have a pattern.
- `sweep.ts` runs all of it. Each executable runs three times: as built, with every pattern planned again
  (`BUN_JSC_formatPatternsOfAnotherICUForTesting=1`), and with every plan refused (`=2`).
- `../programs/calls-fast-paths/intl-constant-formatters*.ts` and `to-locale-string-with-constant-arguments.ts` hold the known traps
  and the ways a formatter can flow through a program.
- With `BUN_JSC_validateAOTRuntime=1` any executable formats every text from a pattern with ICU as well and crashes on a
  difference.

## When ICU changes

Run the whole sweep whenever `icu/source.json` changes in the WebKit fork, and on macOS when a new major version of the system comes
out:

```sh
bun bd test/aot/intl-fuzz/sweep.ts --random=300
```

It makes about six billion comparisons: half an hour on 48 cores. It must end with `0 differences`, `0 plans refused` and at least
the share of formatters with a pattern that `expectedShareWithAPattern` in `generate.ts` records.

- A difference is a bug in the writer or the planner. The line names the locale, the options and the value.
- A refused plan means that what we read from ICU no longer says all that ICU does. No text is wrong, since such a formatter is left
  to ICU, but find out what changed.
- A lower share means that the new ICU uses something the planner refuses (a new pattern letter, another default numbering system).
  Nothing is wrong, those formatters are slower. Teach the planner, or lower the number and say why in the commit.
- `locales.ts` is the list of locales: `bun test/aot/intl-fuzz/list-locales.ts > test/aot/intl-fuzz/locales.ts` renews it.
