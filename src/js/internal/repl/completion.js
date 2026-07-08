// Ported from Node.js v26.3.0 lib/internal/repl/completion.js for Bun's node:repl.
// Attribution: derived from Node.js, MIT licensed (Node.js contributors).
// prettier-ignore
const primordials = require("internal/repl/node-primordials");
var __node_module__ = { exports: {} };

const {
  ArrayPrototypeFilter,
  ArrayPrototypeForEach,
  ArrayPrototypeIncludes,
  ArrayPrototypeMap,
  ArrayPrototypePush,
  ArrayPrototypePushApply,
  ArrayPrototypeShift,
  ArrayPrototypeSlice,
  ArrayPrototypeSome,
  ArrayPrototypeSort,
  ArrayPrototypeUnshift,
  ObjectGetOwnPropertyDescriptor,
  ObjectGetPrototypeOf,
  ObjectKeys,
  ReflectApply,
  RegExpPrototypeExec,
  SafeSet,
  StringPrototypeCodePointAt,
  StringPrototypeEndsWith,
  StringPrototypeIncludes,
  StringPrototypeSlice,
  StringPrototypeStartsWith,
  StringPrototypeToLocaleLowerCase,
  StringPrototypeTrimStart,
} = primordials;

const {
  kContextId,
  getREPLResourceName,
  globalBuiltins,
  getReplBuiltinLibs,
  fixReplRequire,
} = require("internal/repl/utils");

const { sendInspectorCommand } = require("internal/repl/node-shims");

const { isProxy } = require("internal/repl/node-shims");

const CJSModule = require("internal/repl/node-shims").Module;

const { extensionFormatMap } = require("internal/repl/node-shims");

const path = require("node:path");
const fs = require("node:fs");

const {
  constants: { ALL_PROPERTIES, SKIP_SYMBOLS },
  getOwnNonIndexProperties,
} = require("internal/repl/node-shims");

const { isIdentifierStart, isIdentifierChar } = require("internal/repl/native-parse");

