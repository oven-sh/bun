import type * as Bake from "bun:app";
import { join } from "path";

function resolve(path: string): string {
  return join(import.meta.dir, path);
}

const framework: Bake.Framework = {
  builtInModules: [
    {
      import: "bun-framework-react/client.tsx",
      path: resolve("./client.tsx"),
    },
    {
      import: "bun-framework-react/server.tsx",
      path: resolve("./server.tsx"),
    },
    {
      import: "bun-framework-react/ssr.tsx",
      path: resolve("./ssr.tsx"),
    },
    {
      import: "bun-framework-react/client/app.ts",
      path: resolve("./client/app.ts"),
    },
    {
      import: "bun-framework-react/client/constants.ts",
      path: resolve("./client/constants.ts"),
    },
    {
      import: "bun-framework-react/client/css.ts",
      path: resolve("./client/css.ts"),
    },
    {
      import: "bun-framework-react/client/entry.tsx",
      path: resolve("./client/entry.tsx"),
    },
    {
      import: "bun-framework-react/client/root.tsx",
      path: resolve("./client/root.tsx"),
    },
    {
      import: "bun-framework-react/client/router.ts",
      path: resolve("./client/router.ts"),
    },
    {
      import: "bun-framework-react/client/simple-store.ts",
      path: resolve("./client/simple-store.ts"),
    },
    {
      import: "bun-framework-react/components/link.tsx",
      path: resolve("./components/link.tsx"),
    },
    {
      import: "bun-framework-react/lib/util.ts",
      path: resolve("./lib/util.ts"),
    },
  ],

  fileSystemRouterTypes: [
    {
      root: "pages",
      prefix: "/",
      clientEntryPoint: "bun-framework-react/client.tsx",
      serverEntryPoint: "bun-framework-react/server.tsx",
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
