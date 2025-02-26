import { describe, it, expect } from "bun:test";
import { getBaseCompileOptions, type SvelteOptions } from "./options";
import type { BuildConfig } from "bun";

describe("getBaseCompileOptions", () => {
  describe("when no options are provided", () => {
    const pluginOptions: SvelteOptions = {};
    it("when minification is disabled, whitespace and comments are preserved", () => {
      expect(getBaseCompileOptions(pluginOptions, { minify: false })).toEqual(
        expect.objectContaining({
          preserveWhitespace: true,
          preserveComments: true,
        }),
      );
    });
  });

  it.each([{}, { side: "server" }, { side: "client" }, { side: undefined }] as Partial<BuildConfig>[])(
    "when present, forceSide takes precedence over config (%o)",
    buildConfig => {
      expect(getBaseCompileOptions({ forceSide: "client" }, buildConfig)).toEqual(
        expect.objectContaining({
          generate: "client",
        }),
      );
      expect(getBaseCompileOptions({ forceSide: "server" }, buildConfig)).toEqual(
        expect.objectContaining({
          generate: "server",
        }),
      );
    },
  );
});
