import type { Framework } from "bun:app";

function resolve(specifier: string) {
  return Bun.fileURLToPath(import.meta.resolve(specifier));
}

const framework: Framework = {
  serverComponents: {
    separateSSRGraph: true,
    serverRuntimeImportSource: resolve("./vendor/react-server-dom-bun/server.node.js"),
  },
  reactFastRefresh: {
    importSource: resolve("react-refresh/runtime"),
  },
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
  // bundlerOptions: {
  //   ssr: {
  //     conditions: ["react-server"],
  //   },
  // },
};

export default framework;
