console.log("catches-a-missing-file runs");
export const v = await import("./a-file-that-is-not-there.mjs").catch(error => error.code);
