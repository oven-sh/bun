// The tokens of regexps-built-at-start.ts and of its twin, in the style of the package semver: one function makes every expression, and the text of a token is put together out of the texts of earlier ones.
const re = (exports.re = []);
const src = (exports.src = []);
const t = (exports.t = {});
let R = 0;
const createToken = (name, value, isGlobal) => {
  const index = R++;
  t[name] = index;
  src[index] = value;
  re[index] = new RegExp(value, isGlobal ? "g" : undefined);
};
exports.createToken = createToken;
createToken("NUMERICIDENTIFIER", "0|[1-9]\\d*");
createToken("NONNUMERICIDENTIFIER", "\\d*[a-zA-Z-][a-zA-Z0-9-]*");
createToken("MAINVERSION", `(${src[t.NUMERICIDENTIFIER]})\\.` + `(${src[t.NUMERICIDENTIFIER]})\\.` + `(${src[t.NUMERICIDENTIFIER]})`);
createToken("PRERELEASEIDENTIFIER", `(?:${src[t.NUMERICIDENTIFIER]}|${src[t.NONNUMERICIDENTIFIER]})`);
createToken("PRERELEASE", `(?:-(${src[t.PRERELEASEIDENTIFIER]}(?:\\.${src[t.PRERELEASEIDENTIFIER]})*))`);
createToken("FULL", `^v?${src[t.MAINVERSION]}${src[t.PRERELEASE]}?$`);
createToken("COERCE", `(^|[^\\d])(\\d{1,16})(?:\\.(\\d{1,16}))?`, true);
