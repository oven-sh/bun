// ───────────── the project's own Prettier ─────────────
//
// `bun format` hands a file in a language that only a plugin of Prettier reads to the `prettier` that the project has installed.
// Prettier reads the configuration file itself, so what it has for the plugin counts. The other side says which file that is.

const FORMAT_WITH_PRETTIER = 30;

// By the directory that it is looked for from: the package, or `null` if it is not installed.
const prettierPackages = new Map();

function prettierFrom(directory) {
  let found = prettierPackages.get(directory);
  if (found !== undefined) return found;
  const started = performance.now();
  const from = createRequire(nodePath.join(directory, "noop.js"));
  found = null;
  try {
    from.resolve("prettier/package.json");
    found = from("prettier");
  } catch {}
  loadingTime += performance.now() - started;
  prettierPackages.set(directory, found);
  return found;
}

// `getOptionsForFile` of Prettier's command line, and `format`. The message: the length of what follows as JSON, that, the text.
// The JSON: `path`, `config`: the configuration file, or `null`, `usesConfig`: not `--no-config`, `editorconfig`, `flags`: the options
// that the command line sets, `precedence`: `--config-precedence`.
async function formatWithPrettier() {
  const length = ask(MESSAGE);
  const buffer = buffers[MESSAGE];
  const [headLength] = new Uint32Array(buffer, 0, 1);
  const { path, config, usesConfig, editorconfig, flags, precedence } = JSON.parse(decode(buffer, 4, 4 + headLength));
  const text = decode(buffer, 4 + headLength, length);
  const prettier = prettierFrom(cwd);
  if (prettier === null) return NOT_INSTALLED;
  // As Prettier's command line has them, which plugins see.
  const filepath = nativePath(path, nodePath);
  const configFile = config === null ? undefined : nativePath(config, nodePath);
  const ofFiles = usesConfig ? await prettier.resolveConfig(filepath, { config: configFile, editorconfig }) : null;
  let options = { ...ofFiles, ...flags };
  if (precedence === "file-override") options = { ...flags, ...ofFiles };
  if (precedence === "prefer-file") options = ofFiles ?? flags;
  return DONE + (await prettier.format(text, { ...options, filepath }));
}

// What `handle` does with the kinds of calls from `FORMAT_WITH_PRETTIER` on.
function handleForPrettier() {
  // As `handleError` of Prettier's command line shows it.
  return formatWithPrettier().catch(error => FAILED + String(error?.loc ? error : (error?.stack ?? error)));
}
