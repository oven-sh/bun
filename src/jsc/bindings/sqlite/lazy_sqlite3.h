#pragma once

#include "root.h"
#include "sqlite3.h"
#include <wtf/Lock.h>

#if !OS(WINDOWS)
#include <dlfcn.h>
#else
#include <windows.h>
#endif

// The system sqlite3.h only declares these when the library was built with
// SQLITE_ENABLE_SESSION; forward-declare the opaque handles unconditionally
// so node:sqlite can compile (their APIs are runtime-gated on dlsym below).
extern "C" {
struct sqlite3_session;
struct sqlite3_changeset_iter;
}

typedef int (*lazy_sqlite3_bind_blob_type)(sqlite3_stmt*, int, const void*, int n, void (*)(void*));
typedef int (*lazy_sqlite3_bind_blob64_type)(sqlite3_stmt*, int, const void*, sqlite3_uint64, void (*)(void*));
typedef int (*lazy_sqlite3_bind_double_type)(sqlite3_stmt*, int, double);
typedef int (*lazy_sqlite3_bind_int_type)(sqlite3_stmt*, int, int);
typedef int (*lazy_sqlite3_bind_int64_type)(sqlite3_stmt*, int, sqlite3_int64);
typedef int (*lazy_sqlite3_bind_null_type)(sqlite3_stmt*, int);
typedef int (*lazy_sqlite3_bind_text_type)(sqlite3_stmt*, int, const char*, int, void (*)(void*));
typedef int (*lazy_sqlite3_bind_text16_type)(sqlite3_stmt*, int, const void*, int, void (*)(void*));
typedef int (*lazy_sqlite3_bind_text64_type)(sqlite3_stmt*, int, const char*, sqlite3_uint64, void (*)(void*), unsigned char encoding);
typedef int (*lazy_sqlite3_bind_parameter_count_type)(sqlite3_stmt*);
typedef int (*lazy_sqlite3_bind_parameter_index_type)(sqlite3_stmt*, const char* zName);
typedef int (*lazy_sqlite3_changes_type)(sqlite3*);
typedef sqlite3_int64 (*lazy_sqlite3_changes64_type)(sqlite3*);
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
typedef const char* (*lazy_sqlite3_column_database_name_type)(sqlite3_stmt*, int);
typedef const char* (*lazy_sqlite3_column_table_name_type)(sqlite3_stmt*, int);
typedef const char* (*lazy_sqlite3_column_origin_name_type)(sqlite3_stmt*, int);
typedef const char* (*lazy_sqlite3_errmsg_type)(sqlite3*);
typedef int (*lazy_sqlite3_errcode_type)(sqlite3*);
typedef int (*lazy_sqlite3_extended_errcode_type)(sqlite3*);
typedef int (*lazy_sqlite3_error_offset_type)(sqlite3*);
typedef int64_t (*lazy_sqlite3_memory_used_type)();
typedef const char* (*lazy_sqlite3_errstr_type)(int);
typedef char* (*lazy_sqlite3_expanded_sql_type)(sqlite3_stmt* pStmt);
typedef const char* (*lazy_sqlite3_sql_type)(sqlite3_stmt* pStmt);
typedef int (*lazy_sqlite3_finalize_type)(sqlite3_stmt* pStmt);
typedef void (*lazy_sqlite3_free_type)(void*);
typedef int (*lazy_sqlite3_get_autocommit_type)(sqlite3*);
typedef int (*lazy_sqlite3_total_changes_type)(sqlite3*);
typedef int (*lazy_sqlite3_config_type)(int, ...);
typedef int (*lazy_sqlite3_open_v2_type)(const char* filename, sqlite3** ppDb, int flags, const char* zVfs);
typedef int (*lazy_sqlite3_prepare_v2_type)(sqlite3* db, const char* zSql, int nByte, sqlite3_stmt** ppStmt, const char** pzTail);
typedef int (*lazy_sqlite3_prepare_v3_type)(sqlite3* db, const char* zSql, int nByte, unsigned int prepFlags, sqlite3_stmt** ppStmt, const char** pzTail);
typedef int (*lazy_sqlite3_prepare16_v3_type)(sqlite3* db, const void* zSql, int nByte, unsigned int prepFlags, sqlite3_stmt** ppStmt, const void** pzTail);
typedef int (*lazy_sqlite3_reset_type)(sqlite3_stmt* pStmt);
typedef int (*lazy_sqlite3_step_type)(sqlite3_stmt*);
typedef int (*lazy_sqlite3_db_config_type)(sqlite3*, int op, ...);
typedef const char* (*lazy_sqlite3_db_filename_type)(sqlite3*, const char* zDbName);
typedef sqlite3* (*lazy_sqlite3_db_handle_type)(sqlite3_stmt*);
typedef int (*lazy_sqlite3_busy_timeout_type)(sqlite3*, int ms);
typedef int (*lazy_sqlite3_wal_checkpoint_v2_type)(sqlite3*, const char* zDb, int eMode, int* pnLog, int* pnCkpt);
typedef const char* (*lazy_sqlite3_bind_parameter_name_type)(sqlite3_stmt*, int);
typedef int (*lazy_sqlite3_exec_type)(sqlite3*, const char* sql, int (*callback)(void*, int, char**, char**), void*, char** errmsg);
typedef int (*lazy_sqlite3_limit_type)(sqlite3*, int id, int newVal);
typedef int (*lazy_sqlite3_sleep_type)(int);
typedef int (*lazy_sqlite3_stmt_status_type)(sqlite3_stmt*, int op, int resetFlg);
typedef int (*lazy_sqlite3_load_extension_type)(sqlite3* db, const char* zFile, const char* zProc, char** pzErrMsg);
typedef const char* (*lazy_sqlite3_libversion_type)();
typedef void* (*lazy_sqlite3_malloc64_type)(sqlite3_uint64);
typedef unsigned char* (*lazy_sqlite3_serialize_type)(sqlite3* db, const char* zSchema, sqlite3_int64* piSize, unsigned int mFlags);
typedef int (*lazy_sqlite3_deserialize_type)(sqlite3* db, const char* zSchema, unsigned char* pData, sqlite3_int64 szDb, sqlite3_int64 szBuf, unsigned mFlags);
typedef int (*lazy_sqlite3_stmt_readonly_type)(sqlite3_stmt* pStmt);
typedef int (*lazy_sqlite3_stmt_busy_type)(sqlite3_stmt* pStmt);
typedef sqlite3_stmt* (*lazy_sqlite3_next_stmt_type)(sqlite3* pDb, sqlite3_stmt* pStmt);
typedef int (*lazy_sqlite3_compileoption_used_type)(const char* zOptName);
typedef int64_t (*lazy_sqlite3_last_insert_rowid_type)(sqlite3* db);
typedef int (*lazy_sqlite3_set_authorizer_type)(sqlite3*, int (*xAuth)(void*, int, const char*, const char*, const char*, const char*), void* pUserData);
typedef int (*lazy_sqlite3_create_function_v2_type)(sqlite3* db, const char* zFunctionName, int nArg, int eTextRep, void* pApp,
    void (*xFunc)(sqlite3_context*, int, sqlite3_value**), void (*xStep)(sqlite3_context*, int, sqlite3_value**),
    void (*xFinal)(sqlite3_context*), void (*xDestroy)(void*));
