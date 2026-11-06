// Text that is evaluated when the program runs calls and constructs functions of its own.
const which = process.argv[2] ?? "";
const rounds = Number(process.argv[3] ?? "64");
const evaluated = (...parts) => new Function("n", parts.join(process.argv.length > 90 ? " " : ""));
const loops = {
  "a sum": evaluated("let sum = 0; for (let i = 0; i < n; i++) ", "sum += i & 1; return sum;"),
  "a sum of what a function returns": evaluated(
    "function low(value) { return value & 1; } let sum = 0; for (let i = 0; i < n; i++) ",
    "sum += low(i); return sum;",
  ),
  "a sum of what a method returns": evaluated(
    "const held = { low(value) { return value & 1; } }; let sum = 0; for (let i = 0; i < n; i++) ",
    "sum += held.low(i); return sum;",
  ),
  "a sum of what a constructor stores": evaluated(
    "function Low(value) { this.low = value & 1; } let sum = 0; for (let i = 0; i < n; i++) ",
    "sum += new Low(i).low; return sum;",
  ),
};
if (which) console.log(which, loops[which](rounds));
else for (const name in loops) console.log(name, loops[name](rounds));