const importRE = /\bimport\s*\(\s*['"`](([\w@./:-]+\/)?(?:[\w@./:-]*))(?![^'"`])$/;
const requireRE = /\brequire\s*\(\s*['"`](([\w@./:-]+\/)?(?:[\w@./:-]*))(?![^'"`])$/;
const fsAutoCompleteRE = /fs(?:\.promises)?\.\s*[a-z][a-zA-Z]+\(\s*["'](.*)/;
const versionedFileNamesRe = /-\d+\.\d+/;

fixReplRequire(__node_module__);

const { BuiltinModule } = require("internal/repl/node-shims");

const nodeSchemeBuiltinLibs = ArrayPrototypeMap(getReplBuiltinLibs(), lib => `node:${lib}`);
ArrayPrototypeForEach(BuiltinModule.getSchemeOnlyModuleNames(), lib =>
  ArrayPrototypePush(nodeSchemeBuiltinLibs, `node:${lib}`),
);

function isIdentifier(str) {
  if (str === "") {
    return false;
  }
  const first = StringPrototypeCodePointAt(str, 0);
  if (!isIdentifierStart(first)) {
    return false;
  }
  const firstLen = first > 0xffff ? 2 : 1;
  for (let i = firstLen; i < str.length; i += 1) {
    const cp = StringPrototypeCodePointAt(str, i);
    if (!isIdentifierChar(cp)) {
      return false;
    }
    if (cp > 0xffff) {
      i += 1;
    }
  }
  return true;
}

function isNotLegacyObjectPrototypeMethod(str) {
  return (
    isIdentifier(str) &&
    str !== "__defineGetter__" &&
    str !== "__defineSetter__" &&
    str !== "__lookupGetter__" &&
    str !== "__lookupSetter__"
  );
}

function getGlobalLexicalScopeNames(contextId) {
  return sendInspectorCommand(
    session => {
      let names = [];
      session.post(
        "Runtime.globalLexicalScopeNames",
        {
          executionContextId: contextId,
        },
        (error, result) => {
          if (!error) names = result.names;
        },
      );
      return names;
    },
    () => [],
  );
}

function filteredOwnPropertyNames(obj) {
  if (!obj) return [];
  // `Object.prototype` is the only non-contrived object that fulfills
  // `Object.getPrototypeOf(X) === null &&
  //  Object.getPrototypeOf(Object.getPrototypeOf(X.constructor)) === X`.
  let isObjectPrototype = false;
  if (ObjectGetPrototypeOf(obj) === null) {
    const ctorDescriptor = ObjectGetOwnPropertyDescriptor(obj, "constructor");
    if (ctorDescriptor?.value) {
      const ctorProto = ObjectGetPrototypeOf(ctorDescriptor.value);
      isObjectPrototype = ctorProto && ObjectGetPrototypeOf(ctorProto) === obj;
    }
  }
  const filter = ALL_PROPERTIES | SKIP_SYMBOLS;
  return ArrayPrototypeFilter(
    getOwnNonIndexProperties(obj, filter),
    isObjectPrototype ? isNotLegacyObjectPrototypeMethod : isIdentifier,
  );
}

function addCommonWords(completionGroups) {
  // Only words which do not yet exist as global property should be added to
  // this list.
  ArrayPrototypePush(completionGroups, [
    "async",
    "await",
    "break",
    "case",
    "catch",
    "const",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "else",
    "export",
    "false",
    "finally",
    "for",
    "function",
    "if",
    "import",
    "in",
    "instanceof",
    "let",
    "new",
    "null",
    "return",
    "switch",
    "this",
    "throw",
    "true",
    "try",
    "typeof",
    "var",
    "void",
    "while",
    "with",
    "yield",
  ]);
}

function gracefulReaddir(...args) {
  try {
    return ReflectApply(fs.readdirSync, null, args);
  } catch {
    // Continue regardless of error.
  }
}

function completeFSFunctions(match) {
  let baseName = "";
  let filePath = match[1];
  let fileList = gracefulReaddir(filePath, { withFileTypes: true });

  if (!fileList) {
    baseName = path.basename(filePath);
    filePath = path.dirname(filePath);
    fileList = gracefulReaddir(filePath, { withFileTypes: true }) || [];
  }

  const completions = ArrayPrototypeMap(
    ArrayPrototypeFilter(fileList, dirent => StringPrototypeStartsWith(dirent.name, baseName)),
    d => d.name,
  );

  return [[completions], baseName];
}

// Provide a list of completions for the given leading text. This is
// given to the readline interface for handling tab completion.
//
// Example:
//  complete('let foo = util.')
//    -> [['util.print', 'util.debug', 'util.log', 'util.inspect'],
//        'util.' ]
//
// Warning: This evals code like "foo.bar.baz", so it could run property
// getter code. To avoid potential triggering side-effects with getters the completion
// logic is skipped when getters or proxies are involved in the expression.
// (see: https://github.com/nodejs/node/issues/57829).
function complete(line, callback) {
  // List of completion lists, one for each inheritance "level"
  let completionGroups = [];
  let completeOn, group;

  // Ignore right whitespace. It could change the outcome.
  line = StringPrototypeTrimStart(line);

  let filter = "";

  let match;
  // REPL commands (e.g. ".break").
  if ((match = RegExpPrototypeExec(/^\s*\.(\w*)$/, line)) !== null) {
    ArrayPrototypePush(completionGroups, ObjectKeys(this.commands));
    completeOn = match[1];
    if (completeOn.length) {
      filter = completeOn;
    }
  } else if ((match = RegExpPrototypeExec(requireRE, line)) !== null) {
    // require("...<Tab>")
    completeOn = match[1];
    filter = completeOn;
    if (this.allowBlockingCompletions) {
      const subdir = match[2] || "";
      const extensions = ObjectKeys(CJSModule._extensions);
      const indexes = ArrayPrototypeMap(extensions, extension => `index${extension}`);
      ArrayPrototypePush(indexes, "package.json", "index");

      group = [];
      let paths = [];

      if (completeOn === ".") {
        group = ["./", "../"];
      } else if (completeOn === "..") {
        group = ["../"];
      } else if (RegExpPrototypeExec(/^\.\.?\//, completeOn) !== null) {
        paths = [process.cwd()];
      } else {
        paths = [];
        ArrayPrototypePushApply(paths, __node_module__.paths);
        ArrayPrototypePushApply(paths, CJSModule.globalPaths);
      }

      ArrayPrototypeForEach(paths, dir => {
        dir = path.resolve(dir, subdir);
        const dirents = gracefulReaddir(dir, { withFileTypes: true }) || [];
        ArrayPrototypeForEach(dirents, dirent => {
          if (RegExpPrototypeExec(versionedFileNamesRe, dirent.name) !== null || dirent.name === ".npm") {
            // Exclude versioned names that 'npm' installs.
            return;
          }
          const extension = path.extname(dirent.name);
          const base = StringPrototypeSlice(dirent.name, 0, -extension.length);
          if (!dirent.isDirectory()) {
            if (StringPrototypeIncludes(extensions, extension) && (!subdir || base !== "index")) {
              ArrayPrototypePush(group, `${subdir}${base}`);
            }
            return;
          }
          ArrayPrototypePush(group, `${subdir}${dirent.name}/`);
          const absolute = path.resolve(dir, dirent.name);
          if (
            ArrayPrototypeSome(gracefulReaddir(absolute) || [], subfile => ArrayPrototypeIncludes(indexes, subfile))
          ) {
            ArrayPrototypePush(group, `${subdir}${dirent.name}`);
          }
        });
      });
      if (group.length) {
        ArrayPrototypePush(completionGroups, group);
      }
    }

    ArrayPrototypePush(completionGroups, getReplBuiltinLibs(), nodeSchemeBuiltinLibs);
  } else if ((match = RegExpPrototypeExec(importRE, line)) !== null) {
    // import('...<Tab>')
    completeOn = match[1];
    filter = completeOn;
    if (this.allowBlockingCompletions) {
      const subdir = match[2] || "";
      // File extensions that can be imported:
      const extensions = ObjectKeys(extensionFormatMap);

      // Only used when loading bare module specifiers from `node_modules`:
      const indexes = ArrayPrototypeMap(extensions, ext => `index${ext}`);
      ArrayPrototypePush(indexes, "package.json");

      group = [];
      let paths = [];
      if (completeOn === ".") {
        group = ["./", "../"];
      } else if (completeOn === "..") {
        group = ["../"];
      } else if (RegExpPrototypeExec(/^\.\.?\//, completeOn) !== null) {
        paths = [process.cwd()];
      } else {
        paths = ArrayPrototypeSlice(__node_module__.paths);
      }

      ArrayPrototypeForEach(paths, dir => {
        dir = path.resolve(dir, subdir);
        const isInNodeModules = path.basename(dir) === "node_modules";
        const dirents = gracefulReaddir(dir, { withFileTypes: true }) || [];
        ArrayPrototypeForEach(dirents, dirent => {
          const { name } = dirent;
          if (RegExpPrototypeExec(versionedFileNamesRe, name) !== null || name === ".npm") {
            // Exclude versioned names that 'npm' installs.
            return;
          }

          if (!dirent.isDirectory()) {
            const extension = path.extname(name);
            if (StringPrototypeIncludes(extensions, extension)) {
              ArrayPrototypePush(group, `${subdir}${name}`);
            }
            return;
          }

          ArrayPrototypePush(group, `${subdir}${name}/`);
          if (!subdir && isInNodeModules) {
            const absolute = path.resolve(dir, name);
            const subfiles = gracefulReaddir(absolute) || [];
            if (
              ArrayPrototypeSome(subfiles, subfile => {
                return ArrayPrototypeIncludes(indexes, subfile);
              })
            ) {
              ArrayPrototypePush(group, `${subdir}${name}`);
            }
          }
        });
      });

      if (group.length) {
        ArrayPrototypePush(completionGroups, group);
      }
    }

    ArrayPrototypePush(completionGroups, getReplBuiltinLibs(), nodeSchemeBuiltinLibs);
  } else if ((match = RegExpPrototypeExec(fsAutoCompleteRE, line)) !== null && this.allowBlockingCompletions) {
    ({ 0: completionGroups, 1: completeOn } = completeFSFunctions(match));
  } else if (line.length === 0 || RegExpPrototypeExec(/\w|\.|\$/, line[line.length - 1]) !== null) {
    const completeTarget = line.length === 0 ? line : findExpressionCompleteTarget(line);

    if (line.length !== 0 && !completeTarget) {
      completionGroupsLoaded();
      return;
    }
    let expr = "";
    completeOn = completeTarget;
    const targetSegments = line.length === 0 ? null : memberChainSegments(completeTarget);
    if (StringPrototypeEndsWith(line, ".")) {
      expr = StringPrototypeSlice(completeTarget, 0, -1);
    } else if (targetSegments !== null && targetSegments.length > 1) {
      const last = targetSegments[targetSegments.length - 1];
      filter = last.key ?? "";
      expr = targetSegments[targetSegments.length - 2].prefix;
      // A trailing `[...]` segment isn't a partial identifier — nothing to filter on.
      if (last.key === null) {
        expr = last.prefix;
        filter = "";
      }
    } else if (targetSegments !== null) {
      // A bare identifier prefix (`tru`): no receiver, filter the globals by it.
      filter = targetSegments[0].prefix;
    }

    // Resolve expr and get its completions.
    if (!expr) {
      // Get global vars synchronously
      ArrayPrototypePush(completionGroups, getGlobalLexicalScopeNames(this[kContextId]));
      let contextProto = this.context;
      while ((contextProto = ObjectGetPrototypeOf(contextProto)) !== null) {
        ArrayPrototypePush(completionGroups, filteredOwnPropertyNames(contextProto));
      }
      const contextOwnNames = filteredOwnPropertyNames(this.context);
      if (!this.useGlobal) {
        // When the context is not `global`, builtins are not own
        // properties of it.
        // `globalBuiltins` is a `SafeSet`, not an Array-like.
        ArrayPrototypePush(contextOwnNames, ...globalBuiltins);
      }
      ArrayPrototypePush(completionGroups, contextOwnNames);
      if (filter !== "") addCommonWords(completionGroups);
      completionGroupsLoaded();
      return;
    }

    // Destructuring keeps the "eval" property name out of member-access
    // position: JSC's assertion-enabled builtin parser rejects `x.eval` /
    // `x["eval"]` inside builtin sources, and minify-syntax would fold a
    // bracket access back into dot form.
    const { eval: evalFn } = this;

    return includesProxiesOrGetters(
      targetSegments,
      evalFn,
      this.context,
      includes => {
        if (includes) {
          // The expression involves proxies or getters, meaning that it
          // can trigger side-effectful behaviors, so bail out
          return completionGroupsLoaded();
        }

        let chaining = ".";
        if (StringPrototypeEndsWith(expr, "?")) {
          expr = StringPrototypeSlice(expr, 0, -1);
          chaining = "?.";
        }

        const memberGroups = [];
        const evalExpr = `try { ${expr} } catch {}`;
        // ReflectApply keeps `this` bound like `this.eval(...)` would.
        ReflectApply(evalFn, this, [
          evalExpr,
          this.context,
          getREPLResourceName(),
          (e, obj) => {
            try {
              let p;
              if ((typeof obj === "object" && obj !== null) || typeof obj === "function") {
                ArrayPrototypePush(memberGroups, filteredOwnPropertyNames(obj));
                p = ObjectGetPrototypeOf(obj);
              } else {
                p = obj.constructor ? obj.constructor.prototype : null;
              }
              // Circular refs possible? Let's guard against that.
              let sentinel = 5;
              while (p !== null && sentinel-- !== 0) {
                ArrayPrototypePush(memberGroups, filteredOwnPropertyNames(p));
                p = ObjectGetPrototypeOf(p);
              }
            } catch {
              // Maybe a Proxy object without `getOwnPropertyNames` trap.
              // We simply ignore it here, as we don't want to break the
              // autocompletion. Fixes the bug
              // https://github.com/nodejs/node/issues/2119
            }

            if (memberGroups.length) {
              expr += chaining;
              ArrayPrototypeForEach(memberGroups, group => {
                ArrayPrototypePush(
                  completionGroups,
                  ArrayPrototypeMap(group, member => `${expr}${member}`),
                );
              });
              filter &&= `${expr}${filter}`;
            }

            completionGroupsLoaded();
          },
        ]);
      },
    );
  }

  return completionGroupsLoaded();

  // Will be called when all completionGroups are in place
  // Useful for async autocompletion
  function completionGroupsLoaded() {
    // Filter, sort (within each group), uniq and merge the completion groups.
    if (completionGroups.length && filter) {
      const newCompletionGroups = [];
      const lowerCaseFilter = StringPrototypeToLocaleLowerCase(filter);
      ArrayPrototypeForEach(completionGroups, group => {
        const filteredGroup = ArrayPrototypeFilter(group, str => {
          // Filter is always case-insensitive following chromium autocomplete
          // behavior.
          return StringPrototypeStartsWith(StringPrototypeToLocaleLowerCase(str), lowerCaseFilter);
        });
        if (filteredGroup.length) {
          ArrayPrototypePush(newCompletionGroups, filteredGroup);
        }
      });
      completionGroups = newCompletionGroups;
    }

    const completions = [];
    // Unique completions across all groups.
    const uniqueSet = new SafeSet();
    uniqueSet.add("");
    // Completion group 0 is the "closest" (least far up the inheritance
    // chain) so we put its completions last: to be closest in the REPL.
    ArrayPrototypeForEach(completionGroups, group => {
      ArrayPrototypeSort(group, (a, b) => (b > a ? 1 : -1));
      const setSize = uniqueSet.size;
      ArrayPrototypeForEach(group, entry => {
        if (!uniqueSet.has(entry)) {
          ArrayPrototypeUnshift(completions, entry);
          uniqueSet.add(entry);
        }
      });
      // Add a separator between groups.
      if (uniqueSet.size !== setSize) {
        ArrayPrototypeUnshift(completions, "");
      }
    });

    // Remove obsolete group entry, if present.
    if (completions[0] === "") {
      ArrayPrototypeShift(completions);
    }

    callback(null, [completions, completeOn]);
  }
}

/**
 * This function tries to extract a target for tab completion from code representing an expression.
 *
 * Such target is basically the last piece of the expression that can be evaluated for the potential
 * tab completion.
 *
 * Some examples:
 * - The complete target for `const a = obj.b` is `obj.b`
 *   (because tab completion will evaluate and check the `obj.b` object)
 * - The complete target for `tru` is `tru`
 *   (since we'd ideally want to complete that to `true`)
 * - The complete target for `{ a: tru` is `tru`
 *   (like the last example, we'd ideally want that to complete to true)
 * - There is no complete target for `{ a: true }`
 *   (there is nothing to complete)
 * @param {string} code the code representing the expression to analyze
 * @returns {string|null} a substring of the code representing the complete target is there was one, `null` otherwise
 */
function findExpressionCompleteTarget(code) {
  // Scan backward from the end, treating each balanced `[...]` as opaque, so
  // arbitrary index expressions (`obj["a" + "b"]`, `obj[k[0]]`) are captured
  // whole. Stops at the first char that can't be part of a member expression.
  let i = code.length;
  const isIdent = c => RegExpPrototypeExec(/[\w$]/, c) !== null;
  while (i > 0) {
    let c = code[i - 1];
    if (isIdent(c)) {
      while (i > 0 && isIdent(code[i - 1])) i--;
      c = code[i - 1];
    }
    if (c === "." && code[i - 2] === "?") {
      i -= 2;
      continue;
    }
    if (c === ".") {
      i--;
      continue;
    }
    if (c === "]") {
      let depth = 1;
      let j = i - 1;
      while (j > 0 && depth > 0) {
        j--;
        const cj = code[j];
        if (cj === "]") depth++;
        else if (cj === "[") depth--;
        else if (cj === '"' || cj === "'" || cj === "`") {
          const q = cj;
          while (j > 0) {
            j--;
            if (code[j] === q && code[j - 1] !== "\\") break;
          }
        }
      }
      if (depth !== 0) return null;
      // Bail on a call inside the brackets (identifier or `]` immediately
      // before `(`). Grouping parens are allowed — the index expression is
      // evaluated to obtain the key, same as Node's acorn-based path.
      if (RegExpPrototypeExec(/[\w$\]]\s*\(/, StringPrototypeSlice(code, j + 1, i - 1)) !== null) return null;
      i = j;
      continue;
    }
    break;
  }
  const result = StringPrototypeSlice(code, i);
  if (result === "" || memberChainSegments(result) === null) return null;
  return result;
}

/**
 * Tokenize a member-expression source (already matched by simpleExpressionRE
 * and containing no `(`) into `{prefix, key, keyExpr}` segments so the
 * getter/Proxy walk can evaluate each prefix and inspect the next key.
 */
function memberChainSegments(src) {
  const segs = [];
  let i = 0;
  const base = RegExpPrototypeExec(/^[A-Za-z_$][\w$]*/, src);
  if (base === null) return null;
  let prefix = base[0];
  i = prefix.length;
  segs.push({ prefix, key: null, keyExpr: null });
  while (i < src.length) {
    // `?.` links: skip the `?` for `?.ident`, and the `?.` for `?.[computed]`
    // so the bracket branch below sees the `[`.
    if (src[i] === "?" && src[i + 1] === ".") i += src[i + 2] === "[" ? 2 : 1;
    if (src[i] === ".") {
      i += 1;
      const id = RegExpPrototypeExec(/^[A-Za-z_$][\w$]*/, StringPrototypeSlice(src, i));
      if (id === null) {
        // Trailing `.` or `?.` — the completion filter, not a chain link.
        if (i === src.length) break;
        return null;
      }
      prefix = StringPrototypeSlice(src, 0, i + id[0].length);
      segs.push({ prefix, key: id[0], keyExpr: null });
      i += id[0].length;
    } else if (src[i] === "[") {
      // Find the matching `]`, honoring nested `[` and quoted strings.
      let depth = 1;
      let j = i + 1;
      while (j < src.length && depth > 0) {
        const c = src[j];
        if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === '"' || c === "'" || c === "`") {
          const q = c;
          j++;
          while (j < src.length && src[j] !== q) j += src[j] === "\\" ? 2 : 1;
        }
        j++;
      }
      if (depth !== 0) return null;
      const inner = StringPrototypeSlice(src, i + 1, j - 1);
      prefix = StringPrototypeSlice(src, 0, j);
      // Literal string/number keys are resolved statically; anything else is
      // evaluated to obtain the key (the caller has already rejected `(`).
      const lit = RegExpPrototypeExec(
        /^\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`|(\d+))\s*$/,
        inner,
      );
      segs.push({
        prefix,
        key: lit ? (lit[1] ?? lit[2] ?? lit[3] ?? lit[4]) : null,
        keyExpr: lit ? null : inner,
      });
      i = j;
    } else {
      return null;
    }
  }
  return segs;
}

/**
 * Determine whether a member-expression chain touches a getter or Proxy
 * (which could trigger side effects during completion).
 */
function includesProxiesOrGetters(segments, evalFn, ctx, callback, idx = 0) {
  if (segments === null) return callback(false);
  const seg = segments[idx];
  evalFn(`try { ${seg.prefix} } catch { }`, ctx, getREPLResourceName(), (_, obj) => {
    const t = typeof obj;
    if ((t !== "object" && t !== "function") || obj === null) return callback(false);
    if (isProxy(obj)) return callback(true);
    const next = segments[idx + 1];
    if (!next) return callback(false);
    const step = key => {
      if (key != null && segmentHasGetter(obj, key)) return callback(true);
      return includesProxiesOrGetters(segments, evalFn, ctx, callback, idx + 1);
    };
    if (next.key !== null) return step(next.key);
    if (next.keyExpr !== null) {
      return evalFn(`try { ${next.keyExpr} } catch { }`, ctx, getREPLResourceName(), (_, k) =>
        step(typeof k === "string" || typeof k === "number" ? k : null),
      );
    }
    return step(null);
  });
}

function segmentHasGetter(obj, prop) {
  while (obj != null) {
    const d = ObjectGetOwnPropertyDescriptor(obj, prop);
    if (d) return typeof d.get === "function";
    obj = ObjectGetPrototypeOf(obj);
  }
  return false;
}

__node_module__.exports = {
  complete,
};

export default __node_module__.exports;
