"use strict";

Object.defineProperty(module, "exports", {
  get: makeQuietBell,
});

let made = 0;

function makeQuietBell() {
  made++;
  const bell = { number: made };
  for (const name of ["ring", "stop", "mute"]) bell[name] = silence;
  Object.defineProperty(bell, "made", { get: () => made, enumerable: false });
  return bell;
}

function silence() {
  return undefined;
}
