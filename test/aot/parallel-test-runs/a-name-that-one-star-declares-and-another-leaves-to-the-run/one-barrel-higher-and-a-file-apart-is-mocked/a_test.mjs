import { test, mock } from "bun:test";
import * as outer from "./outer.mjs";
import * as top from "./top.mjs";
mock.module("./apart.mjs", () => ({ near: 2 }));
const tell = space => typeof space.round + " " + Object.keys(space).join();
test("t", () => { console.log("SAID outer", tell(outer)); console.log("SAID top", tell(top)); });
