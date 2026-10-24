exports.state = "early";
import("./main.mjs").then(main => console.log("the import() in k sees", main.value));
exports.state = "late";
