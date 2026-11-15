// A closure escapes, comes back as a value nobody follows and is renamed there by a statement of the program. Its siblings are not. Each is then called where the compiler knows the callee, and by value.
const never = process.argv.length > 1000 ? "x" : "";
const unknown = new Function("f", "return f;" + never);
const first = stack => stack.split("\n")[1].trim().replace(/ ?\(.*\)$/, "");
function make(n) {
  return function made() {
    return new Error("x" + n).stack;
  };
}
const renames = {
  "displayName by Reflect.set": f => void Reflect.set(unknown(f), unknown("displayName"), "displayed"),
};
for (const [how, rename] of Object.entries(renames)) {
  const a = make(1), b = make(2), c = make(3);
  unknown(a), unknown(b), unknown(c);
  const direct = () => [first(a()), first(b()), first(c())].join(" ");
  const byValue = () => [a, b, c].map(f => first(unknown(f)())).join(" ");
  let warm = "";
  for (let i = 0; i < unknown(300); ++i) warm = direct() + " | " + byValue();
  rename(b);
  let after = "";
  for (let i = 0; i < unknown(300); ++i) after = direct() + " | " + byValue();
  console.log(how + ": " + warm + " || " + after);
}
