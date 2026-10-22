const result = JSON.parse('{ "first": 1.5, "second": ["two"] }', "-");
console.log(typeof result, Object.keys(result).join(), typeof result.first, result.first + 1);
console.log(Array.isArray(result.second), result.second.length, typeof result.second[0], result.second[0].length, result.second[0]);
