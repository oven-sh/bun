#pragma once
#include "root.h"

#include <JavaScriptCore/ObjectConstructor.h>
#include <wtf/text/StringToIntegerConversion.h>
#include <JavaScriptCore/DateInstance.h>
#include "ExceptionOr.h"

namespace JSC {
// errors if the string includes unpaired surrogates
WebCore::ExceptionOr<void> encodeURIComponent(VM& vm, WTF::StringView source, StringBuilder& builder);
}
