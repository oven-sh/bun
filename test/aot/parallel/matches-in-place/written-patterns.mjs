// Regular expressions that loops match: classes, runs that give characters back, alternatives, groups, anchors, lookaheads. Subjects: flat, substrings, ropes, wide, long. What is printed is what plain Bun prints.
const unseen = x => [x][JSON.parse("0")];
const long = "x".repeat(80);
const subjects = unseen(["", "a", "b", "ab", "abc", "aab", "abab", "ABab", "alpha-12", "beta", "x = 1042;", "https://a.b/c", "http://q", "foo.test.ts", "foo.tsx", "  indent  ", "2026-11-10", "2026-11-1", "-1.5e+3", "12", "#a0b1c2", "a\nb", "\n", "\r\nab", "é", "ÿ", "Ÿ", "µ", "K", "k", "s", "ſ", "_", "ab ab", "a-b", "a/b/c", "a,b;c", "abĀ", long, long + "ab", "ab" + long, ("xyaab12zw").slice(2, 7), "ab" + String(subjects0().length), "true", "truex", "if", "elsif", "else", "end", "q=1&r=2"]);
function subjects0() { return [1, 2, 3]; }
function tests(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    let t = "";
    t += /^[a-z]+-\d+$/.test(s) ? 1 : 0;
    t += /^https?:\/\//.test(s) ? 1 : 0;
    t += /[A-Z_]/.test(s) ? 1 : 0;
    t += /\.tsx?$/.test(s) ? 1 : 0;
    t += /^(?:alpha|beta|gamma)\b/.test(s) ? 1 : 0;
    t += /zeta|AB/i.test(s) ? 1 : 0;
    t += /[^\x00-\x7f]/.test(s) ? 1 : 0;
    t += /ÿ|µ|ſ|k/i.test(s) ? 1 : 0;
    t += /k/iu.test(s) ? 1 : 0;
    t += /^(?:true|false|if|then|else|elsif|end)$/.test(s) ? 1 : 0;
    t += /^a.*b$/.test(s) ? 1 : 0;
    t += /^a.*?b/s.test(s) ? 1 : 0;
    t += /(?:^|;)b/m.test(s) ? 1 : 0;
    t += /a$/m.test(s) ? 1 : 0;
    t += /a(?!b)/.test(s) ? 1 : 0;
    t += /(?=ab)a/.test(s) ? 1 : 0;
    t += /\Bb\B|\bab\b/.test(s) ? 1 : 0;
    t += /^a{2,3}b?$|^(?:ab){2}$/.test(s) ? 1 : 0;
    t += /^(?:a|ab)(?:c|bcd)?$/.test(s) ? 1 : 0;
    t += /[a-z0-9_]{5}/.test(s) ? 1 : 0;
    t += /^$/.test(s) ? 1 : 0;
    t += /$^/.test(s) ? 1 : 0;
    t += /a*/.test(s) ? 1 : 0;
    t += " " + s.search(/[\d=]/) + " " + s.search(/b$/) + " " + s.search(/^a/) + " " + s.search(/\d\d|x/);
    out.push(t);
  }
  return out.join("\n");
}
console.log(tests(subjects));
function groups(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    let t = "";
    const a = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s);
    if (a) t += "date " + a[1] + a[2] + a[3];
    const b = s.match(/^([+-]?\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
    if (b) t += "number " + b[1] + "|" + b[2] + "|" + b[3];
    const c = /([a-z0-9]+)(\W*)/i.exec(s);
    if (c) t += "word " + c[1] + "|" + c[2] + "@" + c.index;
    const d = /(?:(a)|(b)|(c))+/.exec(s);
    if (d) t += "last " + d[1] + d[2] + d[3] + d[0];
    const e = /^(a?)(a?)(b?)/.exec(s);
    if (e) t += "three " + e[1] + "," + e[2] + "," + e[3];
    const f = /(a+)(a+)?(b)?/.exec(s);
    if (f !== null) { const [whole, one, two, three] = f; t += "runs " + whole + one + two + three; }
    const g = /^(.*)\/([^/]*)$/.exec(s);
    if (g) t += "path " + g[1] + ":" + g[2];
    const h = /^(?<key>[^=]+)=(?<value>[^&]*)/.exec(s);
    if (h) t += "pair " + h.groups.key + ":" + h.groups.value;
    const j = /(b)|a(x)?/.exec(s);
    if (j) t += JSON.stringify(j) + j.length;
    out.push(t);
  }
  return out.join("\n");
}
console.log(groups(subjects));
