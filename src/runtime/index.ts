// @ts-nocheck
export * from "./hmr";
export * from "./errors";
export * from "./index-without-hmr";

globalThis.process ||= {
  env: {},
  cwd() {
    return "/bun-fake-dir/";
  },
};
