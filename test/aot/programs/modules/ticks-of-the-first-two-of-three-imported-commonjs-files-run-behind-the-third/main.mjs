// The first two of three imported CommonJS files queue a tick each. Both ticks run behind the third file and ahead of this module. Plain Bun prints another output.
import "./zero.cjs";
import "./first.cjs";
import "./second.cjs";
console.log("main runs");
