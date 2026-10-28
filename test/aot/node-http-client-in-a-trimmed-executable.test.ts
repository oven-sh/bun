// A program that uses the client of node:http or node:https has no `blocked by` line in the trim report. `agent: false` in
// ClientRequest made a fresh agent with `new defaultAgent.constructor()`, and at that site the compiler could not tell the agent's
// class from `Function`: the report was blocked by eval for every program that reaches node:_http_client (#47155). Only that line
// goes: the global object still counts as escaped for these programs, so the interpreter is still kept.
import { expect } from "bun:test";
import { completeness, globalObject, open } from "./runtime-use-expectations";
import { runtimeUse } from "./runtime-use-harness";
import { describe, test } from "./supported";

const onError = `.on("error", () => process.exit(0));`;

describe.concurrent("the client of node:http leaves the report closed", () => {
  test.each([
    [
      "http.get",
      `import http from "node:http";\nhttp.get("http://127.0.0.1:1/", (res: any) => res.resume())${onError}`,
    ],
    [
      "https.get",
      `import https from "node:https";\nhttps.get("https://127.0.0.1:1/", (res: any) => res.resume())${onError}`,
    ],
    [
      "agent: false with both modules loaded",
      `import http from "node:http";\nimport https from "node:https";\n` +
        `http.get({ host: "127.0.0.1", port: 1, agent: false }, (res: any) => res.resume())${onError}\n` +
        `https.get({ host: "127.0.0.1", port: 1, agent: false }, (res: any) => res.resume())${onError}`,
    ],
  ])(
    "%s",
    async (_, text) => {
      const use = await runtimeUse({ "main.ts": text });
      // Nothing blocks --trim. The global object counts as escaped, as with a server of node:http (runtime-use-of-built-in-code.test.ts).
      expect({ ...completeness(use), exitCode: use.exitCode }).toEqual({ ...open(globalObject), exitCode: 0 });
    },
    // A debug build takes minutes over the whole of node:http.
    900_000,
  );
});
