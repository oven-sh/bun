#include "BunPythonModule.h"

#include <JavaScriptCore/Protect.h>
#include <JavaScriptCore/PyCodecs.h>
#include <JavaScriptCore/PyException.h>
#include <JavaScriptCore/PyIO.h>
#include <JavaScriptCore/PyRange.h>
#include <wtf/RefCounted.h>
#include <wtf/Scope.h>

// The module _sqlite3, under sqlite3. (Modules/_sqlite/ in CPython is the reference.) It uses the SQLite that bun:sqlite and
// node:sqlite use: the one in the executable, or on macOS the system's, loaded when first needed.

#ifndef LAZY_LOAD_SQLITE
#if defined(__APPLE__)
#define LAZY_LOAD_SQLITE 1
#else
#define LAZY_LOAD_SQLITE 0
#endif
#endif

#if LAZY_LOAD_SQLITE
#include "lazy_sqlite3.h"

// What lazy_sqlite3.h does not load, because nothing else needs it.
#define FOR_EACH_SQLITE_FUNCTION_LOADED_HERE(v) \
    v(blob_bytes) \
    v(blob_close) \
    v(blob_open) \
    v(blob_read) \
    v(blob_write) \
    v(complete) \
    v(create_collation_v2) \
    v(data_count) \
    v(initialize) \
    v(interrupt) \
    v(keyword_count) \
    v(keyword_name) \
    v(progress_handler) \
    v(result_blob) \
    v(result_error_nomem) \
    v(result_error_toobig) \
    v(result_text) \
    v(threadsafe) \
    v(trace_v2) \
    v(txn_state)

#define DECLARE_POINTER(name) static decltype(&sqlite3_##name) loadedHere_sqlite3_##name;
FOR_EACH_SQLITE_FUNCTION_LOADED_HERE(DECLARE_POINTER)
#undef DECLARE_POINTER

static bool loadTheRestOfSQLite()
{
#define LOAD(name) \
    loadedHere_sqlite3_##name = reinterpret_cast<decltype(loadedHere_sqlite3_##name)>(dlsym(sqlite3_handle, "sqlite3_" #name)); \
    if (!loadedHere_sqlite3_##name) \
        return false;
    FOR_EACH_SQLITE_FUNCTION_LOADED_HERE(LOAD)
#undef LOAD
    return true;
}

#define sqlite3_blob_bytes loadedHere_sqlite3_blob_bytes
#define sqlite3_blob_close loadedHere_sqlite3_blob_close
#define sqlite3_blob_open loadedHere_sqlite3_blob_open
#define sqlite3_blob_read loadedHere_sqlite3_blob_read
#define sqlite3_blob_write loadedHere_sqlite3_blob_write
#define sqlite3_complete loadedHere_sqlite3_complete
#define sqlite3_create_collation_v2 loadedHere_sqlite3_create_collation_v2
#define sqlite3_data_count loadedHere_sqlite3_data_count
#define sqlite3_initialize loadedHere_sqlite3_initialize
#define sqlite3_interrupt loadedHere_sqlite3_interrupt
#define sqlite3_keyword_count loadedHere_sqlite3_keyword_count
#define sqlite3_keyword_name loadedHere_sqlite3_keyword_name
#define sqlite3_progress_handler loadedHere_sqlite3_progress_handler
#define sqlite3_result_blob loadedHere_sqlite3_result_blob
#define sqlite3_result_error_nomem loadedHere_sqlite3_result_error_nomem
#define sqlite3_result_error_toobig loadedHere_sqlite3_result_error_toobig
#define sqlite3_result_text loadedHere_sqlite3_result_text
#define sqlite3_threadsafe loadedHere_sqlite3_threadsafe
#define sqlite3_trace_v2 loadedHere_sqlite3_trace_v2
#define sqlite3_txn_state loadedHere_sqlite3_txn_state
#else
#include "sqlite3_local.h"
#endif

extern "C" void Bun__initializeSQLite();

namespace Bun {
namespace PythonModules {
namespace Sqlite {

static constexpr int parseDeclTypes = 1;
static constexpr int parseColNames = 2;
static constexpr int legacyTransactionControl = -1;

// ---- The types ----

static PyType* connectionType(JSGlobalObject*);
static PyType* cursorType(JSGlobalObject*);
static PyType* prepareProtocolType(JSGlobalObject*);

#define FOR_EACH_SQLITE_EXCEPTION(v) \
    v(Warning, rt.Exception()) \
    v(Error, rt.Exception()) \
    v(InterfaceError, Error(globalObject)) \
    v(DatabaseError, Error(globalObject)) \
    v(DataError, DatabaseError(globalObject)) \
    v(OperationalError, DatabaseError(globalObject)) \
    v(IntegrityError, DatabaseError(globalObject)) \
    v(InternalError, DatabaseError(globalObject)) \
    v(ProgrammingError, DatabaseError(globalObject)) \
    v(NotSupportedError, DatabaseError(globalObject))

#define DEFINE_EXCEPTION(name, base) \
    static constexpr TypeDef name##TypeDef { "sqlite3." #name ""_s, { TypeFlag::Base, TypeFlag::Mutable, TypeFlag::HasWeakref }, {}, {}, {} }; \
    static PyType* name(JSGlobalObject* globalObject) \
    { \
        Runtime& rt = runtime(globalObject); \
        return rt.typeFor(name##TypeDef, base); \
    }
FOR_EACH_SQLITE_EXCEPTION(DEFINE_EXCEPTION)
#undef DEFINE_EXCEPTION

// ---- What the module remembers ----
//
// In hidden fields of its types, which are there as long as anything of the module's is.

enum class ModuleValue { Adapters,
    Converters,
    ShowsCallbackTracebacks,
    HasAdapterForBasicType };

static JSValue moduleValue(JSGlobalObject* globalObject, ModuleValue which)
{
    unsigned index = static_cast<unsigned>(which);
    return hiddenField(globalObject, index < 2 ? connectionType(globalObject) : cursorType(globalObject), index % 2);
}

static void setModuleValue(JSGlobalObject* globalObject, ModuleValue which, JSValue value)
{
    unsigned index = static_cast<unsigned>(which);
    setHiddenField(globalObject, index < 2 ? connectionType(globalObject) : cursorType(globalObject), index % 2, value);
}

static bool moduleFlag(JSGlobalObject* globalObject, ModuleValue which) { return moduleValue(globalObject, which) == jsBoolean(true); }

// ---- Errors ----

struct NamedCode {
    ASCIILiteral name;
    int code;
};

#define CODE(name) { #name ""_s, name }
static constexpr NamedCode errorCodes[] = {
    CODE(SQLITE_ABORT), CODE(SQLITE_AUTH), CODE(SQLITE_BUSY), CODE(SQLITE_CANTOPEN), CODE(SQLITE_CONSTRAINT), CODE(SQLITE_CORRUPT),
    CODE(SQLITE_DONE), CODE(SQLITE_EMPTY), CODE(SQLITE_ERROR), CODE(SQLITE_FORMAT), CODE(SQLITE_FULL), CODE(SQLITE_INTERNAL),
    CODE(SQLITE_INTERRUPT), CODE(SQLITE_IOERR), CODE(SQLITE_LOCKED), CODE(SQLITE_MISMATCH), CODE(SQLITE_MISUSE), CODE(SQLITE_NOLFS),
    CODE(SQLITE_NOMEM), CODE(SQLITE_NOTADB), CODE(SQLITE_NOTFOUND), CODE(SQLITE_OK), CODE(SQLITE_PERM), CODE(SQLITE_PROTOCOL),
    CODE(SQLITE_RANGE), CODE(SQLITE_READONLY), CODE(SQLITE_ROW), CODE(SQLITE_SCHEMA), CODE(SQLITE_TOOBIG), CODE(SQLITE_NOTICE),
    CODE(SQLITE_WARNING), CODE(SQLITE_ABORT_ROLLBACK), CODE(SQLITE_BUSY_RECOVERY), CODE(SQLITE_CANTOPEN_FULLPATH),
    CODE(SQLITE_CANTOPEN_ISDIR), CODE(SQLITE_CANTOPEN_NOTEMPDIR), CODE(SQLITE_CORRUPT_VTAB), CODE(SQLITE_IOERR_ACCESS),
    CODE(SQLITE_IOERR_BLOCKED), CODE(SQLITE_IOERR_CHECKRESERVEDLOCK), CODE(SQLITE_IOERR_CLOSE), CODE(SQLITE_IOERR_DELETE),
    CODE(SQLITE_IOERR_DELETE_NOENT), CODE(SQLITE_IOERR_DIR_CLOSE), CODE(SQLITE_IOERR_DIR_FSYNC), CODE(SQLITE_IOERR_FSTAT),
    CODE(SQLITE_IOERR_FSYNC), CODE(SQLITE_IOERR_LOCK), CODE(SQLITE_IOERR_NOMEM), CODE(SQLITE_IOERR_RDLOCK), CODE(SQLITE_IOERR_READ),
    CODE(SQLITE_IOERR_SEEK), CODE(SQLITE_IOERR_SHMLOCK), CODE(SQLITE_IOERR_SHMMAP), CODE(SQLITE_IOERR_SHMOPEN),
    CODE(SQLITE_IOERR_SHMSIZE), CODE(SQLITE_IOERR_SHORT_READ), CODE(SQLITE_IOERR_TRUNCATE), CODE(SQLITE_IOERR_UNLOCK),
    CODE(SQLITE_IOERR_WRITE), CODE(SQLITE_LOCKED_SHAREDCACHE), CODE(SQLITE_READONLY_CANTLOCK), CODE(SQLITE_READONLY_RECOVERY),
    CODE(SQLITE_CONSTRAINT_CHECK), CODE(SQLITE_CONSTRAINT_COMMITHOOK), CODE(SQLITE_CONSTRAINT_FOREIGNKEY),
    CODE(SQLITE_CONSTRAINT_FUNCTION), CODE(SQLITE_CONSTRAINT_NOTNULL), CODE(SQLITE_CONSTRAINT_PRIMARYKEY),
    CODE(SQLITE_CONSTRAINT_TRIGGER), CODE(SQLITE_CONSTRAINT_UNIQUE), CODE(SQLITE_CONSTRAINT_VTAB), CODE(SQLITE_READONLY_ROLLBACK),
    CODE(SQLITE_IOERR_MMAP), CODE(SQLITE_NOTICE_RECOVER_ROLLBACK), CODE(SQLITE_NOTICE_RECOVER_WAL), CODE(SQLITE_BUSY_SNAPSHOT),
    CODE(SQLITE_IOERR_GETTEMPPATH), CODE(SQLITE_WARNING_AUTOINDEX), CODE(SQLITE_CANTOPEN_CONVPATH), CODE(SQLITE_IOERR_CONVPATH),
    CODE(SQLITE_CONSTRAINT_ROWID), CODE(SQLITE_READONLY_DBMOVED), CODE(SQLITE_AUTH_USER), CODE(SQLITE_IOERR_VNODE),
    CODE(SQLITE_IOERR_AUTH), CODE(SQLITE_OK_LOAD_PERMANENTLY), CODE(SQLITE_IOERR_BEGIN_ATOMIC), CODE(SQLITE_IOERR_COMMIT_ATOMIC),
    CODE(SQLITE_IOERR_ROLLBACK_ATOMIC), CODE(SQLITE_ERROR_MISSING_COLLSEQ), CODE(SQLITE_ERROR_RETRY), CODE(SQLITE_READONLY_CANTINIT),
    CODE(SQLITE_READONLY_DIRECTORY), CODE(SQLITE_CORRUPT_SEQUENCE), CODE(SQLITE_LOCKED_VTAB), CODE(SQLITE_CANTOPEN_DIRTYWAL),
    CODE(SQLITE_ERROR_SNAPSHOT), CODE(SQLITE_CANTOPEN_SYMLINK), CODE(SQLITE_CONSTRAINT_PINNED), CODE(SQLITE_OK_SYMLINK),
    CODE(SQLITE_BUSY_TIMEOUT), CODE(SQLITE_CORRUPT_INDEX), CODE(SQLITE_IOERR_DATA), CODE(SQLITE_IOERR_CORRUPTFS),
};

static constexpr NamedCode otherConstants[] = {
    { "PARSE_DECLTYPES"_s, parseDeclTypes }, { "PARSE_COLNAMES"_s, parseColNames }, { "LEGACY_TRANSACTION_CONTROL"_s, legacyTransactionControl },
    CODE(SQLITE_DENY), CODE(SQLITE_IGNORE), CODE(SQLITE_CREATE_INDEX), CODE(SQLITE_CREATE_TABLE), CODE(SQLITE_CREATE_TEMP_INDEX),
    CODE(SQLITE_CREATE_TEMP_TABLE), CODE(SQLITE_CREATE_TEMP_TRIGGER), CODE(SQLITE_CREATE_TEMP_VIEW), CODE(SQLITE_CREATE_TRIGGER),
    CODE(SQLITE_CREATE_VIEW), CODE(SQLITE_DELETE), CODE(SQLITE_DROP_INDEX), CODE(SQLITE_DROP_TABLE), CODE(SQLITE_DROP_TEMP_INDEX),
    CODE(SQLITE_DROP_TEMP_TABLE), CODE(SQLITE_DROP_TEMP_TRIGGER), CODE(SQLITE_DROP_TEMP_VIEW), CODE(SQLITE_DROP_TRIGGER),
    CODE(SQLITE_DROP_VIEW), CODE(SQLITE_INSERT), CODE(SQLITE_PRAGMA), CODE(SQLITE_READ), CODE(SQLITE_SELECT), CODE(SQLITE_TRANSACTION),
    CODE(SQLITE_UPDATE), CODE(SQLITE_ATTACH), CODE(SQLITE_DETACH), CODE(SQLITE_ALTER_TABLE), CODE(SQLITE_REINDEX), CODE(SQLITE_ANALYZE),
    CODE(SQLITE_CREATE_VTABLE), CODE(SQLITE_DROP_VTABLE), CODE(SQLITE_FUNCTION), CODE(SQLITE_SAVEPOINT), CODE(SQLITE_RECURSIVE),
    CODE(SQLITE_LIMIT_LENGTH), CODE(SQLITE_LIMIT_SQL_LENGTH), CODE(SQLITE_LIMIT_COLUMN), CODE(SQLITE_LIMIT_EXPR_DEPTH),
    CODE(SQLITE_LIMIT_COMPOUND_SELECT), CODE(SQLITE_LIMIT_VDBE_OP), CODE(SQLITE_LIMIT_FUNCTION_ARG), CODE(SQLITE_LIMIT_ATTACHED),
    CODE(SQLITE_LIMIT_LIKE_PATTERN_LENGTH), CODE(SQLITE_LIMIT_VARIABLE_NUMBER), CODE(SQLITE_LIMIT_TRIGGER_DEPTH),
    CODE(SQLITE_LIMIT_WORKER_THREADS), CODE(SQLITE_DBCONFIG_ENABLE_FKEY), CODE(SQLITE_DBCONFIG_ENABLE_TRIGGER),
    CODE(SQLITE_DBCONFIG_ENABLE_FTS3_TOKENIZER), CODE(SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION), CODE(SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE),
    CODE(SQLITE_DBCONFIG_ENABLE_QPSG), CODE(SQLITE_DBCONFIG_TRIGGER_EQP), CODE(SQLITE_DBCONFIG_RESET_DATABASE),
    CODE(SQLITE_DBCONFIG_DEFENSIVE), CODE(SQLITE_DBCONFIG_WRITABLE_SCHEMA), CODE(SQLITE_DBCONFIG_DQS_DDL), CODE(SQLITE_DBCONFIG_DQS_DML),
    CODE(SQLITE_DBCONFIG_LEGACY_ALTER_TABLE), CODE(SQLITE_DBCONFIG_ENABLE_VIEW), CODE(SQLITE_DBCONFIG_LEGACY_FILE_FORMAT),
    CODE(SQLITE_DBCONFIG_TRUSTED_SCHEMA),
};
#undef CODE

// Null: no exception goes with the code, or a MemoryError, which has been raised.
static PyType* exceptionTypeFor(JSGlobalObject* globalObject, int code)
{
    switch (code) {
    case SQLITE_OK:
        takePendingException(globalObject);
        return nullptr;
    case SQLITE_INTERNAL:
    case SQLITE_NOTFOUND:
        return InternalError(globalObject);
    case SQLITE_NOMEM: {
        auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
        raiseMemoryError(globalObject, scope, String());
        return nullptr;
    }
    case SQLITE_ERROR:
    case SQLITE_PERM:
    case SQLITE_ABORT:
    case SQLITE_BUSY:
    case SQLITE_LOCKED:
    case SQLITE_READONLY:
    case SQLITE_INTERRUPT:
    case SQLITE_IOERR:
    case SQLITE_FULL:
    case SQLITE_CANTOPEN:
    case SQLITE_PROTOCOL:
    case SQLITE_EMPTY:
    case SQLITE_SCHEMA:
        return OperationalError(globalObject);
    case SQLITE_CORRUPT:
        return DatabaseError(globalObject);
    case SQLITE_TOOBIG:
        return DataError(globalObject);
    case SQLITE_CONSTRAINT:
    case SQLITE_MISMATCH:
        return IntegrityError(globalObject);
    case SQLITE_MISUSE:
    case SQLITE_RANGE:
        return InterfaceError(globalObject);
    default:
        return DatabaseError(globalObject);
    }
}

static void raiseWithCode(JSGlobalObject* globalObject, PyType* type, int code, const char* message)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue exception = call(globalObject, type, makeStr(vm, String::fromUTF8(message)));
    RETURN_IF_EXCEPTION(scope, void());
    setAttr(globalObject, exception, internString(vm, "sqlite_errorcode"_s), jsNumber(code));
    RETURN_IF_EXCEPTION(scope, void());
    ASCIILiteral name = "unknown"_s;
    for (auto& known : errorCodes) {
        if (known.code == code)
            name = known.name;
    }
    setAttr(globalObject, exception, internString(vm, "sqlite_errorname"_s), makeStr(vm, name));
    RETURN_IF_EXCEPTION(scope, void());
    raiseException(globalObject, scope, exception);
}

static JSValue raiseFromCode(JSGlobalObject* globalObject, int code)
{
    if (PyType* type = exceptionTypeFor(globalObject, code))
        raiseWithCode(globalObject, type, code, sqlite3_errstr(code));
    return {};
}

// Raises what the last call on the connection failed with, if it failed, and returns its code.
static int raiseFromDatabase(JSGlobalObject* globalObject, sqlite3* db)
{
    int code = sqlite3_errcode(db);
    PyType* type = exceptionTypeFor(globalObject, code);
    if (!type)
        return SQLITE_OK;
    raiseWithCode(globalObject, type, sqlite3_extended_errcode(db), sqlite3_errmsg(db));
    return code;
}

// For a call that failed: there is an exception afterwards, whatever SQLite has to say.
static JSValue failFromDatabase(JSGlobalObject* globalObject, sqlite3* db)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (db)
        raiseFromDatabase(globalObject, db);
    RETURN_IF_EXCEPTION(scope, {});
    return raiseSystemError(globalObject, scope, "SQLite failed without saying why"_s);
}

static JSValue raiseOf(JSGlobalObject* globalObject, PyType* type, const String& message)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    return raise(globalObject, scope, type, message);
}

static void rethrow(JSGlobalObject* globalObject, JSValue exception)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    throwPythonException(globalObject, scope, exception);
}

// `earlier` was taken before something that may have raised in its turn. Whichever there is propagates; if both, the later
// one, with the earlier one for its context.
static void chainExceptions(JSGlobalObject* globalObject, JSValue earlier)
{
    if (!earlier)
        return;
    JSValue later = takePendingException(globalObject);
    if (!later) {
        rethrow(globalObject, earlier);
        return;
    }
    if (auto* exception = PyException::tryFrom(later))
        exception->setContext(getVM(globalObject), earlier);
    rethrow(globalObject, later);
}

// ---- Text ----

// The str as UTF-8. False: an exception, because of a lone surrogate.
static bool encodeUTF8(JSGlobalObject* globalObject, JSValue value, Vector<uint8_t>& result)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSString* string = strValue(value);
    auto view = string->view(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    if (auto encoded = tryEncodeUTF8(view)) {
        result = WTF::move(*encoded);
        return true;
    }
    codecEncodeUTF8(globalObject, string, "strict"_s);
    ASSERT(scope.exception());
    return false;
}

// Empty: a UnicodeDecodeError.
static JSValue decodeUTF8(JSGlobalObject* globalObject, std::span<const uint8_t> bytes)
{
    VM& vm = getVM(globalObject);
    if (bytes.empty())
        return makeStr(vm, emptyString());
    String string = String::fromUTF8(bytes);
    if (!string.isNull())
        return makeStr(vm, string);
    return codecDecodeUTF8(globalObject, bytes, "strict"_s);
}

// None for a null pointer.
static JSValue decodeCString(JSGlobalObject* globalObject, const char* text)
{
    if (!text)
        return jsUndefined();
    return decodeUTF8(globalObject, byteCast<uint8_t>(unsafeSpan(text)));
}

// A parameter declared `str` to Argument Clinic: UTF-8, with a NUL after it and none in it. `which`: "argument 1".
static bool textArgument(JSGlobalObject* globalObject, ASCIILiteral function, ASCIILiteral which, JSValue value, Vector<uint8_t>& result)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!isStr(value)) {
        raiseTypeError(globalObject, scope, function, "() "_s, which, " must be str, not "_s, typeNameOfArgument(globalObject, value));
        return false;
    }
    if (!encodeUTF8(globalObject, value, result))
        return false;
    if (result.contains(0)) {
        raiseValueError(globalObject, scope, "embedded null character"_s);
        return false;
    }
    result.append(0);
    return true;
}

