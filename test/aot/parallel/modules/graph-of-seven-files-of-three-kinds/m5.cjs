require("./show.cjs");
say("m5 begins");
Object.defineProperty(exports, "first", { enumerable: true, get: () => "m5.first by a getter" });
exports.second = { of: "m5" };
say("m5 ends");
