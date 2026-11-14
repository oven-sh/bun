import { test, vi } from "bun:test";
import { sold } from "./sale.mjs";
test("c", async () => { console.log("SAID c", sold(), (await vi.importActual("./tax.mjs")).under()); });
