const made = Object.create(null, { first: { value: 1.5, enumerable: true }, second: { get: () => "two" } });
console.log(made.first + 1, made.second.length, Object.keys(made).join());
