addEventListener("ping", event => {
  console.log(typeof event.target.Bun.inspect, typeof event.target.process.binding, typeof event.target.navigator.userAgent);
  console.log(typeof event.target.process.getBuiltinModule("node:zlib").gzipSync);
});
dispatchEvent(new Event("ping"));
