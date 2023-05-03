import { BunPlugin } from "bun";

function Plugin(config: { client: {} }): BunPlugin {
  return {
    name: "bun-plugin-yaml",
    SECRET_SERVER_COMPONENTS_INTERNALS: {},
  };
}

export default Plugin;