typedef int (*lazy_sqlite3_create_window_function_type)(sqlite3* db, const char* zFunctionName, int nArg, int eTextRep, void* pApp,
    void (*xStep)(sqlite3_context*, int, sqlite3_value**), void (*xFinal)(sqlite3_context*),
    void (*xValue)(sqlite3_context*), void (*xInverse)(sqlite3_context*, int, sqlite3_value**), void (*xDestroy)(void*));
typedef void* (*lazy_sqlite3_user_data_type)(sqlite3_context*);
typedef void* (*lazy_sqlite3_aggregate_context_type)(sqlite3_context*, int nBytes);
typedef const void* (*lazy_sqlite3_value_blob_type)(sqlite3_value*);
typedef int (*lazy_sqlite3_value_bytes_type)(sqlite3_value*);
typedef double (*lazy_sqlite3_value_double_type)(sqlite3_value*);
typedef sqlite3_int64 (*lazy_sqlite3_value_int64_type)(sqlite3_value*);
typedef const unsigned char* (*lazy_sqlite3_value_text_type)(sqlite3_value*);
typedef int (*lazy_sqlite3_value_type_type)(sqlite3_value*);
typedef void (*lazy_sqlite3_result_blob64_type)(sqlite3_context*, const void*, sqlite3_uint64, void (*)(void*));
typedef void (*lazy_sqlite3_result_double_type)(sqlite3_context*, double);
typedef void (*lazy_sqlite3_result_error_type)(sqlite3_context*, const char*, int);
typedef void (*lazy_sqlite3_result_int64_type)(sqlite3_context*, sqlite3_int64);
typedef void (*lazy_sqlite3_result_null_type)(sqlite3_context*);
typedef void (*lazy_sqlite3_result_text64_type)(sqlite3_context*, const char*, sqlite3_uint64, void (*)(void*), unsigned char encoding);
typedef sqlite3_backup* (*lazy_sqlite3_backup_init_type)(sqlite3* pDest, const char* zDestName, sqlite3* pSource, const char* zSourceName);
typedef int (*lazy_sqlite3_backup_step_type)(sqlite3_backup*, int nPage);
typedef int (*lazy_sqlite3_backup_finish_type)(sqlite3_backup*);
typedef int (*lazy_sqlite3_backup_remaining_type)(sqlite3_backup*);
typedef int (*lazy_sqlite3_backup_pagecount_type)(sqlite3_backup*);
typedef int (*lazy_sqlite3session_create_type)(sqlite3*, const char* zDb, sqlite3_session** ppSession);
typedef void (*lazy_sqlite3session_delete_type)(sqlite3_session*);
typedef int (*lazy_sqlite3session_attach_type)(sqlite3_session*, const char* zTab);
typedef int (*lazy_sqlite3session_changeset_type)(sqlite3_session*, int* pnChangeset, void** ppChangeset);
typedef int (*lazy_sqlite3session_patchset_type)(sqlite3_session*, int* pnPatchset, void** ppPatchset);
typedef int (*lazy_sqlite3changeset_apply_type)(sqlite3*, int nChangeset, void* pChangeset,
    int (*xFilter)(void* pCtx, const char* zTab), int (*xConflict)(void* pCtx, int eConflict, sqlite3_changeset_iter* p), void* pCtx);

