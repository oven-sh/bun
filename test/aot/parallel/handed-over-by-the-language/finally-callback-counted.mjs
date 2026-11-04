const seen = [];
function done(value) { seen.push("n:" + arguments.length); }
done(7);
await Promise.resolve("text").finally(done);
console.log(seen.join(" "));
