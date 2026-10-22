const flat = [1.5, 2.5].flatMap((value, index) => (index === 0 ? [value, "text"] : value));
console.log(flat.length, flat[0] + 1, flat[1].length, flat[2] + 1);
