// Portions of this file are copied from eslint-plugin-svelte, which is under the MIT License:
//
// Copyright (c) 2021 Yosuke Ota
//
// `decodeMappings` is copied from @jridgewell/sourcemap-codec, which is under the MIT License:
//
// Copyright 2024 Justin Ridgewell <justin@ridgewell.name>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

// ------------- the project's Svelte compiler -------------
//
// `svelte/no-unused-svelte-ignore` asks for the warnings `svelte/compiler` emits for a component, as
// eslint-plugin-svelte 3's `getSvelteCompileWarnings` computes them: with its `svelte-ignore` comments blanked, its
// style sheets in other languages and its scripts transformed by what the project has installed, and the warnings
// mapped back. The other side has read the component and passes all positions in UTF-16 code units of the text without
// a byte order mark. It decides which comment a warning belongs to.

const COMPILE_SVELTE = 31;

// The answer's `kind`.
const COMPILE_WARNED = "warn";
const COMPILE_FAILED = "error";

// eslint-plugin-svelte's `loadModule`, from the working directory and from the plugin, not from the file, which may be
// anywhere. `null` if neither has it.
function loadForSvelte(name, plugin) {
  for (const from of [nodePath.join(cwd, "__placeholder__.js"), plugin]) {
    if (!from) continue;
    try {
      return createRequire(from)(name);
    } catch {}
  }
  return null;
}

// What the plugin itself imports, resolved from its location.
function importedBySvelte(name, plugin) {
  try {
    return createRequire(plugin)(name);
  } catch {
    return null;
  }
}

// eslint-plugin-svelte's `LinesAndColumns`.
function linesAndColumns(code) {
  const starts = [0];
  for (let index = 0; index < code.length; index++) {
    const c = code[index];
    if (c === "\r") {
      if (code[index + 1] === "\n") index++;
      starts.push(index + 1);
    } else if (c === "\n") {
      starts.push(index + 1);
    }
  }
  return {
    getLocFromIndex(index) {
      let [lower, upper] = [0, starts.length];
      while (lower < upper) {
        const mid = Math.floor(lower + (upper - lower) / 2);
        if (starts[mid] < index) lower = mid + 1;
        else if (starts[mid] > index) upper = mid;
        else return { line: mid + 1, column: 0 };
      }
      return { line: upper, column: index - starts[upper - 1] };
    },
    getIndexFromLoc(loc) {
      return starts[loc.line - 1] + loc.column;
    },
  };
}

// @jridgewell/sourcemap-codec's `decode` (see the top of this file): the segments of each line of `mappings`.
function decodeMappings(mappings) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lines = [];
  let line = [];
  const state = [0, 0, 0, 0, 0];
  let at = 0;
  const vlq = () => {
    let [value, shift, more] = [0, 0, true];
    while (more) {
      // As in `decodeInteger`, a non-digit is 0, and so is anything past the end.
      const digit = at < mappings.length ? Math.max(chars.indexOf(mappings[at++]), 0) : 0;
      more = (digit & 32) !== 0;
      value |= (digit & 31) << shift;
      shift += 5;
    }
    const negative = value & 1;
    value >>>= 1;
    return negative ? -0x80000000 | -value : value;
  };
  state[0] = 0;
  while (at <= mappings.length) {
    const c = mappings[at];
    if (c === ";" || at === mappings.length) {
      lines.push(line);
      line = [];
      state[0] = 0;
      at++;
      continue;
    }
    if (c === ",") {
      at++;
      continue;
    }
    const segment = [];
    state[0] += vlq();
    segment.push(state[0]);
    if (at < mappings.length && mappings[at] !== "," && mappings[at] !== ";") {
      for (let i = 1; i < 4; i++) {
        state[i] += vlq();
        segment.push(state[i]);
      }
      if (at < mappings.length && mappings[at] !== "," && mappings[at] !== ";") {
        state[4] += vlq();
        segment.push(state[4]);
      }
    }
    line.push(segment);
  }
  for (const it of lines) it.sort((a, b) => a[0] - b[0]);
  return lines;
}

// The TypeScript config files that were read, keyed by path and extra extensions: `{ options, projectReferences,
// fileNames, names }`, where `names` are the root files as `canonicalName` has them, or `null` for one `typescript`
// can't read.
const readForSvelte = new Map();

