const mapped = [1.5, , 2.5].map(value => value * 2);
console.log(mapped.length, 1 in mapped, mapped[1] === undefined, mapped[2] + 1);
