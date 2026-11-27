import { test } from "bun:test";
import type { AddressInfo } from "node:net";

test("a request is born by as many calls of Math.floor as in plain Bun", async () => {
  let asked = 0;
  let counts = false;
  const real = Math.floor;
  Math.floor = function (value: number) {
    if (counts) asked++;
    return real(value);
  } as typeof Math.floor;
  const { createServer } = require("node:http") as typeof import("node:http");
  const seen: number[] = [];
  const server = createServer((request, response) => {
    counts = false;
    seen.push(asked);
    response.end("made up");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  await (await fetch(address)).text();
  for (let turn = 0; turn < 2; turn++) {
    counts = true;
    await (await fetch(address)).text();
  }
  counts = false;
  Math.floor = real;
  server.close();
  console.log("Math.floor was called:", seen.join(" "));
});