static const char* cString(const Vector<uint8_t>& text) { return byteCast<char>(text.span().data()); }

static bool checkIsStr(JSGlobalObject* globalObject, ASCIILiteral function, ASCIILiteral which, JSValue value)
{
    if (isStr(value))
        return true;
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    raiseTypeError(globalObject, scope, function, "() "_s, which, " must be str, not "_s, typeNameOfArgument(globalObject, value));
    return false;
}

static bool int64ForSQLite(JSGlobalObject* globalObject, JSValue value, int64_t& result)
{
    ASSERT(isInt(value));
    if (auto converted = tryInt64(intValue(value))) {
        result = *converted;
        return true;
    }
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    raiseOverflowError(globalObject, scope, "Python int too large to convert to SQLite INTEGER"_s);
    return false;
}

// ---- What SQLite hands out ----
//
// Objects that die together are finalized in no particular order, so whatever one of them needs of another's when it goes
// belongs to both.
//
// It is the collector that destroys these, on whichever thread it runs, so their destructors must not run code of the program.
// SQLite runs some when a statement that is in the middle of an aggregate is reset or finalized: see Unfinished, finalCallback().

struct Blob;
class Database;
class Statement;

// What SQLite calls back with. The Connection keeps the callable alive: see ConnectionField, CursorCallables.
struct CallbackContext {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(CallbackContext);
    JSGlobalObject* globalObject { nullptr };
    JSValue callable;
    Database* database { nullptr }; // For a collation: see OffLimits.
};

WTF_MAKE_STRUCT_TZONE_ALLOCATED_IMPL(CallbackContext);

static void destroyCallbackContext(void* context) { delete static_cast<CallbackContext*>(context); }

class Database : public RefCounted<Database> {
    WTF_MAKE_TZONE_ALLOCATED(Database);

public:
    static Ref<Database> create(VM& vm, sqlite3* handle) { return adoptRef(*new Database(vm, handle)); }
    ~Database();

    // Null once the program has closed it.
    sqlite3* handle() const { return m_isClosed ? nullptr : m_handle; }
    bool isClosed() const { return m_isClosed; }
    // Not null: why the program cannot use it just now. See OffLimits.
    ASCIILiteral whyOffLimits() const { return m_whyOffLimits; }

    // Nothing is left open. In CPython, cursors that nobody holds any more have let go of their statements by the time a
    // connection is closed; here they may still be waiting to be collected, and a connection with statements left would only
    // be marked for closing: its file would stay open, and locked, and a write-ahead log would not be folded back.
    // Not so when a connection is opened anew: cursors go on reading what they were reading.
    enum class Statements : bool { AreLeft,
        AreFinalized };
    // For the program it is closed from now on. SQLite hears of it once nothing is in the middle of using it: see DatabaseUse.
    void close(Statements = Statements::AreFinalized);

    // Whether a statement of any connection of the VM has.
    static bool anotherStatementHasRowsLeft(VM&, sqlite3_stmt* currentStatement);

    Vector<Blob*> openBlobs;
    UncheckedKeyHashSet<Statement*> statements;
    unsigned backupsUnderWay { 0 }; // Of it, not into it.

    // The callbacks that go by no name. Without a callable: none.
    enum class Hook : uint8_t { Trace = 1 << 0,
        Progress = 1 << 1,
        Authorizer = 1 << 2 };
    CallbackContext trace;
    CallbackContext progress;
    int progressInterval { 0 };
    CallbackContext authorizer;
    // Tells SQLite.
    void didChange(OptionSet<Hook>);

private:
    friend class DatabaseUse;
    friend class OffLimits;

    Database(VM&, sqlite3*);
    void didEndLastUse();
    void closeForSQLite();

    // All there are, of all VMs.
    static Lock s_lock;
    static Vector<Database*>& all() WTF_REQUIRES_LOCK(s_lock);

    VM& m_vm;
    sqlite3* m_handle;
    unsigned m_useCount { 0 };
    ASCIILiteral m_whyOffLimits;
    OptionSet<Hook> m_hooksToSettle;
    bool m_isClosed { false };
    Statements m_statementsAtClose { Statements::AreFinalized };
};

WTF_MAKE_TZONE_ALLOCATED_IMPL(Database);

// For whatever calls SQLite and may be called back by it, or keeps a handle while code of the program runs: adapters,
// converters, factories, functions, the authorizer, __index__, __buffer__. All that can close the connection, or open it anew.
// While one of these is in scope, the handles of the connection and of its statements stay good.
class DatabaseUse {
    WTF_MAKE_NONCOPYABLE(DatabaseUse);

public:
    explicit DatabaseUse(Database& database)
        : m_database(database)
    {
        ++database.m_useCount;
    }

    ~DatabaseUse()
    {
        if (!--m_database->m_useCount)
            m_database->didEndLastUse();
    }

    Database& database() const { return m_database.get(); }
    // Whether or not the program has closed it.
    sqlite3* handle() const { return m_database->m_handle; }
    bool isClosed() const { return m_database->m_isClosed; }

private:
    Ref<Database> m_database;
};

// When SQLite calls the authorizer, the progress handler or a collation, it may be in the middle of compiling a statement, or of
// finding its way through a tree, with pointers to what another statement, deserialize() or a backup would take away. Its
// documentation forbids these callbacks to use the connection, as it forbids all use of the target of a backup that is under
// way, and CPython leaves it at that. Here checkConnection() sees to it. (Functions, aggregates and the trace callback are
// called between two steps of a statement, and may use the connection.)
class OffLimits {
    WTF_MAKE_NONCOPYABLE(OffLimits);

public:
    OffLimits(Database& database, ASCIILiteral why)
        : m_database(database)
        , m_before(std::exchange(database.m_whyOffLimits, why))
    {
    }

    ~OffLimits() { m_database->m_whyOffLimits = m_before; }

private:
    Ref<Database> m_database;
    ASCIILiteral m_before;
};

class Statement : public RefCounted<Statement> {
    WTF_MAKE_TZONE_ALLOCATED(Statement);

public:
    static Ref<Statement> create(Database& database, sqlite3_stmt* handle, bool isDML) { return adoptRef(*new Statement(database, handle, isDML)); }

    ~Statement()
    {
        m_database->statements.remove(this);
        finalize();
    }

    Database& database() const { return m_database.get(); }
    // Null for SQL with nothing in it, and once the connection is closed. SQLite takes a null statement for one that does nothing.
    sqlite3_stmt* handle() const { return m_handle; }
    bool isDML() const { return m_isDML; }
    void finalize() { sqlite3_finalize(std::exchange(m_handle, nullptr)); }

    int reset()
    {
        DatabaseUse use(m_database.get());
        return sqlite3_reset(m_handle);
    }

private:
    Statement(Database& database, sqlite3_stmt* handle, bool isDML)
        : m_database(database)
        , m_handle(handle)
        , m_isDML(isDML)
    {
        database.statements.add(this);
    }

    Ref<Database> m_database;
    sqlite3_stmt* m_handle;
    bool m_isDML;
};

WTF_MAKE_TZONE_ALLOCATED_IMPL(Statement);

// A statement that has given some of its rows keeps its database locked against writers, and its table against being
// dropped. In CPython a cursor that nobody holds any more has reset its statement; here it does when it is collected. So, before
// "database is locked" is taken for an answer, the cursors that are only waiting for that are collected. (A connection that
// nobody holds any more waits for a collection in CPython too: it is in a cycle with its cache of statements.)
static bool isLockError(int rc) { return (rc & 0xff) == SQLITE_BUSY || (rc & 0xff) == SQLITE_LOCKED; }

Lock Database::s_lock;

Vector<Database*>& Database::all()
{
    static NeverDestroyed<Vector<Database*>> databases;
    return databases;
}

Database::Database(VM& vm, sqlite3* handle)
    : m_vm(vm)
    , m_handle(handle)
{
    Locker locker { s_lock };
    all().append(this);
}

Database::~Database()
{
    close();
    Locker locker { s_lock };
    all().removeFirst(this);
}

bool Database::anotherStatementHasRowsLeft(VM& vm, sqlite3_stmt* currentStatement)
{
    Locker locker { s_lock };
    for (auto* database : all()) {
        // Those of another VM are its own business, and that of its thread.
        if (&database->m_vm != &vm)
            continue;
        for (auto* statement : database->statements) {
            if (statement->handle() && statement->handle() != currentStatement && sqlite3_stmt_busy(statement->handle()))
                return true;
        }
    }
    return false;
}

// False: an exception.
static bool collectAbandonedCursors(JSGlobalObject* globalObject)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue gc = importModule(globalObject, "gc"_s);
    RETURN_IF_EXCEPTION(scope, false);
    callMethod(globalObject, gc, internString(vm, "collect"_s));
    return !scope.exception();
}

struct StatementHolder {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(StatementHolder);
    Ref<Statement> statement;
};

WTF_MAKE_STRUCT_TZONE_ALLOCATED_IMPL(StatementHolder);

static constexpr TypeDef statementTypeDef { "sqlite3.Statement"_s, { TypeFlag::Immutable, TypeFlag::DisallowInstantiation }, {}, {}, {} };

// ---- Connection ----

enum class Autocommit : int8_t { Legacy = legacyTransactionControl,
    Disabled = 0,
    Enabled = 1 };

struct Connection {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(Connection);

    sqlite3* db() const { return database ? database->handle() : nullptr; }

    RefPtr<Database> database;
    bool isInitialized { false };
    int detectTypes { 0 };
    ASCIILiteral isolationLevel; // Null: None.
    Autocommit autocommit { Autocommit::Legacy };
    // The statements used last, the most recent at the end.
    Vector<std::pair<String, Ref<Statement>>> statementCache;
    unsigned statementCacheCapacity { 0 };
};

WTF_MAKE_STRUCT_TZONE_ALLOCATED_IMPL(Connection);

enum ConnectionField : unsigned {
    RowFactory,
    TextFactory,
    // A dict of the functions, aggregates and collations SQLite has been given.
    Callables,
    TraceCallback,
    ProgressHandler,
    Authorizer,
    ConnectionFieldCount
};

static Connection& connectionOf(PyRecord* self) { return *stateOf<Connection>(self); }
static PyRecord* asRecord(JSValue value) { return uncheckedDowncast<PyRecord>(value.asCell()); }

static JSValue raiseClosedDatabase(JSGlobalObject* globalObject)
{
    return raiseOf(globalObject, ProgrammingError(globalObject), "Cannot operate on a closed database."_s);
}

// Enough for what asks SQLite nothing, or only to take note of something.
static bool checkConnectionIsOpen(JSGlobalObject* globalObject, PyRecord* self)
{
    Connection& connection = connectionOf(self);
    if (!connection.isInitialized) {
        raiseOf(globalObject, ProgrammingError(globalObject), "Base Connection.__init__ not called."_s);
        return false;
    }
    if (!connection.db()) {
        raiseClosedDatabase(globalObject);
        return false;
    }
    return true;
}

static bool checkConnection(JSGlobalObject* globalObject, PyRecord* self)
{
    if (!checkConnectionIsOpen(globalObject, self))
        return false;
    if (ASCIILiteral why = connectionOf(self).database->whyOffLimits(); !why.isNull()) {
        raiseOf(globalObject, ProgrammingError(globalObject), why);
        return false;
    }
    return true;
}

static bool executeSimply(JSGlobalObject* globalObject, Database& database, const char* sql)
{
    DatabaseUse use(database);
    int rc;
    for (bool hasCollected = false;; hasCollected = true) {
        if (use.isClosed()) {
            raiseClosedDatabase(globalObject);
            return false;
        }
        sqlite3_stmt* statement;
        rc = sqlite3_prepare_v2(use.handle(), sql, -1, &statement, nullptr);
        if (rc == SQLITE_OK) {
            sqlite3_step(statement);
            rc = sqlite3_finalize(statement);
        }
        if (!isLockError(rc) || hasCollected || !Database::anotherStatementHasRowsLeft(getVM(globalObject), nullptr))
            break;
        if (!collectAbandonedCursors(globalObject))
            return false;
    }
    if (rc != SQLITE_OK) {
        failFromDatabase(globalObject, use.handle());
        return false;
    }
    return true;
}

static bool executeSimply(JSGlobalObject* globalObject, Connection& connection, const char* sql) { return executeSimply(globalObject, *connection.database, sql); }

static bool isolationLevelArgument(JSGlobalObject* globalObject, JSValue value, ASCIILiteral& result)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (value.isUndefined()) {
        result = {};
        return true;
    }
    if (!isStr(value)) {
        raiseTypeError(globalObject, scope, "isolation_level must be str or None"_s);
        return false;
    }
    String level = strValue(value)->value(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    if (level.contains(static_cast<char16_t>(0))) {
        raiseValueError(globalObject, scope, "embedded null character"_s);
        return false;
    }
    for (ASCIILiteral allowed : { ""_s, "DEFERRED"_s, "IMMEDIATE"_s, "EXCLUSIVE"_s }) {
        if (equalIgnoringASCIICase(level, allowed)) {
            result = allowed;
            return true;
        }
    }
    raiseValueError(globalObject, scope, "isolation_level string must be '', 'DEFERRED', 'IMMEDIATE', or 'EXCLUSIVE'"_s);
    return false;
}

static bool autocommitArgument(JSGlobalObject* globalObject, JSValue value, Autocommit& result)
{
    if (value.isBoolean()) {
        result = value.asBoolean() ? Autocommit::Enabled : Autocommit::Disabled;
        return true;
    }
    if (isInt(value) && tryInt64(intValue(value)) == legacyTransactionControl) {
        result = Autocommit::Legacy;
        return true;
    }
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    raiseValueError(globalObject, scope, "autocommit must be True, False, or sqlite3.LEGACY_TRANSACTION_CONTROL"_s);
    return false;
}

static JSValue connectionDel(JSGlobalObject*, JSValue self);

static bool hasItsOwnFinalizer(PyType* type)
{
    auto* native = PyNativeFunction::tryFrom(type->lookup(Special::Del));
    return !native || native->def().pointer.f1 != connectionDel;
}

// False: the rollback failed, and an exception says so. It is closed all the same.
static bool closeConnection(JSGlobalObject* globalObject, PyRecord* self, Database::Statements statements = Database::Statements::AreFinalized)
{
    VM& vm = getVM(globalObject);
    Connection& connection = connectionOf(self);
    if (!connection.db())
        return true;
    Ref<Database> database = *connection.database;
    bool succeeded = true;
    // Where no statement can be run, it is left to SQLite, which rolls back what it closes.
    if (connection.autocommit == Autocommit::Disabled && !sqlite3_get_autocommit(database->handle()) && database->whyOffLimits().isNull())
        succeeded = executeSimply(globalObject, database.get(), "ROLLBACK");
    database->close(statements);
    // The callbacks that the rollback ran may have opened the connection anew. Then the rest is the new database's.
    if (connection.database != database.ptr())
        return succeeded;
    for (unsigned field : { Callables, TraceCallback, ProgressHandler, Authorizer })
        self->set(vm, field, JSValue());
    if (!hasItsOwnFinalizer(self->type()))
        runtime(globalObject).unregisterFinalizable(self);
    return succeeded;
}

static JSValue connectionNew(JSGlobalObject* globalObject, JSValue cls, const CallArgs&)
{
    PyType* type = PyType::from(cls);
    PyRecord* self = createRecordWithState(globalObject, type, ConnectionFieldCount, makeUnique<Connection>());
    if (hasItsOwnFinalizer(type))
        runtime(globalObject).registerFinalizable(self);
    return self;
}

