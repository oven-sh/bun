let sum = 0;
const lines = [];
for (let i = 0; i < 4000; i++) lines.push(`2026-10-${String((i % 28) + 1).padStart(2, "0")}T12:${i % 60}:07Z GET /users/${i}/posts?page=${i % 9}&q=a%20b host-${i % 17}.example.com ${200 + (i % 5)} ${i * 13}ms "Mozilla/5.0 (X11; Linux x86_64)"`);
const date = /^(?<year>\d{4})-(?<month>\d\d)-(?<day>\d\d)T/, path = /\/users\/(\d+)\/(\w+)\?(?:page=(\d+))?/, host = /\b[a-z]+-\d+(?:\.[a-z]+)+\b/i, word = /\w+/g, sticky = /\d+/y, unicode = /\p{Lu}\p{Ll}+/u, back = /(\d)\1/, lazy = /".*?"/, look = /\d+(?=ms)/;
for (let round = 0; round < 6; round++)
  for (const line of lines) {
    sum += Number(date.exec(line).groups.day) + Number(path.exec(line)[1]) + host.exec(line)[0].length + line.match(word).length;
    sticky.lastIndex = 0; sum += sticky.test(line) ? sticky.lastIndex : 0;
    sum += unicode.exec(line).index + (back.test(line) ? 1 : 0) + lazy.exec(line)[0].length + Number(look.exec(line)[0]);
    sum += line.replace(/%20/g, " ").length + line.replace(/(\d+)ms/, (_, n) => n + " ms").length + line.split(/\s+/).length + line.search(/Linux/);
  }
for (const match of lines.join("\n").matchAll(/^.*?GET (\S+)/gm)) sum += match[1].length;
console.log(sum);
