#pragma once

#include <wtf/AbstractRefCountedAndCanMakeWeakPtr.h>

namespace WebCore {

class JSVMClientDataClient : public AbstractRefCountedAndCanMakeWeakPtr<JSVMClientDataClient> {
public:
    virtual ~JSVMClientDataClient() = default;
    virtual void willDestroyVM() = 0;
};

} // namespace WebCore
