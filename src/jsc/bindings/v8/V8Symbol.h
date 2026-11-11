#pragma once

#include "v8.h"
#include "V8Name.h"
#include "V8Local.h"
#include "V8Isolate.h"

namespace v8 {

class Symbol : public Name {
public:
    BUN_EXPORT static Local<Symbol> GetIterator(Isolate* isolate);
};

} // namespace v8
