#pragma once

#include "root.h"
#include <memory>
#include <wtf/VectorTraits.h>

extern "C" {
struct sqlite3_session;
}

namespace Bun {

// Calls no script, so the collector can run it. Defined in SqliteUserFunction.h.
template<typename T>
struct SqliteDeleter {
    void operator()(T*) const;
};

// A connection, statement, session or backup, or memory from sqlite3_malloc().
template<typename T>
using SqlitePtr = std::unique_ptr<T, SqliteDeleter<T>>;

} // namespace Bun

namespace WTF {
template<typename T> struct VectorTraits<Bun::SqlitePtr<T>> : SimpleClassVectorTraits {};
}
