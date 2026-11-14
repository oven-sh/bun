import { test, mock } from "bun:test";
import * as higher from "./higher.mjs";
mock.module("./other.mjs", () => ({ round: 3, far: 4 }));
test("t", () => { console.log("SAID higher", typeof higher.round, Object.keys(higher).join()); });
