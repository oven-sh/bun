import { beforeAll, mock, test } from "bun:test";
import * as hook from "./hook.mjs";
import * as row from "./row.mjs";
import * as ofTests from "./shared.mjs";
import * as ofLib from "../lib/shared.mjs";
import { mockBesideHelper, readHook, readRow } from "../lib/helper.mjs";

const factory = () => ({ x: "mocked" });
const path = "./hook.mjs";
beforeAll(() => mock.module(path, factory));
beforeAll(mockBesideHelper);
test.each(["./row.mjs"])("a row of each() ends in the mock call: %s", each => mock.module(each, factory));
test("the callback has left by its tail call, so the file that it is written in is who calls", async () => {
  console.log("SAID a hook:", hook.x, await readHook());
  console.log("SAID a row:", row.x, await readRow());
  console.log("SAID a hook of the helper:", ofTests.x, ofLib.x);
});
