// Text handed to the Function constructor takes a name out of null by an object pattern, and an element out of a number by a list pattern.
const frames = error =>
  error.stack
    .split("\n")
    .slice(1, 3)
    .map(line => line.trim().replace(/(file:\/\/)?[^\s()]*[\\/]/, "$1"))
    .join(" | ");
for (const text of ["const { a } =  null;", "const [a] =  n;"]) {
  try {
    new Function("n", text)(1);
  } catch (error) {
    console.log(text, frames(error));
  }
}
try {
  new Function("n", "const { a } =  null;")(1);
} catch (error) {
  console.log(frames(error));
}
