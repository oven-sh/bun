// If you want to test an internal API, add a binding into this file.
//
// Then at test time: import ... from "bun:internal-for-testing"
//
// In a debug build, the import is always allowed.
// It is disallowed in release builds unless run in Bun's CI.

/// <reference path="./private.d.ts" />

export const quickAndDirtyJavaScriptSyntaxHighlighter = $newZigFunction(
  "fmt.zig",
  "QuickAndDirtyJavaScriptSyntaxHighlighter.jsFunctionSyntaxHighlight",
  2,
) as (code: string) => string;

export const TLSBinding = $cpp("NodeTLS.cpp", "createNodeTLSBinding");

export const SQL = $cpp("JSSQLStatement.cpp", "createJSSQLStatementConstructor");

export const patchInternals = {
  parse: $newZigFunction("patch.zig", "TestingAPIs.parse", 1),
  apply: $newZigFunction("patch.zig", "TestingAPIs.apply", 2),
  makeDiff: $newZigFunction("patch.zig", "TestingAPIs.makeDiff", 2),
};

export const shellInternals = {
  lex: (a, ...b) => $newZigFunction("shell.zig", "TestingAPIs.shellLex", 2)(a.raw, b),
  parse: (a, ...b) => $newZigFunction("shell.zig", "TestingAPIs.shellParse", 2)(a.raw, b),
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

export const crash_handler = $zig("crash_handler.zig", "js_bindings.generate") as {
  getMachOImageZeroOffset: () => number;
  segfault: () => void;
  panic: () => void;
  rootError: () => void;
  outOfMemory: () => void;
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
