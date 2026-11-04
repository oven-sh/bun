import { test } from "bun:test";
import { later, often, stop } from "./app.js";
import { advance, freeze, thaw } from "./clock.js";

// The runner stores its own functions in the place of the timers, and no operation of any file stores anything. The call that makes it do so is reached through a list.
test("the code under test sets the runner's timers", () => {
  const log = [];
  freeze();
  later(log, 1000);
  const timer = often(log, 400);
  console.log("set:", log.join());
  advance(900);
  console.log("900 ms on:", log.join());
  advance(100);
  stop(timer);
  advance(5000);
  console.log("at the end:", log.join());
  thaw();
});
