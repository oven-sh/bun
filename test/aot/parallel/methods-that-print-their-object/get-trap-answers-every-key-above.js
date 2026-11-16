const answer = function (depth, options, inspect) { return "every key, from above: " + (typeof inspect === "function" ? inspect([1]) : typeof inspect); };
console.log(Object.create(new Proxy({}, { get: () => answer })));
