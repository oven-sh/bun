const seen = [];
function done(value) { seen.push("value:" + typeof value + (value === undefined ? "!" : "")); }
done(7);
await Promise.resolve("text").finally(done);
console.log(seen.join(" "));
