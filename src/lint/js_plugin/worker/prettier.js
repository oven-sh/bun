// ------------- the project's own Prettier -------------
//
// `bun fmt` hands a file in a language that only a plugin of Prettier reads to the `prettier` that the project has installed.
// Prettier reads the configuration file itself, so what it has for the plugin counts. The other side says which file that is.

const FORMAT_WITH_PRETTIER = 30;

// `error.message` of what `prettier.format` has thrown.
const MESSAGE_OF_PRETTIER = "7";

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
// The JSON: `path`, or `null` for text that has no file name, `config`: the configuration file, or `null`, `usesConfig`: not `--no-config`, `editorconfig`, `flags`: the options
// that the command line sets, `precedence`: `--config-precedence`, `looksAtStdin`: the text is standard input, with `--check` or
// `--list-different`.
async function formatWithPrettier() {
  const headLength = messageWords(1)[0];
  const { path, config, usesConfig, editorconfig, flags, precedence, looksAtStdin } = JSON.parse(
    messageText(4, 4 + headLength),
  );
  const text = messageText(4 + headLength);
  const prettier = prettierFrom(cwd);
  if (prettier === null) return NOT_INSTALLED;
  // As Prettier's command line has them, which plugins see.
  const filepath = path === null ? undefined : nativePath(path, nodePath);
  const configFile = config === null ? undefined : nativePath(config, nodePath);
  const ofFiles = usesConfig ? await prettier.resolveConfig(filepath, { config: configFile, editorconfig }) : null;
  let options = { ...ofFiles, ...flags };
  if (precedence === "file-override") options = { ...flags, ...ofFiles };
  if (precedence === "prefer-file") options = ofFiles ?? flags;
  try {
    return DONE + (await prettier.format(text, { ...options, filepath }));
  } catch (error) {
    if (!looksAtStdin) throw error;
    // As `listDifferent` of Prettier's command line shows it.
    return MESSAGE_OF_PRETTIER + error.message;
  }
}

// What `handle` does with the kinds of calls from `FORMAT_WITH_PRETTIER` on.
function handleForPrettier() {
  // As `handleError` of Prettier's command line shows it.
  return formatWithPrettier().catch(error => FAILED + messageOf(error, it => (it?.loc ? it : (it?.stack ?? it))));
}
