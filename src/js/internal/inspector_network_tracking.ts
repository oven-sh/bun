// Port of Node v26.3.0 lib/internal/inspector_network_tracking.js. Node turns
// this on at startup under --experimental-network-inspection; Bun enables it
// when a session enables the Network domain and disables it when the last
// such session is gone, so the clients pay nothing while no one inspects.
let enabled = false;

function enable() {
  if (enabled) return;
  enabled = true;
  require("internal/inspector/network_http").enable();
  require("internal/inspector/network_http2").enable();
  require("internal/inspector/network_fetch").enable();
}

function disable() {
  if (!enabled) return;
  enabled = false;
  require("internal/inspector/network_http").disable();
  require("internal/inspector/network_http2").disable();
  require("internal/inspector/network_fetch").disable();
}

export default { enable, disable };
