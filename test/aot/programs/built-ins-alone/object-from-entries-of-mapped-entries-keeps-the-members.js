const made = Object.fromEntries(Object.entries({ first: 1.5, second: 2.5 }).map(([key, value]) => [key, value * 2]));
console.log(made.first + 1, made.second + 1);
