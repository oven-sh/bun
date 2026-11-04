const report = value => console.log(typeof value === "string" ? value : String(value));
// Generated: classes that share a prototype object, a kind of cell or a row of classes, each asked about the values of all.
const show = (value) => value === true ? "1" : value === false ? "0" : String(value);
function attempt(act) { try { return act(); } catch (error) { return "T"; } }
function maybe(name, make, values) { try { values.push([name, make()]); } catch (error) { values.push([name + ", which cannot be made: " + error.name, undefined]); } }

function isIntlCollator(x) { return x instanceof Intl.Collator; }
function countIntlCollator(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Intl.Collator) count++; } return count; }
function isIntlDateTimeFormat(x) { return x instanceof Intl.DateTimeFormat; }
function countIntlDateTimeFormat(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Intl.DateTimeFormat) count++; } return count; }
function isIntlNumberFormat(x) { return x instanceof Intl.NumberFormat; }
function countIntlNumberFormat(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Intl.NumberFormat) count++; } return count; }
function isIntlPluralRules(x) { return x instanceof Intl.PluralRules; }
function countIntlPluralRules(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Intl.PluralRules) count++; } return count; }
function isIntlRelativeTimeFormat(x) { return x instanceof Intl.RelativeTimeFormat; }
function countIntlRelativeTimeFormat(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Intl.RelativeTimeFormat) count++; } return count; }
function isIntlListFormat(x) { return x instanceof Intl.ListFormat; }
function countIntlListFormat(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Intl.ListFormat) count++; } return count; }
function isIntlLocale(x) { return x instanceof Intl.Locale; }
function countIntlLocale(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Intl.Locale) count++; } return count; }
function isIntlSegmenter(x) { return x instanceof Intl.Segmenter; }
function countIntlSegmenter(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Intl.Segmenter) count++; } return count; }
function isIntlDisplayNames(x) { return x instanceof Intl.DisplayNames; }
function countIntlDisplayNames(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Intl.DisplayNames) count++; } return count; }
function isIntlDurationFormat(x) { return x instanceof Intl.DurationFormat; }
function countIntlDurationFormat(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Intl.DurationFormat) count++; } return count; }
const tests = [["Intl.Collator", isIntlCollator, countIntlCollator], ["Intl.DateTimeFormat", isIntlDateTimeFormat, countIntlDateTimeFormat], ["Intl.NumberFormat", isIntlNumberFormat, countIntlNumberFormat], ["Intl.PluralRules", isIntlPluralRules, countIntlPluralRules], ["Intl.RelativeTimeFormat", isIntlRelativeTimeFormat, countIntlRelativeTimeFormat], ["Intl.ListFormat", isIntlListFormat, countIntlListFormat], ["Intl.Locale", isIntlLocale, countIntlLocale], ["Intl.Segmenter", isIntlSegmenter, countIntlSegmenter], ["Intl.DisplayNames", isIntlDisplayNames, countIntlDisplayNames], ["Intl.DurationFormat", isIntlDurationFormat, countIntlDurationFormat]];
const values = [];
maybe("created below Intl.Collator.prototype", () => Object.create(Intl.Collator.prototype), values);
maybe("Intl.Collator.prototype", () => Intl.Collator.prototype, values);
maybe("Intl.Collator", () => Intl.Collator, values);
maybe("new Intl.Collator", () => new Intl.Collator(), values);
maybe("new of a class below Intl.Collator", () => new (class extends Intl.Collator {})(), values);
maybe("new Intl.Collator without its prototype", () => Object.setPrototypeOf(new Intl.Collator(), null), values);
maybe("new Intl.Collator below Intl.DateTimeFormat.prototype", () => Object.setPrototypeOf(new Intl.Collator(), Intl.DateTimeFormat.prototype), values);
maybe("a proxy of new Intl.Collator", () => new Proxy(new Intl.Collator(), {}), values);
maybe("Intl.Collator made for Intl.DateTimeFormat as new.target", () => Reflect.construct(Intl.Collator, [], Intl.DateTimeFormat), values);
maybe("created below Intl.DateTimeFormat.prototype", () => Object.create(Intl.DateTimeFormat.prototype), values);
maybe("Intl.DateTimeFormat.prototype", () => Intl.DateTimeFormat.prototype, values);
maybe("Intl.DateTimeFormat", () => Intl.DateTimeFormat, values);
maybe("new Intl.DateTimeFormat", () => new Intl.DateTimeFormat(), values);
maybe("new of a class below Intl.DateTimeFormat", () => new (class extends Intl.DateTimeFormat {})(), values);
maybe("new Intl.DateTimeFormat without its prototype", () => Object.setPrototypeOf(new Intl.DateTimeFormat(), null), values);
maybe("new Intl.DateTimeFormat below Intl.NumberFormat.prototype", () => Object.setPrototypeOf(new Intl.DateTimeFormat(), Intl.NumberFormat.prototype), values);
maybe("a proxy of new Intl.DateTimeFormat", () => new Proxy(new Intl.DateTimeFormat(), {}), values);
maybe("Intl.DateTimeFormat made for Intl.NumberFormat as new.target", () => Reflect.construct(Intl.DateTimeFormat, [], Intl.NumberFormat), values);
maybe("created below Intl.NumberFormat.prototype", () => Object.create(Intl.NumberFormat.prototype), values);
maybe("Intl.NumberFormat.prototype", () => Intl.NumberFormat.prototype, values);
maybe("Intl.NumberFormat", () => Intl.NumberFormat, values);
maybe("new Intl.NumberFormat", () => new Intl.NumberFormat(), values);
maybe("new of a class below Intl.NumberFormat", () => new (class extends Intl.NumberFormat {})(), values);
maybe("new Intl.NumberFormat without its prototype", () => Object.setPrototypeOf(new Intl.NumberFormat(), null), values);
maybe("new Intl.NumberFormat below Intl.PluralRules.prototype", () => Object.setPrototypeOf(new Intl.NumberFormat(), Intl.PluralRules.prototype), values);
maybe("a proxy of new Intl.NumberFormat", () => new Proxy(new Intl.NumberFormat(), {}), values);
maybe("Intl.NumberFormat made for Intl.PluralRules as new.target", () => Reflect.construct(Intl.NumberFormat, [], Intl.PluralRules), values);
maybe("created below Intl.PluralRules.prototype", () => Object.create(Intl.PluralRules.prototype), values);
maybe("Intl.PluralRules.prototype", () => Intl.PluralRules.prototype, values);
maybe("Intl.PluralRules", () => Intl.PluralRules, values);
maybe("new Intl.PluralRules", () => new Intl.PluralRules(), values);
maybe("new of a class below Intl.PluralRules", () => new (class extends Intl.PluralRules {})(), values);
maybe("new Intl.PluralRules without its prototype", () => Object.setPrototypeOf(new Intl.PluralRules(), null), values);
maybe("new Intl.PluralRules below Intl.RelativeTimeFormat.prototype", () => Object.setPrototypeOf(new Intl.PluralRules(), Intl.RelativeTimeFormat.prototype), values);
maybe("a proxy of new Intl.PluralRules", () => new Proxy(new Intl.PluralRules(), {}), values);
maybe("Intl.PluralRules made for Intl.RelativeTimeFormat as new.target", () => Reflect.construct(Intl.PluralRules, [], Intl.RelativeTimeFormat), values);
maybe("created below Intl.RelativeTimeFormat.prototype", () => Object.create(Intl.RelativeTimeFormat.prototype), values);
maybe("Intl.RelativeTimeFormat.prototype", () => Intl.RelativeTimeFormat.prototype, values);
maybe("Intl.RelativeTimeFormat", () => Intl.RelativeTimeFormat, values);
maybe("new Intl.RelativeTimeFormat", () => new Intl.RelativeTimeFormat(), values);
maybe("new of a class below Intl.RelativeTimeFormat", () => new (class extends Intl.RelativeTimeFormat {})(), values);
maybe("new Intl.RelativeTimeFormat without its prototype", () => Object.setPrototypeOf(new Intl.RelativeTimeFormat(), null), values);
maybe("new Intl.RelativeTimeFormat below Intl.ListFormat.prototype", () => Object.setPrototypeOf(new Intl.RelativeTimeFormat(), Intl.ListFormat.prototype), values);
maybe("a proxy of new Intl.RelativeTimeFormat", () => new Proxy(new Intl.RelativeTimeFormat(), {}), values);
maybe("Intl.RelativeTimeFormat made for Intl.ListFormat as new.target", () => Reflect.construct(Intl.RelativeTimeFormat, [], Intl.ListFormat), values);
maybe("created below Intl.ListFormat.prototype", () => Object.create(Intl.ListFormat.prototype), values);
maybe("Intl.ListFormat.prototype", () => Intl.ListFormat.prototype, values);
maybe("Intl.ListFormat", () => Intl.ListFormat, values);
maybe("new Intl.ListFormat", () => new Intl.ListFormat(), values);
maybe("new of a class below Intl.ListFormat", () => new (class extends Intl.ListFormat {})(), values);
maybe("new Intl.ListFormat without its prototype", () => Object.setPrototypeOf(new Intl.ListFormat(), null), values);
maybe("new Intl.ListFormat below Intl.Locale.prototype", () => Object.setPrototypeOf(new Intl.ListFormat(), Intl.Locale.prototype), values);
maybe("a proxy of new Intl.ListFormat", () => new Proxy(new Intl.ListFormat(), {}), values);
maybe("Intl.ListFormat made for Intl.Locale as new.target", () => Reflect.construct(Intl.ListFormat, [], Intl.Locale), values);
maybe("created below Intl.Locale.prototype", () => Object.create(Intl.Locale.prototype), values);
maybe("Intl.Locale.prototype", () => Intl.Locale.prototype, values);
maybe("Intl.Locale", () => Intl.Locale, values);
maybe("new Intl.Locale", () => new Intl.Locale("en"), values);
maybe("new of a class below Intl.Locale", () => new (class extends Intl.Locale {})("en"), values);
maybe("new Intl.Locale without its prototype", () => Object.setPrototypeOf(new Intl.Locale("en"), null), values);
maybe("new Intl.Locale below Intl.Segmenter.prototype", () => Object.setPrototypeOf(new Intl.Locale("en"), Intl.Segmenter.prototype), values);
maybe("a proxy of new Intl.Locale", () => new Proxy(new Intl.Locale("en"), {}), values);
maybe("Intl.Locale made for Intl.Segmenter as new.target", () => Reflect.construct(Intl.Locale, ["en"], Intl.Segmenter), values);
maybe("created below Intl.Segmenter.prototype", () => Object.create(Intl.Segmenter.prototype), values);
maybe("Intl.Segmenter.prototype", () => Intl.Segmenter.prototype, values);
maybe("Intl.Segmenter", () => Intl.Segmenter, values);
maybe("new Intl.Segmenter", () => new Intl.Segmenter(), values);
maybe("new of a class below Intl.Segmenter", () => new (class extends Intl.Segmenter {})(), values);
maybe("new Intl.Segmenter without its prototype", () => Object.setPrototypeOf(new Intl.Segmenter(), null), values);
maybe("new Intl.Segmenter below Intl.DisplayNames.prototype", () => Object.setPrototypeOf(new Intl.Segmenter(), Intl.DisplayNames.prototype), values);
maybe("a proxy of new Intl.Segmenter", () => new Proxy(new Intl.Segmenter(), {}), values);
maybe("Intl.Segmenter made for Intl.DisplayNames as new.target", () => Reflect.construct(Intl.Segmenter, [], Intl.DisplayNames), values);
maybe("created below Intl.DisplayNames.prototype", () => Object.create(Intl.DisplayNames.prototype), values);
maybe("Intl.DisplayNames.prototype", () => Intl.DisplayNames.prototype, values);
maybe("Intl.DisplayNames", () => Intl.DisplayNames, values);
maybe("new Intl.DisplayNames", () => new Intl.DisplayNames("en", { type: "language" }), values);
maybe("new of a class below Intl.DisplayNames", () => new (class extends Intl.DisplayNames {})("en", { type: "language" }), values);
maybe("new Intl.DisplayNames without its prototype", () => Object.setPrototypeOf(new Intl.DisplayNames("en", { type: "language" }), null), values);
maybe("new Intl.DisplayNames below Intl.DurationFormat.prototype", () => Object.setPrototypeOf(new Intl.DisplayNames("en", { type: "language" }), Intl.DurationFormat.prototype), values);
maybe("a proxy of new Intl.DisplayNames", () => new Proxy(new Intl.DisplayNames("en", { type: "language" }), {}), values);
maybe("Intl.DisplayNames made for Intl.DurationFormat as new.target", () => Reflect.construct(Intl.DisplayNames, ["en", { type: "language" }], Intl.DurationFormat), values);
maybe("created below Intl.DurationFormat.prototype", () => Object.create(Intl.DurationFormat.prototype), values);
maybe("Intl.DurationFormat.prototype", () => Intl.DurationFormat.prototype, values);
maybe("Intl.DurationFormat", () => Intl.DurationFormat, values);
maybe("new Intl.DurationFormat", () => new Intl.DurationFormat(), values);
maybe("new of a class below Intl.DurationFormat", () => new (class extends Intl.DurationFormat {})(), values);
maybe("new Intl.DurationFormat without its prototype", () => Object.setPrototypeOf(new Intl.DurationFormat(), null), values);
maybe("new Intl.DurationFormat below Intl.Collator.prototype", () => Object.setPrototypeOf(new Intl.DurationFormat(), Intl.Collator.prototype), values);
maybe("a proxy of new Intl.DurationFormat", () => new Proxy(new Intl.DurationFormat(), {}), values);
maybe("Intl.DurationFormat made for Intl.Collator as new.target", () => Reflect.construct(Intl.DurationFormat, [], Intl.Collator), values);
maybe("Intl.Collator()", () => (Intl.Collator()), values);
maybe("Intl.DateTimeFormat()", () => (Intl.DateTimeFormat()), values);
maybe("Intl.NumberFormat()", () => (Intl.NumberFormat()), values);
maybe("Intl.NumberFormat.call(Object.create(Intl.NumberFormat.prototype))", () => (Intl.NumberFormat.call(Object.create(Intl.NumberFormat.prototype))), values);
maybe("Intl.DateTimeFormat.call(Object.create(Intl.DateTimeFormat.prototype))", () => (Intl.DateTimeFormat.call(Object.create(Intl.DateTimeFormat.prototype))), values);
maybe(`new Intl.Segmenter().segment("a")`, () => (new Intl.Segmenter().segment("a")), values);
maybe(`new Intl.Locale("en").maximize()`, () => (new Intl.Locale("en").maximize()), values);
maybe("Intl", () => (Intl), values);
for (const [name, value] of values) {
  let answers = "";
  for (const [, is, count] of tests) answers += show(attempt(() => is(value))) + show(attempt(() => count(value)));
  report(answers + " " + name);
}
const ordinary = Function.prototype[Symbol.hasInstance];
report("Intl.Collator: " + (Intl.Collator[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Intl.Collator, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Intl.Collator, value))) + show(attempt(() => Intl.Collator[Symbol.hasInstance](value)))).join(""));
report("Intl.DateTimeFormat: " + (Intl.DateTimeFormat[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Intl.DateTimeFormat, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Intl.DateTimeFormat, value))) + show(attempt(() => Intl.DateTimeFormat[Symbol.hasInstance](value)))).join(""));
report("Intl.NumberFormat: " + (Intl.NumberFormat[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Intl.NumberFormat, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Intl.NumberFormat, value))) + show(attempt(() => Intl.NumberFormat[Symbol.hasInstance](value)))).join(""));
report("Intl.PluralRules: " + (Intl.PluralRules[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Intl.PluralRules, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Intl.PluralRules, value))) + show(attempt(() => Intl.PluralRules[Symbol.hasInstance](value)))).join(""));
report("Intl.RelativeTimeFormat: " + (Intl.RelativeTimeFormat[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Intl.RelativeTimeFormat, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Intl.RelativeTimeFormat, value))) + show(attempt(() => Intl.RelativeTimeFormat[Symbol.hasInstance](value)))).join(""));
report("Intl.ListFormat: " + (Intl.ListFormat[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Intl.ListFormat, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Intl.ListFormat, value))) + show(attempt(() => Intl.ListFormat[Symbol.hasInstance](value)))).join(""));
report("Intl.Locale: " + (Intl.Locale[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Intl.Locale, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Intl.Locale, value))) + show(attempt(() => Intl.Locale[Symbol.hasInstance](value)))).join(""));
report("Intl.Segmenter: " + (Intl.Segmenter[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Intl.Segmenter, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Intl.Segmenter, value))) + show(attempt(() => Intl.Segmenter[Symbol.hasInstance](value)))).join(""));
report("Intl.DisplayNames: " + (Intl.DisplayNames[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Intl.DisplayNames, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Intl.DisplayNames, value))) + show(attempt(() => Intl.DisplayNames[Symbol.hasInstance](value)))).join(""));
report("Intl.DurationFormat: " + (Intl.DurationFormat[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Intl.DurationFormat, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Intl.DurationFormat, value))) + show(attempt(() => Intl.DurationFormat[Symbol.hasInstance](value)))).join(""));
process.exit(0);
