#pragma once

// Quote-includes resolve against the including file's directory first, so this
// keeps `#include "config.h"` in the imported sources pointed at ../config.h
// rather than at webcore/config.h further down the include path.
#include "../config.h"
