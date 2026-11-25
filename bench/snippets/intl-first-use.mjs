// The first call of what reaches ICU, each in a new process: bun intl-first-use.mjs <executable>...
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const date = Date.UTC(2024, 0, 15, 15, 4, 5);
const texts = {
  ja: "今日はいい天気ですね。東京タワーまで歩いて行きましょう。",
  zh: "人人生而自由，在尊严和权利上一律平等。他们赋有理性和良心。",
  th: "เป็นมนุษย์สุดประเสริฐเลิศคุณค่ากว่าบรรดาฝูงสัตว์เดรัจฉาน",
  km: "មនុស្សទាំងអស់កើតមកមានសេរីភាពនិងសមភាព",
};

const cases = {
  "Date toString": () => new Date(date).toString(),
  "Date toLocaleString": () => new Date(date).toLocaleString(),
  "Number toLocaleString": () => (1234.5).toLocaleString(),
  "localeCompare": () => "é".localeCompare("f"),
  "normalize": () => "ﬁ①".normalize("NFKC"),
  "URL": () => new URL("http://bücher.example").href,
  "Locale maximize": () => new Intl.Locale("sr-ME").maximize(),
};
for (const locale of ["en", "en-GB", "de", "es-MX", "uk", "ja", "sw"]) {
  const options = {
    DateTimeFormat: [{ dateStyle: "full", timeStyle: "full", timeZone: "America/Los_Angeles" }, "format", date],
    DisplayNames: [{ type: "region" }, "of", "JP"],
    ListFormat: [{}, "format", ["a", "b", "c"]],
    NumberFormat: [{ style: "currency", currency: "EUR" }, "format", 1234.5],
    PluralRules: [{}, "select", 3],
    RelativeTimeFormat: [{}, "format", -3, "day"],
  };
  for (const [name, [option, method, ...args]] of Object.entries(options)) {
    cases[`${name} ${locale}`] = () => new Intl[name](locale, option)[method](...args);
  }
  cases[`unit ${locale}`] = () => (3).toLocaleString(locale, { style: "unit", unit: "liter", unitDisplay: "long" });
}
const allHan = Array.from({ length: 2000 }, (_, i) => String.fromCharCode(0x4e00 + ((i * 7919) % 0x5200)));
for (const locale of ["en", "sv", "ja", "ko", "zh", "zh-TW", "zh-u-co-zhuyin"]) {
  cases[`Collator ${locale}`] = () => [...texts.zh].sort(new Intl.Collator(locale).compare);
  cases[`Collator ${locale} 2000`] = () => allHan.sort(new Intl.Collator(locale).compare);
}
for (const [locale, text] of Object.entries(texts)) {
  for (const granularity of ["grapheme", "word", "sentence"]) {
    cases[`Segmenter ${locale} ${granularity}`] = () => [...new Intl.Segmenter(locale, { granularity }).segment(text)];
  }
}

if (process.env.CASE) {
  const start = process.hrtime.bigint();
  cases[process.env.CASE]();
  console.log(Number(process.hrtime.bigint() - start) / 1000);
} else {
  const executables = process.argv.length > 2 ? process.argv.slice(2) : [process.execPath];
  const runs = Number(process.env.RUNS ?? 41);
  console.log("median µs".padEnd(28), ...executables);
  for (const name in cases) {
    const env = { ...process.env, CASE: name, TZ: "Europe/London", LANG: "en_US.UTF-8" };
    const times = executables.map(() => []);
    for (let run = 0; run < runs; run++) {
      executables.forEach((executable, i) => {
        times[i].push(Number(execFileSync(executable, [fileURLToPath(import.meta.url)], { env })));
      });
    }
    const medians = times.map(it => it.sort((a, b) => a - b)[runs >> 1].toFixed(0));
    console.log(name.padEnd(28), ...medians.map((it, i) => it.padStart(executables[i].length)));
  }
}
