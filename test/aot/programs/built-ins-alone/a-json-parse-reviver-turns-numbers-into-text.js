const data = JSON.parse("[1, 2]", (key, value) => (typeof value === "number" ? `n${value}` : value));
console.log(typeof data[0], data[0].length, data[1]);
