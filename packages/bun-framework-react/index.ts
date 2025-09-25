import type { Framework } from "bun:app";

function resolve(specifier: string) {
  return require.resolve(specifier);
}

const framework: Framework = {
  fileSystemRouterTypes: [
    {
      root: "pages",
      clientEntryPoint: resolve("./client.tsx"),
      serverEntryPoint: resolve("./server.tsx"),
      extensions: [".tsx", ".jsx"],
      style: "nextjs-pages",
      layouts: true,
      ignoreUnderscores: true,
      prefix: "/",
      ignoreDirs: ["node_modules", ".git"],
    },
  ],
  serverComponents: {
    separateSSRGraph: true,
    serverRegisterClientReferenceExport: "registerClientReference",
    serverRuntimeImportSource: resolve("./vendor/react-server-dom-bun/server"),
  },
  reactFastRefresh: {
    importSource: resolve("react-refresh/runtime"),
  },
  bundlerOptions: {
    ssr: {
      conditions: ["react-server"],
    },
  },
};

export default framework;
