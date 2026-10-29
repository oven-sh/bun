import * as file from "./file.cjs";
console.log("the entry point lists", Object.keys(file).join(), "early" in file, "late" in file);
console.log("the entry point spreads", { ...file });
setTimeout(() => console.log("a timer lists", Object.keys(file).join(), file.late));
