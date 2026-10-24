// Node's `only` rule for a --test-only run. node:test loads this module only when the flag is set, and never in a Worker.

const entryCount = $bindgen("jest.bind.ts", "nodeTestEntryCount");
const focusEntry = $bindgen("jest.bind.ts", "nodeTestFocusEntry");

const WeakSetPrototypeAdd = WeakSet.prototype.add;
const WeakSetPrototypeDelete = WeakSet.prototype.delete;
const WeakSetPrototypeHas = WeakSet.prototype.has;

type Mode = "skip" | "todo" | "only";

type TestOptions = { only?: unknown; skip?: unknown; expectFailure?: unknown };

type TestNode = {
  parent: TestNode | undefined;
  isSuite: boolean;
  subtestChain: Promise<unknown>;
  isRunning(): boolean;
};

type AddFn<Node> = (
  arg0: unknown,
  arg1: unknown,
  arg2: unknown,
  executionParent: Node | undefined,
  mode?: Mode,
) => Promise<undefined>;

type Shim<Node> = {
  addTest: AddFn<Node>;
  addSuite: AddFn<Node>;
  parseTestArgs(arg0: unknown, arg1: unknown, arg2: unknown): { name: string; options: TestOptions; fn: Function };
  validateTestOptions(options: TestOptions): unknown;
  parseExpectFailure(expectFailure: unknown): unknown;
  currentNode(): Node | undefined;
  currentCollectionParent(): Node;
};

// Node's Test#runOnlySubtests, for a test that runs. bun:test keeps the state of the tests that it collects.
const runOnlySubtests = new WeakSet<TestNode>();

function noop() {}

// https://github.com/nodejs/node/blob/bc2e01dcf6acd5cf7d169b5f26cf89abaaeb41f1/lib/internal/test_runner/test.js#L372-L374. It does not change what bun:test has collected.
function setRunOnlySubtests(node: TestNode, value: boolean) {
  if (value) WeakSetPrototypeAdd.$call(runOnlySubtests, node);
  else WeakSetPrototypeDelete.$call(runOnlySubtests, node);
}

// A filtered subtest is left out of the output and its promise resolves in sibling order: test.js#L1221-L1230 and #L1301-L1306 of the same commit.
function omitSubtest(parent: TestNode): Promise<undefined> {
  return (parent.subtestChain = parent.subtestChain.then(noop)) as Promise<undefined>;
}

function createOnlyFilter<Node extends TestNode>(shim: Shim<Node>) {
  const { addTest, addSuite, parseTestArgs, validateTestOptions, parseExpectFailure } = shim;
  const { currentNode, currentCollectionParent } = shim;

  // Node builds and checks a test before it filters it. These are the checks of addTest(), addSuite() and TestNode.
  function validateDeclaration(options: TestOptions) {
    validateTestOptions(options);
    parseExpectFailure(options.expectFailure);
  }

  function addOnly(
    add: AddFn<Node>,
    arg0: unknown,
    arg1: unknown,
    arg2: unknown,
    executionParent: Node | undefined,
    mode?: Mode,
  ): Promise<undefined> {
    const { name, options: declared, fn } = parseTestArgs(arg0, arg1, arg2);
    // https://github.com/nodejs/node/blob/bc2e01dcf6acd5cf7d169b5f26cf89abaaeb41f1/lib/internal/test_runner/harness.js#L409-L419
    const options = mode === "only" ? { ...declared, only: true } : declared;
    const { only } = options;
    const runningNode = executionParent ?? currentNode();
    if (runningNode !== undefined && runningNode.isRunning()) {
      // Not ported: node also filters a suite that a running test declares, and the tests in it.
      if (add === addSuite || runningNode.isSuite) return add(name, options, fn, runningNode, mode);
      validateDeclaration(options);
      // For a parent that has started: https://github.com/nodejs/node/blob/bc2e01dcf6acd5cf7d169b5f26cf89abaaeb41f1/lib/internal/test_runner/test.js#L668-L681 and #L872-L879
      if (only) setRunOnlySubtests(runningNode, true);
      else if (only === false || WeakSetPrototypeHas.$call(runOnlySubtests, runningNode))
        return omitSubtest(runningNode);
      return add(name, options, fn, runningNode, mode);
    }
    const skippedTopLevelSuite =
      add === addSuite &&
      !only &&
      (mode === "skip" || !!options.skip) &&
      currentCollectionParent().parent === undefined;
    // Node never selects these: `{ only: false }`, and a skipped suite, whose callback cannot declare an only-marked test.
    if (only === false || skippedTopLevelSuite) {
      validateDeclaration(options);
      return Promise.resolve(undefined);
    }
    if (!only) return add(name, options, fn, executionParent, mode);
    const index = entryCount();
    const result = add(name, options, fn, executionParent, mode);
    focusEntry(index);
    return result;
  }

  function registerTest(arg0: unknown, arg1: unknown, arg2: unknown, executionParent: Node | undefined, mode?: Mode) {
    return addOnly(addTest, arg0, arg1, arg2, executionParent, mode);
  }

  function registerSuite(arg0: unknown, arg1: unknown, arg2: unknown, executionParent: Node | undefined, mode?: Mode) {
    return addOnly(addSuite, arg0, arg1, arg2, executionParent, mode);
  }

  return { registerTest, registerSuite, setRunOnlySubtests };
}

export default { createOnlyFilter };
