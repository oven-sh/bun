// Hardcoded module "internal/test/binding"
// Provides access to internal bindings for Node.js test suite compatibility.

module.exports = {
  internalBinding: process.binding,
};
