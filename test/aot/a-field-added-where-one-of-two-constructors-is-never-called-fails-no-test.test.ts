// Two constructors reach a `new`, a function and a class, and the function is never called: TypeScript's services replace the constructors of its allocator like this.
// A store that adds a field to the objects passes its guard from the first time on. The counts are exact: no clock and no machine decides them.
import { expect } from "bun:test";
import { tempDirWithBunTypes as tempDir } from "harness";
import { slot } from "./harness/commands";
import { buildCounted, countScript } from "./harness/counted-run";
import { test } from "./supported";

const store = "node.symbol = symbol;";
const files = {
  "rounds.js": `
    function PlainNode(kind) {
      this.kind = kind;
      this.parent = undefined;
    }
    class NodeObject {
      constructor(kind) {
        this.kind = kind;
        this.parent = undefined;
      }
    }
    const allocator = { getNodeConstructor: () => PlainNode };
    if (!process.env.PLAIN_NODES) allocator.getNodeConstructor = () => NodeObject;
    // Whoever listens may do anything to what it is handed.
    process.emit(process.env.EVENT ?? "nothing", PlainNode, NodeObject);

    const nodes = [];
    function createNode(kind) {
      const Node = allocator.getNodeConstructor();
      nodes.push(new Node(kind));
    }
    function bind(position, symbol) {
      const node = nodes[position];
      ${store}
    }
    const units = Number(process.argv[2]);
    for (let unit = 0; unit < units; unit++) createNode(unit);
    for (let unit = 0; unit < units; unit++) bind(unit, { name: "s" + unit });
    console.log(nodes.every(node => Object.keys(node).join() === "kind,parent,symbol") ? "ok" : "no");
  `,
};

test(
  "a field added to objects of a class that shares the store with a function never called",
  () =>
    slot(async () => {
      using dir = tempDir("aot-one-of-two-constructors-is-never-called", files);
      const folder = String(dir);
      const work = await countScript(await buildCounted(folder, "./rounds.js"), folder, "ok\n", {
        warmUp: 2,
        units: 10,
      });
      const guards = [...work.tests, ...work.uneven].filter(
        counted => counted.kind === "AreMembersUnchanged" && counted.position === files["rounds.js"].indexOf(store),
      );
      // A renamed test would count nothing.
      expect(guards.map(counted => ({ executed: counted.executed, failed: counted.failed }))).toEqual([
        { executed: 1, failed: 0 },
      ]);
    }),
  300_000,
);
