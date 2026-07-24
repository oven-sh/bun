// Mirror of Node's `lib/internal/modules/customization_hooks.js` (`module.registerHooks`,
// added in Node v22.15.0). Hooks are validated and returned with Node's observable shape,
// but Bun's module loader does not invoke them yet.
const { validateFunction } = require("internal/validators");

const ObjectFreeze = Object.freeze;

class ModuleHooks {
  resolve: Function | undefined = undefined;
  load: Function | undefined = undefined;

  constructor(resolve, load) {
    this.resolve = resolve;
    this.load = load;
    ObjectFreeze(this);
  }

  deregister() {}
}

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/modules/customization_hooks.js
function registerHooks(hooks) {
  const { resolve, load } = hooks;
  if (resolve) {
    validateFunction(resolve, "hooks.resolve");
  }
  if (load) {
    validateFunction(load, "hooks.load");
  }
  return new ModuleHooks(resolve, load);
}

export default { registerHooks };
