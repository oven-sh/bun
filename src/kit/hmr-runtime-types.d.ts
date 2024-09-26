type Id = string;

interface Config {
  main: Id;
  /** If available, this is the Id of `react-refresh/runtime` */
  refresh: Id;
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
 * 
 * TODO: rename this "side" to align with other code
 */
declare const mode: "client" | "server";

/*
 * This variable becomes the default export. Kit uses this
 * interface as opposed to a WebSocket connection.
 */
declare var server_exports: {
  handleRequest: (req: any, id: Id) => any,
  registerUpdate: (modules: any) => void,
};

/*
 * If you are running a debug build of Bun. These debug builds should provide
 * helpful information to someone working on the bundler itself.
 */
declare const IS_BUN_DEVELOPMENT: any;
