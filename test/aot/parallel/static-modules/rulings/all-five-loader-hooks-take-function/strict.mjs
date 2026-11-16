import { hooks, suffix } from "./main.cjs";
for (const [object, name] of hooks) {
  const before = object[name + suffix];
  let outcome = "nothing thrown";
  try {
    object[name + suffix] = () => "hooked";
  } catch (error) {
    outcome = error.constructor.name;
  }
  console.log("strict", name, outcome, object[name + suffix] === before ? "as before" : "REPLACED");
}
