// It has ES syntax: the names are its own.
const module = { exports: "a local of an ES module" }, exports = "another";
export const stillEs: string = module.exports + ", " + exports;
