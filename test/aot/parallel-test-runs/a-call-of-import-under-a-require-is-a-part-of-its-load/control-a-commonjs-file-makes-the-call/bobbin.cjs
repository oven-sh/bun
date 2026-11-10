import("./thread.mjs").then(it => console.log("the call comes with the", it.thread));
console.log("the bobbin ends");
exports.bobbin = "bobbin";