// C++17 inline variables: the pointers, handle, and lock are shared across
// every TU that includes this header (JSSQLStatement.cpp + NodeSqlite.cpp),
// so bun:sqlite's Database.setCustomSQLite() also affects node:sqlite and
// exactly one dlopen happens per process.
inline lazy_sqlite3_bind_blob_type lazy_sqlite3_bind_blob;
inline lazy_sqlite3_bind_blob64_type lazy_sqlite3_bind_blob64;
inline lazy_sqlite3_bind_double_type lazy_sqlite3_bind_double;
inline lazy_sqlite3_bind_int_type lazy_sqlite3_bind_int;
inline lazy_sqlite3_bind_int64_type lazy_sqlite3_bind_int64;
inline lazy_sqlite3_bind_null_type lazy_sqlite3_bind_null;
inline lazy_sqlite3_bind_parameter_count_type lazy_sqlite3_bind_parameter_count;
inline lazy_sqlite3_bind_parameter_index_type lazy_sqlite3_bind_parameter_index;
inline lazy_sqlite3_bind_text_type lazy_sqlite3_bind_text;
inline lazy_sqlite3_bind_text16_type lazy_sqlite3_bind_text16;
inline lazy_sqlite3_bind_text64_type lazy_sqlite3_bind_text64;
inline lazy_sqlite3_changes_type lazy_sqlite3_changes;
inline lazy_sqlite3_changes64_type lazy_sqlite3_changes64;
inline lazy_sqlite3_clear_bindings_type lazy_sqlite3_clear_bindings;
inline lazy_sqlite3_close_v2_type lazy_sqlite3_close_v2;
inline lazy_sqlite3_close_type lazy_sqlite3_close;
inline lazy_sqlite3_busy_timeout_type lazy_sqlite3_busy_timeout;
inline lazy_sqlite3_wal_checkpoint_v2_type lazy_sqlite3_wal_checkpoint_v2;
inline lazy_sqlite3_file_control_type lazy_sqlite3_file_control;
inline lazy_sqlite3_column_blob_type lazy_sqlite3_column_blob;
inline lazy_sqlite3_column_bytes_type lazy_sqlite3_column_bytes;
inline lazy_sqlite3_column_bytes16_type lazy_sqlite3_column_bytes16;
inline lazy_sqlite3_column_count_type lazy_sqlite3_column_count;
inline lazy_sqlite3_column_decltype_type lazy_sqlite3_column_decltype;
inline lazy_sqlite3_column_double_type lazy_sqlite3_column_double;
inline lazy_sqlite3_column_int_type lazy_sqlite3_column_int;
inline lazy_sqlite3_column_int64_type lazy_sqlite3_column_int64;
inline lazy_sqlite3_column_name_type lazy_sqlite3_column_name;
inline lazy_sqlite3_column_text_type lazy_sqlite3_column_text;
inline lazy_sqlite3_column_type_type lazy_sqlite3_column_type;
inline lazy_sqlite3_column_database_name_type lazy_sqlite3_column_database_name;
inline lazy_sqlite3_column_table_name_type lazy_sqlite3_column_table_name;
inline lazy_sqlite3_column_origin_name_type lazy_sqlite3_column_origin_name;
inline lazy_sqlite3_errmsg_type lazy_sqlite3_errmsg;
inline lazy_sqlite3_errcode_type lazy_sqlite3_errcode;
inline lazy_sqlite3_errstr_type lazy_sqlite3_errstr;
inline lazy_sqlite3_expanded_sql_type lazy_sqlite3_expanded_sql;
inline lazy_sqlite3_sql_type lazy_sqlite3_sql;
inline lazy_sqlite3_finalize_type lazy_sqlite3_finalize;
inline lazy_sqlite3_free_type lazy_sqlite3_free;
inline lazy_sqlite3_get_autocommit_type lazy_sqlite3_get_autocommit;
inline lazy_sqlite3_open_v2_type lazy_sqlite3_open_v2;
inline lazy_sqlite3_prepare_v2_type lazy_sqlite3_prepare_v2;
inline lazy_sqlite3_prepare_v3_type lazy_sqlite3_prepare_v3;
inline lazy_sqlite3_prepare16_v3_type lazy_sqlite3_prepare16_v3;
inline lazy_sqlite3_reset_type lazy_sqlite3_reset;
inline lazy_sqlite3_step_type lazy_sqlite3_step;
inline lazy_sqlite3_db_config_type lazy_sqlite3_db_config;
inline lazy_sqlite3_db_filename_type lazy_sqlite3_db_filename;
inline lazy_sqlite3_db_handle_type lazy_sqlite3_db_handle;
inline lazy_sqlite3_load_extension_type lazy_sqlite3_load_extension;
inline lazy_sqlite3_libversion_type lazy_sqlite3_libversion;
inline lazy_sqlite3_malloc64_type lazy_sqlite3_malloc64;
inline lazy_sqlite3_serialize_type lazy_sqlite3_serialize;
inline lazy_sqlite3_deserialize_type lazy_sqlite3_deserialize;
inline lazy_sqlite3_stmt_readonly_type lazy_sqlite3_stmt_readonly;
inline lazy_sqlite3_stmt_busy_type lazy_sqlite3_stmt_busy;
inline lazy_sqlite3_next_stmt_type lazy_sqlite3_next_stmt;
inline lazy_sqlite3_compileoption_used_type lazy_sqlite3_compileoption_used;
inline lazy_sqlite3_config_type lazy_sqlite3_config;
inline lazy_sqlite3_extended_result_codes_type lazy_sqlite3_extended_result_codes;
inline lazy_sqlite3_extended_errcode_type lazy_sqlite3_extended_errcode;
inline lazy_sqlite3_error_offset_type lazy_sqlite3_error_offset;
inline lazy_sqlite3_memory_used_type lazy_sqlite3_memory_used;
inline lazy_sqlite3_bind_parameter_name_type lazy_sqlite3_bind_parameter_name;
inline lazy_sqlite3_total_changes_type lazy_sqlite3_total_changes;
inline lazy_sqlite3_last_insert_rowid_type lazy_sqlite3_last_insert_rowid;
inline lazy_sqlite3_exec_type lazy_sqlite3_exec;
inline lazy_sqlite3_limit_type lazy_sqlite3_limit;
inline lazy_sqlite3_sleep_type lazy_sqlite3_sleep;
inline lazy_sqlite3_stmt_status_type lazy_sqlite3_stmt_status;
inline lazy_sqlite3_set_authorizer_type lazy_sqlite3_set_authorizer;
inline lazy_sqlite3_create_function_v2_type lazy_sqlite3_create_function_v2;
inline lazy_sqlite3_create_window_function_type lazy_sqlite3_create_window_function;
inline lazy_sqlite3_user_data_type lazy_sqlite3_user_data;
inline lazy_sqlite3_aggregate_context_type lazy_sqlite3_aggregate_context;
inline lazy_sqlite3_value_blob_type lazy_sqlite3_value_blob;
inline lazy_sqlite3_value_bytes_type lazy_sqlite3_value_bytes;
inline lazy_sqlite3_value_double_type lazy_sqlite3_value_double;
inline lazy_sqlite3_value_int64_type lazy_sqlite3_value_int64;
inline lazy_sqlite3_value_text_type lazy_sqlite3_value_text;
inline lazy_sqlite3_value_type_type lazy_sqlite3_value_type;
inline lazy_sqlite3_result_blob64_type lazy_sqlite3_result_blob64;
inline lazy_sqlite3_result_double_type lazy_sqlite3_result_double;
inline lazy_sqlite3_result_error_type lazy_sqlite3_result_error;
inline lazy_sqlite3_result_int64_type lazy_sqlite3_result_int64;
inline lazy_sqlite3_result_null_type lazy_sqlite3_result_null;
inline lazy_sqlite3_result_text64_type lazy_sqlite3_result_text64;
inline lazy_sqlite3_backup_init_type lazy_sqlite3_backup_init;
inline lazy_sqlite3_backup_step_type lazy_sqlite3_backup_step;
inline lazy_sqlite3_backup_finish_type lazy_sqlite3_backup_finish;
inline lazy_sqlite3_backup_remaining_type lazy_sqlite3_backup_remaining;
inline lazy_sqlite3_backup_pagecount_type lazy_sqlite3_backup_pagecount;
inline lazy_sqlite3session_create_type lazy_sqlite3session_create;
inline lazy_sqlite3session_delete_type lazy_sqlite3session_delete;
inline lazy_sqlite3session_attach_type lazy_sqlite3session_attach;
inline lazy_sqlite3session_changeset_type lazy_sqlite3session_changeset;
inline lazy_sqlite3session_patchset_type lazy_sqlite3session_patchset;
inline lazy_sqlite3changeset_apply_type lazy_sqlite3changeset_apply;

