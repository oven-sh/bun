function fromCommaInCommonJs() {
  const r = 1 + (0, require)("./c26.cjs").a;
  return r;
}
function fromVariableInCommonJs(path) {
  const r = 1 + (0, require)(path).a;
  return r;
}
function fromDeclared(require) {
  const r = 1 + (0, require)("./c28.cjs").a;
  return r;
}
fromCommaInCommonJs();
fromVariableInCommonJs("./c27.cjs");
fromDeclared(require);
