// Flags: --minify-identifiers
const first = (exports.first = []);
const s = (exports.second = {});
console.log(Object.keys(exports).join(), first.length, typeof s);
