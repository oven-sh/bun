await vi.hoisted(() => import("./support.mjs"));
import { test, vi } from "bun:test";
import { launch } from "./support.mjs";
test("launch", () => console.log("SAID", launch()));
