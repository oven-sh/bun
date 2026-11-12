const event = new CustomEvent("x", { detail: (depth, options, inspect) => "the library stores what an event held: " + inspect({ a: 1 }) });
console.log(require("node:querystring").decode("a=b", null, null, { decodeURIComponent: text => (text === "a" ? Bun.inspect.custom : event.detail) }));
