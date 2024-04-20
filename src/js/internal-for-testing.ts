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

export const shellInternals = {
  lex: $newZigFunction("shell.zig", "TestingAPIs.shellLex", 1),
  parse: $newZigFunction("shell.zig", "TestingAPIs.shellParse", 1),
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