static JSValue connectionInit(JSGlobalObject* globalObject, JSValue selfValue, const CallArgs& args)
{
    Runtime& rt = runtime(globalObject);
    VM& vm = rt.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    enum { DatabasePath, Timeout, DetectTypes, IsolationLevel, CheckSameThread, Factory, CachedStatements, URI, AutocommitMode, Count };
    static constexpr ASCIILiteral names[] = { "database"_s, "timeout"_s, "detect_types"_s, "isolation_level"_s, "check_same_thread"_s, "factory"_s, "cached_statements"_s, "uri"_s, "autocommit"_s };
    JSValue values[Count];
    if (!unpackArguments(globalObject, { "Connection"_s, 0, 1, 1, names }, args, values))
        return {};
    if (!audit(globalObject, "sqlite3.connect"_s, values[0]))
        return {};

    double timeout = 5.0;
    if (values[Timeout]) {
        timeout = toDouble(globalObject, values[Timeout]);
        RETURN_IF_EXCEPTION(scope, {});
    }
    int detectTypes, cacheSize;
    if (!intArgument(globalObject, values[DetectTypes], 0, detectTypes))
        return {};
    ASCIILiteral isolationLevel = ""_s;
    if (values[IsolationLevel] && !isolationLevelArgument(globalObject, values[IsolationLevel], isolationLevel))
        return {};
    if (values[CheckSameThread]) {
        isTrue(globalObject, values[CheckSameThread]);
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (!intArgument(globalObject, values[CachedStatements], 128, cacheSize))
        return {};
    bool isURI = false;
    if (values[URI]) {
        isURI = isTrue(globalObject, values[URI]);
        RETURN_IF_EXCEPTION(scope, {});
    }
    Autocommit autocommit = Autocommit::Legacy;
    if (values[AutocommitMode] && !autocommitArgument(globalObject, values[AutocommitMode], autocommit))
        return {};

    JSValue path = ioFSPath(globalObject, values[DatabasePath]);
    RETURN_IF_EXCEPTION(scope, {});
    Vector<uint8_t> encodedPath;
    if (isStr(path)) {
        auto view = strValue(path)->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        encodedPath = encodeFilesystem(view);
    } else
        encodedPath.append(PyBytes::from(path)->span());
    if (encodedPath.contains(0))
        return raiseValueError(globalObject, scope, "embedded null byte"_s);
    encodedPath.append(0);

    PyRecord* self = asRecord(selfValue);
    Connection& connection = connectionOf(self);
    if (connection.isInitialized) {
        connection.isInitialized = false;
        connection.statementCache.clear();
        if (!closeConnection(globalObject, self, Database::Statements::AreLeft))
            return {};
    }

    sqlite3* db = nullptr;
    int rc = sqlite3_open_v2(cString(encodedPath), &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | (isURI ? SQLITE_OPEN_URI : 0), nullptr);
    if (!db && rc == SQLITE_NOMEM)
        return raiseMemoryError(globalObject, scope, String());
    if (rc != SQLITE_OK) {
        failFromDatabase(globalObject, db);
        sqlite3_close(db);
        return {};
    }
    sqlite3_busy_timeout(db, static_cast<int>(timeout * 1000));

    connection.database = Database::create(vm, db);
    connection.detectTypes = detectTypes;
    connection.isolationLevel = isolationLevel;
    connection.autocommit = autocommit;
    connection.statementCacheCapacity = std::max(cacheSize, 0);
    self->set(vm, RowFactory, jsUndefined());
    self->set(vm, TextFactory, rt.strType());
    self->set(vm, Callables, PyDict::create(globalObject));
    connection.isInitialized = true;
    rt.registerFinalizable(self);

    if (!audit(globalObject, "sqlite3.connect/handle"_s, self))
        return {};
    if (autocommit == Autocommit::Disabled && !executeSimply(globalObject, connection, "BEGIN"))
        return {};
    return jsUndefined();
}

static void warnUnclosed(JSGlobalObject* globalObject, JSValue self)
{
    Runtime& rt = runtime(globalObject);
    String text = reprForMessage(globalObject, self);
    warnAbout(globalObject, rt.ResourceWarning(), makeString("unclosed database in "_s, text), 1, self);
    if (pendingExceptionMatches(globalObject, rt.Warning()))
        reportUnraisable(globalObject, makeString("Exception ignored while finalizing database connection "_s, text), jsUndefined());
    else
        takePendingException(globalObject);
}

static JSValue connectionDel(JSGlobalObject* globalObject, JSValue selfValue)
{
    PyRecord* self = asRecord(selfValue);
    Connection& connection = connectionOf(self);
    JSValue saved = takePendingException(globalObject);
    if (connection.db())
        warnUnclosed(globalObject, self);
    connection.statementCache.clear();
    if (!closeConnection(globalObject, self))
        reportUnraisable(globalObject, makeString("Exception ignored while closing database "_s, reprForMessage(globalObject, self)), jsUndefined());
    if (saved)
        rethrow(globalObject, saved);
    return jsUndefined();
}

static JSValue connectionClose(JSGlobalObject* globalObject, JSValue selfValue)
{
    PyRecord* self = asRecord(selfValue);
    Connection& connection = connectionOf(self);
    if (!connection.isInitialized)
        return raiseOf(globalObject, ProgrammingError(globalObject), "Base Connection.__init__ not called."_s);
    connection.statementCache.clear();
    if (!closeConnection(globalObject, self))
        return {};
    return jsUndefined();
}

static bool commit(JSGlobalObject* globalObject, PyRecord* self)
{
    if (!checkConnection(globalObject, self))
        return false;
    Connection& connection = connectionOf(self);
    if (connection.autocommit == Autocommit::Legacy)
        return sqlite3_get_autocommit(connection.db()) || executeSimply(globalObject, connection, "COMMIT");
    if (connection.autocommit == Autocommit::Disabled)
        return executeSimply(globalObject, connection, "COMMIT") && executeSimply(globalObject, connection, "BEGIN");
    return true;
}

static bool rollback(JSGlobalObject* globalObject, PyRecord* self)
{
    if (!checkConnection(globalObject, self))
        return false;
    Connection& connection = connectionOf(self);
    if (connection.autocommit == Autocommit::Legacy)
        return sqlite3_get_autocommit(connection.db()) || executeSimply(globalObject, connection, "ROLLBACK");
    if (connection.autocommit == Autocommit::Disabled)
        return executeSimply(globalObject, connection, "ROLLBACK") && executeSimply(globalObject, connection, "BEGIN");
    return true;
}

static JSValue connectionCommit(JSGlobalObject* globalObject, JSValue self) { return commit(globalObject, asRecord(self)) ? jsUndefined() : JSValue(); }
static JSValue connectionRollback(JSGlobalObject* globalObject, JSValue self) { return rollback(globalObject, asRecord(self)) ? jsUndefined() : JSValue(); }

static JSValue connectionEnter(JSGlobalObject* globalObject, JSValue self) { return checkConnection(globalObject, asRecord(self)) ? self : JSValue(); }

static JSValue connectionExit(JSGlobalObject* globalObject, JSValue selfValue, JSValue type, JSValue value, JSValue traceback)
{
    PyRecord* self = asRecord(selfValue);
    if (!isNone(type) || !isNone(value) || !isNone(traceback))
        return rollback(globalObject, self) ? jsBoolean(false) : JSValue();
    if (commit(globalObject, self))
        return jsBoolean(false);
    // So that the database is not left locked.
    JSValue failure = takePendingException(globalObject);
    rollback(globalObject, self);
    chainExceptions(globalObject, failure);
    return {};
}

// ---- Statements ----

// Where the SQL begins, after white space and comments. Null: nowhere.
static const char* skipToSQL(const char* sql)
{
    for (const char* position = sql; *position; ++position) {
        switch (*position) {
        case ' ':
        case '\t':
        case '\f':
        case '\n':
        case '\r':
            break;
        case '-':
            if (position[1] != '-')
                return position;
            position += 2;
            while (*position && *position != '\n')
                ++position;
            if (!*position)
                return nullptr;
            break;
        case '/':
            if (position[1] != '*')
                return position;
            position += 2;
            while (*position && (position[0] != '*' || position[1] != '/'))
                ++position;
            if (!*position)
                return nullptr;
            ++position;
            break;
        default:
            return position;
        }
    }
    return nullptr;
}

static bool startsWithKeyword(const char* sql, ASCIILiteral keyword)
{
    for (size_t i = 0; i < keyword.length(); ++i) {
        if (toASCIILower(sql[i]) != keyword[i])
            return false;
    }
    return true;
}

static RefPtr<Statement> createStatement(JSGlobalObject* globalObject, Database& database, JSValue sql)
{
    Vector<uint8_t> text;
    if (!encodeUTF8(globalObject, sql, text))
        return nullptr;
    DatabaseUse use(database);
    sqlite3* db = use.handle();
    if (text.size() > static_cast<size_t>(sqlite3_limit(db, SQLITE_LIMIT_SQL_LENGTH, -1))) {
        raiseOf(globalObject, DataError(globalObject), "query string is too large"_s);
        return nullptr;
    }
    if (text.contains(0)) {
        raiseOf(globalObject, ProgrammingError(globalObject), "the query contains a null character"_s);
        return nullptr;
    }
    text.append(0);

    sqlite3_stmt* handle;
    const char* tail;
    if (sqlite3_prepare_v2(db, cString(text), static_cast<int>(text.size()), &handle, &tail) != SQLITE_OK) {
        failFromDatabase(globalObject, db);
        return nullptr;
    }
    // By the authorizer.
    if (use.isClosed()) {
        takePendingException(globalObject);
        raiseClosedDatabase(globalObject);
        sqlite3_finalize(handle);
        return nullptr;
    }
    if (skipToSQL(tail)) {
        raiseOf(globalObject, ProgrammingError(globalObject), "You can only execute one statement at a time."_s);
        sqlite3_finalize(handle);
        return nullptr;
    }
    bool isDML = false;
    if (const char* start = skipToSQL(cString(text)))
        isDML = startsWithKeyword(start, "insert"_s) || startsWithKeyword(start, "update"_s) || startsWithKeyword(start, "delete"_s) || startsWithKeyword(start, "replace"_s);
    return Statement::create(database, handle, isDML);
}

// `database` is that of the connection.
static RefPtr<Statement> statementFromCache(JSGlobalObject* globalObject, Connection& connection, Database& database, JSValue sql)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!connection.statementCacheCapacity)
        RELEASE_AND_RETURN(scope, createStatement(globalObject, database, sql));
    String key = strValue(sql)->value(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    auto& cache = connection.statementCache;
    for (size_t i = cache.size(); i--;) {
        if (cache[i].first != key)
            continue;
        auto entry = WTF::move(cache[i]);
        cache.removeAt(i);
        cache.append(WTF::move(entry));
        return cache.last().second.ptr();
    }
    RefPtr<Statement> statement = createStatement(globalObject, database, sql);
    RETURN_IF_EXCEPTION(scope, nullptr);
    // The authorizer may have run statements of its own.
    if (cache.size() >= connection.statementCacheCapacity)
        cache.removeAt(0);
    cache.append({ key, *statement });
    return statement;
}

static JSValue connectionCall(JSGlobalObject* globalObject, JSValue selfValue, const CallArgs& args)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    PyRecord* self = asRecord(selfValue);
    if (!checkConnection(globalObject, self))
        return {};
    if (args.hasKeywords())
        return raiseTypeError(globalObject, scope, "sqlite3.Connection() takes no keyword arguments"_s);
    if (args.size() != 1)
        return raiseTypeError(globalObject, scope, "function takes exactly 1 argument ("_s, args.size(), " given)"_s);
    if (!isStr(args[0]))
        return raiseTypeError(globalObject, scope, "argument 1 must be str, not "_s, typeNameOfArgument(globalObject, args[0]));
    RefPtr<Statement> statement = createStatement(globalObject, *connectionOf(self).database, args[0]);
    if (!statement)
        return {};
    return createRecordWithState(globalObject, runtime(globalObject).typeFor(statementTypeDef), 0, std::unique_ptr<StatementHolder>(new StatementHolder { statement.releaseNonNull() }));
}

// ---- Adapters ----

// PEP 246, more or less. `alternative`, if not empty, is the result when nothing adapts the object.
static JSValue adapt(JSGlobalObject* globalObject, JSValue object, JSValue protocol, JSValue alternative)
{
    Runtime& rt = runtime(globalObject);
    VM& vm = rt.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue key = PyTuple::create(globalObject, { typeOf(globalObject, object), protocol });
    JSValue adapter = PyDict::from(moduleValue(globalObject, ModuleValue::Adapters))->get(globalObject, key);
    RETURN_IF_EXCEPTION(scope, {});
    if (adapter)
        RELEASE_AND_RETURN(scope, call(globalObject, adapter, object));

    // The protocol may know the object, or the object the protocol.
    std::tuple<JSValue, ASCIILiteral, JSValue> attempts[] = { { protocol, "__adapt__"_s, object }, { object, "__conform__"_s, protocol } };
    for (auto& [owner, name, argument] : attempts) {
        adapter = getAttrIfPresent(globalObject, owner, internString(vm, name));
        RETURN_IF_EXCEPTION(scope, {});
        if (!adapter)
            continue;
        JSValue adapted = call(globalObject, adapter, argument);
        if (adapted) {
            if (!isNone(adapted))
                return adapted;
        } else if (!clearPendingExceptionIfMatches(globalObject, rt.TypeError()))
            return {};
    }
    if (alternative)
        return alternative;
    return raise(globalObject, scope, ProgrammingError(globalObject), "can't adapt"_s);
}

static bool needsAdapting(JSGlobalObject* globalObject, JSValue value)
{
    if (moduleFlag(globalObject, ModuleValue::HasAdapterForBasicType))
        return true;
    if (isExactInt(value) || value.isString())
        return false;
    Runtime& rt = runtime(globalObject);
    PyType* type = typeOf(globalObject, value);
    return type != rt.floatType() && type != rt.bytearrayType();
}

// ---- Values, to and from SQLite ----

static JSValue valueFromSQLite(JSGlobalObject* globalObject, sqlite3_value* value)
{
    switch (sqlite3_value_type(value)) {
    case SQLITE_INTEGER:
        return makeInt(globalObject, static_cast<int64_t>(sqlite3_value_int64(value)));
    case SQLITE_FLOAT:
        return makeFloat(globalObject, sqlite3_value_double(value));
    case SQLITE_TEXT: {
        const unsigned char* text = sqlite3_value_text(value);
        return decodeUTF8(globalObject, { text, static_cast<size_t>(sqlite3_value_bytes(value)) });
    }
    case SQLITE_BLOB: {
        auto* blob = static_cast<const uint8_t*>(sqlite3_value_blob(value));
        return bytesFrom(globalObject, { blob, static_cast<size_t>(sqlite3_value_bytes(value)) });
    }
    default:
        return jsUndefined();
    }
}

// False: an exception.
static bool argumentsFromSQLite(JSGlobalObject* globalObject, int count, sqlite3_value** values, MarkedArgumentBuffer& result)
{
    for (int i = 0; i < count; ++i) {
        JSValue value = valueFromSQLite(globalObject, values[i]);
        if (!value)
            return false;
        result.append(value);
    }
    return true;
}

static JSValue callWith(JSGlobalObject* globalObject, JSValue callable, const MarkedArgumentBuffer& arguments)
{
    return call(globalObject, callable, CallArgs(reinterpret_cast<const JSValue*>(ArgList(arguments).data()), arguments.size()));
}

// False: an exception.
static bool setResult(JSGlobalObject* globalObject, sqlite3_context* context, JSValue value)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    constexpr size_t limit = std::numeric_limits<int>::max();
    if (isNone(value)) {
        sqlite3_result_null(context);
        return true;
    }
    if (isInt(value)) {
        int64_t integer;
        if (!int64ForSQLite(globalObject, value, integer))
            return false;
        sqlite3_result_int64(context, integer);
        return true;
    }
    if (isFloat(value)) {
        sqlite3_result_double(context, floatValue(value));
        return true;
    }
    if (isStr(value)) {
        Vector<uint8_t> text;
        if (!encodeUTF8(globalObject, value, text))
            return false;
        if (text.size() > limit) {
            raiseOverflowError(globalObject, scope, "string is longer than INT_MAX bytes"_s);
            return false;
        }
        sqlite3_result_text(context, text.isEmpty() ? "" : cString(text), static_cast<int>(text.size()), SQLITE_TRANSIENT);
        return true;
    }
    if (hasBuffer(value)) {
        BufferHolder holder(globalObject);
        if (!holder.get(value))
            return false;
        if (static_cast<size_t>(holder.buffer.length) > limit) {
            raiseOverflowError(globalObject, scope, "BLOB longer than INT_MAX bytes"_s);
            return false;
        }
        sqlite3_result_blob(context, holder.buffer.length ? static_cast<const void*>(holder.buffer.data) : "", static_cast<int>(holder.buffer.length), SQLITE_TRANSIENT);
        return true;
    }
    raise(globalObject, scope, ProgrammingError(globalObject), makeString("User-defined functions cannot return '"_s, typeName(globalObject, value), "' values to SQLite"_s));
    return false;
}

// ---- Callbacks ----
//
// SQLite cannot be told of an exception: what a callback raises ends here, and SQLite is given an error of its own kind.

static void printOrClearException(CallbackContext& context)
{
    JSGlobalObject* globalObject = context.globalObject;
    if (moduleFlag(globalObject, ModuleValue::ShowsCallbackTracebacks))
        reportUnraisable(globalObject, makeString("Exception ignored on sqlite3 callback "_s, reprForMessage(globalObject, context.callable)), jsUndefined());
    else
        takePendingException(globalObject);
}

static CallbackContext& contextOf(sqlite3_context* context) { return *static_cast<CallbackContext*>(sqlite3_user_data(context)); }

static void failCallback(sqlite3_context* sqliteContext, const char* message)
{
    CallbackContext& context = contextOf(sqliteContext);
    Runtime& rt = runtime(context.globalObject);
    if (pendingExceptionMatches(context.globalObject, rt.MemoryError()))
        sqlite3_result_error_nomem(sqliteContext);
    else if (pendingExceptionMatches(context.globalObject, rt.OverflowError()))
        sqlite3_result_error_toobig(sqliteContext);
    else
        sqlite3_result_error(sqliteContext, message, -1);
    printOrClearException(context);
}

static void functionCallback(sqlite3_context* sqliteContext, int count, sqlite3_value** values)
{
    CallbackContext& context = contextOf(sqliteContext);
    JSGlobalObject* globalObject = context.globalObject;
    MarkedArgumentBuffer arguments;
    JSValue result;
    if (argumentsFromSQLite(globalObject, count, values, arguments))
        result = callWith(globalObject, context.callable, arguments);
    if (!result || !setResult(globalObject, sqliteContext, result))
        failCallback(sqliteContext, "user-defined function raised exception");
}

// The instance of the aggregate class is in memory of SQLite's, where the collector does not look.
static EncodedJSValue* aggregateSlot(sqlite3_context* sqliteContext, bool create)
{
    return static_cast<EncodedJSValue*>(sqlite3_aggregate_context(sqliteContext, create ? sizeof(EncodedJSValue) : 0));
}

static void stepCallback(sqlite3_context* sqliteContext, int count, sqlite3_value** values)
{
    CallbackContext& context = contextOf(sqliteContext);
    JSGlobalObject* globalObject = context.globalObject;
    VM& vm = getVM(globalObject);
    EncodedJSValue* slot = aggregateSlot(sqliteContext, true);
    if (!slot) {
        sqlite3_result_error_nomem(sqliteContext);
        return;
    }
    if (!*slot) {
        JSValue instance = call(globalObject, context.callable);
        if (!instance) {
            failCallback(sqliteContext, "user-defined aggregate's '__init__' method raised error");
            return;
        }
        gcProtect(instance);
        *slot = JSValue::encode(instance);
    }
    JSValue method = getAttr(globalObject, JSValue::decode(*slot), internString(vm, "step"_s));
    if (!method) {
        failCallback(sqliteContext, "user-defined aggregate's 'step' method not defined");
        return;
    }
    MarkedArgumentBuffer arguments;
    if (!argumentsFromSQLite(globalObject, count, values, arguments)) {
        // As in CPython, where the exception waits for whoever looks next.
        return;
    }
    if (!callWith(globalObject, method, arguments))
        failCallback(sqliteContext, "user-defined aggregate's 'step' method raised error");
}

static void finalCallback(sqlite3_context* sqliteContext)
{
    CallbackContext& context = contextOf(sqliteContext);
    JSGlobalObject* globalObject = context.globalObject;
    VM& vm = getVM(globalObject);
    // No slot: no row matched. An empty one: the class could not be instantiated.
    EncodedJSValue* slot = aggregateSlot(sqliteContext, false);
    if (!slot || !*slot)
        return;
    JSValue instance = JSValue::decode(*slot);
    // The collector is destroying a statement that nothing got to reset: the last resort, see Unfinished. No code can run.
    if (vm.heap.mutatorState() != MutatorState::Running || vm.heap.isShuttingDown()) [[unlikely]] {
        gcUnprotect(instance);
        *slot = 0;
        return;
    }
    JSValue earlier = takePendingException(globalObject);
    JSValue result = callMethod(globalObject, instance, internString(vm, "finalize"_s));
    gcUnprotect(instance);
    *slot = 0;
    if (result && setResult(globalObject, sqliteContext, result)) {
        if (earlier)
            rethrow(globalObject, earlier);
        return;
    }
    bool isMissing = pendingExceptionMatches(globalObject, runtime(globalObject).AttributeError());
    chainExceptions(globalObject, earlier);
    failCallback(sqliteContext, isMissing ? "user-defined aggregate's 'finalize' method not defined" : "user-defined aggregate's 'finalize' method raised error");
}

static void inverseCallback(sqlite3_context* sqliteContext, int count, sqlite3_value** values)
{
    CallbackContext& context = contextOf(sqliteContext);
    JSGlobalObject* globalObject = context.globalObject;
    EncodedJSValue* slot = aggregateSlot(sqliteContext, false);
    if (!slot || !*slot)
        return;
    JSValue method = getAttr(globalObject, JSValue::decode(*slot), internString(getVM(globalObject), "inverse"_s));
    if (!method) {
        failCallback(sqliteContext, "user-defined aggregate's 'inverse' method not defined");
        return;
    }
    MarkedArgumentBuffer arguments;
    if (!argumentsFromSQLite(globalObject, count, values, arguments)) {
        failCallback(sqliteContext, "unable to build arguments for user-defined aggregate's 'inverse' method");
        return;
    }
    if (!callWith(globalObject, method, arguments))
        failCallback(sqliteContext, "user-defined aggregate's 'inverse' method raised error");
}

static void valueCallback(sqlite3_context* sqliteContext)
{
    CallbackContext& context = contextOf(sqliteContext);
    JSGlobalObject* globalObject = context.globalObject;
    // No row has been in the window yet, because of a FILTER or of a frame that is empty: NULL, as from finalCallback().
    // (CPython crashes.)
    EncodedJSValue* slot = aggregateSlot(sqliteContext, false);
    if (!slot || !*slot)
        return;
    JSValue result = callMethod(globalObject, JSValue::decode(*slot), internString(getVM(globalObject), "value"_s));
    if (!result) {
        bool isMissing = pendingExceptionMatches(globalObject, runtime(globalObject).AttributeError());
        failCallback(sqliteContext, isMissing ? "user-defined aggregate's 'value' method not defined" : "user-defined aggregate's 'value' method raised error");
        return;
    }
    if (!setResult(globalObject, sqliteContext, result))
        failCallback(sqliteContext, "unable to set result from user-defined aggregate's 'value' method");
}

