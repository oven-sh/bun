exports.first = function () { return "first ran"; };
exports.second = function () { return "second ran"; };
const box = { resolve: require.resolve, load: require };
console.log(box.resolve("asked"));
console.log(typeof box.load("asked for a module").sep);
