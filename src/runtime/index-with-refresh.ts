// @ts-nocheck
export * from "./hmr";
export * from "./errors";
export * from "./index-without-hmr";
export * as __FastRefreshRuntime from "../react-refresh";

globalThis.process ||= {
  env: {},
  cwd() {
    return "/bun-fake-dir/";
  },
} as any;
