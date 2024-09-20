// @ts-nocheck
export * as __FastRefreshRuntime from "../react-refresh";
export * from "./errors";
export * from "./hmr";
export * from "./index-without-hmr";

globalThis.process ||= {
  env: {},
  cwd() {
    return "/bun-fake-dir/";
  },
} as any;