#define sqlite3_bind_blob lazy_sqlite3_bind_blob
#define sqlite3_bind_blob64 lazy_sqlite3_bind_blob64
#define sqlite3_bind_double lazy_sqlite3_bind_double
#define sqlite3_bind_int lazy_sqlite3_bind_int
#define sqlite3_bind_int64 lazy_sqlite3_bind_int64
#define sqlite3_bind_null lazy_sqlite3_bind_null
#define sqlite3_bind_parameter_count lazy_sqlite3_bind_parameter_count
#define sqlite3_bind_parameter_index lazy_sqlite3_bind_parameter_index
#define sqlite3_bind_text lazy_sqlite3_bind_text
#define sqlite3_bind_text16 lazy_sqlite3_bind_text16
#define sqlite3_bind_text64 lazy_sqlite3_bind_text64
#define sqlite3_changes lazy_sqlite3_changes
#define sqlite3_changes64 lazy_sqlite3_changes64
#define sqlite3_clear_bindings lazy_sqlite3_clear_bindings
#define sqlite3_close_v2 lazy_sqlite3_close_v2
#define sqlite3_close lazy_sqlite3_close
#define sqlite3_busy_timeout lazy_sqlite3_busy_timeout
#define sqlite3_wal_checkpoint_v2 lazy_sqlite3_wal_checkpoint_v2
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
#define sqlite3_column_database_name lazy_sqlite3_column_database_name
#define sqlite3_column_table_name lazy_sqlite3_column_table_name
#define sqlite3_column_origin_name lazy_sqlite3_column_origin_name
#define sqlite3_errmsg lazy_sqlite3_errmsg
#define sqlite3_errcode lazy_sqlite3_errcode
#define sqlite3_errstr lazy_sqlite3_errstr
#define sqlite3_expanded_sql lazy_sqlite3_expanded_sql
#define sqlite3_sql lazy_sqlite3_sql
#define sqlite3_finalize lazy_sqlite3_finalize
#define sqlite3_free lazy_sqlite3_free
#define sqlite3_get_autocommit lazy_sqlite3_get_autocommit
#define sqlite3_open_v2 lazy_sqlite3_open_v2
#define sqlite3_prepare_v2 lazy_sqlite3_prepare_v2
#define sqlite3_prepare_v3 lazy_sqlite3_prepare_v3
#define sqlite3_prepare16_v3 lazy_sqlite3_prepare16_v3
#define sqlite3_reset lazy_sqlite3_reset
#define sqlite3_step lazy_sqlite3_step
#define sqlite3_db_config lazy_sqlite3_db_config
#define sqlite3_db_filename lazy_sqlite3_db_filename
#define sqlite3_db_handle lazy_sqlite3_db_handle
#define sqlite3_load_extension lazy_sqlite3_load_extension
#define sqlite3_libversion lazy_sqlite3_libversion
#define sqlite3_malloc64 lazy_sqlite3_malloc64
#define sqlite3_serialize lazy_sqlite3_serialize
#define sqlite3_deserialize lazy_sqlite3_deserialize
#define sqlite3_stmt_readonly lazy_sqlite3_stmt_readonly
#define sqlite3_stmt_busy lazy_sqlite3_stmt_busy
#define sqlite3_next_stmt lazy_sqlite3_next_stmt
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
#define sqlite3_exec lazy_sqlite3_exec
#define sqlite3_limit lazy_sqlite3_limit
#define sqlite3_sleep lazy_sqlite3_sleep
#define sqlite3_stmt_status lazy_sqlite3_stmt_status
#define sqlite3_set_authorizer lazy_sqlite3_set_authorizer
#define sqlite3_create_function_v2 lazy_sqlite3_create_function_v2
#define sqlite3_create_window_function lazy_sqlite3_create_window_function
#define sqlite3_user_data lazy_sqlite3_user_data
#define sqlite3_aggregate_context lazy_sqlite3_aggregate_context
#define sqlite3_value_blob lazy_sqlite3_value_blob
#define sqlite3_value_bytes lazy_sqlite3_value_bytes
#define sqlite3_value_double lazy_sqlite3_value_double
#define sqlite3_value_int64 lazy_sqlite3_value_int64
#define sqlite3_value_text lazy_sqlite3_value_text
#define sqlite3_value_type lazy_sqlite3_value_type
#define sqlite3_result_blob64 lazy_sqlite3_result_blob64
#define sqlite3_result_double lazy_sqlite3_result_double
#define sqlite3_result_error lazy_sqlite3_result_error
#define sqlite3_result_int64 lazy_sqlite3_result_int64
#define sqlite3_result_null lazy_sqlite3_result_null
#define sqlite3_result_text64 lazy_sqlite3_result_text64
#define sqlite3_backup_init lazy_sqlite3_backup_init
#define sqlite3_backup_step lazy_sqlite3_backup_step
#define sqlite3_backup_finish lazy_sqlite3_backup_finish
#define sqlite3_backup_remaining lazy_sqlite3_backup_remaining
#define sqlite3_backup_pagecount lazy_sqlite3_backup_pagecount
#define sqlite3session_create lazy_sqlite3session_create
#define sqlite3session_delete lazy_sqlite3session_delete
#define sqlite3session_attach lazy_sqlite3session_attach
#define sqlite3session_changeset lazy_sqlite3session_changeset
#define sqlite3session_patchset lazy_sqlite3session_patchset
#define sqlite3changeset_apply lazy_sqlite3changeset_apply

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
inline const char* sqlite3_lib_path = "sqlite3.dll";
#elif OS(DARWIN)
inline const char* sqlite3_lib_path = "libsqlite3.dylib";
#else
inline const char* sqlite3_lib_path = "sqlite3";
#endif

