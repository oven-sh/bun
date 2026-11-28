// ------------- the project's own Prettier -------------
//
// `bun fmt` hands a file in a language that only a plugin of Prettier reads to the `prettier` that the project has installed.
// Prettier reads the configuration file itself, so what it has for the plugin counts. The other side says which file that is.

const FORMAT_WITH_PRETTIER = 30;

// `error.message` of what `prettier.format` has thrown.
const MESSAGE_OF_PRETTIER = "7";
// None of the plugins has a parser for the file.
const NO_PARSER = "8";

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

// By the list of plugins: the names of the options that Prettier has with them.
const optionNames = [];

async function optionNamesWith(prettier, plugins) {
  const isSame = it => it.plugins.length === plugins.length && it.plugins.every((plugin, at) => plugin === plugins[at]);
  let found = optionNames.find(isSame);
  if (found === undefined) {
    const { options } = await prettier.getSupportInfo({ plugins, showDeprecated: true });
    found = { plugins, names: new Set(options.map(it => it.name)) };
    optionNames.push(found);
  }
  return found.names;
}

// `getOptionsForFile` of Prettier's command line, and `format`. The message: the length of what follows as JSON, that, the text.
// The JSON: `path`, or `null` for text that has no file name, `config`: the configuration file, or `null`, `usesConfig`: not `--no-config`, `editorconfig`, `flags`: the options
// that the command line sets, `precedence`: `--config-precedence`, `looksAtStdin`: the text is standard input, with `--check` or
// `--list-different`.
async function formatWithPrettier() {
  const headLength = messageWords(1)[0];
  const {
    path,
    config,
    usesConfig,
    editorconfig,
    flags,
    // The plugins that the command line and `bunfig.toml` list for the file. A path is absolute.
    plugins = [],
    // The names in `flags` that one of those plugins must have.
    passThrough = [],
    precedence,
    looksAtStdin,
  } = JSON.parse(messageText(4, 4 + headLength));
  const text = messageText(4 + headLength);
  const prettier = prettierFrom(cwd);
  if (prettier === null) return NOT_INSTALLED;
  // As Prettier's command line has them, which plugins see.
  const filepath = path === null ? undefined : nativePath(path, nodePath);
  const configFile = config === null ? undefined : nativePath(config, nodePath);
  const ofFiles = usesConfig ? await prettier.resolveConfig(filepath, { config: configFile, editorconfig }) : null;
  let options = { ...ofFiles, ...flags };
  if (precedence === "file-override") options = { ...flags, ...ofFiles };
  // `prefer-file` with a configuration file: no flag is used.
  const dropsFlags = precedence === "prefer-file" && Boolean(ofFiles);
  if (dropsFlags) options = ofFiles;
  // Both lists are loaded in every mode. The winner comes last: Prettier takes a parser from the last plugin with it.
  if (plugins.length > 0) {
    const ofFlags = plugins.map(it => (nodePath.isAbsolute(it) ? nativePath(it, nodePath) : it));
    const ofConfig = ofFiles?.plugins ?? [];
    const both = precedence === "file-override" ? [...ofFlags, ...ofConfig] : [...ofConfig, ...ofFlags];
    // Of a plugin that is in the list twice, the last one stays.
    options = { ...options, plugins: both.filter((it, at) => !both.includes(it, at + 1)) };
  }
  try {
    if (passThrough.length > 0 && !dropsFlags) {
      // Prettier ignores an option that it does not know, so a typo would pass unseen.
      const names = await optionNamesWith(prettier, options.plugins ?? []);
      const unknown = passThrough.find(it => !names.has(it));
      if (unknown !== undefined) {
        return FAILED + `Unknown option "${unknown}" in [[fmt.overrides]]: no listed plugin declares it`;
      }
    }
    return DONE + (await prettier.format(text, { ...options, filepath }));
  } catch (error) {
    // Thrown for a name or a `parser` that no plugin has. Text without a file name keeps Prettier's own message.
    const isOfNoPlugin =
      error?.name === "UndefinedParserError" ||
      (error?.name === "ConfigError" && String(error.message).startsWith("Couldn't resolve parser"));
    if (isOfNoPlugin && path !== null) return NO_PARSER;
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
