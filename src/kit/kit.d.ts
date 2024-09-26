declare namespace Kit {
  interface Options {
    framework?: Framework | undefined;
  }

  /**
   * A "Framework" in our eyes is simply a set of bundler options that a
   * framework author would set in order to integrate framework code with the
   * application. Many of the configuration options are paths, which are
   * resolved as import specifiers. The first thing the bundler does is
   * ensure that all import specifiers are fully resolved.
   */
  interface Framework {
    /**
     * This file is the true entrypoint of the server application. This module
     * must `export default` a fetch function, which takes a request and the
     * bundled route module, and returns a response. See `ServerEntryPoint`
     * 
     * When `serverComponents` is configured, this can access the component
     * manifest using the special 'bun:kit/server' import:
     * 
     *     import { clientManifest } from 'bun:kit/server'
     */
    serverEntryPoint: ImportSource;
    /**
     * This file is the true entrypoint of the client application.
     */
    clientEntryPoint: ImportSource;
    /**
     * Bun offers integration for React's Server Components with an
     * interface that is generic enough to adapt to any framework.
     */
    serverComponents?: ServerComponentsOptions | undefined;
    /**
     * While it is unlikely that Fast Refresh is useful outside of
     * React, it can be enabled regardless.
     */
    reactFastRefresh?: ReactFastRefreshOptions | undefined;
  }

  /**
   * A high-level overview of what server components means exists
   * in the React Docs: https://react.dev/reference/rsc/server-components
   *
   * When enabled, files with "use server" and "use client" directives will get
   * special processing according to this object, in combination with the
   * framework-specified entry points for server rendering and browser
   * interactivity.
   */
  interface ServerComponentsOptions {
    /**
     * If you are unsure what to set this to for a custom server components
     * framework, choose 'false'.
     *
     * When set `true`, when bundling "use client" components for SSR, these
     * files will be placed in a separate bundling graph where `conditions` does
     * not include `react-server`.
     *
     * The built in framework config for React enables this flag so that server
     * components and client components, utilize their own versions of React,
     * despite running in the same process. This facilitates different aspects
     * of the server and client react runtimes, such as `async` components only
     * being available on the server.
     * 
     * To cross from the server graph to the SSR graph, use the bun_kit_graph
     * import attribute:
     * 
     *     import * as ReactDOM from 'react-dom/server' with { bun_kit_graph: 'ssr' };
     *
     * Since these models are so subtley different, there is no default value
     * provided for this.
     */
    separateSSRGraph: boolean;
    /** Server components runtime for the server */
    serverRuntimeImportSource: ImportSource;
    /** Server components runtime for the client */
    clientRuntimeImportSource: ImportSource;
    /**
     * When server code imports client code, a stub module is generated,
     * where every export calls this export from `serverRuntimeImportSource`.
     * This is used to implement client components on the server.
     *
     * The call is given three arguments:
     *
     *     export const ClientComp = registerClientReference(
     *         // A function which may be passed through, it throws an error
     *         function () { throw new Error('Cannot call client-component on the server') },
     *
     *         // The file path. In production, these use hashed strings for
     *         // compactness and code privacy.
     *         "src/components/Client.tsx",
     *
     *         // The component name.
     *         "ClientComp",
     *     );
     * 
     * Additionally, the bundler will assemble a component manifest to be used
     * during rendering.
     */
    serverRegisterClientReferenceExport: string | undefined;
  }

  /** Customize the React Fast Refresh transform. */
  interface ReactFastRefreshOptions {
    /** @default "react-refresh/runtime" */
    importSource: ImportSource | undefined;
  }

  /// Will be resolved from the point of view of the framework user's project root
  /// Examples: `react-dom`, `./entry_point.tsx`, `/absolute/path.js`
  type ImportSource = string;

  interface ServerEntryPoint {
    /// The framework implementation decides and enforces the shape
    /// of the route module. Bun passes it as an opaque value.
    default: (request: Request, routeModule: unknown, routeMetadata: RouteMetadata) => Response;
  }

  interface RouteMetadata {
    /** A list of css files that the route will need to be styled */
    styles: string[];
    /** A list of js files that the route will need to be interactive */
    scripts: string[];
  }
}

declare class Kit {
  constructor(options: Kit.Options);
}

module 'bun:kit/server' {
  declare const clientManifest: ClientManifest;
  declare const serverManifest: ServerManifest;

  interface ClientManifest {
    [uid: string]: {
      /** The module ID in */
      id: string;
      /** The export name */
      name: string;
      /** Currently not implemented; always an empty array */
      chunks: [];
    }
  }
}


// const serverManifest = {
//   'Client.tsx#Client': {
//     id: 'Client.tsx',
//     name: 'Client',
//     chunks: [],
//   },
// };

// export const clientManifest = {
//   moduleMap: {
//     "Client.tsx": {
//       Client: {
//         name: 'Client',
//         specifier: 'ssr:Client.tsx',
//       },
//     }
//   },
//   moduleLoading: {
//     prefix: "",
//   },
// };