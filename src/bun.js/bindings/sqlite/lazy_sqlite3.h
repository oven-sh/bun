#pragma once

#include "root.h"

#if !OS(WINDOWS)
#include <dlfcn.h>
#else
#include <windows.h>
#endif

typedef int (*lazy_sqlite3_bind_blob_type)(sqlite3_stmt*, int, const void*, int n, void (*)(void*));
typedef int (*lazy_sqlite3_bind_double_type)(sqlite3_stmt*, int, double);
typedef int (*lazy_sqlite3_bind_int_type)(sqlite3_stmt*, int, int);
typedef int (*lazy_sqlite3_bind_int64_type)(sqlite3_stmt*, int, sqlite3_int64);
typedef int (*lazy_sqlite3_bind_null_type)(sqlite3_stmt*, int);
typedef int (*lazy_sqlite3_bind_text_type)(sqlite3_stmt*, int, const char*, int, void (*)(void*));
typedef int (*lazy_sqlite3_bind_text16_type)(sqlite3_stmt*, int, const void*, int, void (*)(void*));
typedef int (*lazy_sqlite3_bind_parameter_count_type)(sqlite3_stmt*);
typedef int (*lazy_sqlite3_bind_parameter_index_type)(sqlite3_stmt*, const char* zName);
typedef int (*lazy_sqlite3_changes_type)(sqlite3*);
typedef int (*lazy_sqlite3_clear_bindings_type)(sqlite3_stmt*);
typedef int (*lazy_sqlite3_close_v2_type)(sqlite3*);
typedef int (*lazy_sqlite3_close_type)(sqlite3*);
typedef int (*lazy_sqlite3_file_control_type)(sqlite3*, const char* zDbName, int op, void* pArg);
typedef int (*lazy_sqlite3_extended_result_codes_type)(sqlite3*, int onoff);
typedef const void* (*lazy_sqlite3_column_blob_type)(sqlite3_stmt*, int iCol);
typedef double (*lazy_sqlite3_column_double_type)(sqlite3_stmt*, int iCol);
typedef int (*lazy_sqlite3_column_int_type)(sqlite3_stmt*, int iCol);
typedef sqlite3_int64 (*lazy_sqlite3_column_int64_type)(sqlite3_stmt*, int iCol);
typedef const unsigned char* (*lazy_sqlite3_column_text_type)(sqlite3_stmt*, int iCol);
typedef int (*lazy_sqlite3_column_bytes_type)(sqlite3_stmt*, int iCol);
typedef int (*lazy_sqlite3_column_bytes16_type)(sqlite3_stmt*, int iCol);
typedef int (*lazy_sqlite3_column_type_type)(sqlite3_stmt*, int iCol);
typedef int (*lazy_sqlite3_column_count_type)(sqlite3_stmt* pStmt);
typedef const char* (*lazy_sqlite3_column_decltype_type)(sqlite3_stmt*, int);
typedef const char* (*lazy_sqlite3_column_name_type)(sqlite3_stmt*, int N);
typedef const char* (*lazy_sqlite3_errmsg_type)(sqlite3*);
typedef int (*lazy_sqlite3_extended_errcode_type)(sqlite3*);
typedef int (*lazy_sqlite3_error_offset_type)(sqlite3*);
typedef int64_t (*lazy_sqlite3_memory_used_type)();
typedef const char* (*lazy_sqlite3_errstr_type)(int);
typedef char* (*lazy_sqlite3_expanded_sql_type)(sqlite3_stmt* pStmt);
typedef int (*lazy_sqlite3_finalize_type)(sqlite3_stmt* pStmt);
typedef void (*lazy_sqlite3_free_type)(void*);
typedef int (*lazy_sqlite3_get_autocommit_type)(sqlite3*);
typedef int (*lazy_sqlite3_total_changes_type)(sqlite3*);
typedef int (*lazy_sqlite3_get_autocommit_type)(sqlite3*);
typedef int (*lazy_sqlite3_config_type)(int, ...);
typedef int (*lazy_sqlite3_open_v2_type)(const char* filename, /* Database filename (UTF-8) */ sqlite3** ppDb, /* OUT: SQLite db handle */ int flags, /* Flags */ const char* zVfs /* Name of VFS module to use */);
typedef int (*lazy_sqlite3_prepare_v3_type)(sqlite3* db, /* Database handle */
    const char* zSql, /* SQL statement, UTF-8 encoded */
    int nByte, /* Maximum length of zSql in bytes. */
    unsigned int prepFlags, /* Zero or more SQLITE_PREPARE_ flags */
    sqlite3_stmt** ppStmt, /* OUT: Statement handle */
    const char** pzTail /* OUT: Pointer to unused portion of zSql */);
