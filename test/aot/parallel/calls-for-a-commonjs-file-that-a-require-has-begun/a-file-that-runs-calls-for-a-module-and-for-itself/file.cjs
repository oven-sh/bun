log("file<");
keep("file-other", import("./other.mjs"));
keep("file-file", import("./file.cjs"));
exports.name = "file";
log("file>");
