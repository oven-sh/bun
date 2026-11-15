const { done } = await import("./begin.mjs");
console.log("end", done);
if (process.env.MADE_UP_RELOAD) console.log(Object.keys(await import("./kit.cjs")).length);
