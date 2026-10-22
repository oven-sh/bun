const joined = [1.5, ,].concat([, 2.5]);
console.log(joined.length, 1 in joined, 2 in joined, joined[1] === undefined, joined[3] + 1);
