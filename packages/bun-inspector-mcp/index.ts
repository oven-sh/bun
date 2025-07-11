import { startMcpServer } from "./mcp";
import * as Pkg from "./package.json";
import { define, cli } from "gunshi";

const command = define({
  name: Pkg.name,
  args: {
    url: {
      "type": "positional",
      parse: v => {
        if (!URL.canParse(v)) {
          throw new Error(`Invalid URL: ${v}`);
        }
        return new URL(v);
      },
    },
  },
  run: async ({ values: { url } }) => {
    await startMcpServer({ url: new URL(url) });
  },
});

if (import.meta.main) {
  await cli(process.argv.slice(2), command);
}