typedef int (*lazy_sqlite3_prepare16_v3_type)(sqlite3* db, /* Database handle */
    const void* zSql, /* SQL statement, UTF-16 encoded */
    int nByte, /* Maximum length of zSql in bytes. */
    unsigned int prepFlags, /* Zero or more SQLITE_PREPARE_ flags */
    sqlite3_stmt** ppStmt, /* OUT: Statement handle */
    const void** pzTail /* OUT: Pointer to unused portion of zSql */);
typedef int (*lazy_sqlite3_reset_type)(sqlite3_stmt* pStmt);
typedef int (*lazy_sqlite3_step_type)(sqlite3_stmt*);
typedef int (*lazy_sqlite3_clear_bindings_type)(sqlite3_stmt*);
typedef int (*lazy_sqlite3_column_type_type)(sqlite3_stmt*, int iCol);
typedef int (*lazy_sqlite3_db_config_type)(sqlite3*, int op, ...);
typedef const char* (*lazy_sqlite3_bind_parameter_name_type)(sqlite3_stmt*, int);

typedef int (*lazy_sqlite3_load_extension_type)(
    sqlite3* db, /* Load the extension into this database connection */
    const char* zFile, /* Name of the shared library containing extension */
    const char* zProc, /* Entry point.  Derived from zFile if 0 */
    char** pzErrMsg /* Put error message here if not 0 */
);
typedef void* (*lazy_sqlite3_libversion_type)();
typedef void* (*lazy_sqlite3_malloc64_type)(sqlite3_uint64);
typedef unsigned char* (*lazy_sqlite3_serialize_type)(
    sqlite3* db, /* The database connection */
    const char* zSchema, /* Which DB to serialize. ex: "main", "temp", ... */
    sqlite3_int64* piSize, /* Write size of the DB here, if not NULL */
    unsigned int mFlags /* Zero or more SQLITE_SERIALIZE_* flags */
);
typedef int (*lazy_sqlite3_deserialize_type)(
    sqlite3* db, /* The database connection */
    const char* zSchema, /* Which DB to reopen with the deserialization */
    unsigned char* pData, /* The serialized database content */
    sqlite3_int64 szDb, /* Number bytes in the deserialization */
    sqlite3_int64 szBuf, /* Total size of buffer pData[] */
    unsigned mFlags /* Zero or more SQLITE_DESERIALIZE_* flags */
);

typedef int (*lazy_sqlite3_stmt_readonly_type)(sqlite3_stmt* pStmt);
typedef int (*lazy_sqlite3_compileoption_used_type)(const char* zOptName);
typedef int64_t (*lazy_sqlite3_last_insert_rowid_type)(sqlite3* db);

