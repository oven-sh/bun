const seen = [];
class Th { then(resolve, reject) { seen.push("resolve:" + typeof resolve + (resolve === undefined ? "!" : "")); seen.push("reject:" + typeof reject + (reject === undefined ? "!" : "")); if (typeof resolve === "function") resolve(1); } }
new Th().then(1, 2);
await Promise.resolve(new Th());
console.log(seen.join(" "));
