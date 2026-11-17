var fs = require("fs");
var path = require("path");

exports.FILES = [
    require.resolve("../lib/utils.js"),
    require.resolve("../lib/nodes.js"),
    require.resolve("../lib/print.js"),
    require.resolve("./exports.js"),
];

var make = new Function("words", "exports", function() {
    var code = exports.FILES.map(function(file) {
        return fs.readFileSync(file, "utf8");
    });
    code.push("exports.describe = " + describe.toString());
    return exports.source = code.join("\n\n");
}());
exports.make = make;
exports.length = make.toString().length;
make(require("./words.json"), exports);

function describe() {
    return member("if", WORDS) + " " + NODE_Any.TYPE + " “quoted”";
}

// The program itself reads another text.
exports.patched = function () {
    var read = fs.readFileSync;
    fs.readFileSync = function (file, encoding) {
        return read.call(fs, file, encoding).replace("20", "30");
    };
    try {
        return new Function("a", fs.readFileSync(path.join(__dirname, "../lib/body.js"), "utf8"))(1);
    } finally {
        fs.readFileSync = read;
    }
};
exports.fromBytes = new Function("a", fs.readFileSync(path.join(__dirname, "..", "lib", "body.js")).toString());
exports.fromTemplate = new Function("a", `${fs.readFileSync(`${__dirname}/../lib/body.js`, { encoding: "utf-8" })}`);
exports.perCall = function (b) {
    return new Function("a", fs.readFileSync(__dirname + "/../lib/body.js", "utf8"));
};