static lazy_sqlite3_bind_blob_type lazy_sqlite3_bind_blob;
static lazy_sqlite3_bind_double_type lazy_sqlite3_bind_double;
static lazy_sqlite3_bind_int_type lazy_sqlite3_bind_int;
static lazy_sqlite3_bind_int64_type lazy_sqlite3_bind_int64;
static lazy_sqlite3_bind_null_type lazy_sqlite3_bind_null;
static lazy_sqlite3_bind_parameter_count_type lazy_sqlite3_bind_parameter_count;
static lazy_sqlite3_bind_parameter_index_type lazy_sqlite3_bind_parameter_index;
static lazy_sqlite3_bind_text_type lazy_sqlite3_bind_text;
static lazy_sqlite3_bind_text16_type lazy_sqlite3_bind_text16;
static lazy_sqlite3_changes_type lazy_sqlite3_changes;
static lazy_sqlite3_clear_bindings_type lazy_sqlite3_clear_bindings;
static lazy_sqlite3_close_v2_type lazy_sqlite3_close_v2;
static lazy_sqlite3_close_type lazy_sqlite3_close;
static lazy_sqlite3_file_control_type lazy_sqlite3_file_control;
static lazy_sqlite3_column_blob_type lazy_sqlite3_column_blob;
static lazy_sqlite3_column_bytes_type lazy_sqlite3_column_bytes;
static lazy_sqlite3_column_bytes16_type lazy_sqlite3_column_bytes16;
static lazy_sqlite3_column_count_type lazy_sqlite3_column_count;
static lazy_sqlite3_column_decltype_type lazy_sqlite3_column_decltype;
static lazy_sqlite3_column_double_type lazy_sqlite3_column_double;
static lazy_sqlite3_column_int_type lazy_sqlite3_column_int;
static lazy_sqlite3_column_int64_type lazy_sqlite3_column_int64;
static lazy_sqlite3_column_name_type lazy_sqlite3_column_name;
static lazy_sqlite3_column_text_type lazy_sqlite3_column_text;
static lazy_sqlite3_column_type_type lazy_sqlite3_column_type;
static lazy_sqlite3_errmsg_type lazy_sqlite3_errmsg;
static lazy_sqlite3_errstr_type lazy_sqlite3_errstr;
static lazy_sqlite3_expanded_sql_type lazy_sqlite3_expanded_sql;
static lazy_sqlite3_finalize_type lazy_sqlite3_finalize;
static lazy_sqlite3_free_type lazy_sqlite3_free;
static lazy_sqlite3_get_autocommit_type lazy_sqlite3_get_autocommit;
static lazy_sqlite3_open_v2_type lazy_sqlite3_open_v2;
static lazy_sqlite3_prepare_v3_type lazy_sqlite3_prepare_v3;
static lazy_sqlite3_prepare16_v3_type lazy_sqlite3_prepare16_v3;
static lazy_sqlite3_reset_type lazy_sqlite3_reset;
static lazy_sqlite3_step_type lazy_sqlite3_step;
static lazy_sqlite3_db_config_type lazy_sqlite3_db_config;
static lazy_sqlite3_load_extension_type lazy_sqlite3_load_extension;
static lazy_sqlite3_malloc64_type lazy_sqlite3_malloc64;
static lazy_sqlite3_serialize_type lazy_sqlite3_serialize;
static lazy_sqlite3_deserialize_type lazy_sqlite3_deserialize;
static lazy_sqlite3_stmt_readonly_type lazy_sqlite3_stmt_readonly;
static lazy_sqlite3_compileoption_used_type lazy_sqlite3_compileoption_used;
static lazy_sqlite3_config_type lazy_sqlite3_config;
static lazy_sqlite3_extended_result_codes_type lazy_sqlite3_extended_result_codes;
static lazy_sqlite3_extended_errcode_type lazy_sqlite3_extended_errcode;
static lazy_sqlite3_error_offset_type lazy_sqlite3_error_offset;
static lazy_sqlite3_memory_used_type lazy_sqlite3_memory_used;
static lazy_sqlite3_bind_parameter_name_type lazy_sqlite3_bind_parameter_name;
static lazy_sqlite3_total_changes_type lazy_sqlite3_total_changes;
static lazy_sqlite3_last_insert_rowid_type lazy_sqlite3_last_insert_rowid;