static int authorizerCallback(void* data, int action, const char* first, const char* second, const char* databaseName, const char* source)
{
    auto& database = *static_cast<Database*>(data);
    // A copy: what it calls may set another callback.
    CallbackContext context = database.authorizer;
    if (!context.callable)
        return SQLITE_OK;
    OffLimits offLimits(database, "The authorizer callback cannot use the connection that calls it."_s);
    JSGlobalObject* globalObject = context.globalObject;
    JSValue arguments[5] = { jsNumber(action) };
    const char* texts[] = { first, second, databaseName, source };
    JSValue result;
    bool isBuilt = true;
    for (unsigned i = 0; i < 4 && isBuilt; ++i) {
        arguments[i + 1] = decodeCString(globalObject, texts[i]);
        isBuilt = !!arguments[i + 1];
    }
    if (isBuilt)
        result = call(globalObject, context.callable, CallArgs(arguments, 5));
    if (!result) {
        printOrClearException(context);
        return SQLITE_DENY;
    }
    if (!isInt(result))
        return SQLITE_DENY;
    auto code = tryInt64(intValue(result));
    if (!code || *code < std::numeric_limits<int>::min() || *code > std::numeric_limits<int>::max()) {
        auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
        raiseOverflowError(globalObject, scope, "Python int too large to convert to C int"_s);
        scope.release();
        printOrClearException(context);
        return SQLITE_DENY;
    }
    return static_cast<int>(*code);
}

static int progressCallback(void* data)
{
    auto& database = *static_cast<Database*>(data);
    // A copy: what it calls may set another callback.
    CallbackContext context = database.progress;
    if (!context.callable)
        return 0;
    OffLimits offLimits(database, "The progress handler cannot use the connection that calls it."_s);
    JSGlobalObject* globalObject = context.globalObject;
    VM& vm = getVM(globalObject);
    JSValue result = call(globalObject, context.callable);
    bool stops = false;
    if (result)
        stops = isTrue(globalObject, result);
    if (vm.exceptionForInspection()) {
        printOrClearException(context);
        return -1;
    }
    return stops;
}

static int traceCallback(unsigned type, void* data, void* statement, void* sql)
{
    if (type != SQLITE_TRACE_STMT)
        return 0;
    // A copy: what it calls may set another callback.
    CallbackContext context = static_cast<Database*>(data)->trace;
    if (!context.callable)
        return 0;
    JSGlobalObject* globalObject = context.globalObject;
    VM& vm = getVM(globalObject);
    JSValue text;
    if (char* expanded = sqlite3_expanded_sql(static_cast<sqlite3_stmt*>(statement))) {
        text = decodeCString(globalObject, expanded);
        sqlite3_free(expanded);
    } else {
        raiseOf(globalObject, DataError(globalObject), "Expanded SQL string exceeds the maximum string length"_s);
        printOrClearException(context);
        text = decodeCString(globalObject, static_cast<const char*>(sql));
    }
    if (text)
        call(globalObject, context.callable, text);
    if (vm.exceptionForInspection())
        printOrClearException(context);
    return 0;
}

static int collationCallback(void* data, int firstLength, const void* first, int secondLength, const void* second)
{
    CallbackContext& context = *static_cast<CallbackContext*>(data);
    JSGlobalObject* globalObject = context.globalObject;
    VM& vm = getVM(globalObject);
    // One statement makes many comparisons. After one has raised, the rest do not matter: whoever ran the statement finds the
    // exception.
    if (vm.exceptionForInspection())
        return 0;
    OffLimits offLimits(*context.database, "A collation cannot use the connection that calls it."_s);
    JSValue left = decodeUTF8(globalObject, { static_cast<const uint8_t*>(first), static_cast<size_t>(firstLength) });
    if (!left)
        return 0;
    JSValue right = decodeUTF8(globalObject, { static_cast<const uint8_t*>(second), static_cast<size_t>(secondLength) });
    if (!right)
        return 0;
    JSValue result = call(globalObject, context.callable, left, right);
    if (!result)
        return 0;
    JSValue index = toIndex(globalObject, result);
    if (!index) {
        takePendingException(globalObject);
        return 0;
    }
    return intSign(index);
}

// ---- Connection: giving SQLite the callbacks ----

static bool checkParameterCount(JSGlobalObject* globalObject, Connection& connection, int count, ASCIILiteral name)
{
    int limit = sqlite3_limit(connection.db(), SQLITE_LIMIT_FUNCTION_ARG, -1);
    if (count >= -1 && count <= limit)
        return true;
    raiseOf(globalObject, ProgrammingError(globalObject), makeString('\'', name, "' must be between -1 and "_s, limit, ", not "_s, count));
    return false;
}

// Under which the Connection keeps the callable: SQLite tells functions apart by name, whatever the case, and number of arguments.
static JSValue keyForCallable(JSGlobalObject* globalObject, ASCIILiteral kind, const Vector<uint8_t>& name, int parameterCount)
{
    return makeStr(getVM(globalObject), makeString(kind, ' ', parameterCount, ' ', String::fromUTF8(cString(name)).convertToASCIILowercase()));
}

static void rememberCallable(JSGlobalObject* globalObject, PyRecord* self, JSValue key, JSValue callable)
{
    auto* callables = PyDict::from(self->get(Callables));
    if (callable)
        callables->set(globalObject, key, callable);
    else
        callables->remove(globalObject, key);
}

static JSValue connectionCreateFunction(JSGlobalObject* globalObject, JSValue selfValue, const CallArgs& args)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    static constexpr ASCIILiteral names[] = { "deterministic"_s };
    JSValue values[4];
    if (!unpackArguments(globalObject, { "create_function"_s, 3, 3, 3, names }, args, values))
        return {};
    Vector<uint8_t> name;
    int parameterCount;
    if (!textArgument(globalObject, "create_function"_s, "argument 1"_s, values[0], name) || !intArgument(globalObject, values[1], 0, parameterCount))
        return {};
    bool isDeterministic = false;
    if (values[3]) {
        isDeterministic = isTrue(globalObject, values[3]);
        RETURN_IF_EXCEPTION(scope, {});
    }
    PyRecord* self = asRecord(selfValue);
    if (!checkConnection(globalObject, self))
        return {};
    Connection& connection = connectionOf(self);
    if (!checkParameterCount(globalObject, connection, parameterCount, "narg"_s))
        return {};
    // The old function, if there is one, goes during the call, and a failed call destroys the context.
    rememberCallable(globalObject, self, keyForCallable(globalObject, "new"_s, name, parameterCount), values[2]);
    int rc = sqlite3_create_function_v2(connection.db(), cString(name), parameterCount, SQLITE_UTF8 | (isDeterministic ? SQLITE_DETERMINISTIC : 0), new CallbackContext { globalObject, values[2] }, functionCallback, nullptr, nullptr, destroyCallbackContext);
    rememberCallable(globalObject, self, keyForCallable(globalObject, "new"_s, name, parameterCount), {});
    if (rc != SQLITE_OK)
        return raise(globalObject, scope, OperationalError(globalObject), "Error creating function"_s);
    rememberCallable(globalObject, self, keyForCallable(globalObject, "function"_s, name, parameterCount), values[2]);
    return jsUndefined();
}

static JSValue createAggregate(JSGlobalObject* globalObject, JSValue selfValue, const CallArgs& args, ASCIILiteral function, ASCIILiteral countName, bool isWindowFunction)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue values[3];
    if (!unpackArguments(globalObject, { function, 3, 3, 3, {} }, args, values))
        return {};
    Vector<uint8_t> name;
    int parameterCount;
    if (!textArgument(globalObject, function, "argument 1"_s, values[0], name) || !intArgument(globalObject, values[1], 0, parameterCount))
        return {};
    PyRecord* self = asRecord(selfValue);
    if (!checkConnection(globalObject, self))
        return {};
    Connection& connection = connectionOf(self);
    if (!checkParameterCount(globalObject, connection, parameterCount, countName))
        return {};

    JSValue key = keyForCallable(globalObject, "function"_s, name, parameterCount);
    JSValue temporaryKey = keyForCallable(globalObject, "new"_s, name, parameterCount);
    JSValue aggregateClass = values[2];
    int rc;
    if (isWindowFunction && isNone(aggregateClass)) {
        rc = sqlite3_create_window_function(connection.db(), cString(name), parameterCount, SQLITE_UTF8, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr);
        aggregateClass = {};
    } else {
        rememberCallable(globalObject, self, temporaryKey, aggregateClass);
        auto* context = new CallbackContext { globalObject, aggregateClass };
        if (isWindowFunction)
            rc = sqlite3_create_window_function(connection.db(), cString(name), parameterCount, SQLITE_UTF8, context, stepCallback, finalCallback, valueCallback, inverseCallback, destroyCallbackContext);
        else
            rc = sqlite3_create_function_v2(connection.db(), cString(name), parameterCount, SQLITE_UTF8, context, nullptr, stepCallback, finalCallback, destroyCallbackContext);
        rememberCallable(globalObject, self, temporaryKey, {});
    }
    if (rc != SQLITE_OK) {
        if (isWindowFunction)
            RELEASE_AND_RETURN(scope, raiseFromCode(globalObject, rc));
        return raise(globalObject, scope, OperationalError(globalObject), "Error creating aggregate"_s);
    }
    rememberCallable(globalObject, self, key, aggregateClass);
    return jsUndefined();
}

static JSValue connectionCreateAggregate(JSGlobalObject* globalObject, JSValue self, const CallArgs& args) { return createAggregate(globalObject, self, args, "create_aggregate"_s, "n_arg"_s, false); }
static JSValue connectionCreateWindowFunction(JSGlobalObject* globalObject, JSValue self, const CallArgs& args) { return createAggregate(globalObject, self, args, "create_window_function"_s, "num_params"_s, true); }

static JSValue connectionCreateCollation(JSGlobalObject* globalObject, JSValue selfValue, const CallArgs& args)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue values[2];
    if (!unpackArguments(globalObject, { "create_collation"_s, 2, 2, 2, {} }, args, values))
        return {};
    Vector<uint8_t> name;
    if (!textArgument(globalObject, "create_collation"_s, "argument 1"_s, values[0], name))
        return {};
    PyRecord* self = asRecord(selfValue);
    if (!checkConnection(globalObject, self))
        return {};
    Connection& connection = connectionOf(self);
    JSValue callable = values[1];
    JSValue key = keyForCallable(globalObject, "collation"_s, name, 0);
    int rc;
    if (isNone(callable)) {
        rc = sqlite3_create_collation_v2(connection.db(), cString(name), SQLITE_UTF8, nullptr, nullptr, nullptr);
        callable = {};
    } else {
        if (!isCallable(globalObject, callable))
            return raiseTypeError(globalObject, scope, "parameter must be callable"_s);
        auto* context = new CallbackContext { globalObject, callable, connection.database.get() };
        rc = sqlite3_create_collation_v2(connection.db(), cString(name), SQLITE_UTF8, context, collationCallback, destroyCallbackContext);
        // Here, unlike elsewhere, a failed call leaves the context to the caller.
        if (rc != SQLITE_OK)
            delete context;
    }
    if (rc != SQLITE_OK)
        return failFromDatabase(globalObject, connection.db());
    rememberCallable(globalObject, self, key, callable);
    return jsUndefined();
}

static JSValue connectionSetAuthorizer(JSGlobalObject* globalObject, JSValue selfValue, const CallArgs& args)
{
    VM& vm = getVM(globalObject);
    JSValue callable;
    if (!unpackArguments(globalObject, { "set_authorizer"_s, 1, 1, 1, {} }, args, &callable))
        return {};
    PyRecord* self = asRecord(selfValue);
    if (!checkConnectionIsOpen(globalObject, self))
        return {};
    Database& database = *connectionOf(self).database;
    self->set(vm, Authorizer, callable);
    database.authorizer = { globalObject, isNone(callable) ? JSValue() : callable };
    database.didChange(Database::Hook::Authorizer);
    return jsUndefined();
}

static JSValue connectionSetProgressHandler(JSGlobalObject* globalObject, JSValue selfValue, const CallArgs& args)
{
    VM& vm = getVM(globalObject);
    static constexpr ASCIILiteral names[] = { "n"_s };
    JSValue values[2];
    if (!unpackArguments(globalObject, { "set_progress_handler"_s, 1, 2, 2, names }, args, values))
        return {};
    int interval;
    if (!intArgument(globalObject, values[1], 0, interval))
        return {};
    PyRecord* self = asRecord(selfValue);
    if (!checkConnectionIsOpen(globalObject, self))
        return {};
    Database& database = *connectionOf(self).database;
    self->set(vm, ProgressHandler, values[0]);
    database.progress = { globalObject, isNone(values[0]) ? JSValue() : values[0] };
    database.progressInterval = interval;
    database.didChange(Database::Hook::Progress);
    return jsUndefined();
}

static JSValue connectionSetTraceCallback(JSGlobalObject* globalObject, JSValue selfValue, const CallArgs& args)
{
    VM& vm = getVM(globalObject);
    JSValue callable;
    if (!unpackArguments(globalObject, { "set_trace_callback"_s, 1, 1, 1, {} }, args, &callable))
        return {};
    PyRecord* self = asRecord(selfValue);
    if (!checkConnectionIsOpen(globalObject, self))
        return {};
    Database& database = *connectionOf(self).database;
    self->set(vm, TraceCallback, callable);
    database.trace = { globalObject, isNone(callable) ? JSValue() : callable };
    database.didChange(Database::Hook::Trace);
    return jsUndefined();
}

// SQLite is given the Database to call them with, and they look there for what to call: one that finds nothing does nothing. So
// SQLite need not be told at once to forget one, and while anything is under way it is not. Around some of its work (VACUUM, ALTER
// TABLE, reading the schema) it puts part of these settings aside and then back, and would be left with a function and no
// argument, or a mask and no function. For the same reason, what it is told meanwhile it is told again afterwards.
void Database::didChange(OptionSet<Hook> hooks)
{
    bool canForget = !m_useCount;
    if (!canForget)
        m_hooksToSettle.add(hooks);
    if (hooks.contains(Hook::Trace) && (trace.callable || canForget))
        sqlite3_trace_v2(m_handle, SQLITE_TRACE_STMT, trace.callable ? traceCallback : nullptr, this);
    if (hooks.contains(Hook::Progress) && (progress.callable || canForget))
        sqlite3_progress_handler(m_handle, progress.callable ? progressInterval : 0, progress.callable ? progressCallback : nullptr, this);
    if (hooks.contains(Hook::Authorizer) && (authorizer.callable || canForget))
        sqlite3_set_authorizer(m_handle, authorizer.callable ? authorizerCallback : nullptr, this);
}

void Database::didEndLastUse()
{
    if (m_isClosed)
        closeForSQLite();
    else if (m_hooksToSettle)
        didChange(std::exchange(m_hooksToSettle, {}));
}

// ---- Cursor ----

struct Cursor {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(Cursor);

    RefPtr<Statement> statement; // While it has rows to give.
    bool isInitialized { false };
    bool isClosed { false };
    bool isLocked { false };
    uint32_t arraySize { 0 };
    int64_t rowCount { -1 };
};

WTF_MAKE_STRUCT_TZONE_ALLOCATED_IMPL(Cursor);

enum CursorField : unsigned {
    CursorConnection,
    Description,
    RowCastMap, // A list with the converter for each column, or None.
    LastRowID,
    CursorRowFactory,
    // ConnectionField::Callables as it was when the statement was started, which may call them for as long as it runs: longer
    // than the connection has them, if that is closed by one of them, or opened anew.
    CursorCallables,
    CursorUnfinished, // See Unfinished. Empty until there is need of one.
    CursorFieldCount
};

static Cursor& cursorOf(PyRecord* self) { return *stateOf<Cursor>(self); }

// A statement that has given some of its rows has to be reset when its cursor goes: it may be in the cache of the connection, and
// it keeps the database locked. The collector, which finds out that the cursor is gone, cannot do that, since a reset may
// call finalize() of an aggregate. So a cursor with such a statement refers to one of these, which nothing else does, and
// which has a finalizer: the runtime calls that at a safe point, once the cursor cannot be reached.
struct Unfinished {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(Unfinished);
    RefPtr<Statement> statement;
};

WTF_MAKE_STRUCT_TZONE_ALLOCATED_IMPL(Unfinished);

enum UnfinishedField : unsigned { UnfinishedCallables, // CursorCallables, which the cursor no longer keeps alive by then.
    UnfinishedFieldCount };

static JSValue unfinishedDel(JSGlobalObject*, JSValue self)
{
    if (auto statement = std::exchange(stateOf<Unfinished>(self)->statement, nullptr))
        statement->reset();
    return jsUndefined();
}

static constexpr NativeDef unfinishedMethods[] = {
    PY_SLOT("__del__", unfinishedDel, "($self, /)"),
};

static constexpr TypeDef unfinishedTypeDef { "sqlite3._Unfinished"_s, { TypeFlag::Immutable, TypeFlag::DisallowInstantiation }, unfinishedMethods, {}, {} };

// To be called when Cursor::statement may have changed, before the cursor is left to itself again.
static void didChangeStatement(JSGlobalObject* globalObject, PyRecord* self)
{
    Runtime& rt = runtime(globalObject);
    VM& vm = rt.vm();
    Cursor& cursor = cursorOf(self);
    PyRecord* record = self->get(CursorUnfinished) ? asRecord(self->get(CursorUnfinished)) : nullptr;
    if (!cursor.statement) {
        self->set(vm, CursorCallables, JSValue());
        if (record && std::exchange(stateOf<Unfinished>(record)->statement, nullptr)) {
            rt.unregisterFinalizable(record);
            record->set(vm, UnfinishedCallables, JSValue());
        }
        return;
    }
    if (!record) {
        record = createRecordWithState(globalObject, rt.typeFor(unfinishedTypeDef), UnfinishedFieldCount, makeUnique<Unfinished>());
        self->set(vm, CursorUnfinished, record);
    }
    auto& unfinished = *stateOf<Unfinished>(record);
    if (!unfinished.statement)
        rt.registerFinalizable(record);
    unfinished.statement = cursor.statement;
    record->set(vm, UnfinishedCallables, self->get(CursorCallables));
}

// What sqlite3_reset() says.
static int resetAndDropStatement(JSGlobalObject* globalObject, PyRecord* self)
{
    auto statement = std::exchange(cursorOf(self).statement, nullptr);
    if (!statement)
        return SQLITE_OK;
    // In this order: the reset may still call what the cursor keeps alive for the statement.
    int rc = statement->reset();
    didChangeStatement(globalObject, self);
    return rc;
}

static bool checkCursorIsNotLocked(JSGlobalObject* globalObject, Cursor& cursor)
{
    if (!cursor.isLocked)
        return true;
    raiseOf(globalObject, ProgrammingError(globalObject), "Recursive use of cursors not allowed."_s);
    return false;
}

static bool checkCursor(JSGlobalObject* globalObject, PyRecord* self)
{
    Cursor& cursor = cursorOf(self);
    if (!cursor.isInitialized) {
        raiseOf(globalObject, ProgrammingError(globalObject), "Base Cursor.__init__ not called."_s);
        return false;
    }
    if (cursor.isClosed) {
        raiseOf(globalObject, ProgrammingError(globalObject), "Cannot operate on a closed cursor."_s);
        return false;
    }
    return checkConnection(globalObject, asRecord(self->get(CursorConnection))) && checkCursorIsNotLocked(globalObject, cursor);
}

static JSValue cursorNew(JSGlobalObject* globalObject, JSValue cls, const CallArgs&)
{
    return createRecordWithState(globalObject, PyType::from(cls), CursorFieldCount, makeUnique<Cursor>());
}

