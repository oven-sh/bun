// @bun
// A file with that mark runs as it stands: the engine sees the parentheses and gives no name.
let made;
(made) = function () {};
console.log(JSON.stringify(made.name));
