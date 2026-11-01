// An error at the top level quotes what `bun run` prints: the arm that is kept in the place of the conditional, and that in the place of the variable.
const on = true;
const holder = { a: {} };
const chosen = on ? holder.a : holder.b;
try {
  chosen.b.c;
} catch (error) {
  console.log(error.message);
}
try {
  (on ? holder.a : holder.b).x.y;
} catch (error) {
  console.log(error.message);
}
const text = on ? "kept" : "dropped";
try {
  text.a.b;
} catch (error) {
  console.log(error.message);
}
