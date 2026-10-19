#pragma once

#include "root.h"
#include <JavaScriptCore/WriteBarrier.h>
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>
#include <array>

namespace Bun {

// The database cell marks what the user functions of its connection call (SqliteUserFunction.h).
// A JSC::Strong in the context that SQLite owns would leak a database that one of its callbacks closes over.
class SqliteCallbackRoots {
public:
    using Values = std::array<JSC::JSValue, 4>;

    // After SQLite accepted a function, which replaces the one with the same name and argument count.
    void set(JSC::VM& vm, JSC::JSCell* owner, const WTF::String& name, int argumentCount, const Values& values)
    {
        WTF::Locker locker { owner->cellLock() };
        size_t index = m_functions.findIf([&](auto& function) {
            return function.argumentCount == argumentCount && WTF::equalIgnoringASCIICase(function.name, name);
        });
        if (index == WTF::notFound) {
            index = m_functions.size();
            m_functions.append({ name, argumentCount, {} });
        }
        for (size_t i = 0; i < values.size(); i++)
            m_functions[index].values[i].set(vm, owner, values[i]);
    }

    // After SQLite closed the connection.
    void clear(JSC::JSCell* owner)
    {
        WTF::Locker locker { owner->cellLock() };
        m_functions.clear();
    }

    template<typename Visitor>
    void visit(JSC::JSCell* owner, Visitor& visitor)
    {
        WTF::Locker locker { owner->cellLock() };
        for (auto& function : m_functions) {
            for (auto& value : function.values)
                visitor.append(value);
        }
    }

private:
    struct Function {
        WTF::String name;
        int argumentCount;
        std::array<JSC::WriteBarrier<JSC::Unknown>, 4> values;
    };
    // The collector's threads read it: every access holds the owner's cell lock.
    WTF::Vector<Function> m_functions;
};

} // namespace Bun