static JSValue cursorInit(JSGlobalObject* globalObject, JSValue selfValue, const CallArgs& args)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (args.hasKeywords())
        return raiseTypeError(globalObject, scope, "Cursor() takes no keyword arguments"_s);
    if (!checkPositional(globalObject, "Cursor"_s, args, 1, 1))
        return {};
    if (!PyRecord::tryFrom(args[0], connectionType(globalObject)))
        return raiseTypeError(globalObject, scope, "Cursor() argument 1 must be sqlite3.Connection, not "_s, typeNameOfArgument(globalObject, args[0]));
    PyRecord* self = asRecord(selfValue);
    Cursor& cursor = cursorOf(self);
    if (!checkCursorIsNotLocked(globalObject, cursor))
        return {};
    self->set(vm, CursorConnection, args[0]);
    resetAndDropStatement(globalObject, self);
    self->set(vm, RowCastMap, JSValue());
    self->set(vm, Description, jsUndefined());
    self->set(vm, LastRowID, jsUndefined());
    self->set(vm, CursorRowFactory, jsUndefined());
    cursor.arraySize = 1;
    cursor.isClosed = false;
    cursor.rowCount = -1;
    cursor.isInitialized = true;
    return jsUndefined();
}

static JSValue raiseCannotReset(JSGlobalObject* globalObject)
{
    return raiseOf(globalObject, InternalError(globalObject), "cannot reset statement"_s);
}

// The converter registered under the name, whatever its case. Empty: none, or an exception.
static JSValue converterNamed(JSGlobalObject* globalObject, std::span<const char> name)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue key = decodeUTF8(globalObject, byteCast<uint8_t>(name));
    RETURN_IF_EXCEPTION(scope, {});
    JSValue upper = callMethod(globalObject, key, internString(vm, "upper"_s));
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, PyDict::from(moduleValue(globalObject, ModuleValue::Converters))->get(globalObject, upper));
}

static bool buildRowCastMap(JSGlobalObject* globalObject, PyRecord* self, Connection& connection)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!connection.detectTypes)
        return true;
    sqlite3_stmt* statement = cursorOf(self).statement->handle();
    JSArray* map = newList(globalObject);
    self->set(vm, RowCastMap, JSValue());
    for (int i = 0; i < sqlite3_column_count(statement); ++i) {
        JSValue converter;
        if (connection.detectTypes & parseColNames) {
            // name [type]
            const char* name = sqlite3_column_name(statement, i);
            if (!name) {
                raiseMemoryError(globalObject, scope, String());
                return false;
            }
            const char* typeStart = nullptr;
            for (const char* position = name; *position; ++position) {
                if (*position == '[')
                    typeStart = position + 1;
                else if (*position == ']' && typeStart) {
                    converter = converterNamed(globalObject, { typeStart, static_cast<size_t>(position - typeStart) });
                    RETURN_IF_EXCEPTION(scope, false);
                    break;
                }
            }
        }
        if (!converter && (connection.detectTypes & parseDeclTypes)) {
            // The first word of the declared type: "decimal(10, 5)" and "integer primary key" are "decimal" and "integer".
            if (const char* declared = sqlite3_column_decltype(statement, i)) {
                const char* end = declared;
                while (*end && *end != ' ' && *end != '(')
                    ++end;
                converter = converterNamed(globalObject, { declared, static_cast<size_t>(end - declared) });
                RETURN_IF_EXCEPTION(scope, false);
            }
        }
        listAppend(globalObject, map, converter ? converter : jsUndefined());
        RETURN_IF_EXCEPTION(scope, false);
    }
    self->set(vm, RowCastMap, map);
    return true;
}

static JSValue columnName(JSGlobalObject* globalObject, Connection& connection, const char* name)
{
    size_t length = strlen(name);
    if (connection.detectTypes & parseColNames) {
        if (const char* bracket = strchr(name, '[')) {
            if (bracket != name && bracket[-1] == ' ')
                --bracket;
            length = bracket - name;
        }
    }
    return decodeUTF8(globalObject, { byteCast<uint8_t>(name), length });
}

// The caller has a DatabaseUse, and the cursor is locked: what the converters and the factory run can take neither handle away.
static JSValue fetchOneRow(JSGlobalObject* globalObject, PyRecord* self, PyRecord* connectionRecord, sqlite3* db)
{
    Runtime& rt = runtime(globalObject);
    VM& vm = rt.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    Connection& connection = connectionOf(connectionRecord);
    sqlite3_stmt* statement = cursorOf(self).statement->handle();
    int count = sqlite3_data_count(statement);
    MarkedArgumentBuffer row;
    JSArray* castMap = tryAsList(self->get(RowCastMap));

    auto bytesOfColumn = [&](const void* data, int column) {
        return std::span<const uint8_t> { static_cast<const uint8_t*>(data), static_cast<size_t>(sqlite3_column_bytes(statement, column)) };
    };
    for (int i = 0; i < count; ++i) {
        // Asked for each column: a converter may open the connection anew, with other settings.
        JSValue converter = connection.detectTypes && castMap && static_cast<unsigned>(i) < listLength(castMap) ? listGet(castMap, i) : jsUndefined();
        JSValue converted;
        if (!isNone(converter)) {
            const void* blob = sqlite3_column_blob(statement, i);
            if (!blob) {
                if (sqlite3_errcode(db) == SQLITE_NOMEM)
                    return raiseMemoryError(globalObject, scope, String());
                converted = jsUndefined();
            } else {
                JSValue item = bytesFrom(globalObject, bytesOfColumn(blob, i));
                RETURN_IF_EXCEPTION(scope, {});
                converted = call(globalObject, converter, item);
            }
        } else {
            switch (sqlite3_column_type(statement, i)) {
            case SQLITE_NULL:
                converted = jsUndefined();
                break;
            case SQLITE_INTEGER:
                converted = makeInt(globalObject, static_cast<int64_t>(sqlite3_column_int64(statement, i)));
                break;
            case SQLITE_FLOAT:
                converted = makeFloat(globalObject, sqlite3_column_double(statement, i));
                break;
            case SQLITE_TEXT: {
                const unsigned char* text = sqlite3_column_text(statement, i);
                if (!text && sqlite3_errcode(db) == SQLITE_NOMEM)
                    return raiseMemoryError(globalObject, scope, String());
                auto bytes = bytesOfColumn(text, i);
                JSValue factory = connectionRecord->get(TextFactory);
                if (factory == JSValue(rt.strType())) {
                    converted = decodeUTF8(globalObject, bytes);
                    if (!converted && clearPendingExceptionIfMatches(globalObject, rt.UnicodeDecodeError())) {
                        const char* name = sqlite3_column_name(statement, i);
                        if (!name)
                            return raiseMemoryError(globalObject, scope, String());
                        // What is not ASCII shows as U+FFFD, and the whole is cut as CPython's buffer cuts it.
                        StringBuilder message;
                        auto appendBytes = [&](const char* bytes) {
                            for (; *bytes; ++bytes)
                                message.append(isASCII(*bytes) ? static_cast<char16_t>(*bytes) : static_cast<char16_t>(0xfffd));
                        };
                        message.append("Could not decode to UTF-8 column '"_s);
                        appendBytes(name);
                        message.append("' with text '"_s);
                        appendBytes(byteCast<char>(text));
                        message.append('\'');
                        return raise(globalObject, scope, OperationalError(globalObject), message.toString().left(198));
                    }
                } else if (factory == JSValue(rt.bytesType()))
                    converted = bytesFrom(globalObject, bytes);
                else if (factory == JSValue(rt.bytearrayType()))
                    converted = PyByteArray::create(globalObject, bytes);
                else {
                    JSValue item = bytesFrom(globalObject, bytes);
                    RETURN_IF_EXCEPTION(scope, {});
                    converted = call(globalObject, factory, item);
                }
                break;
            }
            default: {
                const void* blob = sqlite3_column_blob(statement, i);
                if (!blob && sqlite3_errcode(db) == SQLITE_NOMEM)
                    return raiseMemoryError(globalObject, scope, String());
                converted = bytesFrom(globalObject, bytesOfColumn(blob, i));
            }
            }
        }
        RETURN_IF_EXCEPTION(scope, {});
        row.append(converted);
    }
    return PyTuple::create(globalObject, std::span<const JSValue> { reinterpret_cast<const JSValue*>(ArgList(row).data()), row.size() });
}

// SQLITE_OK, or an error of SQLite's, or SQLITE_ERROR and an exception.
static int bindParameter(JSGlobalObject* globalObject, sqlite3_stmt* statement, int position, JSValue parameter)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    constexpr size_t limit = std::numeric_limits<int>::max();
    if (isNone(parameter))
        return sqlite3_bind_null(statement, position);
    if (isInt(parameter)) {
        int64_t value;
        if (!int64ForSQLite(globalObject, parameter, value))
            return SQLITE_ERROR;
        return sqlite3_bind_int64(statement, position, value);
    }
    if (isFloat(parameter))
        return sqlite3_bind_double(statement, position, floatValue(parameter));
    if (isStr(parameter)) {
        Vector<uint8_t> text;
        if (!encodeUTF8(globalObject, parameter, text))
            return SQLITE_ERROR;
        if (text.size() > limit) {
            raiseOverflowError(globalObject, scope, "string longer than INT_MAX bytes"_s);
            return SQLITE_ERROR;
        }
        return sqlite3_bind_text(statement, position, text.isEmpty() ? "" : cString(text), static_cast<int>(text.size()), SQLITE_TRANSIENT);
    }
    if (hasBuffer(parameter)) {
        BufferHolder holder(globalObject);
        if (!holder.get(parameter))
            return SQLITE_ERROR;
        if (static_cast<size_t>(holder.buffer.length) > limit) {
            raiseOverflowError(globalObject, scope, "BLOB longer than INT_MAX bytes"_s);
            return SQLITE_ERROR;
        }
        // A null pointer would bind NULL, which an empty blob is not.
        return sqlite3_bind_blob(statement, position, holder.buffer.length ? static_cast<const void*>(holder.buffer.data) : "", static_cast<int>(holder.buffer.length), SQLITE_TRANSIENT);
    }
    raise(globalObject, scope, ProgrammingError(globalObject), makeString("Error binding parameter "_s, position, ": type '"_s, typeName(globalObject, parameter), "' is not supported"_s));
    return SQLITE_ERROR;
}

// False: an exception.
static bool adaptAndBind(JSGlobalObject* globalObject, sqlite3_stmt* statement, int position, JSValue parameter)
{
    if (needsAdapting(globalObject, parameter)) {
        parameter = adapt(globalObject, parameter, prepareProtocolType(globalObject), parameter);
        if (!parameter)
            return false;
    }
    if (bindParameter(globalObject, statement, position, parameter) == SQLITE_OK)
        return true;
    JSValue raised = takePendingException(globalObject);
    raiseFromDatabase(globalObject, sqlite3_db_handle(statement));
    chainExceptions(globalObject, raised);
    return false;
}

static bool bindParameters(JSGlobalObject* globalObject, sqlite3_stmt* statement, JSValue parameters)
{
    Runtime& rt = runtime(globalObject);
    VM& vm = rt.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    int needed = sqlite3_bind_parameter_count(statement);
    PyType* type = typeOf(globalObject, parameters);
    bool isExactTuple = type == rt.tupleType();
    bool isExactList = type == rt.listType();

    if (isExactTuple || isExactList || (!isDict(parameters) && type->lookup(Special::GetItem) && (type->isHeapType() || !type->has(TypeFlag::Mapping)))) {
        int64_t given = isExactTuple ? PyTuple::from(parameters)->length() : isExactList ? listLength(asList(parameters)) : length(globalObject, parameters);
        RETURN_IF_EXCEPTION(scope, false);
        if (given != needed) {
            raise(globalObject, scope, ProgrammingError(globalObject), makeString("Incorrect number of bindings supplied. The current statement uses "_s, needed, ", and there are "_s, given, " supplied."_s));
            return false;
        }
        for (int i = 0; i < needed; ++i) {
            const char* name = sqlite3_bind_parameter_name(statement, i + 1);
            if (name && name[0] != '?') {
                raise(globalObject, scope, ProgrammingError(globalObject), makeString("Binding "_s, i + 1, " ('"_s, String::fromUTF8(name), "') is a named parameter, but you supplied a sequence which requires nameless (qmark) placeholders."_s));
                return false;
            }
            JSValue item;
            if (isExactTuple)
                item = PyTuple::from(parameters)->at(i);
            else if (isExactList) {
                // What adapting an earlier item ran may have shortened it.
                if (static_cast<unsigned>(i) >= listLength(asList(parameters))) {
                    raiseIndexError(globalObject, scope, "list index out of range"_s);
                    return false;
                }
                item = listGet(asList(parameters), i);
            } else {
                item = getItem(globalObject, parameters, jsNumber(i));
                RETURN_IF_EXCEPTION(scope, false);
            }
            if (!adaptAndBind(globalObject, statement, i + 1, item))
                return false;
        }
        return true;
    }
    if (isDict(parameters)) {
        for (int i = 1; i <= needed; ++i) {
            const char* name = sqlite3_bind_parameter_name(statement, i);
            if (!name) {
                raise(globalObject, scope, ProgrammingError(globalObject), makeString("Binding "_s, i, " has no name, but you supplied a dictionary (which has only names)."_s));
                return false;
            }
            ++name; // Past the colon.
            JSValue key = decodeCString(globalObject, name);
            RETURN_IF_EXCEPTION(scope, false);
            JSValue item = getItem(globalObject, parameters, key);
            if (!item) {
                if (!clearPendingExceptionIfMatches(globalObject, rt.KeyError()))
                    return false;
                raise(globalObject, scope, ProgrammingError(globalObject), makeString("You did not supply a value for binding parameter :"_s, strValue(key)->value(globalObject).data, '.'));
                return false;
            }
            if (!adaptAndBind(globalObject, statement, i, item))
                return false;
        }
        return true;
    }
    raise(globalObject, scope, ProgrammingError(globalObject), "parameters are of unsupported type"_s);
    return false;
}

// execute() and executemany(). `parameters` may be empty for the former.
static JSValue executeQuery(JSGlobalObject* globalObject, PyRecord* self, bool isMultiple, JSValue operation, JSValue parameters)
{
    Runtime& rt = runtime(globalObject);
    VM& vm = rt.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!checkCursor(globalObject, self))
        return {};
    Cursor& cursor = cursorOf(self);
    PyRecord* connectionRecord = asRecord(self->get(CursorConnection));
    Connection& connection = connectionOf(connectionRecord);
    cursor.isLocked = true;

    // The way out, whether or not an exception is on its way. (There is none after SQL with nothing in it, which SQLite
    // refuses to run and has no error for.)
    auto finish = [&]() -> JSValue {
        cursor.isLocked = false;
        if (!scope.exception()) {
            if (cursor.statement && !sqlite3_stmt_busy(cursor.statement->handle()))
                cursor.statement = nullptr;
            didChangeStatement(globalObject, self);
            return self;
        }
        if (cursor.statement) {
            int stateBefore = sqlite3_errcode(sqlite3_db_handle(cursor.statement->handle()));
            if (resetAndDropStatement(globalObject, self) != SQLITE_OK && stateBefore == SQLITE_OK) {
                JSValue raised = takePendingException(globalObject);
                raiseCannotReset(globalObject);
                chainExceptions(globalObject, raised);
            }
        }
        cursor.rowCount = -1;
        return {};
    };
    auto failToReset = [&]() -> JSValue {
        cursor.isLocked = false;
        cursor.rowCount = -1;
        cursor.statement = nullptr;
        didChangeStatement(globalObject, self);
        return raiseCannotReset(globalObject);
    };
    // After anything that may have run code of the program. (If that has opened the connection anew, the statement goes on.)
    auto failIfClosed = [&] {
        if (connection.db())
            return false;
        takePendingException(globalObject);
        raiseClosedDatabase(globalObject);
        return true;
    };

    JSValue iterator;
    if (isMultiple) {
        iterator = isIterator(globalObject, parameters) ? parameters : getIter(globalObject, parameters);
        if (scope.exception() || failIfClosed())
            return finish();
    }

    self->set(vm, Description, jsUndefined());
    if (cursor.statement && cursor.statement->reset() != SQLITE_OK)
        return failToReset();
    if (failIfClosed())
        return finish();
    DatabaseUse use(*connection.database);
    sqlite3* db = use.handle();
    cursor.statement = statementFromCache(globalObject, connection, use.database(), operation);
    if (!cursor.statement)
        return finish();
    self->set(vm, CursorCallables, connectionRecord->get(Callables));
    if (isMultiple && sqlite3_stmt_readonly(cursor.statement->handle())) {
        raise(globalObject, scope, ProgrammingError(globalObject), "executemany() can only execute DML statements."_s);
        return finish();
    }
    // Another cursor is in the middle of it.
    if (sqlite3_stmt_busy(cursor.statement->handle())) {
        cursor.statement = createStatement(globalObject, use.database(), operation);
        if (!cursor.statement)
            return finish();
    }
    if (cursor.statement->reset() != SQLITE_OK)
        return failToReset();
    cursor.rowCount = cursor.statement->isDML() ? 0 : -1;

    if (connection.autocommit == Autocommit::Legacy && !connection.isolationLevel.isNull() && cursor.statement->isDML() && sqlite3_get_autocommit(db)) {
        auto begin = makeString("BEGIN "_s, connection.isolationLevel).ascii();
        if (!executeSimply(globalObject, use.database(), begin.data()) || failIfClosed())
            return finish();
    }

    // The cursor is locked, so this stays its statement.
    Statement& statement = *cursor.statement;
    bool isDone = false;
    while (true) {
        JSValue current;
        if (isMultiple) {
            current = iterNext(globalObject, iterator);
            if (scope.exception() || failIfClosed())
                return finish();
            if (!current)
                break;
        } else {
            if (isDone)
                break;
            isDone = true;
            current = parameters ? parameters : JSValue(rt.emptyTuple());
        }
        if (!bindParameters(globalObject, statement.handle(), current) || failIfClosed())
            return finish();

        int rc;
        for (bool hasCollected = false;; hasCollected = true) {
            rc = sqlite3_step(statement.handle());
            if (!connection.db() || !isLockError(rc) || hasCollected || scope.exception() || !Database::anotherStatementHasRowsLeft(vm, statement.handle()))
                break;
            sqlite3_reset(statement.handle());
            if (!collectAbandonedCursors(globalObject))
                return finish();
        }
        if (failIfClosed())
            return finish();
        if (rc != SQLITE_DONE && rc != SQLITE_ROW) {
            // A callback may have left one.
            if (JSValue raised = takePendingException(globalObject)) {
                if (moduleFlag(globalObject, ModuleValue::ShowsCallbackTracebacks))
                    printException(globalObject, raised);
            }
            raiseFromDatabase(globalObject, db);
            return finish();
        }
        if (scope.exception())
            return finish();
        if (!buildRowCastMap(globalObject, self, connection)) {
            JSValue cause = takePendingException(globalObject);
            raise(globalObject, scope, OperationalError(globalObject), "Error while building row_cast_map"_s);
            if (auto* exception = PyException::tryFrom(pendingException(globalObject))) {
                exception->setCause(vm, cause);
                exception->setContext(vm, cause);
            }
            return finish();
        }

        int columnCount = sqlite3_column_count(statement.handle());
        if (isNone(self->get(Description)) && columnCount > 0) {
            MarkedArgumentBuffer columns;
            for (int i = 0; i < columnCount; ++i) {
                const char* name = sqlite3_column_name(statement.handle(), i);
                if (!name) {
                    raiseMemoryError(globalObject, scope, String());
                    return finish();
                }
                JSValue decoded = columnName(globalObject, connection, name);
                if (!decoded)
                    return finish();
                columns.append(PyTuple::create(globalObject, { decoded, jsUndefined(), jsUndefined(), jsUndefined(), jsUndefined(), jsUndefined(), jsUndefined() }));
            }
            self->set(vm, Description, PyTuple::create(globalObject, std::span<const JSValue> { reinterpret_cast<const JSValue*>(ArgList(columns).data()), columns.size() }));
        }

        if (rc == SQLITE_DONE) {
            if (statement.isDML())
                cursor.rowCount += sqlite3_changes(db);
            if (statement.reset() != SQLITE_OK)
                return failToReset();
        }
    }

    if (failIfClosed())
        return finish();
    if (!isMultiple)
        self->set(vm, LastRowID, makeInt(globalObject, static_cast<int64_t>(sqlite3_last_insert_rowid(db))));
    return finish();
}

