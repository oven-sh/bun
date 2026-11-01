// node:util sits in an object, an array and a Map that go through a value that the build cannot follow. Its members are then called under computed names.
import util from "node:util";
const hide = value => new CustomEvent("x", { detail: value }).detail;
const options = { force: { type: "boolean", short: "f" } };
console.log(
  JSON.stringify(hide({ nested: [{ util }] }).nested[0].util[hide("parseArgs")]({ args: ["-f"], options }).values),
);
console.log(hide([util])[0][hide("styleText")]("bold", "x").length > 1);
console.log(
  JSON.stringify(
    hide(new Map([["u", util]]))
      .get("u")
      [hide("parseEnv")]("A=1\nB=two"),
  ),
);
