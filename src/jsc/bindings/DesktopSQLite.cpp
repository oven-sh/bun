#include "root.h"

#if LAZY_LOAD_SQLITE
#include "sqlite/lazy_sqlite3.h"
#else
#include "sqlite/sqlite3_local.h"
#endif

extern "C" void Bun__initializeSQLite();

namespace Bun {

// `Library` in src/web/storage/sql.rs
struct SQLiteLibrary {
    int (*open)(const char*, sqlite3**, int, const char*);
    int (*close)(sqlite3*);
    int (*execute)(sqlite3*, const char*, int (*)(void*, int, char**, char**), void*, char**);
    int (*prepare)(sqlite3*, const char*, int, unsigned, sqlite3_stmt**, const char**);
    int (*step)(sqlite3_stmt*);
    int (*reset)(sqlite3_stmt*);
    int (*finalize)(sqlite3_stmt*);
    int (*bindNull)(sqlite3_stmt*, int);
    int (*bindInteger)(sqlite3_stmt*, int, sqlite3_int64);
    int (*bindReal)(sqlite3_stmt*, int, double);
    int (*bindText)(sqlite3_stmt*, int, const char*, sqlite3_uint64, void (*)(void*), unsigned char);
    int (*bindBlob)(sqlite3_stmt*, int, const void*, sqlite3_uint64, void (*)(void*));
    int (*columnType)(sqlite3_stmt*, int);
    sqlite3_int64 (*columnInteger)(sqlite3_stmt*, int);
    double (*columnReal)(sqlite3_stmt*, int);
    const void* (*columnBlob)(sqlite3_stmt*, int);
    int (*columnBytes)(sqlite3_stmt*, int);
};

extern "C" const SQLiteLibrary* Bun__Desktop__loadSQLite()
{
#if LAZY_LOAD_SQLITE
    if (lazyLoadSQLite() < 0)
        return nullptr;
#endif
    Bun__initializeSQLite();
    static const SQLiteLibrary library {
        sqlite3_open_v2,
        sqlite3_close_v2,
        sqlite3_exec,
        sqlite3_prepare_v3,
        sqlite3_step,
        sqlite3_reset,
        sqlite3_finalize,
        sqlite3_bind_null,
        sqlite3_bind_int64,
        sqlite3_bind_double,
        sqlite3_bind_text64,
        sqlite3_bind_blob64,
        sqlite3_column_type,
        sqlite3_column_int64,
        sqlite3_column_double,
        sqlite3_column_blob,
        sqlite3_column_bytes,
    };
    return &library;
}

}
