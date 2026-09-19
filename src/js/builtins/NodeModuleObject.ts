// Implementation for `require('node:module')._initPaths`. Exists only as a
// compatibility stub. Calling this does not affect the actual CommonJS loader.
export function _initPaths() {
  const homeDir = process.platform === "win32" ? process.env.USERPROFILE : Bun.env.HOME;
  const nodePath = process.platform === "win32" ? process.env.NODE_PATH : Bun.env.NODE_PATH;

  // process.execPath is $PREFIX/bin/node except on Windows where it is
  // $PREFIX\node.exe where $PREFIX is the root of the Node.js installation.
  const path = require("node:path");
  const prefixDir =
    process.platform === "win32" ? path.resolve(process.execPath, "..") : path.resolve(process.execPath, "..", "..");

  const paths = [path.resolve(prefixDir, "lib", "node")];

  if (homeDir) {
    paths.unshift(path.resolve(homeDir, ".node_libraries"));
    paths.unshift(path.resolve(homeDir, ".node_modules"));
  }

  if (nodePath) {
    paths.unshift(...nodePath.split(path.delimiter).filter(Boolean));
  }

  const M = require("node:module");
  M.globalPaths = paths;
}

$overriddenName = "stripTypeScriptTypes";
export function stripTypeScriptTypes(code: string) {
  if (typeof code !== "string") {
    throw $ERR_INVALID_ARG_TYPE("code", "string", code);
  }

  const options = arguments[1];
  if (options !== undefined && (typeof options !== "object" || options === null || Array.isArray(options))) {
    throw $ERR_INVALID_ARG_TYPE("options", "Object", options);
  }

  const mode = options?.mode ?? "strip";
  if (mode !== "strip" && mode !== "transform") {
    throw $ERR_INVALID_ARG_VALUE("options.mode", mode, "must be one of: 'strip', 'transform'");
  }

  const sourceMap = options?.sourceMap ?? false;
  if (typeof sourceMap !== "boolean") {
    throw $ERR_INVALID_ARG_TYPE("options.sourceMap", "boolean", sourceMap);
  }

  const sourceUrl = options?.sourceUrl ?? "";
  if (typeof sourceUrl !== "string") {
    throw $ERR_INVALID_ARG_TYPE("options.sourceUrl", "string", sourceUrl);
  }

  if (mode === "strip") {
    if (sourceMap) {
      throw $ERR_INVALID_ARG_VALUE("options.sourceMap", sourceMap, "must be one of: false, undefined");
    }

    const match = /(?:^|[\s;}])(?:export\s+)?(?:const\s+)?(enum|namespace|module)\s+[A-Za-z_$]/.exec(code);
    if (match) {
      const before = code.slice(0, match.index + match[0].indexOf(match[1]));
      if (!/\bdeclare(?:\s+const)?$/.test(before.trim())) {
        const isEnum = match[1] === "enum";
        const err = new SyntaxError(
          isEnum
            ? "TypeScript enum is not supported in strip-only mode"
            : "TypeScript namespace declaration is not supported in strip-only mode",
        );
        (err as any).code = "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX";
        throw err;
      }
    }
  }

  const transpilerSymbol = Symbol.for("::bun::stripTypeScriptTypes::transpiler");
  var transpiler = (globalThis as any)[transpilerSymbol];
  if (!transpiler) {
    transpiler = (globalThis as any)[transpilerSymbol] = new Bun.Transpiler({ loader: "ts" });
  }

  try {
    let result = transpiler.transformSync(code);
    if (sourceMap && mode === "transform") {
      const map = {
        version: 3,
        sources: [sourceUrl],
        names: [],
        mappings: "",
      };
      const base64Map = btoa(JSON.stringify(map));
      result += `\n//# sourceMappingURL=data:application/json;base64,${base64Map}\n`;
    }
    return result;
  } catch (err: any) {
    if (err && (err.name === "AggregateError" || err.name === "BuildMessage" || err instanceof SyntaxError)) {
      const msg = err?.errors?.map((e: any) => e?.message || String(e)).join("\n") || err.message || String(err);
      const syntaxError = new SyntaxError(msg);
      throw syntaxError;
    }
    throw err;
  }
}
