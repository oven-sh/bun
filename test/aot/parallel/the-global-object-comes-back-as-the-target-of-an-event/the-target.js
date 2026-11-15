// The global dispatchEvent() hands the listener an event whose target is the global object. Nothing here writes `globalThis` or `process`.
addEventListener("ping", event => {
  console.log(typeof event.target.process.finalization, typeof event.target.process.allowedNodeEnvironmentFlags);
});
dispatchEvent(new Event("ping"));
