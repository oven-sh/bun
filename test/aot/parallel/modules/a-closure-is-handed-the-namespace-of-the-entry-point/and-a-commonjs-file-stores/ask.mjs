import tools from "./tools.cjs";
function attempt(action) { try { return String(action()); } catch (error) { return error.constructor.name; } }
export function ask(named) {
  const say = (what, action) => console.log(what, attempt(action));
  say("keys", () => Object.keys(named).join());
  say("a store in sloppy code", () => tools.store(named));
}
