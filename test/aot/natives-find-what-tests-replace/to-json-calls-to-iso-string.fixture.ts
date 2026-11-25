import { test } from "bun:test";
function written(ms: number) {
  const date = new Date(ms);
  return date.toJSON();
}
test("toJSON calls the toISOString that it finds", () => {
  const real = Date.prototype.toISOString;
  Date.prototype.toISOString = function () { return "replaced"; };
  let seen: string | null = "";
  try {
    for (let i = 0; i < 300; i++) seen = written(i);
  } finally {
    Date.prototype.toISOString = real;
  }
  console.log(seen);
});
