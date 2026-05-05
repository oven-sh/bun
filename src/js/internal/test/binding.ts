// Node.js `internal/test/binding`, only reachable under --expose-internals.
// In Node this exposes the raw `internalBinding` function to tests; Bun
// proxies to `process.binding` which covers the bindings tests need (`uv`,
// `constants`, etc.).

function internalBinding(name: string) {
  return process.binding(name);
}

export default {
  internalBinding,
};
