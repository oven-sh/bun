const text = String(process.argv.length);
let first = "a" + text;
let second = text.length + 1;
exports.first = first;
exports.second = second;
exports.read = () => first + ":" + second;
