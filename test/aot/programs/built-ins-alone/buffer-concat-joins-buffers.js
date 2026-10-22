const joined = Buffer.concat([Buffer.from("ab"), Buffer.from("c")]);
console.log(joined.length + 1, joined[2] + 1, joined.toString());
