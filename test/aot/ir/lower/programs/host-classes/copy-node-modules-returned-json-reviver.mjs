// RUN: lower
// OPTIONS: builtin-modules

// Some members of these modules are defined with getters. A copy reads all of them.
import fs from "node:fs";
import net from "node:net";
import timers from "node:timers";
import util from "node:util";
for (const [name, module] of Object.entries({ fs, net, timers, util })) {
  const returned = JSON.parse("1", () => module);
  const copy = { ...returned };
  const { ...rest } = returned;
  let read = 0;
  for (const key in returned) if (returned[key] !== undefined) read++;
  console.log(name, Object.keys(copy).length, Object.keys(rest).length, Object.keys(Object.assign({}, returned)).length, Object.values(returned).length, read);
}
