console.log("awaits-a-computed-missing-file runs");
const name = ["a", "file", "that", "is", "not", "there"].join("-");
export const v = await import("./" + name + ".mjs");
