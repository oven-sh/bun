#pragma once

#include "root.h"
#include <wtf/Vector.h>

extern "C" {
struct sqlite3_stmt;
}

namespace Bun {

// The column names a cached row shape was built from. They change only when sqlite3_step() re-prepares the statement.
class SqliteColumnNames {
public:
    // Call after the first sqlite3_step() of a run. True on the first call. Defined in SqliteUserFunction.h.
    inline bool changed(sqlite3_stmt*);

private:
    // Every name with its NUL, in column order.
    WTF::Vector<char> m_bytes;
};

} // namespace Bun
