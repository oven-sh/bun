const made = Object.assign({}, { first: 1.5 }, { second: "two" }, null, { first: "one" });
console.log(made.first.length, made.second.length, Object.keys(made).join());