#define sqlite3_bind_blob lazy_sqlite3_bind_blob
#define sqlite3_bind_double lazy_sqlite3_bind_double
#define sqlite3_bind_int lazy_sqlite3_bind_int
#define sqlite3_bind_int64 lazy_sqlite3_bind_int64
#define sqlite3_bind_null lazy_sqlite3_bind_null
#define sqlite3_bind_parameter_count lazy_sqlite3_bind_parameter_count
#define sqlite3_bind_parameter_index lazy_sqlite3_bind_parameter_index
#define sqlite3_bind_text lazy_sqlite3_bind_text
#define sqlite3_bind_text16 lazy_sqlite3_bind_text16
#define sqlite3_changes lazy_sqlite3_changes
#define sqlite3_clear_bindings lazy_sqlite3_clear_bindings
#define sqlite3_close_v2 lazy_sqlite3_close_v2
#define sqlite3_close lazy_sqlite3_close
#define sqlite3_file_control lazy_sqlite3_file_control
#define sqlite3_column_blob lazy_sqlite3_column_blob
#define sqlite3_column_bytes lazy_sqlite3_column_bytes
#define sqlite3_column_count lazy_sqlite3_column_count
#define sqlite3_column_decltype lazy_sqlite3_column_decltype
#define sqlite3_column_double lazy_sqlite3_column_double
#define sqlite3_column_int lazy_sqlite3_column_int
#define sqlite3_column_name lazy_sqlite3_column_name
#define sqlite3_column_text lazy_sqlite3_column_text
#define sqlite3_column_type lazy_sqlite3_column_type
#define sqlite3_errmsg lazy_sqlite3_errmsg
#define sqlite3_errstr lazy_sqlite3_errstr
#define sqlite3_expanded_sql lazy_sqlite3_expanded_sql
#define sqlite3_finalize lazy_sqlite3_finalize
#define sqlite3_free lazy_sqlite3_free
#define sqlite3_get_autocommit lazy_sqlite3_get_autocommit
#define sqlite3_open_v2 lazy_sqlite3_open_v2
#define sqlite3_prepare_v3 lazy_sqlite3_prepare_v3
#define sqlite3_prepare16_v3 lazy_sqlite3_prepare16_v3
#define sqlite3_reset lazy_sqlite3_reset
#define sqlite3_step lazy_sqlite3_step
#define sqlite3_db_config lazy_sqlite3_db_config
#define sqlite3_load_extension lazy_sqlite3_load_extension
#define sqlite3_malloc64 lazy_sqlite3_malloc64
#define sqlite3_serialize lazy_sqlite3_serialize
#define sqlite3_deserialize lazy_sqlite3_deserialize
#define sqlite3_stmt_readonly lazy_sqlite3_stmt_readonly
#define sqlite3_column_int64 lazy_sqlite3_column_int64
#define sqlite3_compileoption_used lazy_sqlite3_compileoption_used
#define sqlite3_config lazy_sqlite3_config
#define sqlite3_extended_result_codes lazy_sqlite3_extended_result_codes
#define sqlite3_extended_errcode lazy_sqlite3_extended_errcode
#define sqlite3_error_offset lazy_sqlite3_error_offset
#define sqlite3_memory_used lazy_sqlite3_memory_used
#define sqlite3_bind_parameter_name lazy_sqlite3_bind_parameter_name
#define sqlite3_total_changes lazy_sqlite3_total_changes
#define sqlite3_last_insert_rowid lazy_sqlite3_last_insert_rowid

#if !OS(WINDOWS)
#define HMODULE void*
#else
static const char* dlerror()
{
    return "Unknown error while loading sqlite";
}
#define dlsym GetProcAddress
#endif

#if OS(WINDOWS)
static const char* sqlite3_lib_path = "sqlite3.dll";
#elif OS(DARWIN)
static const char* sqlite3_lib_path = "libsqlite3.dylib";
#else
static const char* sqlite3_lib_path = "sqlite3";
#endif

static HMODULE sqlite3_handle = nullptr;