inline HMODULE sqlite3_handle = nullptr;
inline WTF::Lock sqlite3_handle_lock;
// True after dlsym found sqlite3session_create — Apple's system libsqlite3
// is built without SQLITE_ENABLE_SESSION, so node:sqlite session/changeset
// APIs must be runtime-gated on this instead of compiled out.
inline bool lazy_sqlite3_has_session = false;

inline int lazyLoadSQLite()
{
    WTF::Locker locker { sqlite3_handle_lock };
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
    lazy_sqlite3_open_v2 = (lazy_sqlite3_open_v2_type)dlsym(sqlite3_handle, "sqlite3_open_v2");
    if (!lazy_sqlite3_open_v2) return -1;
    lazy_sqlite3_bind_blob = (lazy_sqlite3_bind_blob_type)dlsym(sqlite3_handle, "sqlite3_bind_blob");
    lazy_sqlite3_bind_blob64 = (lazy_sqlite3_bind_blob64_type)dlsym(sqlite3_handle, "sqlite3_bind_blob64");
    lazy_sqlite3_bind_double = (lazy_sqlite3_bind_double_type)dlsym(sqlite3_handle, "sqlite3_bind_double");
    lazy_sqlite3_bind_int = (lazy_sqlite3_bind_int_type)dlsym(sqlite3_handle, "sqlite3_bind_int");
    lazy_sqlite3_bind_int64 = (lazy_sqlite3_bind_int64_type)dlsym(sqlite3_handle, "sqlite3_bind_int64");
    lazy_sqlite3_bind_null = (lazy_sqlite3_bind_null_type)dlsym(sqlite3_handle, "sqlite3_bind_null");
    lazy_sqlite3_bind_parameter_count = (lazy_sqlite3_bind_parameter_count_type)dlsym(sqlite3_handle, "sqlite3_bind_parameter_count");
    lazy_sqlite3_bind_parameter_index = (lazy_sqlite3_bind_parameter_index_type)dlsym(sqlite3_handle, "sqlite3_bind_parameter_index");
    lazy_sqlite3_bind_text = (lazy_sqlite3_bind_text_type)dlsym(sqlite3_handle, "sqlite3_bind_text");
    lazy_sqlite3_bind_text16 = (lazy_sqlite3_bind_text16_type)dlsym(sqlite3_handle, "sqlite3_bind_text16");
    lazy_sqlite3_bind_text64 = (lazy_sqlite3_bind_text64_type)dlsym(sqlite3_handle, "sqlite3_bind_text64");
    lazy_sqlite3_changes = (lazy_sqlite3_changes_type)dlsym(sqlite3_handle, "sqlite3_changes");
    lazy_sqlite3_changes64 = (lazy_sqlite3_changes64_type)dlsym(sqlite3_handle, "sqlite3_changes64");
    lazy_sqlite3_clear_bindings = (lazy_sqlite3_clear_bindings_type)dlsym(sqlite3_handle, "sqlite3_clear_bindings");
    lazy_sqlite3_close_v2 = (lazy_sqlite3_close_v2_type)dlsym(sqlite3_handle, "sqlite3_close_v2");
    lazy_sqlite3_close = (lazy_sqlite3_close_type)dlsym(sqlite3_handle, "sqlite3_close");
    lazy_sqlite3_busy_timeout = (lazy_sqlite3_busy_timeout_type)dlsym(sqlite3_handle, "sqlite3_busy_timeout");
    lazy_sqlite3_wal_checkpoint_v2 = (lazy_sqlite3_wal_checkpoint_v2_type)dlsym(sqlite3_handle, "sqlite3_wal_checkpoint_v2");
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
    lazy_sqlite3_column_database_name = (lazy_sqlite3_column_database_name_type)dlsym(sqlite3_handle, "sqlite3_column_database_name");
    lazy_sqlite3_column_table_name = (lazy_sqlite3_column_table_name_type)dlsym(sqlite3_handle, "sqlite3_column_table_name");
    lazy_sqlite3_column_origin_name = (lazy_sqlite3_column_origin_name_type)dlsym(sqlite3_handle, "sqlite3_column_origin_name");
    lazy_sqlite3_errmsg = (lazy_sqlite3_errmsg_type)dlsym(sqlite3_handle, "sqlite3_errmsg");
    lazy_sqlite3_errcode = (lazy_sqlite3_errcode_type)dlsym(sqlite3_handle, "sqlite3_errcode");
    lazy_sqlite3_errstr = (lazy_sqlite3_errstr_type)dlsym(sqlite3_handle, "sqlite3_errstr");
    lazy_sqlite3_expanded_sql = (lazy_sqlite3_expanded_sql_type)dlsym(sqlite3_handle, "sqlite3_expanded_sql");
    lazy_sqlite3_sql = (lazy_sqlite3_sql_type)dlsym(sqlite3_handle, "sqlite3_sql");
    lazy_sqlite3_finalize = (lazy_sqlite3_finalize_type)dlsym(sqlite3_handle, "sqlite3_finalize");
    lazy_sqlite3_free = (lazy_sqlite3_free_type)dlsym(sqlite3_handle, "sqlite3_free");
    lazy_sqlite3_get_autocommit = (lazy_sqlite3_get_autocommit_type)dlsym(sqlite3_handle, "sqlite3_get_autocommit");
    lazy_sqlite3_prepare_v2 = (lazy_sqlite3_prepare_v2_type)dlsym(sqlite3_handle, "sqlite3_prepare_v2");
    lazy_sqlite3_prepare_v3 = (lazy_sqlite3_prepare_v3_type)dlsym(sqlite3_handle, "sqlite3_prepare_v3");
    lazy_sqlite3_prepare16_v3 = (lazy_sqlite3_prepare16_v3_type)dlsym(sqlite3_handle, "sqlite3_prepare16_v3");
    lazy_sqlite3_reset = (lazy_sqlite3_reset_type)dlsym(sqlite3_handle, "sqlite3_reset");
    lazy_sqlite3_step = (lazy_sqlite3_step_type)dlsym(sqlite3_handle, "sqlite3_step");
    lazy_sqlite3_db_config = (lazy_sqlite3_db_config_type)dlsym(sqlite3_handle, "sqlite3_db_config");
    lazy_sqlite3_db_filename = (lazy_sqlite3_db_filename_type)dlsym(sqlite3_handle, "sqlite3_db_filename");
    lazy_sqlite3_db_handle = (lazy_sqlite3_db_handle_type)dlsym(sqlite3_handle, "sqlite3_db_handle");
    lazy_sqlite3_load_extension = (lazy_sqlite3_load_extension_type)dlsym(sqlite3_handle, "sqlite3_load_extension");
    lazy_sqlite3_libversion = (lazy_sqlite3_libversion_type)dlsym(sqlite3_handle, "sqlite3_libversion");
    lazy_sqlite3_serialize = (lazy_sqlite3_serialize_type)dlsym(sqlite3_handle, "sqlite3_serialize");
    lazy_sqlite3_deserialize = (lazy_sqlite3_deserialize_type)dlsym(sqlite3_handle, "sqlite3_deserialize");
    lazy_sqlite3_malloc64 = (lazy_sqlite3_malloc64_type)dlsym(sqlite3_handle, "sqlite3_malloc64");
    lazy_sqlite3_stmt_readonly = (lazy_sqlite3_stmt_readonly_type)dlsym(sqlite3_handle, "sqlite3_stmt_readonly");
    lazy_sqlite3_stmt_busy = (lazy_sqlite3_stmt_busy_type)dlsym(sqlite3_handle, "sqlite3_stmt_busy");
    lazy_sqlite3_next_stmt = (lazy_sqlite3_next_stmt_type)dlsym(sqlite3_handle, "sqlite3_next_stmt");
    lazy_sqlite3_compileoption_used = (lazy_sqlite3_compileoption_used_type)dlsym(sqlite3_handle, "sqlite3_compileoption_used");
    lazy_sqlite3_config = (lazy_sqlite3_config_type)dlsym(sqlite3_handle, "sqlite3_config");
    lazy_sqlite3_extended_result_codes = (lazy_sqlite3_extended_result_codes_type)dlsym(sqlite3_handle, "sqlite3_extended_result_codes");
    lazy_sqlite3_extended_errcode = (lazy_sqlite3_extended_errcode_type)dlsym(sqlite3_handle, "sqlite3_extended_errcode");
    lazy_sqlite3_error_offset = (lazy_sqlite3_error_offset_type)dlsym(sqlite3_handle, "sqlite3_error_offset");
    lazy_sqlite3_memory_used = (lazy_sqlite3_memory_used_type)dlsym(sqlite3_handle, "sqlite3_memory_used");
    lazy_sqlite3_bind_parameter_name = (lazy_sqlite3_bind_parameter_name_type)dlsym(sqlite3_handle, "sqlite3_bind_parameter_name");
    lazy_sqlite3_total_changes = (lazy_sqlite3_total_changes_type)dlsym(sqlite3_handle, "sqlite3_total_changes");
    lazy_sqlite3_last_insert_rowid = (lazy_sqlite3_last_insert_rowid_type)dlsym(sqlite3_handle, "sqlite3_last_insert_rowid");
    lazy_sqlite3_exec = (lazy_sqlite3_exec_type)dlsym(sqlite3_handle, "sqlite3_exec");
    lazy_sqlite3_limit = (lazy_sqlite3_limit_type)dlsym(sqlite3_handle, "sqlite3_limit");
    lazy_sqlite3_sleep = (lazy_sqlite3_sleep_type)dlsym(sqlite3_handle, "sqlite3_sleep");
    lazy_sqlite3_stmt_status = (lazy_sqlite3_stmt_status_type)dlsym(sqlite3_handle, "sqlite3_stmt_status");
    lazy_sqlite3_set_authorizer = (lazy_sqlite3_set_authorizer_type)dlsym(sqlite3_handle, "sqlite3_set_authorizer");
    lazy_sqlite3_create_function_v2 = (lazy_sqlite3_create_function_v2_type)dlsym(sqlite3_handle, "sqlite3_create_function_v2");
    lazy_sqlite3_create_window_function = (lazy_sqlite3_create_window_function_type)dlsym(sqlite3_handle, "sqlite3_create_window_function");
    lazy_sqlite3_user_data = (lazy_sqlite3_user_data_type)dlsym(sqlite3_handle, "sqlite3_user_data");
    lazy_sqlite3_aggregate_context = (lazy_sqlite3_aggregate_context_type)dlsym(sqlite3_handle, "sqlite3_aggregate_context");
    lazy_sqlite3_value_blob = (lazy_sqlite3_value_blob_type)dlsym(sqlite3_handle, "sqlite3_value_blob");
    lazy_sqlite3_value_bytes = (lazy_sqlite3_value_bytes_type)dlsym(sqlite3_handle, "sqlite3_value_bytes");
    lazy_sqlite3_value_double = (lazy_sqlite3_value_double_type)dlsym(sqlite3_handle, "sqlite3_value_double");
    lazy_sqlite3_value_int64 = (lazy_sqlite3_value_int64_type)dlsym(sqlite3_handle, "sqlite3_value_int64");
    lazy_sqlite3_value_text = (lazy_sqlite3_value_text_type)dlsym(sqlite3_handle, "sqlite3_value_text");
    lazy_sqlite3_value_type = (lazy_sqlite3_value_type_type)dlsym(sqlite3_handle, "sqlite3_value_type");
    lazy_sqlite3_result_blob64 = (lazy_sqlite3_result_blob64_type)dlsym(sqlite3_handle, "sqlite3_result_blob64");
    lazy_sqlite3_result_double = (lazy_sqlite3_result_double_type)dlsym(sqlite3_handle, "sqlite3_result_double");
    lazy_sqlite3_result_error = (lazy_sqlite3_result_error_type)dlsym(sqlite3_handle, "sqlite3_result_error");
    lazy_sqlite3_result_int64 = (lazy_sqlite3_result_int64_type)dlsym(sqlite3_handle, "sqlite3_result_int64");
    lazy_sqlite3_result_null = (lazy_sqlite3_result_null_type)dlsym(sqlite3_handle, "sqlite3_result_null");
    lazy_sqlite3_result_text64 = (lazy_sqlite3_result_text64_type)dlsym(sqlite3_handle, "sqlite3_result_text64");
    lazy_sqlite3_backup_init = (lazy_sqlite3_backup_init_type)dlsym(sqlite3_handle, "sqlite3_backup_init");
    lazy_sqlite3_backup_step = (lazy_sqlite3_backup_step_type)dlsym(sqlite3_handle, "sqlite3_backup_step");
    lazy_sqlite3_backup_finish = (lazy_sqlite3_backup_finish_type)dlsym(sqlite3_handle, "sqlite3_backup_finish");
    lazy_sqlite3_backup_remaining = (lazy_sqlite3_backup_remaining_type)dlsym(sqlite3_handle, "sqlite3_backup_remaining");
    lazy_sqlite3_backup_pagecount = (lazy_sqlite3_backup_pagecount_type)dlsym(sqlite3_handle, "sqlite3_backup_pagecount");
    lazy_sqlite3session_create = (lazy_sqlite3session_create_type)dlsym(sqlite3_handle, "sqlite3session_create");
    lazy_sqlite3session_delete = (lazy_sqlite3session_delete_type)dlsym(sqlite3_handle, "sqlite3session_delete");
    lazy_sqlite3session_attach = (lazy_sqlite3session_attach_type)dlsym(sqlite3_handle, "sqlite3session_attach");
    lazy_sqlite3session_changeset = (lazy_sqlite3session_changeset_type)dlsym(sqlite3_handle, "sqlite3session_changeset");
    lazy_sqlite3session_patchset = (lazy_sqlite3session_patchset_type)dlsym(sqlite3_handle, "sqlite3session_patchset");
    lazy_sqlite3changeset_apply = (lazy_sqlite3changeset_apply_type)dlsym(sqlite3_handle, "sqlite3changeset_apply");
    lazy_sqlite3_has_session = lazy_sqlite3session_create != nullptr;

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

    // SQLITE_ENABLE_COLUMN_METADATA is optional; fall back to nullptr-
    // returning stubs so callers see the same "no info" shape sqlite
    // returns for expressions.
    if (!lazy_sqlite3_column_database_name) {
        lazy_sqlite3_column_database_name = [](sqlite3_stmt*, int) -> const char* { return nullptr; };
        lazy_sqlite3_column_table_name = [](sqlite3_stmt*, int) -> const char* { return nullptr; };
        lazy_sqlite3_column_origin_name = [](sqlite3_stmt*, int) -> const char* { return nullptr; };
    }

    if (!lazy_sqlite3_stmt_status) {
        lazy_sqlite3_stmt_status = [](sqlite3_stmt*, int, int) -> int { return 0; };
    }

    // sqlite3_changes64 was added in 3.37.0; macOS 12 ships 3.36.0. The
    // 32-bit variant has been in the ABI since 3.0.0.
    if (!lazy_sqlite3_changes64) {
        lazy_sqlite3_changes64 = [](sqlite3* db) -> sqlite3_int64 {
            return static_cast<sqlite3_int64>(lazy_sqlite3_changes(db));
        };
    }

    return 0;
}

#if OS(WINDOWS)
#undef dlsym
#endif