function canonicalName(ts, name) {
  const path = nodePath.resolve(name);
  return ts.sys.useCaseSensitiveFileNames ? path : path.toLowerCase();
}

// True if `filename` is among `config`'s root files, also by another path to the same file: typescript-estree's
// `fileListIncludes` and `getPathToSameFile`.
function hasForSvelte(ts, config, filename) {
  if (config.names.has(canonicalName(ts, filename))) return true;
  const realPath = it => ts.sys.realpath?.(it) ?? it;
  const real = realPath(filename);
  if (config.names.has(canonicalName(ts, real))) return true;
  // The root file directories reached through a link, keyed by their real paths.
  config.linked ??= new Map(
    [...new Set(config.fileNames.map(it => nodePath.dirname(it)))]
      .map(it => [it, realPath(it)])
      .filter(([it, real]) => it !== real)
      .map(([it, real]) => [canonicalName(ts, real), it]),
  );
  const directory = config.linked.get(canonicalName(ts, nodePath.dirname(real)));
  return (
    directory !== undefined && config.names.has(canonicalName(ts, nodePath.join(directory, nodePath.basename(real))))
  );
}

function readConfigForSvelte(ts, path, extensions) {
  const key = `${path}\0${extensions.join("\0")}`;
  let read = readForSvelte.get(key);
  if (read !== undefined) return read;
  read = null;
  try {
    const host = { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} };
    const extraFileExtensions = extensions.map(extension => ({
      extension,
      isMixedContent: true,
      scriptKind: ts.ScriptKind.Deferred,
    }));
    const parsed = ts.getParsedCommandLineOfConfigFile(path, {}, host, undefined, undefined, extraFileExtensions);
    if (parsed) {
      const names = new Set(parsed.fileNames.map(it => canonicalName(ts, it)));
      const { options, projectReferences = [], fileNames } = parsed;
      read = { options, projectReferences, fileNames, names };
    }
  } catch {}
  readForSvelte.set(key, read);
  return read;
}

// `parserOptions.project` as typescript-estree's `getProjectConfigFiles` and `resolveProjectList` resolve it: the
// config files, in the order in which each one's program is asked whether the file is among its roots.
function projectsForSvelte(ts, project, filename, root, ignored) {
  if (project === true) {
    let directory = nodePath.dirname(filename);
    do {
      const path = nodePath.join(directory, "tsconfig.json");
      if (ts.sys.fileExists(path)) return [path];
      // A Windows root, such as `C:\`, is longer than one character and is its own parent.
      const parent = nodePath.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    } while (directory.length > 1 && directory.length >= root.length);
    return [];
  }
  const written = (Array.isArray(project) ? project : [project]).filter(it => typeof it === "string");
  const isPattern = it => /[*?[\]{}()!]/.test(it);
  const patterns = (Array.isArray(ignored) ? ignored : ["**/node_modules/**"])
    .filter(it => typeof it === "string")
    .map(it => new Bun.Glob(it));
  const found = written
    .filter(isPattern)
    .flatMap(pattern =>
      [...new Bun.Glob(pattern).scanSync({ cwd: root, onlyFiles: true })]
        .filter(it => !patterns.some(ignore => ignore.match(it)))
        .sort(),
    );
  const paths = [...written.filter(it => !isPattern(it)), ...found].map(it => nodePath.resolve(root, it));
  return [...new Map(paths.map(it => [canonicalName(ts, it), it])).values()];
}

// TypeScript's project service's `forEachConfigFileLocation`: from `from`'s directory, the first `tsconfig.json` or
// `jsconfig.json`, up to `root` if `from` is inside it. If `from` is a config file, its own directory is only searched
// for the names after its own: `jsconfig.json` after `tsconfig.json`.
function configAboveForSvelte(ts, from, root, isConfig) {
  let directory = nodePath.dirname(from);
  const isInRoot = () =>
    directory === root || directory.startsWith(root.endsWith(nodePath.sep) ? root : root + nodePath.sep);
  const isAnyOk = !isInRoot();
  let names = !isConfig
    ? ["tsconfig.json", "jsconfig.json"]
    : nodePath.basename(from) === "tsconfig.json"
      ? ["jsconfig.json"]
      : [];
  do {
    for (const name of names) {
      const path = nodePath.join(directory, name);
      if (ts.sys.fileExists(path)) return path;
    }
    if (nodePath.basename(directory) === "node_modules") break;
    const parent = nodePath.dirname(directory);
    if (parent === directory) break;
    directory = parent;
    names = ["tsconfig.json", "jsconfig.json"];
  } while (isAnyOk || isInRoot());
  return null;
}

