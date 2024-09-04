// @ts-nocheck
export * from "./errors";
export * from "./hmr";
export * from "./index-without-hmr";

globalThis.process ||= {
  env: {},
  cwd() {
    return "/bun-fake-dir/";
  },
};
