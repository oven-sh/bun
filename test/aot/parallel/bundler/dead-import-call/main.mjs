if (false) await import("./missing");
console.log("ran");
const a = await import("./a");
console.log(Object.keys(a).length);
