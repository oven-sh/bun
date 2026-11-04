function count(...xs) { return xs.length + ":" + typeof xs[0] + ":" + (0 in xs); }
function first(...xs) { return xs[0]; }
let text = "";
for (let i = 0; i < 3; i++) text += count() + first() + ";";
console.log(text);
