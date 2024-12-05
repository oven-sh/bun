// If you want to test an internal API, add a binding into this file.
//
// Then at test time: import ... from "bun:internal-for-testing"
//
// In a debug build, the import is always allowed.
// It is disallowed in release builds unless run in Bun's CI.

/// <reference path="./private.d.ts" />

const fmtBinding = $newZigFunction("fmt.zig", "fmt_js_test_bindings.jsFunctionStringFormatter", 2) as (
  code: string,
  id: number,
) => string;

export const quickAndDirtyJavaScriptSyntaxHighlighter = (code: string) => fmtBinding(code, 0);
export const escapePowershell = (code: string) => fmtBinding(code, 1);

export const TLSBinding = $cpp("NodeTLS.cpp", "createNodeTLSBinding");

export const SQL = $cpp("JSSQLStatement.cpp", "createJSSQLStatementConstructor");

export const patchInternals = {
  parse: $newZigFunction("patch.zig", "TestingAPIs.parse", 1),
  apply: $newZigFunction("patch.zig", "TestingAPIs.apply", 2),
  makeDiff: $newZigFunction("patch.zig", "TestingAPIs.makeDiff", 2),
};

const shellLex = $newZigFunction("shell.zig", "TestingAPIs.shellLex", 2);
const shellParse = $newZigFunction("shell.zig", "TestingAPIs.shellParse", 2);

export const shellInternals = {
  lex: (a, ...b) => shellLex(a.raw, b),
  parse: (a, ...b) => shellParse(a.raw, b),
  /**
   * Checks if the given builtin is disabled on the current platform
   *
   * @example
   * ```typescript
   * const isDisabled = builtinDisabled("cp")
   * ```
   */
  builtinDisabled: $newZigFunction("shell.zig", "TestingAPIs.disabledOnThisPlatform", 1),
};

export const iniInternals = {
  parse: $newZigFunction("ini.zig", "IniTestingAPIs.parse", 1),
  // loadNpmrc: (
  //   src: string,
  //   env?: Record<string, string>,
  // ): {
  //   default_registry_url: string;
  //   default_registry_token: string;
  //   default_registry_username: string;
  //   default_registry_password: string;
  // } => $newZigFunction("ini.zig", "IniTestingAPIs.loadNpmrcFromJS", 2)(src, env),
  loadNpmrc: $newZigFunction("ini.zig", "IniTestingAPIs.loadNpmrcFromJS", 2),
};

export const cssInternals = {
  minifyTestWithOptions: $newZigFunction("css_internals.zig", "minifyTestWithOptions", 3),
  testWithOptions: $newZigFunction("css_internals.zig", "testWithOptions", 3),
  prefixTestWithOptions: $newZigFunction("css_internals.zig", "prefixTestWithOptions", 3),
  attrTest: $newZigFunction("css_internals.zig", "attrTest", 3),
};

export const crash_handler = $zig("crash_handler.zig", "js_bindings.generate") as {
  getMachOImageZeroOffset: () => number;
  segfault: () => void;
  panic: () => void;
  rootError: () => void;
  outOfMemory: () => void;
  raiseIgnoringPanicHandler: () => void;
};

export const upgrade_test_helpers = $zig("upgrade_command.zig", "upgrade_js_bindings.generate") as {
  openTempDirWithoutSharingDelete: () => void;
  closeTempDirHandle: () => void;
};

export const install_test_helpers = $zig("install.zig", "bun_install_js_bindings.generate") as {
  /**
   * Returns the lockfile at the given path as an object.
   */
  parseLockfile: (cwd: string) => any;
};

export const jscInternals = $cpp("JSCTestingHelpers.cpp", "createJSCTestingHelpers");

export const nativeFrameForTesting: (callback: () => void) => void = $cpp(
  "CallSite.cpp",
  "createNativeFrameForTesting",
);

// Linux-only. Create an in-memory file descriptor with a preset size.
// You should call fs.closeSync(fd) when you're done with it.
export const memfd_create: (size: number) => number = $newZigFunction(
  "node_fs_binding.zig",
  "createMemfdForTesting",
  1,
);

export const setSyntheticAllocationLimitForTesting: (limit: number) => number = $newZigFunction(
  "javascript.zig",
  "Bun__setSyntheticAllocationLimitForTesting",
  1,
);

export const npm_manifest_test_helpers = $zig("npm.zig", "PackageManifest.bindings.generate") as {
  /**
   * Returns the parsed manifest file. Currently only returns an array of available versions.
   */
  parseManifest: (manifestFileName: string, registryUrl: string) => any;
};

// Like npm-package-arg, sort of https://www.npmjs.com/package/npm-package-arg
export type Dependency = any;
export const npa: (name: string) => Dependency = $newZigFunction("dependency.zig", "fromJS", 1);

export const npmTag: (
  name: string,
) => undefined | "npm" | "dist_tag" | "tarball" | "folder" | "symlink" | "workspace" | "git" | "github" =
  $newZigFunction("dependency.zig", "Version.Tag.inferFromJS", 1);

export const readTarball: (tarball: string) => any = $newZigFunction("pack_command.zig", "bindings.jsReadTarball", 1);

export const isArchitectureMatch: (architecture: string[]) => boolean = $newZigFunction(
  "npm.zig",
  "Architecture.jsFunctionArchitectureIsMatch",
  1,
);

export const isOperatingSystemMatch: (operatingSystem: string[]) => boolean = $newZigFunction(
  "npm.zig",
  "OperatingSystem.jsFunctionOperatingSystemIsMatch",
  1,
);

export const createSocketPair: () => [number, number] = $newZigFunction("socket.zig", "jsCreateSocketPair", 0);

export const isModuleResolveFilenameSlowPathEnabled: () => boolean = $newCppFunction(
  "NodeModuleModule.cpp",
  "jsFunctionIsModuleResolveFilenameSlowPathEnabled",
  0,
);

export const frameworkRouterInternals = $zig("FrameworkRouter.zig", "JSFrameworkRouter.getBindings") as {
  parseRoutePattern: (style: string, pattern: string) => null | { kind: string; pattern: string };
  FrameworkRouter: {
    new(opts: any): any;
  };
};
