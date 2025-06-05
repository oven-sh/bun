#pragma once

namespace JSC {
class JSGlobalObject;
}

namespace Bun {

// Set the trace event categories from command line
void setTraceEventCategories(const char* categories);

// Setup trace event functions on the global object
void setupNodeTraceEvents(JSC::JSGlobalObject* globalObject);

} // namespace Bun