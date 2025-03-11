import { describe, it, expect } from "bun:test";
import path from "node:path";
import pkg from "../package.json";
import plugin, { VuePlugin } from "../src/index";

const fixture = (...segs: string[]) => path.resolve(import.meta.dir, "fixtures", ...segs);

describe("VuePlugin", () => {
  it("has the same name as the package", () => {
    expect(plugin.name).toBe(pkg.name);
  });
});

describe("Bundling Vue apps", () => {
  describe("Given a valid Vue app", () => {
    const appPath = fixture("App.vue");
    it("should bundle the app", async () => {
      const result = await Bun.build({
        entrypoints: [appPath],
        outdir: fixture("dist"),
        plugins: [VuePlugin()],
      });
      for (const log of result.logs) {
        console.log(log);
      }

      expect(result.success).toBeTrue();
      expect(result.outputs.filter(out => ["js", "ts"].includes(out.loader))).not.toBeEmpty();
    });
  });
});
