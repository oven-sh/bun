// What `bun:main` does once the entry point has run (bundler/entry_points.rs, `ServerEntryPoint::generate` without hot reloading),
// for native code to call where no such text is made: `VirtualMachine::reload_entry_point`.
export function startServer(entryNamespace) {
  function isServerConfig(def) {
    return (
      def && def !== globalThis && (typeof def.fetch === "function" || def.app != undefined) && typeof def.stop !== "function"
    );
  }
  function start(def) {
    const server = Bun.serve(def);
    console.debug(
      `Started ${server.development ? "development " : ""}server: ${server.protocol}://${server.hostname}:${server.port}`,
    );
  }
  if (typeof entryNamespace?.then === "function") {
    entryNamespace.then(entryNamespace => {
      if (isServerConfig(entryNamespace?.default)) start(entryNamespace.default);
    }, reportError);
  } else if (isServerConfig(entryNamespace?.default)) {
    start(entryNamespace.default);
  }
}
