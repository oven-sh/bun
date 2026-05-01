import type { BuildConfig } from "bun";
import { beforeAll, describe, expect, it } from "bun:test";
import type { CompileOptions } from "svelte/compiler";

import { getBaseCompileOptions, validateOptions, type SvelteOptions } from "./options";

describe("getBaseCompileOptions", () => {
  describe("when no options are provided", () => {
    const pluginOptions: SvelteOptions = {};
    let fullDefault: Readonly<CompileOptions>;

    beforeAll(() => {
      fullDefault = Object.freeze(getBaseCompileOptions(pluginOptions, {}));
    });

    it("when minification is disabled, whitespace and comments are preserved", () => {
      expect(getBaseCompileOptions(pluginOptions, { minify: false })).toEqual(
        expect.objectContaining({
          preserveWhitespace: true,
          preserveComments: true,
        }),
      );
    });

    it("defaults to production mode", () => {
      expect(fullDefault.dev).toBeFalse();
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
}); // getBaseCompileOptions

describe("validateOptions(options)", () => {
  it.each(["", 1, null, undefined, true, false, Symbol("hi")])(
    "throws if options is not an object (%p)",
    (badOptions: any) => {
      expect(() => validateOptions(badOptions)).toThrow();
    },
  );
}); // validateOptions
