import { test } from "bun:test";
test("object-keys-entries", () => {
  
  const kept = Object.keys;
  let asked = 0; let before = "", during = "", after = "";
  for (let turn = 0; turn < 300; turn++) before = String(Object.entries({ a: turn }).length + Object.values({ a: 1 }).length) + JSON.stringify({ a: turn });
  Object.keys = function (o) { asked++; return kept(o); };
  try {
    for (let turn = 0; turn < 300; turn++) during = String(Object.entries({ a: turn }).length + Object.values({ a: 1 }).length) + JSON.stringify({ a: turn });
  } finally {
    Object.keys = kept;
  }
  const askedDuring = asked;
  for (let turn = 0; turn < 300; turn++) after = String(Object.entries({ a: turn }).length + Object.values({ a: 1 }).length) + JSON.stringify({ a: turn });
  console.log(before, "|", during, "|", after, "|", askedDuring, asked);
});
