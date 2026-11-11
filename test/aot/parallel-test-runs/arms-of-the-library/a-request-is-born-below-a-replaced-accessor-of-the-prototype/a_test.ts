import { test } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

test("a request asks the accessor that a test has laid in the place of Object.prototype's", async () => {
  let asked = 0;
  let counts = false;
  const seen: number[] = [];
  const server = createServer((request, response) => {
    counts = false;
    seen.push(asked);
    response.end("made up");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  await (await fetch(address)).text();
  const real = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__")!;
  Object.defineProperty(Object.prototype, "__proto__", {
    configurable: true,
    get() {
      if (counts && this instanceof Object && "httpVersion" in this) asked++;
      return real.get!.call(this);
    },
    set: real.set,
  });
  for (let turn = 0; turn < 2; turn++) {
    counts = true;
    await (await fetch(address)).text();
  }
  counts = false;
  Object.defineProperty(Object.prototype, "__proto__", real);
  server.close();
  console.log("the accessor was asked of a request:", seen.join(" "));
});