// `program.getCompilerOptions()` of the program typescript-eslint creates for the component, where `how.program` holds
// its parser options: with `project`, the first of its projects that has the file among its roots, with
// `projectService`, the one TypeScript's project service finds for it by the nearest config file, its references and
// the ones above it, otherwise `defaultProject`'s options. `undefined` if there's no program.
function compilerOptionsForSvelte(ts, how) {
  const options = how.program;
  if (!options) return undefined;
  const root = typeof options.tsconfigRootDir === "string" ? nodePath.resolve(options.tsconfigRootDir) : cwd;
  const extensions = Array.isArray(options.extraFileExtensions)
    ? options.extraFileExtensions.filter(it => typeof it === "string")
    : [];
  const read = path => readConfigForSvelte(ts, path, extensions);
  const has = config => config !== null && hasForSvelte(ts, config, how.filename);
  if (!options.projectService) {
    for (const path of projectsForSvelte(ts, options.project, how.filename, root, options.projectFolderIgnoreList)) {
      const config = read(path);
      if (has(config)) return config.options;
    }
    return undefined;
  }
  const seen = new Set();
  const withFile = path => {
    if (seen.has(path)) return null;
    seen.add(path);
    const config = read(path);
    return has(config) ? config : null;
  };
  // `tryFindDefaultConfiguredProject`: the references level by level, then the configs above.
  const find = path => {
    const config = read(path);
    if (!config) return null;
    const found = withFile(path);
    if (found) return found;
    let level = [config];
    while (level.length) {
      const next = [];
      for (const it of level) {
        for (const reference of it.projectReferences) {
          const child = ts.resolveProjectReferencePath(reference);
          if (seen.has(child)) continue;
          const found = withFile(child);
          if (found) return found;
          const config = read(child);
          if (config) next.push(config);
        }
      }
      level = next;
    }
    if (config.options.disableSolutionSearching) return null;
    const above = configAboveForSvelte(ts, path, root, true);
    return above && find(above);
  };
  const nearest = configAboveForSvelte(ts, how.filename, root, false);
  const found = nearest && find(nearest);
  if (found) return found.options;
  const defaultProject = typeof options.projectService === "object" ? options.projectService.defaultProject : undefined;
  return read(nodePath.resolve(root, defaultProject ?? "tsconfig.json"))?.options;
}

