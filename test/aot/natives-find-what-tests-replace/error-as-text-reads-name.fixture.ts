import { test } from "bun:test";
function ask(m: string) { const e = new Error(m); return String(e) + "|" + e.toString() + "|" + `${e}`; }
test("error-as-text-reads-name", () => {
  let calls = 0; let seen: unknown = "";
  const real = Error.prototype.name; Error.prototype.name = "Replaced";
  try {
    for (let i = 0; i < 300; i++) seen = ask("m");
  } finally {
    Error.prototype.name = real;
  }
  console.log(String(seen), calls);
});
