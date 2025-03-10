import { describe, beforeAll, it, expect } from "bun:test";
import type { BuildConfig } from "bun";

import { getBaseCompileOptions, type BaseCompileOptions, type SvelteOptions } from "./options";

describe("getBaseCompileOptions", () => {
  describe("when no options are provided", () => {
    const pluginOptions: SvelteOptions = {};
    let fullDefault: Readonly<BaseCompileOptions>;

    beforeAll(() => {
      fullDefault = Object.freeze(getBaseCompileOptions(pluginOptions, {}));
    });

    it("when minification is disabled, whitespace and comments are preserved", () => {
      expect(getBaseCompileOptions(pluginOptions, { minify: false }).component).toEqual(
        expect.objectContaining({
          preserveWhitespace: true,
          preserveComments: true,
        }),
      );
    });

    it("defaults to production mode", () => {
      expect(fullDefault.common.dev).toBeFalse();
    });
  });

  it.each([{}, { side: "server" }, { side: "client" }, { side: undefined }] as Partial<BuildConfig>[])(
    "when present, forceSide takes precedence over config (%o)",
    buildConfig => {
      expect(getBaseCompileOptions({ forceSide: "client" }, buildConfig).common).toEqual(
        expect.objectContaining({
          generate: "client",
        }),
      );
      expect(getBaseCompileOptions({ forceSide: "server" }, buildConfig).common).toEqual(
        expect.objectContaining({
          generate: "server",
        }),
      );
    },
  );
});
