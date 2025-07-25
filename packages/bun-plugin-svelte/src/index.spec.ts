import { describe, expect, it } from "bun:test";
import { SveltePlugin } from "./index";

describe("SveltePlugin", () => {
  it.each([true, false, 0, 1, "hi"])("throws if passed a non-object (%p)", (badOptions: any) => {
    expect(() => SveltePlugin(badOptions)).toThrow(TypeError);
  });
  it("may be nullish or not provided", () => {
    expect(() => SveltePlugin()).not.toThrow();
    expect(() => SveltePlugin(null as any)).not.toThrow();
    expect(() => SveltePlugin(undefined)).not.toThrow();
  });

  it.each([1, "hi", {}, "Client"])("throws if forceSide is not 'client' or 'server' (%p)", (forceSide: any) => {
    expect(() => SveltePlugin({ forceSide })).toThrow(TypeError);
  });

  it.each([null, undefined])("forceSide may be nullish", (forceSide: any) => {
    expect(() => SveltePlugin({ forceSide })).not.toThrow();
  });
});
