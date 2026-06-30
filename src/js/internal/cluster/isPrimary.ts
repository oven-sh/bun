// tiny module to shortcut getting access to this boolean without loading the entire node:cluster module
export default {
  // node checks the own property (lib/cluster.js): an inherited NODE_UNIQUE_ID
  // (e.g. an extended process.env prototype) must not turn the process into a worker.
  isPrimary: !Object.prototype.hasOwnProperty.$call(process.env, "NODE_UNIQUE_ID"),
};
