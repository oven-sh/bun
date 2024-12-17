// This file is run through translate-c and exposed to Zig code
// under the namespace bun.C.translated. Prefer adding includes
// to this file instead of manually porting struct definitions
// into Zig code. By using automatic translation, differences
// in platforms can be avoided.

// OnBeforeParseResult, etc...
#include "../packages/bun-native-bundler-plugin-api/bundler_plugin.h"

// passwd, getpwuid_r
#include "pwd.h"
