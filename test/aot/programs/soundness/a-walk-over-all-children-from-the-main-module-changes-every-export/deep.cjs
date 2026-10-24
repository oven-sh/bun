module.exports = function walk() {
  const seen = new Set();
  const visit = file => {
    if (seen.has(file)) return;
    seen.add(file);
    file.exports.label = seen.size;
    if (file.exports.double) file.exports.double = x => x + "!";
    if (file.exports.prototype?.add) file.exports.prototype.add = x => x + 0.5;
    for (const child of file.children) visit(child);
  };
  visit(require.main);
};
