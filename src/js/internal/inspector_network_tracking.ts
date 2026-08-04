// Port of https://github.com/nodejs/node/blob/main/lib/internal/inspector_network_tracking.js
// Node enables at startup under --experimental-network-inspection; Bun toggles with the
// first/last Network.enable so clients pay nothing while no one inspects.
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
