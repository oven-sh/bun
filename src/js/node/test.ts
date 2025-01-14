// Hardcoded module "node:test"

const { throwNotImplemented } = require("internal/shared");

function suite() {
  throwNotImplemented("node:test", 5090, "bun:test in available in the interim.");
}

function test() {
  throwNotImplemented("node:test", 5090, "bun:test in available in the interim.");
}

function before() {
  throwNotImplemented("node:test", 5090, "bun:test in available in the interim.");
}

function after() {
  throwNotImplemented("node:test", 5090, "bun:test in available in the interim.");
}

function beforeEach() {
  throwNotImplemented("node:test", 5090, "bun:test in available in the interim.");
}

function afterEach() {
  throwNotImplemented("node:test", 5090, "bun:test in available in the interim.");
}

export default {
  suite,
  test,
  describe: suite,
  it: test,
  before,
  after,
  beforeEach,
  afterEach,
};
