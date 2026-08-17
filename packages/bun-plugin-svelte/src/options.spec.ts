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

    it.each([
      [undefined, true],
      [false, true],
      [true, false],
      // any explicit minify object is truthy, so it counts as minifying
      [{ whitespace: true }, false],
      [{ whitespace: false }, false],
    ] as [BuildConfig["minify"], boolean][])("preserveComments follows minify (%o -> %p)", (minify, expected) => {
      expect(getBaseCompileOptions(pluginOptions, { minify })).toEqual(
        expect.objectContaining({
          preserveComments: expected,
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

    it.each([
      [true, true],
      [false, true],
      [true, false],
      [false, false],
    ])("preserveComments: %p overrides the minify-derived default (minify: %p)", (preserveComments, minify) => {
      expect(getBaseCompileOptions({ compilerOptions: { preserveComments } }, { minify })).toEqual(
        expect.objectContaining({ preserveComments }),
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
