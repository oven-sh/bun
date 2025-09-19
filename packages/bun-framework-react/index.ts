import type { Framework } from "bun:app";

const framework: Framework = {
  fileSystemRouterTypes: [
    {
      root: "pages",
      clientEntryPoint: Bun.fileURLToPath(import.meta.resolve("./client.tsx")),
      serverEntryPoint: Bun.fileURLToPath(import.meta.resolve("./server.tsx")),
      extensions: [".tsx", ".jsx"],
      style: "nextjs-pages",
      layouts: true,
      ignoreUnderscores: true,
    },
  ],

  serverComponents: {
    separateSSRGraph: true,
    serverRegisterClientReferenceExport: "registerClientReference",
    serverRuntimeImportSource: "react-server-dom-bun/server",
  },

  reactFastRefresh: {
    importSource: "react-refresh/runtime",
  },

  bundlerOptions: {
    ssr: {
      conditions: ["react-server"],
    },
  },
};

export default framework;
