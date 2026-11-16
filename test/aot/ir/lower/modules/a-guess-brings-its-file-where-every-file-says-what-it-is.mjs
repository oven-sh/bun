// RUN: link
// CHECK: module {{*}}path="/$bunfs/root/alone.mjs"

// FILE: main.mjs
// `table` is handed on, so the build can't prove what `table.alone` holds at the call. The site is warned of and made at the run, and the file whose name is written there comes along.
const table = { alone: "./alone.mjs" };
export const seen = JSON.stringify(table);
export function later() {
  return import.meta.require(table.alone);
}

// FILE: alone.mjs
export const alone = 1;