static JSValue cursorExecute(JSGlobalObject* globalObject, JSValue self, JSValue sql, JSValue parameters)
{
    if (!checkIsStr(globalObject, "execute"_s, "argument 1"_s, sql))
        return {};
    return executeQuery(globalObject, asRecord(self), false, sql, parameters);
}

static JSValue cursorExecuteMany(JSGlobalObject* globalObject, JSValue self, JSValue sql, JSValue parameters)
{
    if (!checkIsStr(globalObject, "executemany"_s, "argument 1"_s, sql))
        return {};
    return executeQuery(globalObject, asRecord(self), true, sql, parameters);
}

static JSValue cursorExecuteScript(JSGlobalObject* globalObject, JSValue selfValue, JSValue script)
{
    Vector<uint8_t> text;
    if (!textArgument(globalObject, "executescript"_s, "argument"_s, script, text))
        return {};
    PyRecord* self = asRecord(selfValue);
    if (!checkCursor(globalObject, self))
        return {};
    PyRecord* connectionRecord = asRecord(self->get(CursorConnection));
    Connection& connection = connectionOf(connectionRecord);
    DatabaseUse use(*connection.database);
    sqlite3* db = use.handle();
    // The statements may call them after one of them has closed the connection.
    EnsureStillAliveScope callables(connectionRecord->get(Callables));
    size_t length = text.size() - 1;
    if (length > static_cast<size_t>(sqlite3_limit(db, SQLITE_LIMIT_SQL_LENGTH, -1)))
        return raiseOf(globalObject, DataError(globalObject), "query string is too large"_s);

    auto fail = [&]() -> JSValue {
        return failFromDatabase(globalObject, db);
    };
    auto failIfClosed = [&] {
        if (connection.db())
            return false;
        takePendingException(globalObject);
        raiseClosedDatabase(globalObject);
        return true;
    };
    if (connection.autocommit == Autocommit::Legacy && !sqlite3_get_autocommit(db) && sqlite3_exec(db, "COMMIT", nullptr, nullptr, nullptr) != SQLITE_OK)
        return fail();
    if (failIfClosed())
        return {};
    const char* rest = cString(text);
    while (true) {
        sqlite3_stmt* statement;
        const char* tail;
        int rc = sqlite3_prepare_v2(db, rest, static_cast<int>(length) + 1, &statement, &tail);
        if (rc == SQLITE_OK) {
            do {
                rc = sqlite3_step(statement);
            } while (rc == SQLITE_ROW);
            rc = sqlite3_finalize(statement);
        }
        if (failIfClosed())
            return {};
        if (rc != SQLITE_OK) {
            takePendingException(globalObject);
            return fail();
        }
        if (getVM(globalObject).exceptionForInspection())
            return {};
        if (!*tail)
            break;
        length -= tail - rest;
        rest = tail;
    }
    return self;
}

// Empty, with no exception, when there are no more.
static JSValue nextRow(JSGlobalObject* globalObject, PyRecord* self)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!checkCursor(globalObject, self))
        return {};
    Cursor& cursor = cursorOf(self);
    if (!cursor.statement)
        return {};
    PyRecord* connectionRecord = asRecord(self->get(CursorConnection));
    Connection& connection = connectionOf(connectionRecord);
    // Those of the statement, which are not those of the connection if that has been opened anew since.
    RefPtr<Statement> statement = cursor.statement;
    DatabaseUse use(statement->database());
    sqlite3* db = sqlite3_db_handle(statement->handle());
    // The connection has been closed, which took the rows away, and opened again.
    if (!statement->handle()) {
        resetAndDropStatement(globalObject, self);
        return {};
    }

    // Locked until the statement has been stepped: the functions in it may come back to the cursor as well.
    cursor.isLocked = true;
    JSValue row = fetchOneRow(globalObject, self, connectionRecord, db);
    if (scope.exception()) [[unlikely]] {
        cursor.isLocked = false;
        return {};
    }
    if (!connection.db()) {
        cursor.isLocked = false;
        resetAndDropStatement(globalObject, self);
        RELEASE_AND_RETURN(scope, raiseClosedDatabase(globalObject));
    }
    int rc = sqlite3_step(statement->handle());
    cursor.isLocked = false;
    if (!connection.db()) {
        // The row that was there before is still the answer.
        takePendingException(globalObject);
        resetAndDropStatement(globalObject, self);
        if (rc != SQLITE_ROW && rc != SQLITE_DONE)
            RELEASE_AND_RETURN(scope, raiseClosedDatabase(globalObject));
    } else if (rc == SQLITE_DONE) {
        if (statement->isDML())
            cursor.rowCount = sqlite3_changes(db);
        if (resetAndDropStatement(globalObject, self) != SQLITE_OK)
            RELEASE_AND_RETURN(scope, raiseCannotReset(globalObject));
    } else if (rc != SQLITE_ROW) {
        takePendingException(globalObject);
        int raised = raiseFromDatabase(globalObject, db);
        if (resetAndDropStatement(globalObject, self) != SQLITE_OK && raised == SQLITE_OK)
            RELEASE_AND_RETURN(scope, raiseCannotReset(globalObject));
        return {};
    }
    RETURN_IF_EXCEPTION(scope, {});

    JSValue factory = self->get(CursorRowFactory);
    if (!isNone(factory))
        RELEASE_AND_RETURN(scope, call(globalObject, factory, self, row));
    return row;
}

static JSValue cursorIter(JSGlobalObject*, JSValue self) { return self; }

static JSValue cursorNext(JSGlobalObject* globalObject, JSValue self)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue row = nextRow(globalObject, asRecord(self));
    RETURN_IF_EXCEPTION(scope, {});
    if (!row)
        return raiseStopIteration(globalObject, scope);
    return row;
}

static JSValue cursorFetchOne(JSGlobalObject* globalObject, JSValue self)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue row = nextRow(globalObject, asRecord(self));
    RETURN_IF_EXCEPTION(scope, {});
    return row ? row : jsUndefined();
}

static JSValue fetchRows(JSGlobalObject* globalObject, PyRecord* self, uint64_t limit)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSArray* rows = newList(globalObject);
    for (; limit; --limit) {
        JSValue row = nextRow(globalObject, self);
        RETURN_IF_EXCEPTION(scope, {});
        if (!row)
            break;
        listAppend(globalObject, rows, row);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return rows;
}

// A parameter declared uint32, or what PyLong_AsUInt32() makes of a value: they word it differently.
static bool uint32Argument(JSGlobalObject* globalObject, JSValue value, uint32_t& result, bool isParameter = true)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue index = toIndex(globalObject, value);
    RETURN_IF_EXCEPTION(scope, false);
    if (intSign(index) < 0) {
        raiseValueError(globalObject, scope, "Cannot convert negative int"_s);
        return false;
    }
    auto converted = tryUInt64(index);
    if (!converted || *converted > std::numeric_limits<uint32_t>::max()) {
        raiseOverflowError(globalObject, scope, isParameter ? "Python int too large for C uint32_t"_s : "Python int too large to convert to C uint32_t"_s);
        return false;
    }
    result = static_cast<uint32_t>(*converted);
    return true;
}

static JSValue cursorFetchMany(JSGlobalObject* globalObject, JSValue self, JSValue size)
{
    uint32_t limit = cursorOf(asRecord(self)).arraySize;
    if (size && !uint32Argument(globalObject, size, limit))
        return {};
    return fetchRows(globalObject, asRecord(self), limit);
}

static JSValue cursorFetchAll(JSGlobalObject* globalObject, JSValue self) { return fetchRows(globalObject, asRecord(self), std::numeric_limits<uint64_t>::max()); }
static JSValue cursorSetInputSizes(JSGlobalObject*, JSValue, JSValue) { return jsUndefined(); }
static JSValue cursorSetOutputSize(JSGlobalObject*, JSValue, JSValue, JSValue) { return jsUndefined(); }

static JSValue cursorClose(JSGlobalObject* globalObject, JSValue selfValue)
{
    PyRecord* self = asRecord(selfValue);
    Cursor& cursor = cursorOf(self);
    if (!checkCursorIsNotLocked(globalObject, cursor))
        return {};
    if (!self->get(CursorConnection))
        return raiseOf(globalObject, ProgrammingError(globalObject), "Base Cursor.__init__ not called."_s);
    if (!checkConnection(globalObject, asRecord(self->get(CursorConnection))))
        return {};
    if (resetAndDropStatement(globalObject, self) != SQLITE_OK)
        return raiseCannotReset(globalObject);
    cursor.isClosed = true;
    return jsUndefined();
}

template<unsigned field>
static JSValue recordField(JSGlobalObject*, JSValue self)
{
    JSValue value = asRecord(self)->get(field);
    return value ? value : jsUndefined();
}

static JSValue cursorRowCount(JSGlobalObject* globalObject, JSValue self) { return makeInt(globalObject, cursorOf(asRecord(self)).rowCount); }
static JSValue cursorArraySize(JSGlobalObject*, JSValue self) { return jsNumber(cursorOf(asRecord(self)).arraySize); }

static void cursorSetArraySize(JSGlobalObject* globalObject, JSValue self, JSValue value)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    if (!value) {
        raise(globalObject, scope, runtime(globalObject).AttributeError(), makeString("attribute 'arraysize' of '"_s, typeName(globalObject, self), "' objects cannot be deleted"_s));
        return;
    }
    scope.release();
    uint32Argument(globalObject, value, cursorOf(asRecord(self)).arraySize, false);
}

static void cursorSetRowFactory(JSGlobalObject* globalObject, JSValue self, JSValue value)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    if (!value) {
        raise(globalObject, scope, runtime(globalObject).AttributeError(), "cannot delete row_factory attribute"_s);
        return;
    }
    asRecord(self)->set(getVM(globalObject), CursorRowFactory, value);
}

static constexpr NativeDef cursorMethods[] = {
    PY_NEW(cursorNew, "($type, *args, **kwargs)"),
    PY_SLOT("__init__", cursorInit, "($self, /, *args, **kwargs)"),
    PY_SLOT("__iter__", cursorIter, "($self, /)"),
    PY_SLOT("__next__", cursorNext, "($self, /)"),
    PY_METHOD("close", cursorClose, "($self, /)"),
    PY_METHOD("executemany", cursorExecuteMany, "($self, sql, seq_of_parameters, /)"),
    PY_METHOD("executescript", cursorExecuteScript, "($self, sql_script, /)"),
    PY_METHOD("execute", cursorExecute, "($self, sql, parameters=(), /)"),
    PY_METHOD("fetchall", cursorFetchAll, "($self, /)"),
    PY_METHOD("fetchmany", cursorFetchMany, "($self, /, size=1)"),
    PY_METHOD("fetchone", cursorFetchOne, "($self, /)"),
    PY_METHOD("setinputsizes", cursorSetInputSizes, "($self, sizes, /)"),
    PY_METHOD("setoutputsize", cursorSetOutputSize, "($self, size, column=None, /)"),
};

static constexpr NativeGetSet cursorGetSets[] = {
    PY_MEMBER("connection", recordField<CursorConnection>),
    PY_MEMBER("description", recordField<Description>),
    PY_MEMBER("lastrowid", recordField<LastRowID>),
    PY_MEMBER("rowcount", cursorRowCount),
    { "arraysize"_s, cursorArraySize, cursorSetArraySize },
    { "row_factory"_s, recordField<CursorRowFactory>, cursorSetRowFactory },
};

static constexpr TypeDef cursorTypeDef { "sqlite3.Cursor"_s, { TypeFlag::Base, TypeFlag::OwnLayout, TypeFlag::Immutable, TypeFlag::HasWeakref }, cursorMethods, cursorGetSets, "SQLite database cursor class."_s };

static PyType* cursorType(JSGlobalObject* globalObject) { return runtime(globalObject).typeFor(cursorTypeDef); }

// ---- Connection: cursors ----

static JSValue makeCursor(JSGlobalObject* globalObject, PyRecord* self, JSValue factory)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!checkConnection(globalObject, self))
        return {};
    JSValue cursor = call(globalObject, factory ? factory : JSValue(cursorType(globalObject)), self);
    RETURN_IF_EXCEPTION(scope, {});
    PyRecord* record = PyRecord::tryFrom(cursor, cursorType(globalObject));
    if (!record)
        return raiseTypeError(globalObject, scope, "factory must return a cursor, not "_s, typeName(globalObject, cursor));
    if (!isNone(self->get(RowFactory)))
        record->set(vm, CursorRowFactory, self->get(RowFactory));
    return cursor;
}

static JSValue connectionCursor(JSGlobalObject* globalObject, JSValue self, JSValue factory) { return makeCursor(globalObject, asRecord(self), factory); }

static JSValue connectionExecute(JSGlobalObject* globalObject, JSValue self, JSValue sql, JSValue parameters)
{
    if (!checkIsStr(globalObject, "execute"_s, "argument 1"_s, sql))
        return {};
    JSValue cursor = makeCursor(globalObject, asRecord(self), {});
    if (!cursor)
        return {};
    return executeQuery(globalObject, asRecord(cursor), false, sql, parameters);
}

static JSValue connectionExecuteMany(JSGlobalObject* globalObject, JSValue self, JSValue sql, JSValue parameters)
{
    if (!checkIsStr(globalObject, "executemany"_s, "argument 1"_s, sql))
        return {};
    JSValue cursor = makeCursor(globalObject, asRecord(self), {});
    if (!cursor)
        return {};
    return executeQuery(globalObject, asRecord(cursor), true, sql, parameters);
}

static JSValue connectionExecuteScript(JSGlobalObject* globalObject, JSValue self, JSValue script)
{
    JSValue cursor = makeCursor(globalObject, asRecord(self), {});
    if (!cursor)
        return {};
    if (!callMethod(globalObject, cursor, internString(getVM(globalObject), "executescript"_s), script))
        return {};
    return cursor;
}

// ---- Connection: the rest ----

static JSValue connectionInterrupt(JSGlobalObject* globalObject, JSValue self)
{
    if (!checkConnectionIsOpen(globalObject, asRecord(self)))
        return {};
    sqlite3_interrupt(connectionOf(asRecord(self)).db());
    return jsUndefined();
}

static JSValue connectionIterDump(JSGlobalObject* globalObject, JSValue self, JSValue filter)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!checkConnection(globalObject, asRecord(self)))
        return {};
    JSValue module = importModule(globalObject, "sqlite3.dump"_s);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue function = getAttr(globalObject, module, internString(vm, "_iterdump"_s));
    RETURN_IF_EXCEPTION(scope, {});
    PyDict* keywords = PyDict::create(globalObject);
    keywords->set(vm, internString(vm, "filter"_s), filter ? filter : jsUndefined());
    RELEASE_AND_RETURN(scope, callWithTupleAndDict(globalObject, function, PyTuple::create(globalObject, { self }), keywords));
}

static JSValue connectionBackup(JSGlobalObject* globalObject, JSValue selfValue, JSValue targetValue, JSValue pagesValue, JSValue progress, JSValue nameValue, JSValue sleepValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    PyRecord* target = PyRecord::tryFrom(targetValue, connectionType(globalObject));
    if (!target)
        return raiseTypeError(globalObject, scope, "backup() argument 'target' must be sqlite3.Connection, not "_s, typeNameOfArgument(globalObject, targetValue));
    int pages;
    if (!intArgument(globalObject, pagesValue, -1, pages))
        return {};
    Vector<uint8_t> name { 'm', 'a', 'i', 'n', 0 };
    if (nameValue && !textArgument(globalObject, "backup"_s, "argument 'name'"_s, nameValue, name))
        return {};
    double sleep = 0.25;
    if (sleepValue) {
        sleep = toDouble(globalObject, sleepValue);
        RETURN_IF_EXCEPTION(scope, {});
    }
    PyRecord* self = asRecord(selfValue);
    if (!checkConnection(globalObject, self) || !checkConnection(globalObject, target))
        return {};
    if (target == self)
        return raiseValueError(globalObject, scope, "target cannot be the same connection instance"_s);
    bool reportsProgress = progress && !isNone(progress);
    if (reportsProgress && !isCallable(globalObject, progress))
        return raiseTypeError(globalObject, scope, "progress argument must be a callable"_s);
    if (!pages)
        pages = -1;

    DatabaseUse source(*connectionOf(self).database);
    DatabaseUse destination(*connectionOf(target).database);
    sqlite3_backup* backup = sqlite3_backup_init(destination.handle(), "main", source.handle(), cString(name));
    if (!backup)
        return failFromDatabase(globalObject, destination.handle());
    OffLimits offLimits(destination.database(), "The target of a backup cannot be used while the backup is under way."_s);
    ++source.database().backupsUnderWay;
    auto countDown = makeScopeExit([&] { --source.database().backupsUnderWay; });
    int rc;
    do {
        rc = sqlite3_backup_step(backup, pages);
        if (reportsProgress) {
            call(globalObject, progress, jsNumber(rc), jsNumber(sqlite3_backup_remaining(backup)), jsNumber(sqlite3_backup_pagecount(backup)));
            if (scope.exception()) {
                sqlite3_backup_finish(backup);
                return {};
            }
            if (source.isClosed() || destination.isClosed()) {
                sqlite3_backup_finish(backup);
                RELEASE_AND_RETURN(scope, raiseClosedDatabase(globalObject));
            }
        }
        if (rc == SQLITE_BUSY || rc == SQLITE_LOCKED)
            sqlite3_sleep(static_cast<int>(sleep * 1000.0));
    } while (rc == SQLITE_OK || rc == SQLITE_BUSY || rc == SQLITE_LOCKED);
    if (sqlite3_backup_finish(backup) != SQLITE_OK)
        return failFromDatabase(globalObject, destination.handle());
    return jsUndefined();
}

static JSValue connectionSerialize(JSGlobalObject* globalObject, JSValue self, JSValue nameValue)
{
    Vector<uint8_t> name { 'm', 'a', 'i', 'n', 0 };
    if (nameValue && !textArgument(globalObject, "serialize"_s, "argument 'name'"_s, nameValue, name))
        return {};
    if (!checkConnection(globalObject, asRecord(self)))
        return {};
    // SQLite runs a statement of its own for this, and with it the callbacks.
    DatabaseUse use(*connectionOf(asRecord(self)).database);
    sqlite3* db = use.handle();
    // If SQLite has the database in one piece of memory, there is no need for it to make a copy.
    sqlite3_int64 size;
    bool isCopy = false;
    unsigned char* data = sqlite3_serialize(db, cString(name), &size, SQLITE_SERIALIZE_NOCOPY);
    if (!data) {
        isCopy = true;
        data = sqlite3_serialize(db, cString(name), &size, 0);
    }
    if (use.isClosed()) {
        if (isCopy)
            sqlite3_free(data);
        return raiseClosedDatabase(globalObject);
    }
    if (!data)
        return raiseOf(globalObject, OperationalError(globalObject), makeString("unable to serialize '"_s, String::fromUTF8(cString(name)), '\''));
    JSValue result = bytesFrom(globalObject, { data, static_cast<size_t>(size) });
    if (isCopy)
        sqlite3_free(data);
    return result;
}

static JSValue connectionDeserialize(JSGlobalObject* globalObject, JSValue self, JSValue data, JSValue nameValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Vector<uint8_t> text;
    BufferHolder holder(globalObject);
    std::span<const uint8_t> bytes;
    if (isStr(data)) {
        if (!encodeUTF8(globalObject, data, text))
            return {};
        bytes = text.span();
    } else {
        if (!holder.get(data))
            return {};
        bytes = holder.buffer.span();
    }
    Vector<uint8_t> name { 'm', 'a', 'i', 'n', 0 };
    if (nameValue && !textArgument(globalObject, "deserialize"_s, "argument 'name'"_s, nameValue, name))
        return {};
    if (!checkConnection(globalObject, asRecord(self)))
        return {};
    // SQLite runs a statement of its own for this, and with it the callbacks.
    DatabaseUse use(*connectionOf(asRecord(self)).database);
    sqlite3* db = use.handle();
    // SQLite has not always looked, and then takes the database away from the statements that are reading it, or from the backup.
    if (sqlite3_txn_state(db, cString(name)) > SQLITE_TXN_NONE || use.database().backupsUnderWay)
        return raiseFromCode(globalObject, SQLITE_BUSY);
    // SQLite takes the memory over, so it has to be of its own making.
    auto* copy = static_cast<unsigned char*>(sqlite3_malloc64(bytes.size()));
    if (!copy)
        return raiseMemoryError(globalObject, scope, String());
    memcpy(copy, bytes.data(), bytes.size());
    if (sqlite3_deserialize(db, cString(name), copy, bytes.size(), bytes.size(), SQLITE_DESERIALIZE_FREEONCLOSE | SQLITE_DESERIALIZE_RESIZEABLE) != SQLITE_OK)
        return failFromDatabase(globalObject, db);
    if (use.isClosed())
        return raiseClosedDatabase(globalObject);
    return jsUndefined();
}

