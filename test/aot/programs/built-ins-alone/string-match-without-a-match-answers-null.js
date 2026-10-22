const match = "banana".match(/x/g);
console.log(match === null, match?.length, (match ?? []).length);
