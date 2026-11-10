export const value = "real";
export const later = () => Object.keys(import.meta.require("./lib.mjs")).sort().join();
