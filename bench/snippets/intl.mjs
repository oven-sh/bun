// What reaches ICU: Intl, Temporal's calendars and time zones, and strings that are not ASCII.
import { bench, group, run } from "../runner.mjs";

const date = Date.UTC(2024, 0, 15, 15, 4, 5);
const zone = { timeZone: "America/Los_Angeles" };
const texts = {
  fr: "Où l'été dernier, près de la forêt, Éloïse a goûté un pâté créé à Besançon. ".repeat(20),
  el: "Η γρήγορη καφετιά αλεπού πηδά πάνω από τον τεμπέλη σκύλο. ".repeat(20),
  ko: "다람쥐 헌 쳇바퀴에 타고파. 키스의 고유 조건은 입술끼리 만나야 한다. ".repeat(20),
  ja: "今日はいい天気ですね。東京タワーまで歩いて行きましょう。".repeat(20),
  th: "เป็นมนุษย์สุดประเสริฐเลิศคุณค่ากว่าบรรดาฝูงสัตว์เดรัจฉาน ".repeat(20),
};

const constructors = {
  Collator: ["sv"],
  DateTimeFormat: ["de", { dateStyle: "full", timeStyle: "long", ...zone }],
  DisplayNames: ["fr", { type: "region" }],
  DurationFormat: ["es", { style: "long" }],
  ListFormat: ["it"],
  Locale: ["zh-Hant-TW-u-ca-roc"],
  NumberFormat: ["de", { style: "currency", currency: "EUR" }],
  PluralRules: ["ru"],
  RelativeTimeFormat: ["pt"],
  Segmenter: ["ja", { granularity: "word" }],
};
group("new", () => {
  for (const [name, args] of Object.entries(constructors)) bench(name, () => new Intl[name](...args));
  bench(
    "DateTimeFormat, fields",
    () => new Intl.DateTimeFormat("ja", { month: "long", day: "numeric", hour: "numeric" }),
  );
});

group("NumberFormat", () => {
  for (const options of [
    {},
    { style: "currency", currency: "EUR" },
    { notation: "compact", compactDisplay: "long" },
    { style: "unit", unit: "kilometer-per-hour", unitDisplay: "long" },
  ]) {
    const format = new Intl.NumberFormat("de", options);
    bench(`format ${Object.values(options)}`, () => format.format(1234567.891));
  }
  const format = new Intl.NumberFormat("fr");
  bench("formatToParts", () => format.formatToParts(-1234567.891));
  bench("formatRange", () => format.formatRange(3, 5000));
});

group("DateTimeFormat", () => {
  for (const calendar of ["gregory", "japanese", "hebrew", "islamic-umalqura", "chinese"]) {
    const format = new Intl.DateTimeFormat("en", { calendar, dateStyle: "full", timeStyle: "full", ...zone });
    bench(`format ${calendar}`, () => format.format(date));
  }
  const format = new Intl.DateTimeFormat("de", { dateStyle: "medium", timeStyle: "short", ...zone });
  bench("formatToParts", () => format.formatToParts(date));
  bench("formatRange", () => format.formatRange(date, date + 3 * 864e5));
});

group("other formats", () => {
  const made = Object.fromEntries(Object.entries(constructors).map(([name, args]) => [name, new Intl[name](...args)]));
  bench("DisplayNames.of", () => made.DisplayNames.of("JP"));
  bench("DurationFormat.format", () => made.DurationFormat.format({ hours: 1, minutes: 46, seconds: 40 }));
  bench("ListFormat.format", () => made.ListFormat.format(["uno", "due", "tre", "quattro"]));
  bench("PluralRules.select", () => made.PluralRules.select(22));
  bench("RelativeTimeFormat.format", () => made.RelativeTimeFormat.format(-3, "day"));
  bench("Locale.maximize", () => new Intl.Locale("sr-ME").maximize());
  bench("getCanonicalLocales", () => Intl.getCanonicalLocales("SH-latn-rs-u-CA-islamicc"));
});

group("Temporal", () => {
  for (const calendar of ["hebrew", "persian", "chinese"]) {
    const day = Temporal.PlainDate.from("2024-01-15").withCalendar(calendar);
    bench(`add, ${calendar}`, () => day.add({ months: 7 }).monthCode);
  }
  const instant = Temporal.Instant.fromEpochMilliseconds(date);
  bench("toZonedDateTimeISO", () => instant.toZonedDateTimeISO(zone.timeZone).offset);
});

for (const [locale, text] of Object.entries(texts)) {
  group(locale, () => {
    const words = [...new Intl.Segmenter(locale, { granularity: "word" }).segment(text)].map(part => part.segment);
    const { compare } = new Intl.Collator(locale);
    const decomposed = text.normalize("NFD");
    bench("sort", () => words.toSorted(compare));
    bench("normalize NFC", () => decomposed.normalize("NFC"));
    bench("normalize NFD", () => text.normalize("NFD"));
    bench("toUpperCase", () => text.toUpperCase());
    for (const granularity of ["grapheme", "word", "sentence"]) {
      const segmenter = new Intl.Segmenter(locale, { granularity });
      bench(`segment ${granularity}`, () => {
        let count = 0;
        for (const _ of segmenter.segment(text)) count++;
        return count;
      });
    }
  });
}

bench("new URL, host that is not ASCII", () => new URL("https://bücher.例え.jp/"));

await run();
