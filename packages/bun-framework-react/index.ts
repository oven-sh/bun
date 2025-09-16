import type { Framework } from "bun:app";

const framework: Framework = {
  fileSystemRouterTypes: [
    {
      root: "pages",
      prefix: "/",
      clientEntryPoint: Bun.fileURLToPath(import.meta.resolve("./client.tsx")),
      serverEntryPoint: Bun.fileURLToPath(import.meta.resolve("./server.tsx")),
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
