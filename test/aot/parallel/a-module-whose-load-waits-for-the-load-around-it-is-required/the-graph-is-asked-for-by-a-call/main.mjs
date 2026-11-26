const all = await import("./inner.mjs");
console.log("main got", all.answer);
