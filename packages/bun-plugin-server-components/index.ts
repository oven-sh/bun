import { BunPlugin, BuildConfig } from "bun";

function Plugin(config: { client?: BuildConfig; server?: BuildConfig }): BunPlugin {
  return {
    name: "bun-plugin-yaml",
    SECRET_SERVER_COMPONENTS_INTERNALS: config,
  } as any;
}

export default Plugin;
