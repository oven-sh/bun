exports.zero = 0;
for (const [index, name] of ["one", "two", "three"].entries()) exports[name] = index + 1;
exports.four = 4;
for (let index = 0; index < 40; index++) exports["generated" + index] = index;
exports.two = "two again";
exports.live = "the module's own name wins";
function __export(m) {
    for (var p in m) if (!exports.hasOwnProperty(p)) exports[p] = m[p];
}
__export(require("./source.cjs"));
