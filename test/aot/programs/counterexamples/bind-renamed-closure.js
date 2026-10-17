// `fn.bind(..)` takes the name that `defineProperty` gave fn, whether or not the closure around it escapes.
let keep;
function f(c) {
  const user = () => fn.bind(null), fn = () => 1;
  Object.defineProperty(fn, "name", { value: "renamed" });
  if (c) keep = user;
  return user().name;
}
console.log(f(true), "|", f(false));
