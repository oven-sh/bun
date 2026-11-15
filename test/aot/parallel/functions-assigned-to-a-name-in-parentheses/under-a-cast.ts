// Bun prints `made = function () {}`: the cast and its parentheses are gone, so the engine names the function.
let made: any;
(made as any) = function () {};
console.log(JSON.stringify(made.name));
