import { expect } from "bun:test";
import { casesOfOneRun, sayOf } from "./harness/cases-of-one-run";
import { test } from "./supported";

// Under `bun run` a mock stands in place of a built-in module that no import has loaded, and no import runs the real module from then on.
// It runs when the library itself needs it, or a require() of its `node:` name, which no mock reaches.
// A replaced Object.keys tells whether it ran: what node:zlib, node:stream and node:http load throws on one that answers nonsense, and calls one that counts.
const project = casesOfOneRun("a-mock-of-a-built-in-module-keeps-the-real-module-from-running", {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": "{}",
});

function runsAsPlain(title: string, body: string, files: Record<string, string> = {}) {
  const name = project.add(
    name => `
      import { mock, test } from "bun:test";
      ${sayOf(name)}
      const keys = Object.keys;
      const nonsense = () => ["nonsense"];
      function mocked() { return "mocked"; }
      class Mocked { say() { return "mocked"; } }
      test("${name}", async () => {
        try {${body.replaceAll("console.log(", "say(")}
        } catch (error) {
          Object.keys = keys;
          say("threw", mocked(), error.name);
        } finally {
          Object.keys = keys;
        }
      });`,
    files,
  );
  test(title, async () => {
    const plain = (await project.ran()).get(name);
    expect(plain?.result).toBe("pass");
    expect(plain?.printed).toContain("mocked");
    expect((await project.ran(["--debug-aot"])).get(name)).toEqual(plain);
  });
}

for (const [module, member] of [
  ["node:zlib", "crc32"],
  ["node:stream", "Readable"],
  ["node:http", "get"],
]) {
  runsAsPlain(
    `import("${module}") behind a mock, with an Object.keys that the real module throws on`,
    `
          Object.keys = nonsense;
          mock.module("${module}", () => ({ ${member}: mocked }));
          const imported = await import("${module}");
          Object.keys = keys;
          console.log(imported.${member}(), keys(imported).join());`,
  );
}

runsAsPlain(
  "the real module calls nothing that the test has replaced",
  `
          let calls = 0;
          Object.keys = object => (calls++, keys(object));
          mock.module("node:http", () => ({ get: mocked }));
          mock.module("undici", () => ({ fetch: mocked }));
          const answers = [(await import("node:http")).get(), require("undici").fetch(), (await import("undici")).fetch()];
          Object.keys = keys;
          console.log(answers.join(), calls);`,
);

runsAsPlain(
  "a file that imports the module by statements and loads behind the mock",
  `
          Object.keys = nonsense;
          mock.module("node:zlib", () => ({ crc32: mocked, default: { crc32: mocked } }));
          const { all, call, whole } = await import("./helper.js");
          Object.keys = keys;
          console.log(call(), whole.crc32(), keys(all).join(), typeof all.gzipSync);`,
  {
    "helper.js": `
      import whole, { crc32 } from "node:zlib";
      import * as all from "node:zlib";
      export const call = () => crc32("a");
      export { all, whole };`,
  },
);

runsAsPlain(
  "files that hand the names of the module on",
  `
          Object.keys = nonsense;
          mock.module("node:zlib", () => ({ crc32: mocked, more: 1 }));
          const every = await import("./every.js"), one = await import("./one.js");
          Object.keys = keys;
          console.log(keys(every).join(), every.crc32(), keys(one).join(), one.sum());`,
  {
    "every.js": `export * from "node:zlib";`,
    "one.js": `export { crc32 as sum } from "node:zlib";`,
  },
);

runsAsPlain(
  "a second mock before anything has imported the module",
  `
          Object.keys = nonsense;
          mock.module("node:zlib", () => ({ crc32: () => "the first" }));
          mock.module("node:zlib", () => ({ crc32: mocked, more: 1 }));
          const zlib = await import("node:zlib");
          Object.keys = keys;
          console.log(zlib.crc32(), keys(zlib).join());`,
);

runsAsPlain(
  "require() of the node: name runs the real module later, and the mock stays where it stands",
  `
          Object.keys = nonsense;
          mock.module("node:zlib", () => ({ crc32: mocked }));
          const { call } = await import("./helper.js");
          Object.keys = keys;
          const required = require("node:zlib");
          console.log(call(), required.crc32 === mocked, required.crc32("a"), required.gunzipSync(required.gzipSync("text")).toString());
          console.log(call(), (await import("node:zlib")).crc32("a"), require("node:zlib") === required);`,
  { "helper.js": `import { crc32 } from "node:zlib";\nexport const call = () => crc32("a");` },
);

runsAsPlain(
  "the library gets the real module, and the mock stays where it stands",
  `
          Object.keys = nonsense;
          mock.module("node:stream", () => ({ Readable: Mocked }));
          const { make } = await import("./helper.js");
          Object.keys = keys;
          const zlib = await import("node:zlib");
          console.log(make().say(), typeof zlib.createGzip().pipe, zlib.gunzipSync(zlib.gzipSync("text")).toString());
          console.log(make().say(), new (await import("node:stream")).Readable().say());`,
  { "helper.js": `import { Readable } from "node:stream";\nexport const make = () => new Readable();` },
);

runsAsPlain(
  "a CommonJS file that requires the node: name while the real module cannot load",
  `
          Object.keys = nonsense;
          mock.module("node:zlib", () => ({ crc32: mocked }));
          const { first } = require("./helper.cjs");
          Object.keys = keys;
          console.log(mocked(), first, (await import("node:zlib")).crc32());`,
  {
    "helper.cjs": `
      try {
        module.exports.first = typeof require("node:zlib").gzipSync;
      } catch (error) {
        module.exports.first = error.name;
      }`,
  },
);

runsAsPlain(
  "the module was required before the mock, and a file imports it by statements behind it",
  `
          const first = require("node:zlib");
          mock.module("node:zlib", () => ({ crc32: mocked }));
          const { all, call } = await import("./helper.js");
          console.log(call(), keys(all).join(), typeof all.gzipSync, first.crc32 === mocked, require("node:zlib") === first);`,
  {
    "helper.js": `
      import { crc32 } from "node:zlib";
      import * as all from "node:zlib";
      export const call = () => crc32("a");
      export { all };`,
  },
);

// The mock has its own names alone, so the file does not link.
runsAsPlain(
  "a file imports a name that the real module has and the mock lacks",
  `
          mock.module("node:zlib", () => ({ crc32: mocked }));
          console.log(typeof (await import("./helper.js")).gzipSync);`,
  { "helper.js": `import { gzipSync } from "node:zlib";\nexport { gzipSync };` },
);

runsAsPlain(
  "a file imports the default export, which the mock lacks",
  `
          mock.module("node:zlib", () => ({ crc32: mocked }));
          console.log(typeof (await import("./helper.js")).whole);`,
  { "helper.js": `import whole from "node:zlib";\nexport { whole };` },
);

runsAsPlain(
  "a file hands on a name that the real module has and the mock lacks",
  `
          mock.module("node:zlib", () => ({ crc32: mocked }));
          console.log(typeof (await import("./helper.js")).gzipSync);`,
  { "helper.js": `export { gzipSync } from "node:zlib";` },
);
