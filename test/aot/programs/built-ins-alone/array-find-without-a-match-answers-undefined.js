const found = [1.5, 2.5].find(value => value > 9);
console.log(found === undefined, typeof found, found ?? 0.5);
