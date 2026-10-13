#pragma once

#include "root.h"
#include <span>

namespace Bun {

// JSC::Config::isTrustedCode. By address: `source` is all of a builtin's or an embedded module's text, not a copy, and `bytecode` is empty or what the executable has for it.
bool isEmbeddedCode(std::span<const uint8_t> source, std::span<const uint8_t> bytecode, size_t bytecodeEntryOffset);

} // namespace Bun
