import type * as Bake from "bun:app";

const framework: Bake.Framework = {
  fileSystemRouterTypes: [
    {
      root: "pages",
      prefix: "/",
      clientEntryPoint: "./client.tsx",
      serverEntryPoint: "./server.tsx",
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
