console.log("between.cjs runs");
import("./second.mjs").then(() => console.log("second loaded"), error => console.log("second rejected:", error.message));
