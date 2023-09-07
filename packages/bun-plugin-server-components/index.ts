import { BunPlugin, BuildConfig } from "bun";

function Plugin(config: { client?: BuildConfig; ssr?: BuildConfig }): BunPlugin {
  return {
    name: "bun-plugin-server-components",
    SECRET_SERVER_COMPONENTS_INTERNALS: config,
  } as any;
}

export default Plugin;
