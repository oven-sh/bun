import { test, mock, spyOn, vi } from "bun:test";
import vm from "node:vm";
import * as wide from "./wide.mjs";
import * as other from "./other.mjs";
import { ask } from "./reader.mjs";

const answer = {};
for (let i = 0; i < 400; i++) answer["n" + i] = "laid" + i;
globalThis.lay = () => mock.module("./wide.mjs", () => answer);
const script = new vm.Script("for (;;) lay();");
const turns = Number(process.env.TURNS ?? 200);

test("cell", () => {
  let timeouts = 0;
  let wrong = 0;
  for (let turn = 0; turn < turns; turn++) {
    try {
      script.runInThisContext({ timeout: 1 });
    } catch (error) {
      if (error.code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") throw error;
      timeouts++;
    }
    spyOn(other, "read").mockRestore();
    mock.module("./other.mjs", () => ({ read: () => "laid" }));
    vi.doUnmock("./wide.mjs");
    if (ask() !== "laid") wrong++;
    vi.doUnmock("./other.mjs");
  }
  console.log("SAID", timeouts > 0, wrong);
}, 120000);
