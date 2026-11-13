import { test, expect } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";

test("assertion inside a child stdout 'data' listener", async () => {
  const child = spawn("sh", ["-c", "printf a; sleep 0.2; printf b; sleep 0.2; printf c"]);
  const seen = [];
  child.stdout.on("data", d => {
    seen.push(String(d));
    expect(String(d)).toBe("a"); // fails on the 2nd chunk
  });
  const [code] = await once(child, "close");
  console.log("close", code, seen.join(","));
});

test("next test still runs", () => {
  expect(1).toBe(1);
});
