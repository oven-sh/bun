import * as harbor from "./main.mjs";
function read(target) { return "berth" in target; }
function attempt(action) { try { return String(action()); } catch (error) { return error.constructor.name; } }
function ask(named) {
  const say = (what, action) => console.log(what, attempt(action));
  say("keys", () => Object.keys(named).join());
  say("a read", () => read(named));
}
ask(harbor);
