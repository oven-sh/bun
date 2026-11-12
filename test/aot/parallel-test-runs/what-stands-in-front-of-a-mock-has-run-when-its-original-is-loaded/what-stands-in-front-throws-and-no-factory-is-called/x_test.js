import { test, vi } from "bun:test";
import { order } from "./log.js";
vi.mock("./part.js", async importOriginal => { order.push("factory begins"); const original = await importOriginal(); order.push("factory"); return { part: "mock " + original.part }; });
test("t", async () => console.log(`| SAID ${await import("./a.js").then(ns => ns.a(), e => e.message)} ${order.join(" ")}`));
