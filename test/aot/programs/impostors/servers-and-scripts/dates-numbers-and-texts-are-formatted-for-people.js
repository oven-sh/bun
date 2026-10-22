const when = new Date(Date.UTC(2026, 9, 20, 7, 5, 9, 42));
console.log(when.toISOString(), when.toJSON(), when.getTime(), when.toUTCString(), JSON.stringify({ when }), new Date("2026-10-20").getUTCDay(), new Date("nonsense").getTime(), Date.UTC(2026, 0));
console.log(when.toLocaleDateString("en-US", { timeZone: "UTC" }), when.toLocaleTimeString("en-GB", { timeZone: "UTC" }), when.toLocaleString("de-DE", { timeZone: "Europe/Berlin" }), when.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "full" }));
const format = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "short", day: "2-digit", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
console.log(format.format(when), format.formatToParts(when).map(part => part.type).join(), format.resolvedOptions().timeZone, format.formatRange(when, new Date(when.getTime() + 86400000)));
console.log((1234567.891).toLocaleString("en-US"), (1234567.891).toLocaleString("de-DE", { style: "currency", currency: "EUR" }), (0.256).toLocaleString("en-US", { style: "percent" }), (1e9).toLocaleString("en-US", { notation: "compact" }), (5).toLocaleString("en-US", { minimumIntegerDigits: 3 }), 12345678901234567890n.toLocaleString("en-IN"));
console.log(new Intl.NumberFormat("en-US", { style: "unit", unit: "kilometer-per-hour" }).format(50), new Intl.NumberFormat("fr-FR").formatToParts(1234.5).length, (1.005).toFixed(2), (255).toString(16), (0.1 + 0.2).toPrecision(3), (1e21).toString(), Number("0x1f"), parseFloat("3.5kg"), parseInt("08"));
console.log(["ä", "a", "z", "Z", "10", "9"].sort(new Intl.Collator("de").compare), ["10", "9", "1"].sort(new Intl.Collator(undefined, { numeric: true }).compare), "a".localeCompare("B", "en", { sensitivity: "base" }), "ß".localeCompare("ss", "de", { sensitivity: "base" }));
console.log(new Intl.PluralRules("en", { type: "ordinal" }).select(22), new Intl.PluralRules("ru").select(5), new Intl.RelativeTimeFormat("es", { numeric: "auto" }).format(-1, "day"), new Intl.ListFormat("en", { type: "disjunction" }).format(["a", "b"]), new Intl.DisplayNames("en", { type: "region" }).of("JP"), new Intl.DisplayNames("fr", { type: "language" }).of("de"));
console.log([...new Intl.Segmenter("en", { granularity: "word" }).segment("Hello, wide world!")].filter(part => part.isWordLike).map(part => part.segment), [...new Intl.Segmenter().segment("👨‍👩‍👧é")].length, Intl.getCanonicalLocales("EN-us"), Intl.supportedValuesOf("currency").includes("USD"), new Intl.Locale("zh-Hant-TW").script);
console.log("İstanbul".toLocaleLowerCase("tr"), "i".toLocaleUpperCase("tr"), "straße".toUpperCase(), "ǅ".toLowerCase(), "Å".normalize("NFC").length, "abc".padStart(6, "12"), "x".repeat(3), " a b ".trim().split(" "), "a-b-c".replaceAll("-", "+"), "Hello".at(-1), "tab\there".split("\t"));
try {
  new Intl.DateTimeFormat("en", { timeZone: "Mars/Olympus" });
} catch (error) {
  console.log(error.name);
}
try {
  (1).toFixed(101);
} catch (error) {
  console.log(error.name);
}
