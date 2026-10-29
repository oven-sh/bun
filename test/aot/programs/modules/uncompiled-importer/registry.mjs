export const registered = [];
export function register(name) {
  registered.push(name);
}
require(globalThis.pluginPath);
