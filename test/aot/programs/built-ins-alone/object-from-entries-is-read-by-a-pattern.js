const { first, second, third } = Object.fromEntries([["first", 1.5], ["second", "two"]]);
console.log(first + 1, second.length, third === undefined);
