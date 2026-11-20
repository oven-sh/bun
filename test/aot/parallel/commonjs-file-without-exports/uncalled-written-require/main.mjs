if (process.argv[99]) import.meta.require("./plain.cjs");
import("./plain.cjs").then(() => console.log("end"));
