// Nobody catches: the program ends with the error, after its first line and before its last.
// Exit code: 3
var __createBinding = (this && this.__createBinding) || function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
};
var __exportStar = (this && this.__exportStar) && function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
process.on("uncaughtException", error => { console.log("uncaught", error instanceof TypeError, error.message.split(". (In")[0]); process.exitCode = 3; });
const leaf = { first: 1 };
const top = {};
console.log("in front");
__exportStar(leaf, top);
console.log("behind", top.first);
