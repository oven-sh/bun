const seen = [];
process.on = function (name) { seen.push(name); return this; };
process.on("first", () => {});
console.log(seen.join(), Object.keys(process).includes("on"));
console.log(delete process.on, typeof process.on);
process.on("exit", () => console.log("the one above again", seen.length));
