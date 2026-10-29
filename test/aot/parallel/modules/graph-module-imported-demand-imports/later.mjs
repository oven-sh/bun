console.log("later runs");
export const loaded = import("./deep-0.mjs").then(() => console.log("later then deep"));
