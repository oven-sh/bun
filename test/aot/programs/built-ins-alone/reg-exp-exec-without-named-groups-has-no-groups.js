const match = /(a)/.exec("banana");
console.log(match.groups === undefined, typeof match.groups, match.input.length, match.length);
