// RUN: link
// OPTIONS: builtin-modules
// CHECK-NOT: runtimefunction id=StdioGetLightStdioWriteStreams

// Nobody has laid anything above `process` or on it, so a name that it does not have finds nothing, and what lies behind its members stays out.

// FILE: main.js
export const found = process.all;
