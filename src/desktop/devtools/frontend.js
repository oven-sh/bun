// What the frontend takes for the browser that it is in.
function connect(binding, platform) {
  const send = globalThis[binding];
  delete globalThis[binding];
  if (self !== top || location.origin !== "devtools://devtools") return;

  const waiting = new Map();
  let lastId = 0;
  let zoomFactor = 1;
  const tell = (method, args) => {
    const answer = typeof args.at(-1) === "function" && args.pop();
    if (answer) waiting.set(++lastId, answer);
    send(JSON.stringify([answer ? lastId : 0, method, args]));
  };
  const own = {
    events: undefined,
    platform: () => platform,
    isHostedMode: () => false,
    zoomFactor: () => zoomFactor,
    isolatedFileSystem: () => null,
    initialTargetId: async () => null,
    sendMessageToBackend: send,
    registerPreference() {},
    setAddExtensionCallback() {},
    requestFileSystems: () => InspectorFrontendAPI.fileSystemsLoaded([]),
    loadCompleted() {
      InspectorFrontendAPI.setUseSoftMenu(true);
      tell("loadCompleted", []);
    },
  };
  // Each version has methods of its own.
  const host = new Proxy(own, {
    get(own, name) {
      if (name in own || typeof name !== "string" || name === "then") return own[name];
      return name.startsWith("record") ? () => {} : (...args) => tell(name, args);
    },
  });
  Object.defineProperty(globalThis, "InspectorFrontendHost", { get: () => host, set() {} });
  // What waits for a reply has to be done before the next message comes.
  const { port1, port2 } = new MessageChannel();
  port1.onmessage = ({ data: it }) => {
    if (!Array.isArray(it)) InspectorFrontendAPI.dispatchMessage(it);
    else if (it[0] === "zoom") zoomFactor = it[1];
    else if (typeof it[0] === "string") InspectorFrontendAPI[it[0]]?.(...it.slice(1));
    else {
      waiting.get(it[0])?.(it[1]);
      waiting.delete(it[0]);
    }
  };
  globalThis[binding + "Receive"] = all => JSON.parse(all).forEach(it => port2.postMessage(it));
}