static int lazyLoadSQLite()
{
    if (sqlite3_handle)
        return 0;
#if OS(WINDOWS)
    sqlite3_handle = LoadLibraryA(sqlite3_lib_path);
#else
    sqlite3_handle = dlopen(sqlite3_lib_path, RTLD_LAZY);
#endif

    if (!sqlite3_handle) {
        return -1;
    }
    lazy_sqlite3_bind_blob = (lazy_sqlite3_bind_blob_type)dlsym(sqlite3_handle, "sqlite3_bind_blob");
    lazy_sqlite3_bind_double = (lazy_sqlite3_bind_double_type)dlsym(sqlite3_handle, "sqlite3_bind_double");
    lazy_sqlite3_bind_int = (lazy_sqlite3_bind_int_type)dlsym(sqlite3_handle, "sqlite3_bind_int");
    lazy_sqlite3_bind_int64 = (lazy_sqlite3_bind_int64_type)dlsym(sqlite3_handle, "sqlite3_bind_int64");
    lazy_sqlite3_bind_null = (lazy_sqlite3_bind_null_type)dlsym(sqlite3_handle, "sqlite3_bind_null");
    lazy_sqlite3_bind_parameter_count = (lazy_sqlite3_bind_parameter_count_type)dlsym(sqlite3_handle, "sqlite3_bind_parameter_count");
    lazy_sqlite3_bind_parameter_index = (lazy_sqlite3_bind_parameter_index_type)dlsym(sqlite3_handle, "sqlite3_bind_parameter_index");
    lazy_sqlite3_bind_text = (lazy_sqlite3_bind_text_type)dlsym(sqlite3_handle, "sqlite3_bind_text");
    lazy_sqlite3_bind_text16 = (lazy_sqlite3_bind_text16_type)dlsym(sqlite3_handle, "sqlite3_bind_text16");
    lazy_sqlite3_changes = (lazy_sqlite3_changes_type)dlsym(sqlite3_handle, "sqlite3_changes");
    lazy_sqlite3_clear_bindings = (lazy_sqlite3_clear_bindings_type)dlsym(sqlite3_handle, "sqlite3_clear_bindings");
    lazy_sqlite3_close_v2 = (lazy_sqlite3_close_v2_type)dlsym(sqlite3_handle, "sqlite3_close_v2");
    lazy_sqlite3_close = (lazy_sqlite3_close_type)dlsym(sqlite3_handle, "sqlite3_close");
    lazy_sqlite3_file_control = (lazy_sqlite3_file_control_type)dlsym(sqlite3_handle, "sqlite3_file_control");
    lazy_sqlite3_column_blob = (lazy_sqlite3_column_blob_type)dlsym(sqlite3_handle, "sqlite3_column_blob");
    lazy_sqlite3_column_bytes = (lazy_sqlite3_column_bytes_type)dlsym(sqlite3_handle, "sqlite3_column_bytes");
    lazy_sqlite3_column_count = (lazy_sqlite3_column_count_type)dlsym(sqlite3_handle, "sqlite3_column_count");
    lazy_sqlite3_column_decltype = (lazy_sqlite3_column_decltype_type)dlsym(sqlite3_handle, "sqlite3_column_decltype");
    lazy_sqlite3_column_double = (lazy_sqlite3_column_double_type)dlsym(sqlite3_handle, "sqlite3_column_double");
    lazy_sqlite3_column_int = (lazy_sqlite3_column_int_type)dlsym(sqlite3_handle, "sqlite3_column_int");
    lazy_sqlite3_column_int64 = (lazy_sqlite3_column_int64_type)dlsym(sqlite3_handle, "sqlite3_column_int64");
    lazy_sqlite3_column_name = (lazy_sqlite3_column_name_type)dlsym(sqlite3_handle, "sqlite3_column_name");
    lazy_sqlite3_column_text = (lazy_sqlite3_column_text_type)dlsym(sqlite3_handle, "sqlite3_column_text");
    lazy_sqlite3_column_type = (lazy_sqlite3_column_type_type)dlsym(sqlite3_handle, "sqlite3_column_type");
    lazy_sqlite3_errmsg = (lazy_sqlite3_errmsg_type)dlsym(sqlite3_handle, "sqlite3_errmsg");
    lazy_sqlite3_errstr = (lazy_sqlite3_errstr_type)dlsym(sqlite3_handle, "sqlite3_errstr");
    lazy_sqlite3_expanded_sql = (lazy_sqlite3_expanded_sql_type)dlsym(sqlite3_handle, "sqlite3_expanded_sql");
    lazy_sqlite3_finalize = (lazy_sqlite3_finalize_type)dlsym(sqlite3_handle, "sqlite3_finalize");
    lazy_sqlite3_free = (lazy_sqlite3_free_type)dlsym(sqlite3_handle, "sqlite3_free");
    lazy_sqlite3_get_autocommit = (lazy_sqlite3_get_autocommit_type)dlsym(sqlite3_handle, "sqlite3_get_autocommit");
    lazy_sqlite3_open_v2 = (lazy_sqlite3_open_v2_type)dlsym(sqlite3_handle, "sqlite3_open_v2");
    lazy_sqlite3_prepare_v3 = (lazy_sqlite3_prepare_v3_type)dlsym(sqlite3_handle, "sqlite3_prepare_v3");
    lazy_sqlite3_prepare16_v3 = (lazy_sqlite3_prepare16_v3_type)dlsym(sqlite3_handle, "sqlite3_prepare16_v3");
    lazy_sqlite3_reset = (lazy_sqlite3_reset_type)dlsym(sqlite3_handle, "sqlite3_reset");
    lazy_sqlite3_step = (lazy_sqlite3_step_type)dlsym(sqlite3_handle, "sqlite3_step");
    lazy_sqlite3_db_config = (lazy_sqlite3_db_config_type)dlsym(sqlite3_handle, "sqlite3_db_config");
    lazy_sqlite3_load_extension = (lazy_sqlite3_load_extension_type)dlsym(sqlite3_handle, "sqlite3_load_extension");
    lazy_sqlite3_serialize = (lazy_sqlite3_serialize_type)dlsym(sqlite3_handle, "sqlite3_serialize");
    lazy_sqlite3_deserialize = (lazy_sqlite3_deserialize_type)dlsym(sqlite3_handle, "sqlite3_deserialize");
    lazy_sqlite3_malloc64 = (lazy_sqlite3_malloc64_type)dlsym(sqlite3_handle, "sqlite3_malloc64");
    lazy_sqlite3_stmt_readonly = (lazy_sqlite3_stmt_readonly_type)dlsym(sqlite3_handle, "sqlite3_stmt_readonly");
    lazy_sqlite3_compileoption_used = (lazy_sqlite3_compileoption_used_type)dlsym(sqlite3_handle, "sqlite3_compileoption_used");
    lazy_sqlite3_config = (lazy_sqlite3_config_type)dlsym(sqlite3_handle, "sqlite3_config");
    lazy_sqlite3_extended_result_codes = (lazy_sqlite3_extended_result_codes_type)dlsym(sqlite3_handle, "sqlite3_extended_result_codes");
    lazy_sqlite3_extended_errcode = (lazy_sqlite3_extended_errcode_type)dlsym(sqlite3_handle, "sqlite3_extended_errcode");
    lazy_sqlite3_error_offset = (lazy_sqlite3_error_offset_type)dlsym(sqlite3_handle, "sqlite3_error_offset");
    lazy_sqlite3_memory_used = (lazy_sqlite3_memory_used_type)dlsym(sqlite3_handle, "sqlite3_memory_used");
    lazy_sqlite3_bind_parameter_name = (lazy_sqlite3_bind_parameter_name_type)dlsym(sqlite3_handle, "sqlite3_bind_parameter_name");
    lazy_sqlite3_total_changes = (lazy_sqlite3_total_changes_type)dlsym(sqlite3_handle, "sqlite3_total_changes");
    lazy_sqlite3_last_insert_rowid = (lazy_sqlite3_last_insert_rowid_type)dlsym(sqlite3_handle, "sqlite3_last_insert_rowid");

    if (!lazy_sqlite3_extended_result_codes) {
        lazy_sqlite3_extended_result_codes = [](sqlite3*, int) -> int {
            return 0;
        };
    }

    if (!lazy_sqlite3_extended_errcode) {
        lazy_sqlite3_extended_errcode = [](sqlite3*) -> int {
            return 0;
        };
    }

    if (!lazy_sqlite3_error_offset) {
        lazy_sqlite3_error_offset = [](sqlite3*) -> int {
            return -1;
        };
    }

    if (!lazy_sqlite3_memory_used) {
        lazy_sqlite3_memory_used = []() -> int64_t {
            return 0;
        };
    }

    return 0;
}

#if OS(WINDOWS)
#undef dlsym
#endif