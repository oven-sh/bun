var table = { "--alpha": alpha, theme };
function alpha() {}
function theme(first, second, path, ...rest) {
  path = unquote(path);
}
function unquote(text) {}
exports.pattern = new RegExp(
  Object.keys(table)
    .map(name => `${name}\\(`)
    .join("|"),
);
exports.plain = new RegExp(Object.keys(table).join("|"));
