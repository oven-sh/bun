console.log("the body of the file begins");
const { depth } = await import("./below.mjs");
export const opening = "opening " + depth;