// eslint-plugin-svelte's `transform/` transforms, each of the text from `input[0]` to `input[1]`: `{ inputRange,
// output, mappings }`, or `null`.
function transformForSvelte(kind, input, text, how) {
  const code = text.slice(...input);
  const { filename, plugin } = how;
  // Config files are looked up from the working directory, as the plugin does.
  try {
    switch (kind) {
      case "typescript": {
        const ts = loadForSvelte("typescript", plugin);
        if (!ts) return null;
        const output = ts.transpileModule(code, {
          reportDiagnostics: false,
          compilerOptions: {
            target: compilerOptionsForSvelte(ts, how)?.target || ts.ScriptTarget.ESNext,
            module: ts.ModuleKind.ESNext,
            importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Preserve,
            preserveValueImports: true,
            verbatimModuleSyntax: true,
            sourceMap: true,
          },
        });
        return { inputRange: input, output: output.outputText, mappings: JSON.parse(output.sourceMapText).mappings };
      }
      case "babel": {
        const babel = loadForSvelte("@babel/core", plugin);
        if (!babel) return null;
        const output = babel.transformSync(code, {
          sourceType: "module",
          sourceMaps: true,
          minified: false,
          ast: false,
          code: true,
          cwd,
        });
        if (!output) return null;
        return { inputRange: input, output: output.code, mappings: output.map.mappings };
      }
      case "postcss":
      case "pcss": {
        const settings = how.postcss;
        if (settings === false) return null;
        const postcss = importedBySvelte("postcss", plugin);
        const postcssLoadConfig = importedBySvelte("postcss-load-config", plugin);
        if (!postcss || !postcssLoadConfig) return null;
        const configFilePath = settings?.configFilePath;
        const config = postcssLoadConfig.sync(
          { cwd, from: `${filename}.css` },
          typeof configFilePath === "string" ? configFilePath : undefined,
        );
        const result = (postcss.default ?? postcss)(config.plugins).process(code, {
          ...config.options,
          map: { inline: false },
        });
        return { inputRange: input, output: result.content, mappings: result.map.toJSON().mappings };
      }
      case "scss":
      case "sass": {
        const sass = loadForSvelte("sass", plugin);
        if (!sass) return null;
        const output = sass.compileString(code, { sourceMap: true, syntax: kind === "sass" ? "indented" : undefined });
        if (!output) return null;
        return { inputRange: input, output: output.css, mappings: output.sourceMap.mappings };
      }
      case "less": {
        const less = loadForSvelte("less", plugin);
        if (!less) return null;
        let output;
        less.render(code, { sourceMap: {}, syncImport: true, filename: `${filename}.less`, lint: false }, (_, it) => {
          output = it;
        });
        if (!output) return null;
        return { inputRange: input, output: output.css, mappings: JSON.parse(output.map).mappings };
      }
      case "stylus":
      case "styl": {
        const stylus = loadForSvelte("stylus", plugin);
        if (!stylus) return null;
        let output;
        const style = stylus(code, { filename: `${filename}.stylus` }).set("sourcemap", {});
        style.render((_, it) => {
          output = it;
        });
        if (output == null) return null;
        return { inputRange: input, output, mappings: style.sourcemap.mappings };
      }
    }
  } catch {}
  return null;
}

// `getWarningsFromCode`
function compileForSvelte(compiler, code, how) {
  try {
    const isFive = String(compiler.VERSION).split(".")[0] === "5";
    const result = compiler.compile(code, {
      ...(isFive ? { experimental: { async: how.async ?? undefined } } : {}),
      generate: false,
      ...(how.customElement ? { customElement: true } : {}),
    });
    return { warnings: result.warnings, kind: COMPILE_WARNED };
  } catch (error) {
    return { warnings: [{ code: error?.code, start: error?.start, end: error?.end }], kind: COMPILE_FAILED };
  }
}

