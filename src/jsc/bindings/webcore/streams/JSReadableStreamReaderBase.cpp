#include "config.h"
#include "JSReadableStreamReaderBase.h"

#include "JSReadableStreamBYOBReader.h"
#include <JavaScriptCore/JSCInlines.h>

namespace WebCore {

bool JSReadableStreamReaderBase::isBYOB() const
{
    return classInfo() == JSReadableStreamBYOBReader::info();
}

} // namespace WebCore