static JSValue setLimit(JSGlobalObject* globalObject, JSValue self, JSValue categoryValue, JSValue limitValue)
{
    int category, limit;
    if (!intArgument(globalObject, categoryValue, 0, category) || !intArgument(globalObject, limitValue, -1, limit))
        return {};
    if (!checkConnection(globalObject, asRecord(self)))
        return {};
    int old = sqlite3_limit(connectionOf(asRecord(self)).db(), category, limit);
    if (old < 0)
        return raiseOf(globalObject, ProgrammingError(globalObject), "'category' is out of bounds"_s);
    return jsNumber(old);
}

static JSValue connectionSetLimit(JSGlobalObject* globalObject, JSValue self, JSValue category, JSValue limit) { return setLimit(globalObject, self, category, limit); }
static JSValue connectionGetLimit(JSGlobalObject* globalObject, JSValue self, JSValue category) { return setLimit(globalObject, self, category, {}); }

static bool isBooleanConfiguration(int option)
{
    switch (option) {
    case SQLITE_DBCONFIG_ENABLE_FKEY:
    case SQLITE_DBCONFIG_ENABLE_TRIGGER:
    case SQLITE_DBCONFIG_ENABLE_FTS3_TOKENIZER:
    case SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION:
    case SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE:
    case SQLITE_DBCONFIG_ENABLE_QPSG:
    case SQLITE_DBCONFIG_TRIGGER_EQP:
    case SQLITE_DBCONFIG_RESET_DATABASE:
    case SQLITE_DBCONFIG_DEFENSIVE:
    case SQLITE_DBCONFIG_WRITABLE_SCHEMA:
    case SQLITE_DBCONFIG_DQS_DDL:
    case SQLITE_DBCONFIG_DQS_DML:
    case SQLITE_DBCONFIG_LEGACY_ALTER_TABLE:
    case SQLITE_DBCONFIG_ENABLE_VIEW:
    case SQLITE_DBCONFIG_LEGACY_FILE_FORMAT:
    case SQLITE_DBCONFIG_TRUSTED_SCHEMA:
        return true;
    default:
        return false;
    }
}

// `setting`: 0 or 1, or -1 only to ask. -1: an exception.
static int configure(JSGlobalObject* globalObject, JSValue self, int option, int setting)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    if (!checkConnection(globalObject, asRecord(self)))
        return -1;
    if (!isBooleanConfiguration(option)) {
        raiseValueError(globalObject, scope, "unknown config 'op': "_s, option);
        return -1;
    }
    sqlite3* db = connectionOf(asRecord(self)).db();
    int actual;
    if (sqlite3_db_config(db, option, setting, &actual) != SQLITE_OK) {
        failFromDatabase(globalObject, db);
        return -1;
    }
    return actual;
}

static JSValue connectionSetConfig(JSGlobalObject* globalObject, JSValue self, JSValue optionValue, JSValue enableValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    int option;
    if (!intArgument(globalObject, optionValue, 0, option))
        return {};
    bool enable = true;
    if (enableValue) {
        enable = isTrue(globalObject, enableValue);
        RETURN_IF_EXCEPTION(scope, {});
    }
    int actual = configure(globalObject, self, option, enable);
    RETURN_IF_EXCEPTION(scope, {});
    if (actual != static_cast<int>(enable))
        return raise(globalObject, scope, OperationalError(globalObject), "Unable to set config"_s);
    return jsUndefined();
}

static JSValue connectionGetConfig(JSGlobalObject* globalObject, JSValue self, JSValue optionValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    int option;
    if (!intArgument(globalObject, optionValue, 0, option))
        return {};
    int actual = configure(globalObject, self, option, -1);
    RETURN_IF_EXCEPTION(scope, {});
    return jsBoolean(actual);
}

static JSValue connectionIsolationLevel(JSGlobalObject* globalObject, JSValue self)
{
    if (!checkConnectionIsOpen(globalObject, asRecord(self)))
        return {};
    ASCIILiteral level = connectionOf(asRecord(self)).isolationLevel;
    return level.isNull() ? jsUndefined() : JSValue(makeStr(getVM(globalObject), level));
}

static void connectionSetIsolationLevel(JSGlobalObject* globalObject, JSValue self, JSValue value)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    if (!value) {
        raise(globalObject, scope, runtime(globalObject).AttributeError(), "cannot delete attribute"_s);
        return;
    }
    scope.release();
    Connection& connection = connectionOf(asRecord(self));
    if (isNone(value)) {
        connection.isolationLevel = {};
        commit(globalObject, asRecord(self));
        return;
    }
    isolationLevelArgument(globalObject, value, connection.isolationLevel);
}

static JSValue connectionTotalChanges(JSGlobalObject* globalObject, JSValue self)
{
    if (!checkConnectionIsOpen(globalObject, asRecord(self)))
        return {};
    return jsNumber(sqlite3_total_changes(connectionOf(asRecord(self)).db()));
}

static JSValue connectionInTransaction(JSGlobalObject* globalObject, JSValue self)
{
    if (!checkConnectionIsOpen(globalObject, asRecord(self)))
        return {};
    return jsBoolean(!sqlite3_get_autocommit(connectionOf(asRecord(self)).db()));
}

static JSValue connectionAutocommit(JSGlobalObject* globalObject, JSValue self)
{
    if (!checkConnectionIsOpen(globalObject, asRecord(self)))
        return {};
    Autocommit mode = connectionOf(asRecord(self)).autocommit;
    return mode == Autocommit::Legacy ? jsNumber(legacyTransactionControl) : jsBoolean(mode == Autocommit::Enabled);
}

static void connectionSetAutocommit(JSGlobalObject* globalObject, JSValue self, JSValue value)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    if (!value) {
        raise(globalObject, scope, runtime(globalObject).AttributeError(), "cannot delete autocommit attribute"_s);
        return;
    }
    scope.release();
    if (!checkConnection(globalObject, asRecord(self)))
        return;
    Connection& connection = connectionOf(asRecord(self));
    if (!autocommitArgument(globalObject, value, connection.autocommit))
        return;
    bool isInTransaction = !sqlite3_get_autocommit(connection.db());
    if (connection.autocommit == Autocommit::Enabled && isInTransaction)
        executeSimply(globalObject, connection, "COMMIT");
    else if (connection.autocommit == Autocommit::Disabled && !isInTransaction)
        executeSimply(globalObject, connection, "BEGIN");
}

static JSValue connectionTextSignature(JSGlobalObject* globalObject, JSValue) { return makeStr(getVM(globalObject), "(sql, /)"_s); }

template<unsigned field>
static void connectionSetFactory(JSGlobalObject* globalObject, JSValue self, JSValue value)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    if (!value) {
        raise(globalObject, scope, runtime(globalObject).AttributeError(), field == RowFactory ? "cannot delete row_factory attribute"_s : "cannot delete text_factory attribute"_s);
        return;
    }
    asRecord(self)->set(getVM(globalObject), field, value);
}

// The exceptions are attributes of a connection, once it is open, as the DB-API suggests.
template<PyType* (*type)(JSGlobalObject*)>
static JSValue connectionException(JSGlobalObject* globalObject, JSValue self)
{
    return connectionOf(asRecord(self)).isInitialized ? JSValue(type(globalObject)) : jsUndefined();
}

// ---- Blob ----

struct Blob {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(Blob);
    Blob(Ref<Database>&& database, sqlite3_blob* handle)
        : database(WTF::move(database))
        , handle(handle)
    {
        this->database->openBlobs.append(this);
    }

    ~Blob() { close(); }

    void close()
    {
        if (!handle)
            return;
        sqlite3_blob_close(std::exchange(handle, nullptr));
        database->openBlobs.removeFirst(this);
    }

    Ref<Database> database;
    sqlite3_blob* handle;
    int offset { 0 };
};

WTF_MAKE_STRUCT_TZONE_ALLOCATED_IMPL(Blob);

enum BlobField : unsigned { BlobConnection,
    BlobFieldCount };

void Database::close(Statements statementsToo)
{
    if (m_isClosed)
        return;
    m_isClosed = true;
    m_statementsAtClose = statementsToo;
    while (!openBlobs.isEmpty())
        openBlobs.last()->close();
    // The Connection no longer keeps them alive.
    trace = progress = authorizer = {};
    if (!m_useCount)
        closeForSQLite();
}

void Database::closeForSQLite()
{
    if (!m_handle)
        return;
    if (m_statementsAtClose == Statements::AreFinalized) {
        // This may run finalize() of an aggregate, and that anything: it must find neither the set being gone through nor,
        // through a DatabaseUse of its own, its way back here.
        ++m_useCount;
        for (auto& statement : WTF::map(statements, [](Statement* statement) { return Ref { *statement }; }))
            statement->finalize();
        --m_useCount;
    }
    // Statements that are left go on running.
    didChange({ Hook::Trace, Hook::Progress, Hook::Authorizer });
    sqlite3_close_v2(std::exchange(m_handle, nullptr));
}

static Blob& blobOf(JSValue self) { return *stateOf<Blob>(self); }

static bool checkBlob(JSGlobalObject* globalObject, JSValue self)
{
    if (!checkConnection(globalObject, asRecord(asRecord(self)->get(BlobConnection))))
        return false;
    if (blobOf(self).handle)
        return true;
    raiseOf(globalObject, ProgrammingError(globalObject), "Cannot operate on a closed blob."_s);
    return false;
}

static JSValue blobClose(JSGlobalObject* globalObject, JSValue self)
{
    if (!checkConnection(globalObject, asRecord(asRecord(self)->get(BlobConnection))))
        return {};
    blobOf(self).close();
    return jsUndefined();
}

static JSValue readFromBlob(JSGlobalObject* globalObject, Blob& blob, int64_t length, int64_t offset)
{
    PyBytes* result = newBytes(globalObject, length);
    if (!result)
        return {};
    int rc = sqlite3_blob_read(blob.handle, result->mutableData(), static_cast<int>(length), static_cast<int>(offset));
    if (rc != SQLITE_OK)
        return raiseFromCode(globalObject, rc);
    return result;
}

static bool writeToBlob(JSGlobalObject* globalObject, Blob& blob, std::span<const uint8_t> data, int64_t offset)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    if (static_cast<int64_t>(data.size()) > sqlite3_blob_bytes(blob.handle) - offset) {
        raiseValueError(globalObject, scope, "data longer than blob length"_s);
        return false;
    }
    int rc = sqlite3_blob_write(blob.handle, data.data(), static_cast<int>(data.size()), static_cast<int>(offset));
    if (rc != SQLITE_OK) {
        scope.release();
        raiseFromCode(globalObject, rc);
        return false;
    }
    return true;
}

static JSValue blobRead(JSGlobalObject* globalObject, JSValue self, JSValue lengthValue)
{
    int length;
    if (!intArgument(globalObject, lengthValue, -1, length) || !checkBlob(globalObject, self))
        return {};
    Blob& blob = blobOf(self);
    int available = sqlite3_blob_bytes(blob.handle) - blob.offset;
    if (length < 0 || length > available)
        length = available;
    if (!length)
        return runtime(globalObject).emptyBytes();
    JSValue result = readFromBlob(globalObject, blob, length, blob.offset);
    if (result)
        blob.offset += length;
    return result;
}

static JSValue blobWrite(JSGlobalObject* globalObject, JSValue self, JSValue data)
{
    BufferHolder holder(globalObject);
    if (!holder.get(data) || !checkBlob(globalObject, self))
        return {};
    Blob& blob = blobOf(self);
    if (!writeToBlob(globalObject, blob, holder.buffer.span(), blob.offset))
        return {};
    blob.offset += static_cast<int>(holder.buffer.length);
    return jsUndefined();
}

static JSValue blobSeek(JSGlobalObject* globalObject, JSValue self, JSValue offsetValue, JSValue originValue)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    int offset, origin;
    if (!intArgument(globalObject, offsetValue, 0, offset) || !intArgument(globalObject, originValue, 0, origin) || !checkBlob(globalObject, self))
        return {};
    Blob& blob = blobOf(self);
    int length = sqlite3_blob_bytes(blob.handle);
    int base;
    switch (origin) {
    case SEEK_SET:
        base = 0;
        break;
    case SEEK_CUR:
        base = blob.offset;
        break;
    case SEEK_END:
        base = length;
        break;
    default:
        return raiseValueError(globalObject, scope, "'origin' should be os.SEEK_SET, os.SEEK_CUR, or os.SEEK_END"_s);
    }
    if (offset > std::numeric_limits<int>::max() - base)
        return raiseOverflowError(globalObject, scope, "seek offset results in overflow"_s);
    offset += base;
    if (offset < 0 || offset > length)
        return raiseValueError(globalObject, scope, "offset out of blob range"_s);
    blob.offset = offset;
    return jsUndefined();
}

static JSValue blobTell(JSGlobalObject* globalObject, JSValue self) { return checkBlob(globalObject, self) ? jsNumber(blobOf(self).offset) : JSValue(); }
static JSValue blobEnter(JSGlobalObject* globalObject, JSValue self) { return checkBlob(globalObject, self) ? self : JSValue(); }

static JSValue blobExit(JSGlobalObject* globalObject, JSValue self, JSValue, JSValue, JSValue)
{
    if (!checkBlob(globalObject, self))
        return {};
    blobOf(self).close();
    return jsBoolean(false);
}

static JSValue blobLength(JSGlobalObject* globalObject, JSValue self) { return checkBlob(globalObject, self) ? jsNumber(sqlite3_blob_bytes(blobOf(self).handle)) : JSValue(); }

// -1: an exception.
static int64_t blobIndex(JSGlobalObject* globalObject, Blob& blob, JSValue item)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    int64_t index = toSsize(globalObject, item, runtime(globalObject).IndexError());
    RETURN_IF_EXCEPTION(scope, -1);
    int length = sqlite3_blob_bytes(blob.handle);
    if (index < 0)
        index += length;
    if (index < 0 || index >= length) {
        raiseIndexError(globalObject, scope, "Blob index out of range"_s);
        return -1;
    }
    return index;
}

static JSValue blobGetItem(JSGlobalObject* globalObject, JSValue self, JSValue item)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!checkBlob(globalObject, self))
        return {};
    Blob& blob = blobOf(self);
    if (hasIndex(globalObject, item)) {
        int64_t index = blobIndex(globalObject, blob, item);
        RETURN_IF_EXCEPTION(scope, {});
        uint8_t byte = 0;
        int rc = sqlite3_blob_read(blob.handle, &byte, 1, static_cast<int>(index));
        if (rc != SQLITE_OK)
            RELEASE_AND_RETURN(scope, raiseFromCode(globalObject, rc));
        return jsNumber(byte);
    }
    auto* slice = PySlice::tryFrom(item);
    if (!slice)
        return raiseTypeError(globalObject, scope, "Blob indices must be integers"_s);
    PySlice::Indices indices;
    if (!slice->unpack(globalObject, indices))
        return {};
    PySlice::adjust(sqlite3_blob_bytes(blob.handle), indices);
    if (!indices.length)
        return runtime(globalObject).emptyBytes();
    if (indices.step < 0)
        return raiseValueError(globalObject, scope, "Blob doesn't support slices with a negative step"_s);
    if (indices.step == 1)
        RELEASE_AND_RETURN(scope, readFromBlob(globalObject, blob, indices.length, indices.start));
    JSValue whole = readFromBlob(globalObject, blob, indices.stop - indices.start, indices.start);
    RETURN_IF_EXCEPTION(scope, {});
    PyBytes* result = newBytes(globalObject, indices.length);
    RETURN_IF_EXCEPTION(scope, {});
    for (int64_t i = 0, j = 0; i < indices.length; ++i, j += indices.step)
        result->mutableData()[i] = PyBytes::from(whole)->data()[j];
    return result;
}

// An empty value deletes.
static JSValue blobAssign(JSGlobalObject* globalObject, JSValue self, JSValue item, JSValue value)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!checkBlob(globalObject, self))
        return {};
    Blob& blob = blobOf(self);
    if (hasIndex(globalObject, item)) {
        if (!value)
            return raiseTypeError(globalObject, scope, "Blob doesn't support item deletion"_s);
        if (!isInt(value))
            return raiseTypeError(globalObject, scope, '\'', typeName(globalObject, value), "' object cannot be interpreted as an integer"_s);
        int64_t index = blobIndex(globalObject, blob, item);
        RETURN_IF_EXCEPTION(scope, {});
        auto wide = tryInt64(intValue(value));
        if (!wide || *wide < 0 || *wide > 255)
            return raiseValueError(globalObject, scope, "byte must be in range(0, 256)"_s);
        uint8_t byte = static_cast<uint8_t>(*wide);
        RELEASE_AND_RETURN(scope, writeToBlob(globalObject, blob, { &byte, 1 }, index) ? jsUndefined() : JSValue());
    }
    auto* slice = PySlice::tryFrom(item);
    if (!slice)
        return raiseTypeError(globalObject, scope, "Blob indices must be integers"_s);
    if (!value)
        return raiseTypeError(globalObject, scope, "Blob doesn't support slice deletion"_s);
    PySlice::Indices indices;
    if (!slice->unpack(globalObject, indices))
        return {};
    PySlice::adjust(sqlite3_blob_bytes(blob.handle), indices);
    BufferHolder holder(globalObject);
    if (!holder.get(value))
        return {};
    if (holder.buffer.length != indices.length)
        return raiseIndexError(globalObject, scope, "Blob slice assignment is wrong size"_s);
    if (!indices.length)
        return jsUndefined();
    if (indices.step < 0)
        return raiseValueError(globalObject, scope, "Blob doesn't support slices with a negative step"_s);
    if (indices.step == 1)
        RELEASE_AND_RETURN(scope, writeToBlob(globalObject, blob, holder.buffer.span(), indices.start) ? jsUndefined() : JSValue());
    // The stretch the slice is spread over is read, changed and written back.
    Vector<uint8_t> stretch;
    if (!stretch.tryGrow(indices.stop - indices.start))
        return raiseMemoryError(globalObject, scope, String());
    int rc = sqlite3_blob_read(blob.handle, stretch.mutableSpan().data(), static_cast<int>(stretch.size()), static_cast<int>(indices.start));
    if (rc != SQLITE_OK)
        RELEASE_AND_RETURN(scope, raiseFromCode(globalObject, rc));
    for (int64_t i = 0, j = 0; i < indices.length; ++i, j += indices.step)
        stretch[j] = holder.buffer.span()[i];
    RELEASE_AND_RETURN(scope, writeToBlob(globalObject, blob, stretch.span(), indices.start) ? jsUndefined() : JSValue());
}

static JSValue blobSetItem(JSGlobalObject* globalObject, JSValue self, JSValue item, JSValue value) { return blobAssign(globalObject, self, item, value); }
static JSValue blobDelItem(JSGlobalObject* globalObject, JSValue self, JSValue item) { return blobAssign(globalObject, self, item, {}); }

static constexpr NativeDef blobMethods[] = {
    PY_SLOT("__len__", blobLength, "($self, /)"),
    PY_SLOT("__getitem__", blobGetItem, "($self, key, /)"),
    PY_SLOT("__setitem__", blobSetItem, "($self, key, value, /)"),
    PY_SLOT("__delitem__", blobDelItem, "($self, key, /)"),
    PY_METHOD("close", blobClose, "($self, /)"),
    PY_METHOD("__enter__", blobEnter, "($self, /)"),
    PY_METHOD("__exit__", blobExit, "($self, type, val, tb, /)"),
    PY_METHOD("read", blobRead, "($self, length=-1, /)"),
    PY_METHOD("seek", blobSeek, "($self, offset, origin=0, /)"),
    PY_METHOD("tell", blobTell, "($self, /)"),
    PY_METHOD("write", blobWrite, "($self, data, /)"),
};

