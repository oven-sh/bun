import { early, earlyVariable } from "./first.mjs";
function attempt(run) { try { return "answered " + String(run()); } catch (error) { return error.constructor.name; } }
export const seen = [
  "import of a const in its dead zone: " + attempt(() => eval("early = 2")),
  "import of a let in its dead zone: " + attempt(() => eval("earlyVariable = 2")),
  "read of it: " + attempt(() => eval("early")),
  "by parts: " + attempt(() => eval("[early] = [2]")),
];
