const data = JSON.parse('{ "first": 1.5, "second": 2.5 }', (key, value) => (key === "first" ? undefined : value));
console.log("first" in data, data.first === undefined, data.second + 1, Object.keys(data).join());
