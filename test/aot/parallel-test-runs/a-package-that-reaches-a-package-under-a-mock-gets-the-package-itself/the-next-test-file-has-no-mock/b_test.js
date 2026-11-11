import { test, vi } from "bun:test";
import own from "./own.cjs";
import { seen } from "lamp";
test("t", async () => console.log("SAID " + own.seen() + " " + seen() + " | bodies " + globalThis.bodies + " calls " + globalThis.calls));
