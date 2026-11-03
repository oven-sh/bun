let sum = 0;
const words = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"];
const subject = Array.from({ length: 200 }, (_, i) => words[i % 10] + i + (i % 3 ? " " : "-") + "2026-10-" + (10 + (i % 20)) + " <b>" + i.toString(16) + "</b>").join(" ");
for (let i = 0; i < 6000; i++) {
  const w = words[i % 10];
  const sources = [w + i % 200 + "\\b", "(" + w + "|" + words[(i + 1) % 10] + ")(\\d{" + (1 + i % 3) + "})", "^\\s*" + w + "[a-f" + i % 10 + "]+?$", "(?<y>\\d{4})-(?<m>\\d\\d)-" + (10 + i % 20), "(?<=<b>)[0-9a-f]{" + (1 + i % 2) + ",}(?=</b>)", "\\p{L}+" + i % 100];
  const source = sources[i % sources.length];
  const r = new RegExp(source, i % sources.length === 5 ? "u" : i % 4 === 0 ? "i" : "");
  sum += r.test(subject) ? 1 : 0;
  const m = r.exec(subject); if (m) sum += m.index;
}
for (let round = 0; round < 60; round++) {
  sum += subject.replace(/(\d{4})-(\d\d)-(\d\d)/g, "$3.$2.$1").length;
  sum += subject.replace(/<b>([^<]*)<\/b>/g, (_, x) => x.toUpperCase()).length;
  sum += subject.split(/[\s-]+/).length;
  for (const m of subject.matchAll(/(?<word>[a-z]+)(?<n>\d+)/g)) sum += m.groups.word.length;
  sum += (subject.match(/\b\w+a\d+\b/gi) || []).length;
  sum += subject.search(/kappa199/);
  const sticky = /\S+\s*/y; let k = 0; while (sticky.test(subject)) k++; sum += k;
  sum += (subject.match(/(?:a|b|[c-e]|f+)*\d/g) || []).length;
  sum += (subject.match(/[\p{L}\p{N}]+/gv) || []).length;
  sum += /^(?:(?:alpha|beta)\d+[ -]\S+ \S+ ?)+/.exec(subject)[0].length;
}
console.log("regexps-many", sum);
