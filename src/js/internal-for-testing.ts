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

export const getMachOImageZeroOffset = $newZigFunction(
  "crash_handler.zig",
  "jsGetMachOImageZeroOffset",
  0,
) as () => number;