// `getSvelteCompileWarningsWithoutCache` up to `processIgnore`, which the other side does. The message: the length of
// the JSON that follows, the JSON, the text. The JSON: `plugin`, the eslint-plugin-svelte module the config has loaded,
// `filename`, `strip`, the ranges of the comments to blank, `styles`, `{ lang, input, children }` for each style sheet
// in a language other than CSS, `scripts`, the content of each script, `scriptKind`, `typescript` if TypeScript is
// used, `babel` if `@babel/eslint-parser` is, or `null`, `async`, `compilerOptions.experimental.async`,
// `customElement`, `postcss`, `settings.svelte.compileOptions.postcss`, and `program`, the parser options from which
// typescript-eslint creates a program for the component, or `null` if it creates none. Answers `{ kind, version,
// stripped, warnings }`: `stripped` holds the indices of the blanked style sheets, and each warning has its `code` and
// its start and end, as a `line` and `column` of the text or an `index`.
function compileSvelte() {
  const headLength = messageWords(1)[0];
  const how = JSON.parse(messageText(4, 4 + headLength));
  const source = messageText(4 + headLength);
  const compiler = importedBySvelte("svelte/compiler", how.plugin);
  if (compiler === null) return NOT_INSTALLED;
  const transformed = [];
  const blanked = [...how.strip];
  const stripped = [];
  how.styles.forEach((style, i) => {
    const result = transformForSvelte(style.lang, style.input, source, how);
    if (result) transformed.push(result);
    else {
      stripped.push(i);
      blanked.push(...style.children);
    }
  });
  let text = source;
  if (blanked.length) {
    let [code, start] = ["", 0];
    for (const [from, to] of blanked.sort((a, b) => a[0] - b[0])) {
      code += text.slice(start, from) + text.slice(from, to).replace(/[^\t\n\r ]/g, " ");
      start = to;
    }
    text = code + text.slice(start);
  }
  // TypeScript if it's used and installed, otherwise Babel.
  let scriptKind = how.scriptKind;
  if (scriptKind === "typescript" && !loadForSvelte("typescript", how.plugin)) scriptKind = "babel";
  if (scriptKind) {
    for (const input of how.scripts) {
      const result = transformForSvelte(scriptKind, input, text, how);
      if (result) transformed.push(result);
    }
  }
  const answer = (kind, warnings) =>
    DONE + JSON.stringify({ kind, version: String(compiler.VERSION), stripped, warnings });
  const at = point => (point ? { line: point.line, column: point.column } : null);
  if (!transformed.length) {
    const { warnings, kind } = compileForSvelte(compiler, text, how);
    return answer(
      kind,
      warnings.map(it => ({ code: it.code ?? null, start: at(it.start), end: at(it.end) })),
    );
  }
  // `RemapContext`
  let [original, code] = [0, ""];
  const maps = [];
  const appendOriginal = end => {
    const [codeStart, start] = [code.length, original];
    code += text.slice(start, end);
    original = end;
    maps.push({ range: [codeStart, code.length], remap: index => index + start - codeStart });
  };
  const appendTranspile = output => {
    const end = output.inputRange[1];
    const [codeStart, start] = [code.length, original];
    const inputText = text.slice(start, end);
    const outputText = `${output.output}\n`;
    code += outputText;
    original = end;
    let outputLocs, inputLocs, decoded;
    const remapPosition = pos => {
      decoded ??= decodeMappings(output.mappings);
      const lineMaps = decoded[pos.line - 1];
      if (!lineMaps?.length) {
        for (let line = pos.line - 1; line >= 0; line--) {
          const before = decoded[line];
          if (before?.length) {
            const [, , sourceLine, sourceColumn] = before[before.length - 1];
            return { line: sourceLine + 1, column: sourceColumn };
          }
        }
        return { line: -1, column: -1 };
      }
      for (let index = 0; index < lineMaps.length - 1; index++) {
        const [generated, , sourceLine, sourceColumn] = lineMaps[index];
        if (generated <= pos.column && pos.column < lineMaps[index + 1][0])
          return { line: sourceLine + 1, column: sourceColumn + (pos.column - generated) };
      }
      const [generated, , sourceLine, sourceColumn] = lineMaps[lineMaps.length - 1];
      return { line: sourceLine + 1, column: sourceColumn + (pos.column - generated) };
    };
    maps.push({
      range: [codeStart, code.length],
      remap: index => {
        outputLocs ??= linesAndColumns(outputText);
        inputLocs ??= linesAndColumns(inputText);
        return inputLocs.getIndexFromLoc(remapPosition(outputLocs.getLocFromIndex(index - codeStart))) + start;
      },
    });
  };
  for (const result of transformed.sort((a, b) => a.inputRange[0] - b.inputRange[0])) {
    appendOriginal(result.inputRange[0]);
    appendTranspile(result);
  }
  appendOriginal(text.length);
  const { warnings, kind } = compileForSvelte(compiler, code, how);
  const locs = linesAndColumns(code);
  const remapIndex = index => {
    for (const it of maps) if (it.range[0] <= index && index < it.range[1]) return it.remap(index);
    return null;
  };
  // `remapLocs`. Anything that maps to nothing, or to `0`, has no position.
  const remapped = (point, isEnd) => {
    if (!point) return null;
    const index = remapIndex(locs.getIndexFromLoc(point) - (isEnd ? 1 : 0));
    return index ? { index: index + (isEnd ? 1 : 0) } : null;
  };
  return answer(
    kind,
    warnings.map(it => ({ code: it.code ?? null, start: remapped(it.start, false), end: remapped(it.end, true) })),
  );
}

// What `handle` does with the call kinds from `COMPILE_SVELTE` on. A throw outside of `compile` is the rule's error.
function handleForSvelte() {
  try {
    return compileSvelte();
  } catch (error) {
    return FAILED + messageOf(error);
  }
}
