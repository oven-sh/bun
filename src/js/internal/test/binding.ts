// Minimal stand-in for node's lib/internal/test/binding.js, exposed (gated
// like bun:internal-for-testing) so vendored node tests that declare
// `--expose-internals` can run. Only the surface those tests use is
// implemented.
const clusterRawBind = $newZigFunction("node_cluster_binding.zig", "clusterRawBind", 4);

let fs;

// node's udp_wrap UDP handle, reduced to what test-cluster-dgram-bind-fd
// needs: construct, bind a raw UDP socket, read `.fd`, close.
class UDP {
  fd = -1;

  bind(address, port, flags) {
    return bindInternal(this, address, port, flags, "udp4");
  }

  bind6(address, port, flags) {
    return bindInternal(this, address, port, flags, "udp6");
  }

  close() {
    if (this.fd >= 0) {
      fs ??= require("node:fs");
      try {
        fs.closeSync(this.fd);
      } catch {}
      this.fd = -1;
    }
  }
}

function bindInternal(self, address, port, flags, type) {
  const rval = clusterRawBind(type, address, port | 0, flags | 0);
  if (typeof rval === "number") return rval; // negative errno
  self.fd = rval.fd;
  return 0;
}

const bindings = {
  udp_wrap: { UDP },
};

function internalBinding(name) {
  const binding = bindings[name];
  if (binding === undefined) {
    const error = new Error(`No such binding: ${name}`);
    error.code = "ERR_INVALID_MODULE";
    throw error;
  }
  return binding;
}

export default { internalBinding };
