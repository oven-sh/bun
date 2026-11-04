const seen = [];
function reaction(value, more) { seen.push("value:" + typeof value + (value === undefined ? "!" : "")); seen.push("more:" + typeof more + (more === undefined ? "!" : "")); }
reaction(7, 8);
await Promise.resolve("text").then(reaction);
await Promise.reject("text").catch(reaction);
console.log(seen.join(" "));
