import { test, vi } from "bun:test";
import "./panel.cjs";
vi.hoisted(() => {
  (globalThis as any).probe = () => {
    try {
      return "probe got " + require("./sensor.cjs").level;
    } catch (error: any) {
      return "probe caught " + error.message;
    }
  };
});
test("panel", () => { console.log("panel shows", (globalThis as any).shown); });
