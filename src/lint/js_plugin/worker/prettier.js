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
// that the command line and `bunfig.toml` set for the file, `plugins`: the plugins that they list for it, a path among them being
// absolute, `passThrough`: the names in `flags` that only a plugin can know, `precedence`: `--config-precedence`, `looksAtStdin`:
// the text is standard input, with `--check` or `--list-different`.
async function formatWithPrettier() {
  const headLength = messageWords(1)[0];
  const {
    path,
    config,
    usesConfig,
    editorconfig,
    flags,
    plugins = [],
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
  if (precedence === "prefer-file") options = ofFiles ?? flags;
  // The other side sends a file here for a plugin in either list, so both lists are loaded. Prettier's command line lets one
  // replace the other. `resolveConfig` returns a path in its list as the system writes it.
  if (plugins.length > 0 && (precedence !== "prefer-file" || !ofFiles)) {
    const ofFlags = plugins.map(it => (nodePath.isAbsolute(it) ? nativePath(it, nodePath) : it));
    const ofConfig = ofFiles?.plugins ?? [];
    const both = precedence === "file-override" ? [...ofFlags, ...ofConfig] : [...ofConfig, ...ofFlags];
    options = { ...options, plugins: [...new Set(both)] };
  }
  try {
    if (passThrough.length > 0) {
      // Prettier ignores an option that it does not know, so a typo would pass unseen.
      const names = await optionNamesWith(prettier, options.plugins ?? []);
      const unknown = passThrough.find(it => !names.has(it));
      if (unknown !== undefined) {
        return FAILED + `Unknown option "${unknown}" in [[fmt.overrides]]: no listed plugin declares it`;
      }
    }
    return DONE + (await prettier.format(text, { ...options, filepath }));
  } catch (error) {
    // `FAILED` without a stack. `MESSAGE_OF_PRETTIER` would exit with 0 for standard input.
    if (error?.name === "UndefinedParserError") return FAILED + "No listed plugin has a parser for this file";
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
