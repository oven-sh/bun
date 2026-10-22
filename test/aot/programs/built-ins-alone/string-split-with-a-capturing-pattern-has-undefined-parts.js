const parts = "a-b".split(/(-)|(x)/);
console.log(parts.length, parts[1].length, parts[2] === undefined, typeof parts[2], parts[3].length);
