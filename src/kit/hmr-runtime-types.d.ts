/*
 * A module id is an unsigned 52-bit numeric hash of the filepath.
 *
 * TODO: how resistant to hash collision is this? if it is not, an alternate approach must be taken.
 */
type Id = number;

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
*/
declare const mode: 'client' | 'server';

/* What should be `export default`'d */
declare var server_fetch_function: any;

/* 
 * If you are running a debug build of Bun. These debug builds should provide
 * helpful information to someone working on the bundler itself.
 */
declare const IS_BUN_DEVELOPMENT: any;
