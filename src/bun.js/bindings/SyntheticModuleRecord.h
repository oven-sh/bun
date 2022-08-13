#pragma once

// need to fix this...
#define ENABLE_INSPECTOR_ALTERNATE_DISPATCHERS 0

#include "JavaScriptCore/SyntheticModuleRecord.h"

JSC::SyntheticModuleRecord* tryCreateWithExportNamesAndValues(
    JSC::JSGlobalObject*, const JSC::Identifier& moduleKey,
    const WTF::Vector<JSC::Identifier, 4>& exportNames,const JSC::MarkedArgumentBuffer& exportValues);
