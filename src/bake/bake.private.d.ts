type Id = string;

/** Index with same usage as `IncrementalGraph(.client).Index` */
type FileIndex = number;

interface Config {
  // Server + Client
  main: Id;

  // Server
  separateSSRGraph?: true;

  // Client
  /** Dev Server's `configuration_hash_key` */
  version: string;
  /** If available, this is the Id of `react-refresh/runtime` */
  refresh?: Id;
  /**
   * A list of "roots" that the client is aware of. This includes
   * the framework entry point, as well as every client component.
   */
  roots: FileIndex[];
}

/**
 * All modules for the initial bundle.
 */
declare const input_graph: Record<string, ModuleLoadFunction>;

declare const config: Config;

/**
 * The runtime is bundled for server and client, which influences
 * how hmr connection should be established, as well if there is
 * a window to visually display errors with.
 */
declare const side: "client" | "server";

/*
 * This variable becomes the default export. Kit uses this
 * interface as opposed to a WebSocket connection.
 */
declare var server_exports: {
  handleRequest: (req: Request, routeModuleId: Id, clientEntryUrl: string, styles: string[]) => any;
  registerUpdate: (
    modules: any,
    componentManifestAdd: null | string[],
    componentManifestDelete: null | string[],
  ) => void;
};

/*
 * If you are running a debug build of Bun. These debug builds should provide
 * helpful information to someone working on the bundler itself.
 */
declare const IS_BUN_DEVELOPMENT: any;

// shims for experimental react types
declare module "react" {
  export function use<T>(promise: Promise<T>): T;
}
declare module "react-server-dom-webpack/client.browser" {
  export function createFromReadableStream<T = any>(readable: ReadableStream, manifest?: any): Promise<T>;
}
declare module "react-server-dom-webpack/server.browser" {
  export function renderToReadableStream<T = any>(element: JSX.Element, manifest: any): ReadableStream;
}
