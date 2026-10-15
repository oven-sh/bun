#pragma once
#include "root.h"

namespace Bun::Bindgen {

// The Structure of a returned dictionary, by index into Tables::objectStructures.
JSC::Structure* createObjectStructure(JSC::VM&, JSC::JSGlobalObject*, unsigned index);

}
