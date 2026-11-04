module.exports = { value: 1 };
import("./module.mjs").then(() => console.log("loaded"), error => console.log("rejected", error.name, error.message.split(" in module")[0]));
throw new Error("the file throws");
