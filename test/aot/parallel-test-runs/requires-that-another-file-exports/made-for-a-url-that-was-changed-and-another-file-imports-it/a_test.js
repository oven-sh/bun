import { test } from "bun:test";
import "./src/part.cjs";
import "./src/other/part.cjs";
import { askOwn } from "./src/maker.js";
import { askOther } from "./src/asks.js";
const said = (ask) => { try { return ask(); } catch (e) { return "threw " + e.code; } };
test("which folder", () => {
  console.log("SAID", said(askOwn), "|", said(askOther));
});
