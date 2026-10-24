// JSON.stringify reads every member. What makes the members of `process` is in the executable, so the walk ends as in plain Bun.
let text;
try {
  text = typeof JSON.stringify(process);
} catch (error) {
  text = error.constructor.name;
}
console.log(text);
