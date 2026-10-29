#pragma once

#include "root.h"
#include <JavaScriptCore/LineColumn.h>

namespace Bun {

// Where JavaScript called the host function that is running, in the text that JSC runs: no source map is applied.
struct CallerLocation {
    WTF::String sourceURL;
    // One-based. JSC reports a call at the end of its callee: `a.b(c)` is at the column after `b`.
    JSC::LineColumn lineColumn;
    // JSC::SourceProvenance::Static: the text was read from where the program is stored. It is not what a plugin returned.
    bool isStatic { false };
};

CallerLocation callerLocation(JSC::VM&, JSC::CallFrame*);

// Moves `location` to where a stack trace shows it: through the source map of its module, if that has one.
void remapCallerLocation(JSC::JSGlobalObject*, CallerLocation&);

} // namespace Bun
