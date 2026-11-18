#pragma once

#include "engine/support/Vector.h"
#include "engine/text/TextForward.h"

namespace WTF::FileSystemImpl {

std::optional<Vector<uint8_t>> readEntireFile(const String& path);

}
