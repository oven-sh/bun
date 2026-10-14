// Packages reached through symbolic links, as pnpm, workspaces and isolated installs lay them out: one real path, one instance.
import { js, ts, type Case } from "./run-packages";

export const cases: Case[] = [
  {
    name: "store",
    files: {
      "store/linked@1.0.0/node_modules/linked/package.json": `{ "name": "linked", "version": "1.0.0", "main": "index.js", "types": "index.d.ts" }`,
      "store/linked@1.0.0/node_modules/linked/index.js": `const peer = require("linked_peer");
let n = 0;
exports.inc = () => ++n;
exports.peer = peer.name;
exports.where = __dirname.split("/").slice(-4).join("/");
exports.K = class K {};
`,
      "store/linked@1.0.0/node_modules/linked/index.d.ts": `export declare function inc(): number;
export declare const peer: string;
export declare const where: string;
export declare class K {}
`,
      "store/linked_peer@1.0.0/node_modules/linked_peer/package.json": `{ "name": "linked_peer", "version": "1.0.0", "main": "index.js" }`,
      "store/linked_peer@1.0.0/node_modules/linked_peer/index.js": `exports.name = "the peer in the store";
`,
      "store/user@1.0.0/node_modules/user/package.json": `{ "name": "user", "version": "1.0.0", "main": "index.js" }`,
      "store/user@1.0.0/node_modules/user/index.js": `const l = require("linked");
exports.inc = l.inc;
exports.K = l.K;
exports.l = l;
`,
      "workspace/wsp/package.json": `{ "name": "wsp", "version": "1.0.0", "main": "src/index.ts" }`,
      "workspace/wsp/src/index.ts": `import { inc } from "linked";
export const viaWs = (): number => inc();
export class W { n: number = 1; }
`,
    },
    links: {"node_modules/linked": "../store/linked@1.0.0/node_modules/linked", "node_modules/user": "../store/user@1.0.0/node_modules/user", "node_modules/wsp": "../workspace/wsp", "store/linked@1.0.0/node_modules/linked_peer": "../../linked_peer@1.0.0/node_modules/linked_peer", "store/user@1.0.0/node_modules/linked": "../../linked@1.0.0/node_modules/linked", "workspace/wsp/node_modules/linked": "../../../store/linked@1.0.0/node_modules/linked"},
    importers: {
      "one_instance.mjs": `import * as l from "linked";
import u from "user";
${js}t("x", () => [l.inc(), u.inc(), l.inc(), u.K === l.K, u.l === l.default, l.peer, l.where]);
`,
      "one_instance.cjs": `${js}const l = require("linked"), u = require("user");
t("x", () => [l.inc(), u.inc(), l.inc(), u.K === l.K, u.l === l, l.peer, l.where]);
`,
      "one_instance.ts": `import { inc, K, peer } from "linked";
import { viaWs, W } from "wsp";
${ts}t("x", () => [inc() + 0, viaWs(), inc(), peer, new W().n, typeof K]);
`,
      "by_real_path.mjs": `import * as a from "linked";
import * as b from "./store/linked@1.0.0/node_modules/linked/index.js";
${js}t("x", () => [a.inc(), b.inc(), a.K === b.K]);
`,
    },
  },
];
