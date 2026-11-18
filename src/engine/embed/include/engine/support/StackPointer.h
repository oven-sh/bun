#pragma once

#include "engine/support/Compiler.h"

namespace WTF {

ALWAYS_INLINE void* currentStackPointer() { return __builtin_stack_address(); }

}

using WTF::currentStackPointer;
