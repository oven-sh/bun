#pragma once

#include <span>

namespace Bun {
/// The publicly listed builtin specifiers. `module.builtinModules` is built from this
/// list and `isBuiltinModule` consults it, so the two cannot disagree. Specifiers the
/// loader resolves but does not expose, like `bun:app`, are deliberately absent.
std::span<const ASCIILiteral> builtinModuleNames();
bool isBuiltinModule(const String& namePossiblyWithNodePrefix);
String isUnprefixedNodeBuiltin(const String& name);
} // namespace Bun
