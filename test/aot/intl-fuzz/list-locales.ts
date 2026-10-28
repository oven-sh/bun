// Prints the locales this Bun's ICU has data for, as the text of locales.ts. ECMA-402 has no way to list them, so every language
// code of two or three letters is tried, then every script and region with each language that exists.
//   bun test/aot/intl-fuzz/list-locales.ts > test/aot/intl-fuzz/locales.ts
const letters = "abcdefghijklmnopqrstuvwxyz";
const resolves = (tag: string): boolean => {
  try {
    return new Intl.PluralRules(tag).resolvedOptions().locale === tag;
  } catch {
    return false;
  }
};
const languages: string[] = [];
for (const a of letters) for (const b of letters) if (resolves(a + b)) languages.push(a + b);
for (const a of letters) for (const b of letters) for (const c of letters) if (resolves(a + b + c)) languages.push(a + b + c);
const regions: string[] = ["001", "150", "419"];
for (const a of letters) for (const b of letters) regions.push((a + b).toUpperCase());
const scripts = ["Adlm", "Arab", "Beng", "Cyrl", "Deva", "Guru", "Hans", "Hant", "Latn", "Mtei", "Nkoo", "Olck", "Orya", "Rohg", "Shaw", "Telu", "Tfng", "Vaii"];
const found: string[] = [];
for (const language of languages) {
  found.push(language);
  for (const region of regions) if (resolves(language + "-" + region)) found.push(language + "-" + region);
  for (const script of scripts) {
    if (!resolves(language + "-" + script)) continue;
    found.push(language + "-" + script);
    for (const region of regions) if (resolves(language + "-" + script + "-" + region)) found.push(language + "-" + script + "-" + region);
  }
}
console.log("// Made by list-locales.ts.\nexport const locales: string[] = " + JSON.stringify(found).replace(/((?:[^,]*,){24})/g, "$1\n  ") + ";");
