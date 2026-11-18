#pragma once

#include <cstddef>

extern "C" int Support__numberOfProcessorCores();
extern "C" size_t Support__ramSize();

namespace WTF {

// Of those that the process may use.
inline int numberOfProcessorCores() { return Support__numberOfProcessorCores(); }
inline size_t ramSize() { return Support__ramSize(); }

}

using WTF::ramSize;
