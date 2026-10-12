// ───────────── processors ─────────────
//
// ESLint's `processor`: it takes blocks of code out of a file, and maps what is reported about them back. Only the object
// itself is loaded. The other side lints the blocks.

const PREPROCESS = 10;
const POSTPROCESS = 11;
const LOAD_PROCESSOR = 12;

const NEEDS_PROCESSOR = "3";

// By id: `{ preprocess, postprocess, supportsAutofix }`.
const processors = new Map();

// The objects that the configuration file at `path` exports.
async function configObjects(path) {
  let exported = configurations.get(path);
  if (exported === undefined) {
    exported = (await load(pathToFileURL(path).href)).default;
    if (typeof exported === "function") exported = exported();
    exported = [await exported].flat(Infinity);
    configurations.set(path, exported);
  }
  return exported;
}

// `location`: what `locateProcessor` in `evaluate-eslint.js` says.
async function loadProcessor([id, location]) {
  const started = performance.now();
  let processor;
  if (location.name !== undefined) {
    processor = (await locatedPlugin(location.plugin, location.prefix)).processors[location.name];
  } else if (location.object !== undefined) processor = await locatedPlugin(location.object, null);
  else processor = (await configObjects(location.config))[location.index].processor;
  loadingTime += performance.now() - started;
  const { preprocess, postprocess, supportsAutofix } = processor;
  processors.set(id, { preprocess, postprocess, supportsAutofix: Boolean(supportsAutofix) });
  return DONE;
}

// The message: the id of the processor and the length of the path, then the path, then `rest`.
function readForProcessor() {
  const length = ask(MESSAGE);
  const buffer = buffers[MESSAGE];
  const [id, pathLength] = new Uint32Array(buffer, 0, 2);
  return {
    processor: processors.get(id),
    name: decode(buffer, 8, 8 + pathLength),
    rest: decode(buffer, 8 + pathLength, length),
  };
}

// ESLint's `preprocessSync`. Returns `[supportsAutofix, blocks]`, a block being its text, or its path and its text, or
// `[null, message]`.
function preprocess() {
  const { processor, name, rest: code } = readForProcessor();
  if (processor === undefined) return NEEDS_PROCESSOR;
  let blocks;
  try {
    blocks = processor.preprocess(code, name);
  } catch (error) {
    const message = `Preprocessing error: ${error.message.replace(/^line \d+:/iu, "").trim()}`;
    const problem = { ruleId: null, fatal: true, severity: 2, message, line: error.lineNumber, column: error.column };
    return DONE + JSON.stringify([null, problem]);
  }
  if (typeof blocks.then === "function") throw new Error("Unsupported: Preprocessor returned a promise.");
  const described = blocks.map((block, i) =>
    typeof block === "string" ? block : [nodePath.join(name, `${i}_${block.filename}`), block.text],
  );
  return DONE + JSON.stringify([processor.supportsAutofix, described]);
}

// ESLint's `postprocessSync`.
function postprocess() {
  const { processor, name, rest: lists } = readForProcessor();
  if (processor === undefined) return NEEDS_PROCESSOR;
  return DONE + JSON.stringify(processor.postprocess(JSON.parse(lists), name));
}

// What `handle` does with the kinds of calls from `PREPROCESS` on.
function handleForProcessor(kind) {
  try {
    if (kind === PREPROCESS) return preprocess();
    if (kind === POSTPROCESS) return postprocess();
    return loadProcessor(askForJson(MESSAGE)).catch(error => FAILED + describeLoadError(error));
  } catch (error) {
    return FAILED + String(error?.message ?? error);
  }
}