static constexpr TypeDef blobTypeDef { "sqlite3.Blob"_s, { TypeFlag::Immutable, TypeFlag::DisallowInstantiation, TypeFlag::HasWeakref }, blobMethods, {}, {} };

static JSValue connectionBlobOpen(JSGlobalObject* globalObject, JSValue selfValue, JSValue tableValue, JSValue columnValue, JSValue rowValue, JSValue readOnlyValue, JSValue nameValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Vector<uint8_t> table, column;
    Vector<uint8_t> name { 'm', 'a', 'i', 'n', 0 };
    if (!textArgument(globalObject, "blobopen"_s, "argument 1"_s, tableValue, table) || !textArgument(globalObject, "blobopen"_s, "argument 2"_s, columnValue, column))
        return {};
    if (!isInt(rowValue))
        return raiseTypeError(globalObject, scope, "expected 'int'"_s);
    int64_t row;
    if (!int64ForSQLite(globalObject, rowValue, row))
        return {};
    bool isReadOnly = false;
    if (readOnlyValue) {
        isReadOnly = isTrue(globalObject, readOnlyValue);
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (nameValue && !textArgument(globalObject, "blobopen"_s, "argument 'name'"_s, nameValue, name))
        return {};
    PyRecord* self = asRecord(selfValue);
    if (!checkConnection(globalObject, self))
        return {};
    // SQLite runs a statement of its own for this, and with it the progress handler.
    DatabaseUse use(*connectionOf(self).database);
    sqlite3_blob* handle;
    int rc = sqlite3_blob_open(use.handle(), cString(name), cString(table), cString(column), row, !isReadOnly, &handle);
    if (rc == SQLITE_MISUSE)
        RELEASE_AND_RETURN(scope, raiseFromCode(globalObject, rc));
    if (rc != SQLITE_OK)
        return failFromDatabase(globalObject, use.handle());
    if (use.isClosed()) {
        sqlite3_blob_close(handle);
        RELEASE_AND_RETURN(scope, raiseClosedDatabase(globalObject));
    }
    PyRecord* blob = createRecordWithState(globalObject, runtime(globalObject).typeFor(blobTypeDef), BlobFieldCount, makeUnique<Blob>(Ref { use.database() }, handle));
    blob->set(vm, BlobConnection, self);
    return blob;
}

// ---- Connection: the type ----

static constexpr NativeDef connectionMethods[] = {
    PY_NEW(connectionNew, "($type, *args, **kwargs)"),
    PY_SLOT("__call__", connectionCall, "($self, /, *args, **kwargs)"),
    PY_SLOT("__init__", connectionInit, "($self, /, *args, **kwargs)"),
    PY_SLOT("__del__", connectionDel, "($self, /)"),
    PY_METHOD("backup", connectionBackup, "($self, /, target, *, pages=-1, progress=None, name='main', sleep=0.25)"),
    PY_METHOD("close", connectionClose, "($self, /)"),
    PY_METHOD("commit", connectionCommit, "($self, /)"),
    PY_METHOD("create_aggregate", connectionCreateAggregate, "($self, *args, **kwargs)"),
    PY_METHOD("create_collation", connectionCreateCollation, "($self, *args, **kwargs)"),
    PY_METHOD("create_function", connectionCreateFunction, "($self, *args, **kwargs)"),
    PY_METHOD("cursor", connectionCursor, "($self, /, factory=<unrepresentable>)"),
    PY_METHOD("__enter__", connectionEnter, "($self, /)"),
    PY_METHOD("executemany", connectionExecuteMany, "($self, sql, parameters, /)"),
    PY_METHOD("executescript", connectionExecuteScript, "($self, sql_script, /)"),
    PY_METHOD("execute", connectionExecute, "($self, sql, parameters=(), /)"),
    PY_METHOD("__exit__", connectionExit, "($self, type, value, traceback, /)"),
    PY_METHOD("interrupt", connectionInterrupt, "($self, /)"),
    PY_METHOD("iterdump", connectionIterDump, "($self, /, *, filter=None)"),
    PY_METHOD("rollback", connectionRollback, "($self, /)"),
    PY_METHOD("set_authorizer", connectionSetAuthorizer, "($self, *args, **kwargs)"),
    PY_METHOD("set_progress_handler", connectionSetProgressHandler, "($self, *args, **kwargs)"),
    PY_METHOD("set_trace_callback", connectionSetTraceCallback, "($self, *args, **kwargs)"),
    PY_METHOD("setlimit", connectionSetLimit, "($self, category, limit, /)"),
    PY_METHOD("getlimit", connectionGetLimit, "($self, category, /)"),
    PY_METHOD("serialize", connectionSerialize, "($self, /, *, name='main')"),
    PY_METHOD("deserialize", connectionDeserialize, "($self, data, /, *, name='main')"),
    PY_METHOD("create_window_function", connectionCreateWindowFunction, "($self, *args, **kwargs)"),
    PY_METHOD("blobopen", connectionBlobOpen, "($self, table, column, rowid, /, *, readonly=False, name='main')"),
    PY_METHOD("setconfig", connectionSetConfig, "($self, op, enable=True, /)"),
    PY_METHOD("getconfig", connectionGetConfig, "($self, op, /)"),
};

static constexpr NativeGetSet connectionGetSets[] = {
#define EXCEPTION_MEMBER(name, base) PY_MEMBER(#name, connectionException<name>),
    FOR_EACH_SQLITE_EXCEPTION(EXCEPTION_MEMBER)
#undef EXCEPTION_MEMBER
    { "isolation_level"_s, connectionIsolationLevel, connectionSetIsolationLevel },
    { "total_changes"_s, connectionTotalChanges },
    { "in_transaction"_s, connectionInTransaction },
    { "autocommit"_s, connectionAutocommit, connectionSetAutocommit },
    { "__text_signature__"_s, connectionTextSignature },
    { "row_factory"_s, recordField<RowFactory>, connectionSetFactory<RowFactory> },
    { "text_factory"_s, recordField<TextFactory>, connectionSetFactory<TextFactory> },
};

static constexpr TypeDef connectionTypeDef { "sqlite3.Connection"_s, { TypeFlag::Base, TypeFlag::OwnLayout, TypeFlag::Immutable }, connectionMethods, connectionGetSets, "SQLite database connection object."_s };

static PyType* connectionType(JSGlobalObject* globalObject) { return runtime(globalObject).typeFor(connectionTypeDef); }

// ---- Row ----

enum RowField : unsigned { RowData,
    RowDescription,
    RowFieldCount };

static PyType* rowType(JSGlobalObject*);

static JSValue rowNew(JSGlobalObject* globalObject, JSValue cls, const CallArgs& args)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    PyType* type = PyType::from(cls);
    if (args.hasKeywords() && type == rowType(globalObject))
        return raiseTypeError(globalObject, scope, "Row() takes no keyword arguments"_s);
    if (!checkPositional(globalObject, "Row"_s, args, 2, 2))
        return {};
    PyRecord* cursor = PyRecord::tryFrom(args[0], cursorType(globalObject));
    if (!cursor)
        return raiseTypeError(globalObject, scope, "Row() argument 1 must be sqlite3.Cursor, not "_s, typeNameOfArgument(globalObject, args[0]));
    if (!PyTuple::is(args[1]))
        return raiseTypeError(globalObject, scope, "Row() argument 2 must be tuple, not "_s, typeNameOfArgument(globalObject, args[1]));
    PyRecord* self = PyRecord::create(globalObject, type, RowFieldCount);
    self->set(vm, RowData, args[1]);
    JSValue description = cursor->get(Description);
    self->set(vm, RowDescription, description ? description : jsUndefined());
    return self;
}

static PyTuple* rowData(JSValue self) { return PyTuple::from(asRecord(self)->get(RowData)); }

// Whether the two are equal, or are ASCII and differ only in case.
static bool equalIgnoringCase(JSGlobalObject* globalObject, JSValue left, JSValue right)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    bool isSame = isEqual(globalObject, left, right);
    RETURN_IF_EXCEPTION(scope, false);
    if (isSame)
        return true;
    if (!isStr(left) || !isStr(right))
        return false;
    String a = strValue(left)->value(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    String b = strValue(right)->value(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    return a.containsOnlyASCII() && b.containsOnlyASCII() && equalIgnoringASCIICase(a, b);
}

static JSValue rowGetItem(JSGlobalObject* globalObject, JSValue self, JSValue key)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    PyTuple* data = rowData(self);
    auto itemAt = [&](int64_t index) -> JSValue {
        if (index < 0 || index >= data->length())
            return raiseIndexError(globalObject, scope, "tuple index out of range"_s);
        return data->at(static_cast<unsigned>(index));
    };
    if (isInt(key)) {
        int64_t index = toSsize(globalObject, key, runtime(globalObject).IndexError());
        RETURN_IF_EXCEPTION(scope, {});
        return itemAt(index < 0 ? index + data->length() : index);
    }
    if (isStr(key)) {
        JSValue description = asRecord(self)->get(RowDescription);
        if (isNone(description))
            return raiseIndexError(globalObject, scope, "No item with key "_s, reprForMessage(globalObject, key));
        PyTuple* columns = PyTuple::from(description);
        for (unsigned i = 0; i < columns->length(); ++i) {
            bool isIt = equalIgnoringCase(globalObject, key, PyTuple::from(columns->at(i))->at(0));
            RETURN_IF_EXCEPTION(scope, {});
            if (isIt)
                return itemAt(i);
        }
        return raiseIndexError(globalObject, scope, "No item with that key"_s);
    }
    if (PySlice::is(key))
        RELEASE_AND_RETURN(scope, getItem(globalObject, data, key));
    return raiseIndexError(globalObject, scope, "Index must be int or string"_s);
}

static JSValue rowLength(JSGlobalObject*, JSValue self) { return jsNumber(rowData(self)->length()); }
static JSValue rowIter(JSGlobalObject* globalObject, JSValue self) { return getIter(globalObject, rowData(self)); }

static JSValue rowKeys(JSGlobalObject* globalObject, JSValue self)
{
    JSArray* keys = newList(globalObject);
    JSValue description = asRecord(self)->get(RowDescription);
    if (isNone(description))
        return keys;
    PyTuple* columns = PyTuple::from(description);
    for (unsigned i = 0; i < columns->length(); ++i)
        listAppend(globalObject, keys, PyTuple::from(columns->at(i))->at(0));
    return keys;
}

static JSValue rowHash(JSGlobalObject* globalObject, JSValue self)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    int64_t ofDescription = hash(globalObject, asRecord(self)->get(RowDescription));
    RETURN_IF_EXCEPTION(scope, {});
    int64_t ofData = hash(globalObject, rowData(self));
    RETURN_IF_EXCEPTION(scope, {});
    int64_t result = ofDescription ^ ofData;
    return makeInt(globalObject, result == -1 ? static_cast<int64_t>(-2) : result);
}

template<CompareOperator op>
static JSValue rowCompare(JSGlobalObject* globalObject, JSValue self, JSValue other)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if constexpr (op != CompareOperator::Eq && op != CompareOperator::NotEq)
        return runtime(globalObject).notImplemented();
    PyRecord* otherRow = PyRecord::tryFrom(other, rowType(globalObject));
    if (!otherRow)
        return runtime(globalObject).notImplemented();
    bool hasSameColumns = isEqual(globalObject, asRecord(self)->get(RowDescription), otherRow->get(RowDescription));
    RETURN_IF_EXCEPTION(scope, {});
    if (!hasSameColumns)
        return jsBoolean(op != CompareOperator::Eq);
    RELEASE_AND_RETURN(scope, richCompare(globalObject, rowData(self), otherRow->get(RowData), op));
}

static constexpr NativeDef rowMethods[] = {
    PY_NEW(rowNew, "($type, *args, **kwargs)"),
    PY_SLOT("__hash__", rowHash, "($self, /)"),
    PY_SLOT("__lt__", rowCompare<CompareOperator::Lt>, "($self, value, /)"),
    PY_SLOT("__le__", rowCompare<CompareOperator::LtE>, "($self, value, /)"),
    PY_SLOT("__eq__", rowCompare<CompareOperator::Eq>, "($self, value, /)"),
    PY_SLOT("__ne__", rowCompare<CompareOperator::NotEq>, "($self, value, /)"),
    PY_SLOT("__gt__", rowCompare<CompareOperator::Gt>, "($self, value, /)"),
    PY_SLOT("__ge__", rowCompare<CompareOperator::GtE>, "($self, value, /)"),
    PY_SLOT("__iter__", rowIter, "($self, /)"),
    PY_SLOT("__len__", rowLength, "($self, /)"),
    PY_SLOT("__getitem__", rowGetItem, "($self, key, /)"),
    PY_METHOD("keys", rowKeys, "($self, /)"),
};

static constexpr TypeDef rowTypeDef { "sqlite3.Row"_s, { TypeFlag::Base, TypeFlag::OwnLayout, TypeFlag::Immutable }, rowMethods, {}, {} };

static PyType* rowType(JSGlobalObject* globalObject) { return runtime(globalObject).typeFor(rowTypeDef); }

// ---- PrepareProtocol ----

static JSValue prepareProtocolNew(JSGlobalObject* globalObject, JSValue cls, const CallArgs&) { return PyRecord::create(globalObject, PyType::from(cls), 0); }
static JSValue prepareProtocolInit(JSGlobalObject*, JSValue, const CallArgs&) { return jsUndefined(); }

static constexpr NativeDef prepareProtocolMethods[] = {
    PY_NEW(prepareProtocolNew, "($type, *args, **kwargs)"),
    PY_SLOT("__init__", prepareProtocolInit, "($self, /, *args, **kwargs)"),
};

static constexpr TypeDef prepareProtocolTypeDef { "sqlite3.PrepareProtocol"_s, { TypeFlag::Immutable }, prepareProtocolMethods, {}, "PEP 246 style object adaption protocol type."_s };

static PyType* prepareProtocolType(JSGlobalObject* globalObject) { return runtime(globalObject).typeFor(prepareProtocolTypeDef); }

// ---- Functions ----

static JSValue connect(JSGlobalObject* globalObject, const CallArgs& args)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (args.size() > 1)
        return raiseTypeError(globalObject, scope, "connect() takes at most 1 positional arguments ("_s, args.size(), " given)"_s);
    JSValue factory = args.keyword("factory"_s);
    RELEASE_AND_RETURN(scope, call(globalObject, factory ? factory : JSValue(connectionType(globalObject)), args));
}

static JSValue completeStatement(JSGlobalObject* globalObject, JSValue statement)
{
    Vector<uint8_t> text;
    if (!textArgument(globalObject, "complete_statement"_s, "argument 'statement'"_s, statement, text))
        return {};
    return jsBoolean(sqlite3_complete(cString(text)));
}

static JSValue registerAdapter(JSGlobalObject* globalObject, JSValue type, JSValue adapter)
{
    Runtime& rt = runtime(globalObject);
    if (type == JSValue(rt.intType()) || type == JSValue(rt.floatType()) || type == JSValue(rt.strType()) || type == JSValue(rt.bytearrayType()))
        setModuleValue(globalObject, ModuleValue::HasAdapterForBasicType, jsBoolean(true));
    PyDict::from(moduleValue(globalObject, ModuleValue::Adapters))->set(globalObject, PyTuple::create(globalObject, { type, prepareProtocolType(globalObject) }), adapter);
    return getVM(globalObject).exceptionForInspection() ? JSValue() : jsUndefined();
}

static JSValue registerConverter(JSGlobalObject* globalObject, JSValue name, JSValue converter)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!checkIsStr(globalObject, "register_converter"_s, "argument 1"_s, name))
        return {};
    JSValue upper = callMethod(globalObject, name, internString(vm, "upper"_s));
    RETURN_IF_EXCEPTION(scope, {});
    PyDict::from(moduleValue(globalObject, ModuleValue::Converters))->set(globalObject, upper, converter);
    RETURN_IF_EXCEPTION(scope, {});
    return jsUndefined();
}

static JSValue enableCallbackTracebacks(JSGlobalObject* globalObject, JSValue enable)
{
    int flag;
    if (!intArgument(globalObject, enable, 0, flag))
        return {};
    setModuleValue(globalObject, ModuleValue::ShowsCallbackTracebacks, jsBoolean(!!flag));
    return jsUndefined();
}

static JSValue adaptFunction(JSGlobalObject* globalObject, JSValue object, JSValue protocol, JSValue alternative)
{
    return adapt(globalObject, object, protocol ? protocol : JSValue(prepareProtocolType(globalObject)), alternative);
}

static constexpr NativeDef functions[] = {
    PY_FUNCTION("adapt", adaptFunction, "(obj, proto=PrepareProtocolType, alt=<unrepresentable>, /)"),
    PY_FUNCTION("complete_statement", completeStatement, "(statement)"),
    PY_FUNCTION("connect", connect, "(*args, **kwargs)"),
    PY_FUNCTION("enable_callback_tracebacks", enableCallbackTracebacks, "(enable, /)"),
    PY_FUNCTION("register_adapter", registerAdapter, "(type, adapter, /)"),
    PY_FUNCTION("register_converter", registerConverter, "(typename, converter, /)"),
};

} // namespace Sqlite

void initializeSqlite3Module(JSGlobalObject* globalObject, PyModule* module)
{
    using namespace Sqlite;
    Runtime& rt = runtime(globalObject);
    VM& vm = rt.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
#if LAZY_LOAD_SQLITE
    String loadError;
    if (lazyLoadSQLite(&loadError) < 0 || !loadTheRestOfSQLite()) {
        raiseImportError(globalObject, scope, "cannot load SQLite: "_s, loadError);
        return;
    }
#endif
    Bun__initializeSQLite();
    if (int rc = sqlite3_initialize(); rc != SQLITE_OK) {
        raiseImportError(globalObject, scope, String::fromUTF8(sqlite3_errstr(rc)));
        return;
    }

    module->addFunctions(globalObject, functions);
    module->add(globalObject, "Connection"_s, connectionType(globalObject));
    module->add(globalObject, "Cursor"_s, cursorType(globalObject));
    module->add(globalObject, "Row"_s, rowType(globalObject));
    module->add(globalObject, "Blob"_s, rt.typeFor(blobTypeDef));
    module->add(globalObject, "PrepareProtocol"_s, prepareProtocolType(globalObject));
#define ADD_EXCEPTION(name, base) module->add(globalObject, #name ""_s, name(globalObject));
    FOR_EACH_SQLITE_EXCEPTION(ADD_EXCEPTION)
#undef ADD_EXCEPTION

    PyDict* adapters = PyDict::create(globalObject);
    PyDict* converters = PyDict::create(globalObject);
    setModuleValue(globalObject, ModuleValue::Adapters, adapters);
    setModuleValue(globalObject, ModuleValue::Converters, converters);
    setModuleValue(globalObject, ModuleValue::ShowsCallbackTracebacks, jsBoolean(false));
    setModuleValue(globalObject, ModuleValue::HasAdapterForBasicType, jsBoolean(false));
    module->add(globalObject, "adapters"_s, adapters);
    module->add(globalObject, "converters"_s, converters);

    for (auto& constant : errorCodes)
        module->add(globalObject, constant.name, jsNumber(constant.code));
    for (auto& constant : otherConstants)
        module->add(globalObject, constant.name, jsNumber(constant.code));

    MarkedArgumentBuffer keywords;
    for (int i = 0; i < sqlite3_keyword_count(); ++i) {
        const char* keyword;
        int length;
        if (sqlite3_keyword_name(i, &keyword, &length) == SQLITE_OK)
            keywords.append(makeStr(vm, String::fromUTF8(std::span { keyword, static_cast<size_t>(length) })));
    }
    module->add(globalObject, "SQLITE_KEYWORDS"_s, PyTuple::create(globalObject, std::span<const JSValue> { reinterpret_cast<const JSValue*>(ArgList(keywords).data()), keywords.size() }));

    module->add(globalObject, "sqlite_version"_s, makeStr(vm, String::fromUTF8(sqlite3_libversion())));
    // The levels of the DB-API, from those of SQLite: single-thread, serialized, multi-thread.
    static constexpr int threadSafety[] = { 0, 3, 1 };
    module->add(globalObject, "threadsafety"_s, jsNumber(threadSafety[std::clamp(sqlite3_threadsafe(), 0, 2)]));
}

} // namespace PythonModules
} // namespace Bun
