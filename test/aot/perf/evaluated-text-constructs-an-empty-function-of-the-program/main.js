// Text that is evaluated when the program runs makes an object and stores a name on it: the object is a literal, or comes from a function of the program that does nothing.
const which = process.argv[2] ?? "";
const rounds = Number(process.argv[3] ?? "64");
const Empty = function () {};
Empty.prototype = Object.create(null);
const evaluated = (...parts) => new Function("Empty", "n", parts.join(process.argv.length > 90 ? " " : "")).bind(null, Empty);
const loops = {
  "a literal": evaluated("let sum = 0; for (let i = 0; i < n; i++) { const made = {}; ", "made.low = i & 1; sum += made.low; } return sum;"),
  "an object of an empty function": evaluated(
    "let sum = 0; for (let i = 0; i < n; i++) { const made = new Empty(); ",
    "made.low = i & 1; sum += made.low; } return sum;",
  ),
};
if (which) console.log(which, loops[which](rounds));
else for (const name in loops) console.log(name, loops[name](rounds));
