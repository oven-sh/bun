// A program puts its own function and class under the global names setTimeout and URL. Bun's own modules keep the ones they were made with.
// Alone: what the build knows to be replaced goes by every program of the executable
import net from "node:net";
import url from "node:url";
import http from "node:http";
function replace() {
  Object.defineProperties(globalThis, {
    setTimeout: { value: fake, writable: true, configurable: true },
    URL: { value: FakeURL, writable: true, configurable: true },
  });
}
const seen = [];
function fake(...a) {
  seen.push("fake");
  return 7;
}
class FakeURL {
  constructor() {
    seen.push("FakeURL");
    this.href = "fake:";
  }
}
const say = (label, run) => {
  seen.length = 0;
  let said;
  try {
    said = run();
  } catch (error) {
    said = error.name + ": " + error.message;
  }
  console.log(label, "|", said, "|", seen.join());
};
replace();
say("is replaced", () => [setTimeout === fake || setTimeout(() => {}, 0) === 7, URL === FakeURL].join());
say("socket.setTimeout", () => {
  const s = new net.Socket();
  s.setTimeout(1000);
  const k = typeof s.timeout;
  s.destroy();
  return k;
});
say("pathToFileURL", () => url.pathToFileURL("/a").href);
say("http.request of a text", () => {
  const r = http.request("http://127.0.0.1:1/x");
  r.on("error", () => {});
  r.destroy();
  return r.path;
});
export const done = Promise.resolve();
