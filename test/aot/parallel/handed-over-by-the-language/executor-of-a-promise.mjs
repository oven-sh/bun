const seen = [];
function executor(resolve, reject) { seen.push("resolve:" + typeof resolve + (resolve === undefined ? "!" : "")); seen.push("reject:" + typeof reject + (reject === undefined ? "!" : "")); if (typeof resolve === "function") resolve(1); }
executor(1, 2);
await new Promise(executor);
console.log(seen.join(" "));
