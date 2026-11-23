#pragma once

namespace Bun {
bool isBuiltinModule(const String& namePossiblyWithNodePrefix);
// "node:util" for "util", "node:util", "sys" and "node:sys". Null if it is no Node.js module.
ASCIILiteral keyOfNodeBuiltin(const String& name);
} // namespace Bun
