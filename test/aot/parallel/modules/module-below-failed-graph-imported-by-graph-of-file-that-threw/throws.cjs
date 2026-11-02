console.log("throws.cjs runs");
import("./between.cjs").then(() => console.log("between loaded"), error => console.log("between rejected:", error.message));
exports.v = 4;
throw new Error("boom");
