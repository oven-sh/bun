console.log("awaits-a-file runs");
export const v = (await import("./a-file.mjs")).name;
