#pragma once

namespace Bun {
bool isBuiltinModule(const String& namePossiblyWithNodePrefix);
String isUnprefixedNodeBuiltin(const String& name);
} // namespace Bun
