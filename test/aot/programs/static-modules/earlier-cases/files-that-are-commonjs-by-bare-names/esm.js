const module = { exports: "a local called module" }, exports = "a local called exports";
export const seen = module.exports + " / " + exports;
