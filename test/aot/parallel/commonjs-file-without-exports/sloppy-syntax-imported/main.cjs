if (process.argv[99]) require("./plain.cjs");
import("./plain.cjs").catch(error => console.log(error.name));
