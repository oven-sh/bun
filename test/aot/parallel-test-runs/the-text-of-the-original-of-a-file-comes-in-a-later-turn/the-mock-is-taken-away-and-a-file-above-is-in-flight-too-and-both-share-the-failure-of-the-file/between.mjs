console.log("the file between begins");
const { depth } = await import("./below.mjs");
export const middle = "between " + depth;
