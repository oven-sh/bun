if (process.env.MADE_UP_WARM) await import("./kit.cjs");
const { done } = await import("./begin.mjs");
console.log("end", done);
