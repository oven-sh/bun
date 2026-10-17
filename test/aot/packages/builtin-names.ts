// Packages in node_modules that are named like modules of Node: `require("events")` is Node's, `require("events/")` is the package.
import { js, pkg, type Case } from "./run-packages";

export const cases: Case[] = [
  {
    name: "named-like-builtins",
    files: {
      ...pkg("events", {
        "index.js": `exports.iAmThePackage = "events from node_modules";
`,
      }, {"main": "index.js"}),
      ...pkg("buffer", {
        "index.js": `exports.iAmThePackage = "buffer from node_modules";
`,
      }, {"main": "index.js"}),
      ...pkg("util", {
        "index.js": `exports.iAmThePackage = "util from node_modules";
`,
      }, {"main": "index.js"}),
      ...pkg("punycode", {
        "index.js": `exports.iAmThePackage = "punycode from node_modules";
`,
      }, {"main": "index.js"}),
      ...pkg("process", {
        "index.js": `exports.iAmThePackage = "process from node_modules";
`,
      }, {"main": "index.js"}),
      ...pkg("string_decoder", {
        "index.js": `exports.iAmThePackage = "string_decoder from node_modules";
`,
      }, {"main": "index.js"}),
      ...pkg("assert", {
        "index.js": `exports.iAmThePackage = "assert from node_modules";
`,
      }, {"main": "index.js"}),
      ...pkg("path", {
        "index.js": `exports.iAmThePackage = "path from node_modules";
`,
      }, {"main": "index.js"}),
      ...pkg("url", {
        "index.js": `exports.iAmThePackage = "url from node_modules";
`,
      }, {"main": "index.js"}),
      ...pkg("stream", {
        "index.js": `exports.iAmThePackage = "stream from node_modules";
`,
      }, {"main": "index.js"}),
    },
    importers: {
      "events.cjs": `${js}t("bare", () => require("events").iAmThePackage); t("slash", () => require("events/").iAmThePackage); t("node:", () => require("node:events").iAmThePackage); t("index", () => require("events/index.js").iAmThePackage);
`,
      "events.mjs": `import * as bare from "events";
import * as slash from "events/";
${js}t("bare", () => bare.iAmThePackage); t("slash", () => slash.iAmThePackage);
`,
      "buffer.cjs": `${js}t("bare", () => require("buffer").iAmThePackage); t("slash", () => require("buffer/").iAmThePackage); t("node:", () => require("node:buffer").iAmThePackage); t("index", () => require("buffer/index.js").iAmThePackage);
`,
      "buffer.mjs": `import * as bare from "buffer";
import * as slash from "buffer/";
${js}t("bare", () => bare.iAmThePackage); t("slash", () => slash.iAmThePackage);
`,
      "util.cjs": `${js}t("bare", () => require("util").iAmThePackage); t("slash", () => require("util/").iAmThePackage); t("node:", () => require("node:util").iAmThePackage); t("index", () => require("util/index.js").iAmThePackage);
`,
      "util.mjs": `import * as bare from "util";
import * as slash from "util/";
${js}t("bare", () => bare.iAmThePackage); t("slash", () => slash.iAmThePackage);
`,
      "punycode.cjs": `${js}t("bare", () => require("punycode").iAmThePackage); t("slash", () => require("punycode/").iAmThePackage); t("node:", () => require("node:punycode").iAmThePackage); t("index", () => require("punycode/index.js").iAmThePackage);
`,
      "punycode.mjs": `import * as bare from "punycode";
import * as slash from "punycode/";
${js}t("bare", () => bare.iAmThePackage); t("slash", () => slash.iAmThePackage);
`,
      "process.cjs": `${js}t("bare", () => require("process").iAmThePackage); t("slash", () => require("process/").iAmThePackage); t("node:", () => require("node:process").iAmThePackage); t("index", () => require("process/index.js").iAmThePackage);
`,
      "process.mjs": `import * as bare from "process";
import * as slash from "process/";
${js}t("bare", () => bare.iAmThePackage); t("slash", () => slash.iAmThePackage);
`,
      "string_decoder.cjs": `${js}t("bare", () => require("string_decoder").iAmThePackage); t("slash", () => require("string_decoder/").iAmThePackage); t("node:", () => require("node:string_decoder").iAmThePackage); t("index", () => require("string_decoder/index.js").iAmThePackage);
`,
      "string_decoder.mjs": `import * as bare from "string_decoder";
import * as slash from "string_decoder/";
${js}t("bare", () => bare.iAmThePackage); t("slash", () => slash.iAmThePackage);
`,
      "assert.cjs": `${js}t("bare", () => require("assert").iAmThePackage); t("slash", () => require("assert/").iAmThePackage); t("node:", () => require("node:assert").iAmThePackage); t("index", () => require("assert/index.js").iAmThePackage);
`,
      "assert.mjs": `import * as bare from "assert";
import * as slash from "assert/";
${js}t("bare", () => bare.iAmThePackage); t("slash", () => slash.iAmThePackage);
`,
      "path.cjs": `${js}t("bare", () => require("path").iAmThePackage); t("slash", () => require("path/").iAmThePackage); t("node:", () => require("node:path").iAmThePackage); t("index", () => require("path/index.js").iAmThePackage);
`,
      "path.mjs": `import * as bare from "path";
import * as slash from "path/";
${js}t("bare", () => bare.iAmThePackage); t("slash", () => slash.iAmThePackage);
`,
      "url.cjs": `${js}t("bare", () => require("url").iAmThePackage); t("slash", () => require("url/").iAmThePackage); t("node:", () => require("node:url").iAmThePackage); t("index", () => require("url/index.js").iAmThePackage);
`,
      "url.mjs": `import * as bare from "url";
import * as slash from "url/";
${js}t("bare", () => bare.iAmThePackage); t("slash", () => slash.iAmThePackage);
`,
      "stream.cjs": `${js}t("bare", () => require("stream").iAmThePackage); t("slash", () => require("stream/").iAmThePackage); t("node:", () => require("node:stream").iAmThePackage); t("index", () => require("stream/index.js").iAmThePackage);
`,
      "stream.mjs": `import * as bare from "stream";
import * as slash from "stream/";
${js}t("bare", () => bare.iAmThePackage); t("slash", () => slash.iAmThePackage);
`,
    },
  },
];
