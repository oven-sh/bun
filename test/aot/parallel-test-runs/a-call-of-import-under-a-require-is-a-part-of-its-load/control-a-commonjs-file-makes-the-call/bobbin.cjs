import("./thread.mjs").then(it => { console.log("the call comes with the", it.thread); globalThis.callSettles(); });
console.log("the bobbin ends");
exports.bobbin = "bobbin";
