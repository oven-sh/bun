const { RegExpValidator } = require("/workspace/ref/eslint/node_modules/@eslint-community/regexpp");
const v = new RegExpValidator();
for (const d of [4, 8, 10, 12, 13, 14]) {
  const pat = "(".repeat(d) + "(?<a>x)(?<a>y)" + ")".repeat(d);
  const t = process.hrtime.bigint();
  let msg = "ok";
  try { v.validatePattern(pat, 0, pat.length, { unicode: false, unicodeSets: false }); } catch (e) { msg = e.message.slice(-40); }
  console.log(d, Number(process.hrtime.bigint() - t) / 1e6, "ms", msg);
}
