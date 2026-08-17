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

    it("when minification is disabled, comments are preserved", () => {
      expect(getBaseCompileOptions(pluginOptions, { minify: false })).toEqual(
        expect.objectContaining({
          preserveComments: true,
        }),
      );
    });

    // `preserveWhitespace` is a semantic compiler option, not a formatting one: it changes
    // which nodes a component receives. It must not follow the bundler's minify flag.
    it.each([
      undefined,
      false,
      true,
      { whitespace: false },
      { whitespace: true },
      { syntax: true },
      { identifiers: true },
    ] as BuildConfig["minify"][])("preserveWhitespace does not follow minify (%o)", minify => {
      expect(getBaseCompileOptions(pluginOptions, { minify })).toEqual(
        expect.objectContaining({
          preserveWhitespace: false,
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
  describe("compilerOptions", () => {
    it.each([true, false])("forwards preserveWhitespace: %p", preserveWhitespace => {
      expect(getBaseCompileOptions({ compilerOptions: { preserveWhitespace } }, {})).toEqual(
        expect.objectContaining({ preserveWhitespace }),
      );
    });

    it.each([true, false])("forwards preserveComments: %p", preserveComments => {
      expect(getBaseCompileOptions({ compilerOptions: { preserveComments } }, {})).toEqual(
        expect.objectContaining({ preserveComments }),
      );
    });

    it("preserveWhitespace overrides the minify-derived default", () => {
      expect(getBaseCompileOptions({ compilerOptions: { preserveWhitespace: true } }, { minify: true })).toEqual(
        expect.objectContaining({ preserveWhitespace: true }),
      );
    });
  }); // compilerOptions

}); // getBaseCompileOptions

describe("validateOptions(options)", () => {
  it.each(["", 1, null, undefined, true, false, Symbol("hi")])(
    "throws if options is not an object (%p)",
    (badOptions: any) => {
      expect(() => validateOptions(badOptions)).toThrow();
    },
  );
}); // validateOptions
