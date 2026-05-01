// This file is unused by Bun itself, but rather is a tool for
// contributors to hack on `bun-framework-react` without needing
// to compile bun itself. If changes to this are made, please
// update 'pub fn react' in 'bake.zig'
import type { Bake } from "bun";

export function react(): Bake.Framework {
  return {
    // When the files are embedded in the Bun binary,
    // relative path resolution does not work.
    builtInModules: [
      { import: "bun-framework-react/client.tsx", path: require.resolve("./client.tsx") },
      { import: "bun-framework-react/server.tsx", path: require.resolve("./server.tsx") },
      { import: "bun-framework-react/ssr.tsx", path: require.resolve("./ssr.tsx") },
    ],
    fileSystemRouterTypes: [
      {
        root: "pages",
        clientEntryPoint: "bun-framework-react/client.tsx",
        serverEntryPoint: "bun-framework-react/server.tsx",
        extensions: ["jsx", "tsx"],
        style: "nextjs-pages",
        layouts: true,
        ignoreUnderscores: true,
      },
    ],
    staticRouters: ["public"],
    reactFastRefresh: {
      importSource: "react-refresh/runtime",
    },
    serverComponents: {
      separateSSRGraph: true,
      serverRegisterClientReferenceExport: "registerClientReference",
      serverRuntimeImportSource: "react-server-dom-webpack/server",
    },
    bundlerOptions: {
      ssr: {
        conditions: ["react-server"],
      },
    },
  };
}
