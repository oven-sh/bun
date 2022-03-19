import { __injectFastRefresh } from "./hmr";
export * from "./hmr";
export * from "./errors";
export * from "./index-without-hmr";
import * as __FastRefreshRuntime from "../react-refresh";
if (typeof window !== "undefined") {
  __injectFastRefresh(__FastRefreshRuntime);
}
export { __FastRefreshRuntime };

globalThis.process ||= {
  env: {},
  cwd() {
    return "/bun-fake-dir/";
  },
};
