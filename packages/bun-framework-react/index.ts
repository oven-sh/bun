import type * as Bake from "bun:app";
import { fileURLToPath } from "node:url";

const framework: Bake.Framework = {
  fileSystemRouterTypes: [
    {
      root: "pages",
      prefix: "/",
      clientEntryPoint: fileURLToPath(import.meta.resolve("./client.tsx")),
      serverEntryPoint: fileURLToPath(import.meta.resolve("./server.tsx")),
      extensions: [".tsx", ".jsx"],
      style: "nextjs-pages",
      layouts: true,
      ignoreUnderscores: true,
      ignoreDirs: ["node_modules", ".git"],
    },
  ],

  serverComponents: {
    separateSSRGraph: true,
    serverRuntimeImportSource: "react-server-dom-bun/server",
    serverRegisterClientReferenceExport: "registerClientReference",
  },

  reactFastRefresh: {
    importSource: "react-refresh/runtime",
  },
};

export default framework;
