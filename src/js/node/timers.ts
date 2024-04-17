// Hardcoded module "node:timers"
// This implementation isn't 100% correct
// Ref/unref does not impact whether the process is kept alive
export default {
  setTimeout,
  clearTimeout,
  setInterval,
  setImmediate,
  clearInterval,
  clearImmediate,
};
