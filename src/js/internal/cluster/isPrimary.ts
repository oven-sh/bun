// tiny module to shortcut getting access to this boolean without loading the entire node:cluster module
export default {
  isPrimary: !Object.prototype.hasOwnProperty.$call(process.env, "NODE_UNIQUE_ID"),
};
