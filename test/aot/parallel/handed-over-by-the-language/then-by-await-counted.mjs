const seen = [];
class Th { then(resolve, reject) { seen.push("n:" + arguments.length); if (typeof resolve === "function") resolve(1); } }
new Th().then(1);
await new Th();
console.log(seen.join(" "));
