// Import meta require is assigned and called.
import.meta.require = name => console.log("mine", name); import.meta.require("./next.mjs");
