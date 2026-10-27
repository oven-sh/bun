

#include "root.h"

#include "JavaScriptCore/Error.h"
#include "JavaScriptCore/JSBigInt.h"
#include "JavaScriptCore/Structure.h"
#include "JavaScriptCore/ThrowScope.h"

#include "JavaScriptCore/JSArray.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "JavaScriptCore/JSArrayBufferView.h"
#include "JavaScriptCore/JSType.h"

#include "JSSQLStatement.h"
#include "ScriptExecutionContext.h"
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/MathCommon.h>
#include <limits>
#include <wtf/text/ExternalStringImpl.h>

#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/HeapAnalyzer.h>

#include <JavaScriptCore/JSDestructibleObjectHeapCellType.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <wtf/GetPtr.h>
#include <wtf/PointerPreparations.h>
#include <wtf/URL.h>
#include <JavaScriptCore/TypedArrayInlines.h>
#include "GCDefferalContext.h"

#include <JavaScriptCore/DOMJITAbstractHeap.h>
#include "JSBuffer.h"
#include <JavaScriptCore/DFGAbstractHeap.h>
#include "wtf/SIMDUTF.h"
#include <JavaScriptCore/ObjectPrototype.h>
#include "BunBuiltinNames.h"
#include "sqlite3_error_codes.h"
#include "wtf/FastBitVector.h"
#include "wtf/Vector.h"
#include <wtf/HashSet.h>
#include <wtf/Lock.h>
#include <atomic>
#include "wtf/LazyRef.h"
#include <JavaScriptCore/InternalFieldTuple.h>
#include "BunString.h"
#include "ErrorCode.h"
static constexpr int32_t kSafeIntegersFlag = 1 << 1;
static constexpr int32_t kStrictFlag = 1 << 2;
static constexpr int32_t kOwnedByDatabaseFlag = 1 << 3;

/* ******************************************************************************** */
// Lazy Load SQLite on macOS
// This seemed to be about 3% faster on macOS
// but it might be noise
// it's kind of hard to tell
// it should be strictly better though because
// instead of two pointers, one for DYLD_STUB$$ and one for the actual library
// we only call one pointer for the actual library
// and it means there's less work for DYLD to do on startup
// i.e. it shouldn't have any impact on startup time
#if LAZY_LOAD_SQLITE
#include "lazy_sqlite3.h"
#endif
/* ******************************************************************************** */

#include "SqliteCallbackRoots.h"
#include "SqliteUserFunction.h"
#include <wtf/SetForScope.h>

#if !USE(SYSTEM_MALLOC)
#include <bmalloc/BPlatform.h>
#define ENABLE_SQLITE_FAST_MALLOC (BENABLE(MALLOC_SIZE) && BENABLE(MALLOC_GOOD_SIZE))
#endif

static void enableFastMallocForSQLite()
{
#if ENABLE(SQLITE_FAST_MALLOC)
    int returnCode = sqlite3_config(SQLITE_CONFIG_LOOKASIDE, 0, 0);
    ASSERT_WITH_MESSAGE(returnCode == SQLITE_OK, "Unable to reduce lookaside buffer size");

    static sqlite3_mem_methods fastMallocMethods = {
        [](int n) { return fastMalloc(n); },
        [](void* p) { return fastFree(p); },
        [](void* p, int n) { return fastRealloc(p, n); },
        [](void* p) { return static_cast<int>(fastMallocSize(p)); },
        [](int n) { return static_cast<int>(fastMallocGoodSize(n)); },
        [](void*) { return SQLITE_OK; },
        [](void*) {},
        nullptr
    };

    returnCode = sqlite3_config(SQLITE_CONFIG_MALLOC, &fastMallocMethods);
    ASSERT_WITH_MESSAGE(returnCode == SQLITE_OK, "Unable to replace SQLite malloc");

#endif
}

class AutoDestructingSQLiteStatement {
public:
    sqlite3_stmt* stmt { nullptr };

    ~AutoDestructingSQLiteStatement()
    {
        sqlite3_finalize(stmt);
    }
};

struct SQLiteHandleCloser {
    void operator()(sqlite3* db) const { sqlite3_close_v2(db); }
};
// What sqlite3_open_v2 returned (a failed open returns a handle too) until a VersionSqlite3 takes it.
using SQLiteHandle = std::unique_ptr<sqlite3, SQLiteHandleCloser>;

// One-time sqlite3_config() calls. Must run before the FIRST sqlite3_open_v2
// from EITHER bun:sqlite or node:sqlite (they share one library, and config
// is SQLITE_MISUSE after init). extern "C" for the cross-TU forward-declare.
extern "C" void Bun__initializeSQLite()
{
    static std::once_flag onceFlag;
    std::call_once(onceFlag, [] {
        // Statistics put one process-wide mutex around every malloc and free.
        sqlite3_config(SQLITE_CONFIG_MEMSTATUS, 0);
        // A connection is only used by the thread that opened it, so it gets a mutex only with SQLITE_OPEN_FULLMUTEX.
        sqlite3_config(SQLITE_CONFIG_MULTITHREAD);
        enableFastMallocForSQLite();
    });
}

static WTF::String sqliteString(const char* str)
{
    auto res = WTF::String::fromUTF8(str);
    sqlite3_free((void*)str);
    return res;
}

static void sqlite_free_typed_array(void* buf, void* ctx)
{
    sqlite3_free((void*)buf);
}

static constexpr int DEFAULT_SQLITE_FLAGS = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE;
static constexpr unsigned int DEFAULT_SQLITE_PREPARE_FLAGS = SQLITE_PREPARE_PERSISTENT;
static constexpr int MAX_SQLITE_PREPARE_FLAG = SQLITE_PREPARE_PERSISTENT | SQLITE_PREPARE_NORMALIZE | SQLITE_PREPARE_NO_VTAB;

#define CHECK_THIS                                                                                               \
    if (!castedThis) [[unlikely]] {                                                                              \
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected SQLStatement"_s)); \
        return {};                                                                                               \
    }

#define CHECK_NOT_BUSY(connection)                                                                          \
    if ((connection)->inCallback) [[unlikely]] {                                                            \
        throwTypeError(lexicalGlobalObject, scope, "This database connection is busy executing a query"_s); \
        return {};                                                                                          \
    }                                                                                                       \
    if (!(connection)->orphans.isEmpty()) [[unlikely]]                                                      \
        (connection)->finalizeOrphans(lexicalGlobalObject);

#define CHECK_PREPARED                                                                                              \
    if (castedThis->stmt == nullptr) [[unlikely]] {                                                                 \
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, finalizedMessage(castedThis))); \
        return {};                                                                                                  \
    }                                                                                                               \
    CHECK_NOT_BUSY(castedThis->version_db)

namespace WebCore {
class JSSQLStatement;
static ASCIILiteral finalizedMessage(const JSSQLStatement* statement);
}

DECLARE_ALLOCATOR_WITH_HEAP_IDENTIFIER(VersionSqlite3);

// One connection. Its Database's JSSQLDatabase cell and each of its JSSQLStatements hold a reference; the last one closes it.
class VersionSqlite3 final : public WTF::RefCounted<VersionSqlite3> {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED_WITH_HEAP_IDENTIFIER(VersionSqlite3, VersionSqlite3);

public:
    static Ref<VersionSqlite3> create(JSC::JSGlobalObject*, SQLiteHandle&&, size_t deserializedSize);
    ~VersionSqlite3();

    sqlite3* db;
    // The VM (main thread or worker) that opened this connection. Its sqliteDatabases()[liveIndex] is this record.
    JSC::VM* const vm;
    // The Bun.ModuleGraph context whose script opened it (0: none): closed when that graph is disposed.
    const WebCore::ScriptExecutionContextIdentifier graphContext;
    WTF::HashSet<WebCore::JSSQLStatement*> statements;
    // Statements that no JSSQLStatement owns anymore but that aren't finalized yet. The GC moves a statement here when
    // finalizing it would call the update hook (Bun::sqliteCommitsWhenFinalized). The next call on the connection
    // finalizes it, or closeIfDrained() does if the connection is closed and its last statement is gone.
    WTF::Vector<sqlite3_stmt*> orphans;
    // db.handle
    const uint64_t handleNumber;
    const size_t deserializedSize;
    unsigned liveIndex;
    // close(false) with live db.prepare() statements: JS-visible closed, sqlite3_close deferred until they drain.
    bool closed = false;
    // SQLite is calling script of the user from inside a statement of this connection. To reset or finalize that
    // statement now, or to close the connection, frees what SQLite returns to. So every call on the connection throws.
    bool inCallback = false;
    // True if the connection has ever had an update hook.
    bool hasUpdateHook = false;

    sqlite3* handle() const { return closed ? nullptr : db; }

    // The image that Database.deserialize() gave to SQLite. The collector's threads call this.
    size_t extraMemorySize() const { return db ? deserializedSize : 0; }

    void closeHandle()
    {
        sqlite3_close_v2(std::exchange(db, nullptr));
    }

    // Defined after JSSQLStatement: they need its definition to inspect `stmt`.
    void closeIfDrained();
    void finalizeOrphans(JSC::JSGlobalObject*);
    // db.close(force). With it every statement is finalized, so the file is released now. Without it db.prepare()
    // statements stay usable, and sqlite3_close waits until they drain. Returns SQLite's result code.
    int close(bool force, bool mayCallScript = true);
    // process.exit() in a callback: sqlite3_step() stays on the stack, so no destructor may finalize a statement.
    void abandonStatements();

private:
    VersionSqlite3(sqlite3* db, JSC::VM* vm, WebCore::ScriptExecutionContextIdentifier graphContext, uint64_t handleNumber, size_t deserializedSize, unsigned liveIndex)
        : db(db)
        , vm(vm)
        , graphContext(graphContext)
        , handleNumber(handleNumber)
        , deserializedSize(deserializedSize)
        , liveIndex(liveIndex)
    {
    }
};

DEFINE_ALLOCATOR_WITH_HEAP_IDENTIFIER(VersionSqlite3);

Ref<VersionSqlite3> VersionSqlite3::create(JSC::JSGlobalObject* globalObject, SQLiteHandle&& handle, size_t deserializedSize)
{
    static std::atomic<uint64_t> nextHandleNumber { 0 };
    auto& vm = JSC::getVM(globalObject);
    auto& live = WebCore::clientData(vm)->sqliteDatabases();
    Ref record = adoptRef(*new VersionSqlite3(handle.release(), &vm, WebCore::ScriptExecutionContext::ownerOfSQLiteDatabase(globalObject), nextHandleNumber++, deserializedSize, live.size()));
    live.append(record.ptr());
    return record;
}

VersionSqlite3::~VersionSqlite3()
{
    auto& live = WebCore::clientData(*vm)->sqliteDatabases();
    auto* last = live.takeLast();
    if (last != this) {
        live[liveIndex] = last;
        last->liveIndex = liveIndex;
    }
    for (auto* stmt : orphans)
        Bun::sqliteFinalize(stmt, false);
    closeHandle();
}

// Shared with node:sqlite's termination path (Bun__closeAllNodeSqliteDatabasesForTermination):
// with unfinalized statements close_v2 only zombifies the connection and
// defers the WAL checkpoint to a finalize that never comes, so flush the WAL
// into the main database file explicitly. Zero busy_timeout first — TRUNCATE
// waits on readers via the connection's busy-handler, so a large user-set
// timeout plus a cross-process reader would stall process.exit(); with a
// zero handler TRUNCATE degrades to a passive checkpoint immediately.
extern "C" void Bun__sqliteCheckpointForTermination(sqlite3* db)
{
    sqlite3_busy_timeout(db, 0);
    sqlite3_wal_checkpoint_v2(db, nullptr, SQLITE_CHECKPOINT_TRUNCATE, nullptr, nullptr);
}

// Called from the exiting VM's teardown once script is forbidden and its child workers are
// joined: closes the connections that VM opened and never touches another VM's entries.
extern "C" void Bun__closeAllSQLiteDatabasesForTermination(JSC::JSGlobalObject* globalObject)
{
    for (auto* record : WebCore::clientData(globalObject->vm())->sqliteDatabases()) {
        if (record->inCallback)
            record->abandonStatements();
        else if (record->db) {
            Bun__sqliteCheckpointForTermination(record->db);
            // This finalizes the statements before it closes. sqlite3_close_v2() discards the entries that a full-text
            // index hasn't written yet, so a write finalized after it would commit rows that are missing from the index.
            record->close(true, false);
        }
    }
}

// The databases script of a Bun.ModuleGraph opened, when that graph is disposed: as close(true).
extern "C" void Bun__closeSQLiteDatabasesOfGraphContext(WebCore::ScriptExecutionContextIdentifier graphContext)
{
    // A graph is disposed on its VM's thread. Its context's own vm() is null once the realm that made the graph is collected.
    Vector<Ref<VersionSqlite3>> owned;
    for (auto* record : WebCore::clientData(defaultGlobalObject()->vm())->sqliteDatabases()) {
        // One that is calling the script that disposes the graph stays open until it is collected.
        if (record->graphContext == graphContext && record->db && !record->inCallback)
            owned.append(*record);
    }
    // The JSSQLDatabase and its callbacks may already be dead, so don't run JS here.
    for (auto& record : owned)
        record->close(true, false);
}

namespace WebCore {
using namespace JSC;

JSC_DECLARE_HOST_FUNCTION(jsSQLStatementPrepareStatementFunction);
JSC_DECLARE_HOST_FUNCTION(jsSQLStatementExecuteFunction);
JSC_DECLARE_HOST_FUNCTION(jsSQLStatementOpenStatementFunction);
JSC_DECLARE_HOST_FUNCTION(jsSQLStatementIsInTransactionFunction);

JSC_DECLARE_HOST_FUNCTION(jsSQLStatementLoadExtensionFunction);

JSC_DECLARE_HOST_FUNCTION(jsSQLStatementExecuteStatementFunctionRun);
JSC_DECLARE_HOST_FUNCTION(jsSQLStatementExecuteStatementFunctionGet);
JSC_DECLARE_HOST_FUNCTION(jsSQLStatementExecuteStatementFunctionAll);
JSC_DECLARE_HOST_FUNCTION(jsSQLStatementExecuteStatementFunctionIterate);
JSC_DECLARE_HOST_FUNCTION(jsSQLStatementFunctionIterateNext);
JSC_DECLARE_HOST_FUNCTION(jsSQLStatementFunctionIterateEnd);
JSC_DECLARE_HOST_FUNCTION(jsSQLStatementExecuteStatementFunctionRows);
JSC_DECLARE_HOST_FUNCTION(jsSQLStatementExecuteStatementFunctionRawRows);

JSC_DECLARE_CUSTOM_GETTER(jsSqlStatementGetColumnNames);
JSC_DECLARE_CUSTOM_GETTER(jsSqlStatementGetColumnCount);

JSC_DECLARE_HOST_FUNCTION(jsSQLStatementSerialize);
JSC_DECLARE_HOST_FUNCTION(jsSQLStatementDeserialize);

JSC_DECLARE_HOST_FUNCTION(jsSQLStatementSetPrototypeFunction);
JSC_DECLARE_HOST_FUNCTION(jsSQLStatementFunctionFinalize);
JSC_DECLARE_HOST_FUNCTION(jsSQLStatementToStringFunction);

JSC_DECLARE_CUSTOM_GETTER(jsSqlStatementGetColumnNames);
JSC_DECLARE_CUSTOM_GETTER(jsSqlStatementGetColumnCount);
JSC_DECLARE_CUSTOM_GETTER(jsSqlStatementGetParamCount);
JSC_DECLARE_CUSTOM_GETTER(jsSqlStatementGetIsFinalized);
JSC_DECLARE_CUSTOM_GETTER(jsSqlStatementGetRunCount);
JSC_DECLARE_CUSTOM_GETTER(jsSqlStatementGetReadonly);

JSC_DECLARE_CUSTOM_GETTER(jsSqlStatementGetColumnTypes);
JSC_DECLARE_CUSTOM_GETTER(jsSqlStatementGetColumnDeclaredTypes);
JSC_DECLARE_CUSTOM_GETTER(jsSqlStatementGetSafeIntegers);
JSC_DECLARE_CUSTOM_SETTER(jsSqlStatementSetSafeIntegers);
JSC_DECLARE_HOST_FUNCTION(jsSQLStatementSetColumnNameTransformFunction);
JSC_DECLARE_HOST_FUNCTION(jsSQLStatementRunTailFunction);

static JSValue createSQLiteError(JSC::JSGlobalObject* globalObject, int code, const char* msg, int64_t byteOffset)
{
    auto& vm = JSC::getVM(globalObject);
    // Error messages can echo identifiers/values from the query, which SQLite does
    // not validate as UTF-8, so decode leniently to avoid dropping the message.
    WTF::String str = Bun::sqliteText(msg);
    // JSC::createError asserts that the message is not empty. RAISE(ABORT, '') has an empty one.
    JSC::JSObject* object = JSC::ErrorInstance::create(vm, globalObject->errorStructure(), str, JSValue());
    auto& builtinNames = WebCore::builtinNames(vm);
    object->putDirect(vm, vm.propertyNames->name, jsString(vm, String("SQLiteError"_s)), JSC::PropertyAttribute::DontEnum | 0);

    String codeStr;

    switch (code) {
#define MACRO(SQLITE_DEF)          \
    case SQLITE_DEF: {             \
        codeStr = #SQLITE_DEF##_s; \
        break;                     \
    }
        FOR_EACH_SQLITE_ERROR(MACRO)

#undef MACRO
    }
    if (!codeStr.isEmpty())
        object->putDirect(vm, builtinNames.codePublicName(), jsString(vm, codeStr), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | 0);

    object->putDirect(vm, builtinNames.errnoPublicName(), jsNumber(code), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | 0);
    object->putDirect(vm, vm.propertyNames->byteOffset, jsNumber(byteOffset), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | 0);

    return object;
}

// sqlite3_error_offset counts from the pointer that sqlite3_prepare_v3 got. `byteOffsetBase` is how far that pointer is into the caller's SQL text.
static JSValue createSQLiteError(JSC::JSGlobalObject* globalObject, sqlite3* db, int64_t byteOffsetBase = 0)
{
    int64_t byteOffset = sqlite3_error_offset(db);
    if (byteOffset >= 0)
        byteOffset += byteOffsetBase;
    return createSQLiteError(globalObject, sqlite3_extended_errcode(db), sqlite3_errmsg(db), byteOffset);
}

struct SQLiteParameterName {
    Identifier prefixed; // "$a", ":a", "@a", "?2". Null for a plain "?".
    Identifier bare; // "a". Null when `index` is the key.
    uint32_t index; // The position of "?" and "?2" (from 0). 1 for "$1".
};

class SQLiteBindingsMap {
public:
    explicit SQLiteBindingsMap(bool strict = false)
        : strict(strict)
    {
    }

    void ensureNamesLoaded(JSC::VM& vm, sqlite3_stmt* stmt)
    {
        if (hasLoadedNames)
            return;
        hasLoadedNames = true;

        unsigned count = sqlite3_bind_parameter_count(stmt);
        for (unsigned i = 0; i < count; i++) {
            const char* name = sqlite3_bind_parameter_name(stmt, i + 1);
            if (!name)
                continue;

            if (names.isEmpty()) {
                names.grow(count);
                for (unsigned j = 0; j < count; j++)
                    names[j].index = j;
            }

            auto prefixed = Bun::sqliteText(name);
            names[i].prefixed = Identifier::fromString(vm, prefixed);
            if (name[0] == '?')
                continue;
            auto bare = Identifier::fromString(vm, prefixed.substring(1));
            if (auto index = parseIndex(bare))
                names[i].index = *index;
            else
                names[i].bare = WTF::move(bare);
        }
    }

    // Empty when no parameter has a name: the key of each one is its position.
    Vector<SQLiteParameterName> names;
    bool hasLoadedNames = false;
    // The bare key is tried first, and a parameter without a value throws.
    bool strict;
};

struct SQLiteColumnSlot {
    enum class Kind : uint8_t {
        Offset, // a PropertyOffset of the row Structure
        Index, // the name is an array index, like "0"
        Shadowed, // nowhere: a later column has the same name
    };
    Kind kind;
    uint32_t value;
};

// What a Database keeps in #handle: its reference to the connection, and what the connection calls.
class JSSQLDatabase final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr JSC::DestructionMode needsDestruction = NeedsDestruction;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        return Bun::createClassStructure(vm, globalObject, JSC::jsNull(), JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSSQLDatabase* create(JSC::JSGlobalObject* lexicalGlobalObject, SQLiteHandle&& handle, size_t deserializedSize = 0)
    {
        auto& vm = JSC::getVM(lexicalGlobalObject);
        Structure* structure = defaultGlobalObject(lexicalGlobalObject)->JSSQLDatabaseStructure();
        Ref record = VersionSqlite3::create(lexicalGlobalObject, WTF::move(handle), deserializedSize);
        JSSQLDatabase* ptr = new (NotNull, JSC::allocateCell<JSSQLDatabase>(vm)) JSSQLDatabase(vm, structure, WTF::move(record));
        ptr->finishCreation(vm);
        vm.heap.reportExtraMemoryAllocated(ptr, deserializedSize);
        return ptr;
    }
    static void destroy(JSC::JSCell* cell) { static_cast<JSSQLDatabase*>(cell)->~JSSQLDatabase(); }
    template<typename, SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return WebCore::subspaceForImpl<JSSQLDatabase, UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForJSSQLDatabase, m_subspaceForJSSQLDatabase));
    }
    DECLARE_VISIT_CHILDREN;
    DECLARE_INFO;

    static size_t estimatedSize(JSCell* cell, VM& vm)
    {
        return Base::estimatedSize(cell, vm) + uncheckedDowncast<JSSQLDatabase>(cell)->m_record->extraMemorySize();
    }

    VersionSqlite3& record() { return m_record.get(); }

    // After SQLite closed the connection.
    void dropCallbacks()
    {
        m_callbacks.clear(this);
        for (auto& hook : m_updateHooks)
            hook.clear();
        m_wrapper.clear();
    }

    Bun::SqliteCallbackRoots m_callbacks;
    // db.onInsert, db.onUpdate, db.onDelete: see updateHookIndex().
    std::array<JSC::WriteBarrier<JSC::JSObject>, 3> m_updateHooks;
    // The Database, while it has a hook.
    JSC::WriteBarrier<JSC::JSObject> m_wrapper;
    // A hook gets the rowid as a BigInt.
    bool m_safeIntegers { false };

private:
    JSSQLDatabase(JSC::VM& vm, JSC::Structure* structure, Ref<VersionSqlite3>&& record)
        : Base(vm, structure)
        , m_record(WTF::move(record))
    {
    }

    const Ref<VersionSqlite3> m_record;
};

const ClassInfo JSSQLDatabase::s_info = { "SQLDatabase"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSSQLDatabase) };

template<typename Visitor>
void JSSQLDatabase::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSSQLDatabase>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.reportExtraMemoryVisited(thisObject->m_record->extraMemorySize());
    thisObject->m_callbacks.visit(thisObject, visitor);
    for (auto& hook : thisObject->m_updateHooks)
        visitor.append(hook);
    visitor.append(thisObject->m_wrapper);
}

DEFINE_VISIT_CHILDREN(JSSQLDatabase);

Structure* createJSSQLDatabaseStructure(JSGlobalObject* globalObject)
{
    return JSSQLDatabase::createStructure(globalObject->vm(), globalObject);
}

// The handle is an argument of the call, so that frame keeps the cell and its record alive. Null with an exception pending.
static VersionSqlite3* databaseForHandle(JSC::JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, JSC::JSValue handle)
{
    auto* database = dynamicDowncast<JSSQLDatabase>(handle);
    if (!database) [[unlikely]] {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Invalid database handle"_s));
        return nullptr;
    }
    CHECK_NOT_BUSY(&database->record())
    return &database->record();
}

class JSSQLStatement : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr JSC::DestructionMode needsDestruction = NeedsDestruction;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSSQLStatement* create(JSDOMGlobalObject* globalObject, sqlite3_stmt* stmt, JSSQLDatabase* database)
    {
        Structure* structure = globalObject->JSSQLStatementStructure();
        JSSQLStatement* ptr = new (NotNull, JSC::allocateCell<JSSQLStatement>(globalObject->vm())) JSSQLStatement(structure, *globalObject, stmt, database);
        if (database)
            database->record().statements.add(ptr);
        ptr->finishCreation(globalObject->vm());
        return ptr;
    }
    static void destroy(JSC::JSCell*);
    template<typename, SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return WebCore::subspaceForImpl<JSSQLStatement, UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForJSSQLStatement, m_subspaceForJSSQLStatement));
    }
    DECLARE_VISIT_CHILDREN;
    DECLARE_EXPORT_INFO;

    size_t static estimatedSize(JSCell* cell, VM& vm)
    {
        auto* thisObject = uncheckedDowncast<JSSQLStatement>(cell);
        return Base::estimatedSize(thisObject, vm) + thisObject->extraMemorySize();
    }

    static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);

    // The collector's threads call this.
    size_t extraMemorySize() const { return stmt ? m_statementSize : 0; }

    // After a sqlite3_step() that returned a row: the first one of a run, or one after dropRowShape().
    void updateRowShape(JSC::JSGlobalObject*);
    void dropRowShape();

    ~JSSQLStatement();

    void finalizeStatement(bool mayCallScript = true)
    {
        if (!stmt)
            return;
        Bun::sqliteFinalize(std::exchange(stmt, nullptr), mayCallScript);
        if (version_db)
            version_db->closeIfDrained();
    }

    sqlite3_stmt* stmt;
    RefPtr<VersionSqlite3> version_db;
    // It has the functions that the statement calls. (The destructor needs version_db: this cell can be swept first.)
    const JSC::WriteBarrier<JSSQLDatabase> m_database;
    // The row shape: one key and one slot for each result column. Without slots (too many keys for a Structure), rows are built by key.
    Bun::SqliteColumnNames m_shapedColumnNames;
    Vector<Identifier> columnNames;
    Vector<SQLiteColumnSlot> columnSlots;
    mutable JSC::WriteBarrier<JSC::Structure> _structure;
    mutable JSC::WriteBarrier<JSC::JSObject> userPrototype;
    // Bun.sql's `transform.column.from`: makes the key of a row object from the name of a column.
    JSC::WriteBarrier<JSC::JSObject> columnNameTransform;
    const size_t m_statementSize;
    SQLiteBindingsMap m_bindingNames;
    bool useBigInt64 : 1 = false;
    // Created by db.query(); close(false) finalizes these but leaves db.prepare() statements usable.
    bool ownedByDatabase : 1 = false;
    bool finalizedByClose : 1 = false;

protected:
    JSSQLStatement(JSC::Structure* structure, JSDOMGlobalObject& globalObject, sqlite3_stmt* stmt, JSSQLDatabase* database)
        : Base(globalObject.vm(), structure)
        , stmt(stmt)
        , version_db(database ? &database->record() : nullptr)
        , m_database(database, JSC::WriteBarrierEarlyInit)
        , m_statementSize(stmt ? sqlite3_stmt_status(stmt, SQLITE_STMTSTATUS_MEMUSED, 0) : 0)
    {
    }

    void finishCreation(JSC::VM& vm);

private:
    void buildRowShape(JSC::JSGlobalObject*);
    Identifier columnKey(JSC::JSGlobalObject*, int column);
};

static ASCIILiteral finalizedMessage(const JSSQLStatement* statement)
{
    return statement->finalizedByClose ? "Database has closed"_s : "Statement has finalized"_s;
}

static JSValue toJSAsBuffer(JSC::VM&, JSC::JSGlobalObject* globalObject, Bun::SqliteColumn source)
{
    switch (source.type()) {
    case SQLITE_INTEGER: {
        int64_t value = source.int64();
        uint8_t bytes[8];
        for (int j = 0; j < 8; j++)
            bytes[j] = (value >> (j * 8)) & 0xFF;
        return Bun::sqliteBytes(globalObject, bytes, 8);
    }
    case SQLITE_FLOAT: {
        double value = source.real();
        return Bun::sqliteBytes(globalObject, &value, 8);
    }
    case SQLITE3_TEXT: {
        size_t len = source.bytes();
        const void* text = len > 0 ? source.text() : nullptr;
        return Bun::sqliteBytes(globalObject, text, text ? len : 0);
    }
    case SQLITE_BLOB: {
        size_t len = source.bytes();
        const void* blob = len > 0 ? source.blob() : nullptr;
        return Bun::sqliteBytes(globalObject, blob, blob ? len : 0);
    }
    default:
        return jsNull();
    }
}

// `Source` is a Bun::SqliteColumn or a Bun::SqliteArgument.
template<bool useBigInt64, typename Source>
static JSValue toJS(JSC::VM& vm, JSC::JSGlobalObject* globalObject, Source source)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    switch (source.type()) {
    case SQLITE_INTEGER: {
        // https://github.com/oven-sh/bun/issues/1536
        if constexpr (!useBigInt64)
            return jsNumber(source.int64());
        else
            RELEASE_AND_RETURN(throwScope, JSC::JSBigInt::createFrom(globalObject, source.int64()));
    }
    case SQLITE_FLOAT: {
        return jsNumber(source.real());
    }
    // > Note that the SQLITE_TEXT constant was also used in SQLite version
    // > 2 for a completely different meaning. Software that links against
    // > both SQLite version 2 and SQLite version 3 should use SQLITE3_TEXT,
    // > not SQLITE_TEXT.
    case SQLITE3_TEXT: {
        size_t len = source.bytes();
        const unsigned char* text = len > 0 ? source.text() : nullptr;
        if (text == nullptr || len == 0) [[unlikely]] {
            return jsEmptyString(vm);
        }

        if (len < 64) {
            return jsString(vm, WTF::String::fromUTF8ReplacingInvalidSequences({ text, len }));
        }

        auto encoded = Bun__encoding__toStringUTF8(text, len, globalObject);
        RETURN_IF_EXCEPTION(throwScope, {});
        return JSC::JSValue::decode(encoded);
    }
    case SQLITE_BLOB: {
        size_t len = source.bytes();
        const void* blob = len > 0 ? source.blob() : nullptr;
        RELEASE_AND_RETURN(throwScope, Bun::sqliteBytes(globalObject, blob, blob ? len : 0));
    }
    default: {
        break;
    }
    }

    return jsNull();
}

static const HashTableValue JSSQLStatementPrototypeTableValues[] = {
    { "run"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementExecuteStatementFunctionRun, 1 } },
    { "get"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementExecuteStatementFunctionGet, 1 } },
    { "all"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementExecuteStatementFunctionAll, 1 } },
    { "iterate"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementExecuteStatementFunctionIterate, 1 } },
    { "iterateNext"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementFunctionIterateNext, 1 } },
    { "iterateEnd"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementFunctionIterateEnd, 1 } },
    { "runCount"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsSqlStatementGetRunCount, 0 } },
    { "as"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementSetPrototypeFunction, 1 } },
    { "values"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementExecuteStatementFunctionRows, 1 } },
    { "raw"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementExecuteStatementFunctionRawRows, 1 } },
    { "finalize"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementFunctionFinalize, 0 } },
    { "toString"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementToStringFunction, 0 } },
    { "columns"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsSqlStatementGetColumnNames, 0 } },
    { "columnsCount"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsSqlStatementGetColumnCount, 0 } },
    { "paramsCount"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsSqlStatementGetParamCount, 0 } },
    { "isFinalized"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsSqlStatementGetIsFinalized, 0 } },
    { "readonly"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsSqlStatementGetReadonly, 0 } },
    { "columnTypes"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsSqlStatementGetColumnTypes, 0 } },
    { "declaredTypes"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsSqlStatementGetColumnDeclaredTypes, 0 } },
    { "safeIntegers"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsSqlStatementGetSafeIntegers, jsSqlStatementSetSafeIntegers } },
};

class JSSQLStatementPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static JSSQLStatementPrototype* create(JSC::VM& vm, JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSSQLStatementPrototype* ptr = new (NotNull, Bun::allocatePlainObjectCell(vm, sizeof(JSSQLStatementPrototype))) JSSQLStatementPrototype(vm, globalObject, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSSQLStatementPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSSQLStatementPrototype(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        Base::finishCreation(vm);
        Bun::reifyStaticPropertyTable(vm, JSSQLStatementPrototype::info(), JSSQLStatementPrototypeTableValues, *this);
        // Only builtin modules can name these: statement.native is public.
        putDirectNativeFunction(vm, globalObject, WebCore::builtinNames(vm).setColumnNameTransformPrivateName(), 1, jsSQLStatementSetColumnNameTransformFunction, ImplementationVisibility::Private, NoIntrinsic, PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum | 0);
        putDirectNativeFunction(vm, globalObject, WebCore::builtinNames(vm).runTailPrivateName(), 1, jsSQLStatementRunTailFunction, ImplementationVisibility::Private, NoIntrinsic, PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum | 0);
    }
};

const ClassInfo JSSQLStatementPrototype::s_info = { "SQLStatement"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSSQLStatementPrototype) };

Structure* createJSSQLStatementStructure(JSGlobalObject* globalObject)
{
    Structure* prototypeStructure = JSSQLStatementPrototype::createStructure(globalObject->vm(), globalObject, globalObject->objectPrototype());
    prototypeStructure->setMayBePrototype(true);
    JSSQLStatementPrototype* prototype = JSSQLStatementPrototype::create(globalObject->vm(), globalObject, prototypeStructure);
    return JSSQLStatement::createStructure(globalObject->vm(), globalObject, prototype);
}

Identifier JSSQLStatement::columnKey(JSC::JSGlobalObject* globalObject, int column)
{
    auto& vm = JSC::getVM(globalObject);
    const char* utf8 = sqlite3_column_name(stmt, column);
    auto name = Bun::sqliteText(utf8 ? utf8 : "");

    if (auto* transform = columnNameTransform.get()) [[unlikely]] {
        auto scope = DECLARE_THROW_SCOPE(vm);
        // The statement is on a row.
        WTF::SetForScope inCallback { version_db->inCallback, true };
        MarkedArgumentBuffer arguments;
        arguments.append(jsString(vm, name));
        JSValue key = JSC::call(globalObject, transform, JSC::getCallData(transform), jsUndefined(), arguments);
        RETURN_IF_EXCEPTION(scope, {});
        name = key.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return Identifier::fromString(vm, name);
}

void JSSQLStatement::dropRowShape()
{
    m_shapedColumnNames = {};
    columnNames.clear();
    columnSlots.clear();
    _structure.clear();
}

void JSSQLStatement::buildRowShape(JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    unsigned count = sqlite3_column_count(stmt);
    Vector<Identifier> names;
    Vector<SQLiteColumnSlot> slots;
    names.reserveInitialCapacity(count);
    slots.reserveInitialCapacity(count);

    JSObject* prototype = userPrototype ? userPrototype.get() : globalObject->objectPrototype();
    Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(globalObject, prototype, std::min(count, JSFinalObject::maxInlineCapacity));
    // With more properties than this the Structure becomes a dictionary, which rows cannot share.
    unsigned namesLeft = Structure::s_maxTransitionLengthForNonEvalPutById;

    for (unsigned i = 0; i < count; i++) {
        auto name = columnKey(globalObject, i);
        if (scope.exception()) [[unlikely]] {
            dropRowShape();
            return;
        }
        // As in { a: 1, b: 2, a: 3 }: the key stays where it first was, and the last value wins.
        size_t sameName = names.reverseFind(name);
        names.append(name);
        if (!structure)
            continue;

        if (sameName != notFound) {
            slots.append(std::exchange(slots[sameName], { SQLiteColumnSlot::Kind::Shadowed, 0 }));
        } else if (auto index = parseIndex(name)) {
            slots.append({ SQLiteColumnSlot::Kind::Index, *index });
        } else if (namesLeft) {
            namesLeft--;
            PropertyOffset offset;
            if (auto* existing = Structure::addPropertyTransitionToExistingStructure(structure, name, 0, offset))
                structure = existing;
            else
                structure = Structure::addNewPropertyTransition(vm, structure, name, 0, offset, PutPropertySlot::PutById);
            slots.append({ SQLiteColumnSlot::Kind::Offset, static_cast<uint32_t>(offset) });
        } else {
            structure = nullptr;
            slots.clear();
        }
    }

    ASSERT(!structure || !structure->isDictionary());
    columnNames = WTF::move(names);
    columnSlots = WTF::move(slots);
    _structure.setMayBeNull(vm, this, structure);
}

void JSSQLStatement::updateRowShape(JSC::JSGlobalObject* globalObject)
{
    if (m_shapedColumnNames.changed(stmt)) [[unlikely]]
        buildRowShape(globalObject);
}

void JSSQLStatement::destroy(JSC::JSCell* cell)
{
    JSSQLStatement* thisObject = static_cast<JSSQLStatement*>(cell);
    thisObject->~JSSQLStatement();
}

// A Date, a Map or a Promise is a value (one that cannot be bound), not an object of named parameters.
static bool holdsNamedParameters(JSC::JSObject* object)
{
    switch (object->type()) {
    case FinalObjectType:
    case ObjectType:
    case ProxyObjectType:
    case DirectArgumentsType:
    case ScopedArgumentsType:
    case ClonedArgumentsType:
        return true;
    default:
        return false;
    }
}

static constexpr int kUnsupportedValue = -1;
static constexpr int kExceptionPending = -2;

// `Sink` is a Bun::SqliteParameter or a Bun::SqliteResult. Returns SQLite's result code or one of the two above.
template<typename Sink>
static int fromJS(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, Sink sink, JSC::JSValue value, bool safeIntegers)
{
    if (value.isInt32())
        return sink.int64(value.asInt32());
    if (value.isNumber()) {
        double number = value.asDouble();
        // -0 stays REAL to keep its sign.
        if (JSC::isSafeInteger(number) && !JSC::isNegativeZero(number))
            return sink.int64(static_cast<int64_t>(number));
        return sink.real(number);
    }
    if (value.isString()) {
        auto view = asString(value)->view(globalObject);
        RETURN_IF_EXCEPTION(scope, kExceptionPending);
        // Never SQLITE_UTF16: SQLite's decoder drops a leading BOM and stores a lone surrogate as ill-formed UTF-8.
        auto utf8 = Bun::UTF8View::tryCreate(globalObject, scope, view);
        RETURN_IF_EXCEPTION(scope, kExceptionPending);
        return sink.text(utf8->span());
    }
    if (value.isUndefinedOrNull())
        return sink.null();
    if (value.isBoolean())
        return sink.int64(value.asBoolean());
    if (value.isHeapBigInt()) {
        JSBigInt* bigInt = value.asHeapBigInt();
        // Without safeIntegers it keeps its low 64 bits: Bun.hash() gives an unsigned 64-bit integer, and people store it.
        if (safeIntegers && (JSBigInt::compare(bigInt, std::numeric_limits<int64_t>::min()) == JSBigInt::ComparisonResult::LessThan || JSBigInt::compare(bigInt, std::numeric_limits<int64_t>::max()) == JSBigInt::ComparisonResult::GreaterThan)) [[unlikely]] {
            auto bigIntString = bigInt->toString(globalObject, 10);
            RETURN_IF_EXCEPTION(scope, kExceptionPending);
            throwRangeError(globalObject, scope, makeString("BigInt value '"_s, bigIntString, "' is out of range"_s));
            return kExceptionPending;
        }
        return sink.int64(JSBigInt::toBigInt64(value));
    }
    if (auto* view = dynamicDowncast<JSC::JSArrayBufferView>(value))
        return sink.blob(view->span());
    if (auto* buffer = dynamicDowncast<JSC::JSArrayBuffer>(value))
        return sink.blob(buffer->impl()->span());
    return kUnsupportedValue;
}

struct SQLiteBinder {
    JSC::JSGlobalObject* globalObject;
    JSC::ThrowScope& scope;
    VersionSqlite3* versionDB;
    sqlite3_stmt* stmt;
    // Null for the transient statement of db.run().
    JSSQLStatement* statement;
    SQLiteBindingsMap& bindings;
    bool safeIntegers;
    sqlite3* db = sqlite3_db_handle(stmt);

    // `arguments` is the array of what script passed. Its first element decides: an array is the list of values,
    // an object of named parameters is that, and anything else makes `arguments` itself the list.
    bool bind(JSC::JSValue arguments, bool atPrepare = false)
    {
        auto* values = dynamicDowncast<JSC::JSArray>(arguments);
        JSC::JSObject* named = nullptr;
        JSC::JSValue first = arguments;
        if (values) {
            // Nothing was passed: the values of the last call stay bound.
            if (!values->length())
                return true;
            first = element(values, 0);
            RETURN_IF_EXCEPTION(scope, false);
        }

        if (auto* list = values ? dynamicDowncast<JSC::JSArray>(first) : nullptr) {
            values = list;
        } else if (first.isObject() && holdsNamedParameters(asObject(first))) {
            named = asObject(first);
        } else if (!values) {
            throwException(globalObject, scope, createTypeError(globalObject, "Expected object or array"_s));
            return false;
        }

        sqlite3_clear_bindings(stmt);
        if (named)
            return bindNamed(named);

        unsigned count = values->length();
        if (!count)
            return true;

        unsigned required = sqlite3_bind_parameter_count(stmt);
        if (count != required) {
            // db.prepare() has always dropped a value that is not a list: `texts.map(db.prepare, db)` passes the index.
            if (atPrepare && values == arguments.asCell())
                return true;
            throwException(globalObject, scope, createError(globalObject, makeString("SQLite query expected "_s, required, " values, received "_s, count)));
            return false;
        }

        for (unsigned i = 0; i < count; i++) {
            JSC::JSValue value = element(values, i);
            RETURN_IF_EXCEPTION(scope, false);
            if (!bindValue(i + 1, value))
                return false;
        }
        return true;
    }

private:
    // Script that ran during a property read can have finalized `stmt` (statement.finalize(), db.close()).
    bool checkStillAlive()
    {
        if (statement ? statement->stmt == stmt : versionDB->handle() == db) [[likely]]
            return true;
        throwException(globalObject, scope, createError(globalObject, statement ? finalizedMessage(statement) : "Database has closed"_s));
        return false;
    }

    JSC::JSValue element(JSC::JSArray* array, unsigned i)
    {
        if (array->canGetIndexQuickly(i)) [[likely]]
            return array->getIndexQuickly(i);
        JSC::JSValue value = array->getDirectIndex(globalObject, i);
        RETURN_IF_EXCEPTION(scope, {});
        if (!checkStillAlive())
            return {};
        return value ? value : JSC::jsUndefined();
    }

    bool bindNamed(JSC::JSObject* target)
    {
        auto& vm = JSC::getVM(globalObject);
        bindings.ensureNamesLoaded(vm, stmt);
        const auto& names = bindings.names;
        const bool strict = bindings.strict;
        const unsigned count = sqlite3_bind_parameter_count(stmt);

        // Only a read off the fast path can run script, which can mutate `target`.
        Structure* structure = target->structure();
        bool canUseFastPath = target->canUseFastGetOwnProperty(*structure);

        // The own property `name`, or `index` when `name` is null. Empty when there is none.
        const auto& ownProperty = [&](const Identifier& name, uint32_t index) -> JSC::JSValue {
            if (!name.isNull() && canUseFastPath) [[likely]]
                return target->fastGetOwnProperty(vm, *structure, name);

            JSC::JSValue value;
            if (name.isNull()) {
                value = target->getDirectIndex(globalObject, index);
            } else {
                PropertySlot slot(target, PropertySlot::InternalMethodType::GetOwnProperty);
                if (target->methodTable()->getOwnPropertySlot(target, globalObject, name, slot) && !scope.exception()) {
                    if (!slot.isTaintedByOpaqueObject()) [[likely]]
                        value = slot.getValue(globalObject, name);
                    else
                        value = target->get(globalObject, name);
                }
            }
            RETURN_IF_EXCEPTION(scope, {});
            if (!checkStillAlive())
                return {};
            structure = target->structure();
            canUseFastPath = target->canUseFastGetOwnProperty(*structure);
            return value;
        };

        for (unsigned i = 0; i < count; i++) {
            JSC::JSValue value;
            if (names.isEmpty() || names[i].prefixed.isNull()) {
                value = ownProperty({}, i);
            } else {
                const auto& name = names[i];
                value = strict ? ownProperty(name.bare, name.index) : ownProperty(name.prefixed, 0);
                RETURN_IF_EXCEPTION(scope, false);
                if (!value)
                    value = strict ? ownProperty(name.prefixed, 0) : ownProperty(name.bare, name.index);
            }
            RETURN_IF_EXCEPTION(scope, false);

            if (!value) {
                if (!strict)
                    continue;
                throwException(globalObject, scope, createError(globalObject, makeString("Missing parameter \""_s, missingParameter(i), "\""_s)));
                return false;
            }

            if (!bindValue(i + 1, value))
                return false;
        }
        return true;
    }

    String missingParameter(unsigned i)
    {
        const auto& names = bindings.names;
        if (names.isEmpty() || names[i].prefixed.isNull())
            return makeString('?', i + 1);
        // With a numbered parameter ("?1", "$1") in the statement, names are spelled as in the SQL.
        bool numbersAny = names.containsIf([](auto& name) { return !name.prefixed.isNull() && name.bare.isNull(); });
        return (numbersAny ? names[i].prefixed : names[i].bare).string();
    }

    bool bindValue(int i, JSC::JSValue value)
    {
        int result = fromJS(globalObject, scope, Bun::SqliteParameter { stmt, i }, value, safeIntegers);
        if (result == SQLITE_OK) [[likely]]
            return true;

        if (result == kExceptionPending)
            sqlite3_clear_bindings(stmt);
        else if (result == kUnsupportedValue)
            throwException(globalObject, scope, createTypeError(globalObject, "Binding expected string, TypedArray, boolean, number, bigint or null"_s));
        else
            throwException(globalObject, scope, createSQLiteError(globalObject, db));
        return false;
    }
};

// For a string that SQLite or dlopen reads up to its first NUL. Null with an exception when that is not the whole string.
static UTF8CString toCString(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, ASCIILiteral argumentName, JSC::JSValue value)
{
    auto string = value.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (string.contains('\0')) [[unlikely]] {
        Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, argumentName, value, "must be a string without null bytes"_s);
        return {};
    }
    return Bun::tryUTF8(globalObject, scope, string);
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementSetCustomSQLite, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSValue sqliteStrValue = callFrame->argument(0);
    if (!sqliteStrValue.isString()) [[unlikely]] {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected SQLite path"_s));
        return {};
    }

    auto requestedPath = toCString(lexicalGlobalObject, scope, "path"_s, sqliteStrValue);
    RETURN_IF_EXCEPTION(scope, {});

#if LAZY_LOAD_SQLITE
    static UTF8CString selectedSQLitePath;
    {
        WTF::Locker locker { sqlite3_handle_lock };
        if (sqlite3_handle) {
            if (selectedSQLitePath.isNull() || selectedSQLitePath != requestedPath) {
                throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "SQLite already loaded\nA custom SQLite path can only be selected before SQLite is loaded. Repeating a path is allowed only when that path selected the loaded library."_s));
                return {};
            }
        } else {
            // Keep the selected path alive for the process-global SQLite handle.
            selectedSQLitePath = requestedPath;
            sqlite3_lib_path = selectedSQLitePath.legacyCStringPointer();
            WTF::String msg;
            if (lazyLoadSQLiteUnlocked(&msg) == -1) {
                throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, msg));
                return {};
            }
        }
    }

    Bun__initializeSQLite();

    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::jsBoolean(true)));
#else
    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::jsBoolean(false)));
#endif
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementDeserialize, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSArrayBufferView* array = dynamicDowncast<JSC::JSArrayBufferView>(callFrame->argument(0));
    unsigned int deserializeFlags = SQLITE_DESERIALIZE_FREEONCLOSE | SQLITE_DESERIALIZE_RESIZEABLE;
    JSC::EnsureStillAliveScope ensureAliveArray(array);

    deserializeFlags |= callFrame->argument(1).toInt32(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (!array) [[unlikely]] {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected Uint8Array or Buffer"_s));
        return {};
    }

    if (array->isDetached()) [[unlikely]] {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "TypedArray is detached"_s));
        return {};
    }

    if (!Bun::loadSQLite(lexicalGlobalObject, scope)) [[unlikely]]
        return {};

    size_t byteLength = array->byteLength();
    void* ptr = array->vector();
    if (ptr == nullptr || byteLength == 0) [[unlikely]] {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "ArrayBuffer must not be empty"_s));
        return {};
    }
    // SQLite can read a few bytes past the end of a malformed image.
    constexpr size_t slack = 20;
    void* data = sqlite3_malloc64(byteLength + slack);
    if (data == nullptr) [[unlikely]] {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Failed to allocate memory"_s));
        return {};
    }
    memcpy(data, ptr, byteLength);
    memset(static_cast<char*>(data) + byteLength, 0, slack);

    sqlite3* db = nullptr;
    int openStatus = sqlite3_open_v2(":memory:", &db, DEFAULT_SQLITE_FLAGS, nullptr);
    SQLiteHandle handle { db };
    if (openStatus != SQLITE_OK) {
        // Ownership of `data` is only transferred by sqlite3_deserialize below;
        // on open failure it must be released here.
        sqlite3_free(data);
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Failed to open SQLite"_s));
        return {};
    }

    sqlite3_db_config(db, SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION, 1, NULL);
    sqlite3_db_config(db, SQLITE_DBCONFIG_DEFENSIVE, 1, NULL);

    int status = sqlite3_deserialize(db, "main", reinterpret_cast<unsigned char*>(data), byteLength, byteLength + slack, deserializeFlags);
    // SQLITE_DESERIALIZE_FREEONCLOSE transfers ownership of `data` to SQLite,
    // which frees it itself when deserialization fails. Do not free it again here.
    if (status == SQLITE_BUSY) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "SQLITE_BUSY"_s));
        return {};
    }

    if (status != SQLITE_OK) {
        auto message = status == SQLITE_ERROR ? WTF::String("unable to deserialize database"_s) : WTF::String::fromUTF8(sqlite3_errstr(status));
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, message));
        return {};
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(JSSQLDatabase::create(lexicalGlobalObject, WTF::move(handle), byteLength + slack)));
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementSerialize, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    VersionSqlite3* versionDB = databaseForHandle(lexicalGlobalObject, scope, callFrame->argument(0));
    if (!versionDB) [[unlikely]]
        return {};

    auto attachedName = toCString(lexicalGlobalObject, scope, "name"_s, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});

    if (attachedName.isEmpty()) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected attached database name"_s));
        return {};
    }

    // Read after toCString: a user toString() may have closed the database.
    sqlite3* db = versionDB->handle();
    if (!db) [[unlikely]] {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Can't do this on a closed database"_s));
        return {};
    }

    sqlite3_int64 length = -1;
    unsigned char* data = sqlite3_serialize(db, attachedName.legacyCStringPointer(), &length, 0);
    if (data == nullptr && length) [[unlikely]] {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Out of memory"_s));
        return {};
    }

    RELEASE_AND_RETURN(scope, JSBuffer__bufferFromPointerAndLengthAndDeinit(lexicalGlobalObject, reinterpret_cast<char*>(data), static_cast<unsigned int>(length), NULL, sqlite_free_typed_array));
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementLoadExtensionFunction, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    VersionSqlite3* versionDB = databaseForHandle(lexicalGlobalObject, scope, callFrame->argument(0));
    if (!versionDB) [[unlikely]]
        return {};

    JSC::JSValue extension = callFrame->argument(1);
    if (!extension.isString()) [[unlikely]] {
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Expected string"_s));
        return {};
    }

    auto extensionPath = toCString(lexicalGlobalObject, scope, "extension"_s, extension);
    RETURN_IF_EXCEPTION(scope, {});
    UTF8CString entryPoint;
    if (callFrame->argument(2).isString()) {
        entryPoint = toCString(lexicalGlobalObject, scope, "entryPoint"_s, callFrame->argument(2));
        RETURN_IF_EXCEPTION(scope, {});
    }

    sqlite3* db = versionDB->handle();
    if (!db) [[unlikely]] {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Can't do this on a closed database"_s));
        return {};
    }

    if (sqlite3_compileoption_used("SQLITE_OMIT_LOAD_EXTENSION")) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "This build of sqlite3 does not support dynamic extension loading"_s));
        return {};
    }

    char* error;
    int rc = sqlite3_load_extension(db, extensionPath.legacyCStringPointer(), entryPoint.isEmpty() ? nullptr : entryPoint.legacyCStringPointer(), &error);

    // TODO: can we disable loading extensions after this?
    if (rc != SQLITE_OK) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, error ? sqliteString(error) : String::fromUTF8(sqlite3_errmsg(db))));
        return {};
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::jsUndefined()));
}

static bool isSkippedInSQLiteQuery(const char c)
{
    return c == ' ' || c == ';' || (c >= '\t' && c <= '\r');
}

// SQLite parses text that ends in a NUL in place. It copies any other text, once for each prepare.
class NulTerminatedSQL {
public:
    bool init(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSString* string)
    {
        auto view = string->view(globalObject);
        RETURN_IF_EXCEPTION(scope, false);
        if (view->is8Bit() && view->containsOnlyASCII()) {
            auto characters = byteCast<char>(view->span8());
            if (m_ascii.tryReserveInitialCapacity(characters.size() + 1)) [[likely]] {
                m_ascii.append(characters);
                m_ascii.append('\0');
                m_text = m_ascii.span().first(characters.size());
                return true;
            }
        } else if (auto converted = view->tryGetUTF8()) {
            m_converted = WTF::move(converted.value());
            m_text = byteCast<char>(m_converted.span());
            return true;
        }
        throwOutOfMemoryError(globalObject, scope);
        return false;
    }

    const char* begin() const { return m_text.data(); }
    // The NUL.
    const char* end() const { return m_text.data() + m_text.size(); }

private:
    // One lookaside slot: what SQLite copied without a malloc is copied here without one.
    WTF::Vector<char, 1200> m_ascii;
    WTF::UTF8CString m_converted;
    std::span<const char> m_text;
};

// The rows that a statement which can write changed itself: not those of its triggers and foreign key actions.
// sqlite3_changes64() keeps the count of an earlier statement when this one counted nothing.
static int64_t changesSince(sqlite3* db, int64_t totalChangesBefore)
{
    return sqlite3_total_changes64(db) == totalChangesBefore ? 0 : sqlite3_changes64(db);
}

static void putChanges(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSValue tuple, sqlite3* db, int64_t changes, bool safeIntegers)
{
    auto* diff = dynamicDowncast<JSC::InternalFieldTuple>(tuple);
    if (!diff)
        return;
    auto& vm = JSC::getVM(globalObject);
    int64_t lastInsertRowid = sqlite3_last_insert_rowid(db);
    JSC::JSValue rowid = safeIntegers ? JSBigInt::createFrom(globalObject, lastInsertRowid) : JSC::jsNumber(lastInsertRowid);
    RETURN_IF_EXCEPTION(scope, void());
    diff->putInternalField(vm, 0, JSC::jsNumber(changes));
    diff->putInternalField(vm, 1, rowid);
}

// Runs the statements of `sql` from `head` on. The first of them gets `bindingsValue`. Returns how many rows they
// changed, or nothing when there was no statement or an exception is pending.
// db.run() has always run a statement that nothing was bound to with NULL. `refuseParameters` throws instead of running it.
static std::optional<int64_t> runStatements(JSC::JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, VersionSqlite3* versionDB, sqlite3* db, const NulTerminatedSQL& sql, const char* head, JSC::JSValue bindingsValue, int32_t internalFlags, bool refuseParameters)
{
    std::optional<int64_t> changes;

    for (;;) {
        while (isSkippedInSQLiteQuery(*head))
            head++;
        if (head == sql.end())
            break;

        AutoDestructingSQLiteStatement statement;
        const char* tail = nullptr;
        int rc = sqlite3_prepare_v3(db, head, -1, 0, &statement.stmt, &tail);

        if (rc == SQLITE_OK && statement.stmt) {
            if (refuseParameters && sqlite3_bind_parameter_count(statement.stmt)) [[unlikely]] {
                throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Only the first statement of a SQLite query can have parameters"_s));
                return std::nullopt;
            }

            if (!changes && !bindingsValue.isUndefinedOrNull()) {
                SQLiteBindingsMap bindings { (internalFlags & kStrictFlag) != 0 };
                // After a close() during binding, finalizing the statement on scope exit completes the sqlite3_close_v2.
                if (!SQLiteBinder { lexicalGlobalObject, scope, versionDB, statement.stmt, nullptr, bindings, (internalFlags & kSafeIntegersFlag) != 0 }.bind(bindingsValue))
                    return std::nullopt;
            }

            const bool canWrite = !sqlite3_stmt_readonly(statement.stmt);
            const int64_t totalChangesBefore = canWrite ? sqlite3_total_changes64(db) : 0;

            do {
                rc = sqlite3_step(statement.stmt);
            } while (rc == SQLITE_ROW);

            if (rc == SQLITE_DONE) [[likely]] {
                rc = SQLITE_OK;
                changes = changes.value_or(0) + (canWrite ? changesSince(db, totalChangesBefore) : 0);
            }
        }

        if (rc != SQLITE_OK) [[unlikely]] {
            if (!scope.exception())
                throwException(lexicalGlobalObject, scope, createSQLiteError(lexicalGlobalObject, db, head - sql.begin()));
            return std::nullopt;
        }

        // A NUL inside the text.
        if (tail == head)
            break;
        head = tail;
    }
    return changes;
}

// This runs a query one-off
// without the overhead of a long-lived statement object
// does not return anything
JSC_DEFINE_HOST_FUNCTION(jsSQLStatementExecuteFunction, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    VersionSqlite3* versionDB = databaseForHandle(lexicalGlobalObject, scope, callFrame->argument(0));
    if (!versionDB) [[unlikely]]
        return {};
    sqlite3* db = versionDB->handle();

    if (!db) [[unlikely]] {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Database has closed"_s));
        return {};
    }

    JSC::JSValue internalFlagsValue = callFrame->argument(1);
    JSC::JSValue sqlValue = callFrame->argument(3);
    JSC::JSValue bindingsValue = callFrame->argument(4);
    if (!sqlValue.isString()) [[unlikely]] {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected SQL string"_s));
        return {};
    }

    auto* jsSqlString = asString(sqlValue);
    if (jsSqlString->length() == 0) [[unlikely]] {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "SQL string mustn't be blank"_s));
        return {};
    }

    NulTerminatedSQL sql;
    if (!sql.init(lexicalGlobalObject, scope, jsSqlString)) [[unlikely]]
        return {};

    const int32_t internalFlags = internalFlagsValue.isInt32() ? internalFlagsValue.asInt32() : 0;
    auto changes = runStatements(lexicalGlobalObject, scope, versionDB, db, sql, sql.begin(), bindingsValue, internalFlags, false);
    RETURN_IF_EXCEPTION(scope, {});
    if (!changes) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Query contained no valid SQL statement; likely empty query."_s));
        return {};
    }

    putChanges(lexicalGlobalObject, scope, callFrame->argument(2), db, *changes, (internalFlags & kSafeIntegersFlag) != 0);
    RELEASE_AND_RETURN(scope, JSValue::encode(jsUndefined()));
}

// For Bun.sql: runs what follows the statement in `sql`, the text that it was prepared from. The values of a query are
// the first statement's, so a later one with a parameter is refused. Returns how many rows changed, or undefined when
// nothing follows.
JSC_DEFINE_HOST_FUNCTION(jsSQLStatementRunTailFunction, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    JSSQLStatement* castedThis = dynamicDowncast<JSSQLStatement>(callFrame->thisValue());
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_THIS
    CHECK_PREPARED

    JSC::JSValue sqlValue = callFrame->argument(0);
    if (!sqlValue.isString()) [[unlikely]] {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected SQL string"_s));
        return {};
    }

    NulTerminatedSQL sql;
    if (!sql.init(lexicalGlobalObject, scope, asString(sqlValue))) [[unlikely]]
        return {};

    // sqlite3_sql() ends where sqlite3_prepare_v3() stopped.
    const size_t ownLength = std::min<size_t>(strlen(sqlite3_sql(castedThis->stmt)), sql.end() - sql.begin());
    auto changes = runStatements(lexicalGlobalObject, scope, castedThis->version_db.get(), sqlite3_db_handle(castedThis->stmt), sql, sql.begin() + ownLength, jsUndefined(), 0, true);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(changes ? jsNumber(*changes) : jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementIsInTransactionFunction, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    VersionSqlite3* versionDB = databaseForHandle(lexicalGlobalObject, scope, callFrame->argument(0));
    if (!versionDB) [[unlikely]]
        return {};

    sqlite3* db = versionDB->handle();

    if (!db) [[unlikely]] {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Database has closed"_s));
        return {};
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(jsBoolean(!sqlite3_get_autocommit(db))));
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementPrepareStatementFunction, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSValue sqlValue = callFrame->argument(1);
    JSC::JSValue bindings = callFrame->argument(2);
    JSC::JSValue prepareFlagsValue = callFrame->argument(3);
    JSC::JSValue internalFlagsValue = callFrame->argument(4);

    VersionSqlite3* versionDB = databaseForHandle(lexicalGlobalObject, scope, callFrame->argument(0));
    if (!versionDB) [[unlikely]]
        return {};

    if (!sqlValue.isString()) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected SQL string"_s));
        return {};
    }

    sqlite3* db = versionDB->handle();
    if (!db) {
        throwException(lexicalGlobalObject, scope, createRangeError(lexicalGlobalObject, "Cannot use a closed database"_s));
        return {};
    }

    auto* jsSqlString = asString(sqlValue);
    if (!jsSqlString->length()) {
        throwException(lexicalGlobalObject, scope, createRangeError(lexicalGlobalObject, "Invalid SQL statement"_s));
        return {};
    }
    NulTerminatedSQL sql;
    if (!sql.init(lexicalGlobalObject, scope, jsSqlString)) [[unlikely]]
        return {};

    unsigned int flags = DEFAULT_SQLITE_PREPARE_FLAGS;
    if (prepareFlagsValue.isNumber()) {

        int prepareFlags = JSC::toInt32(prepareFlagsValue.asNumber());
        if (prepareFlags < 0 || prepareFlags > MAX_SQLITE_PREPARE_FLAG) {
            throwException(lexicalGlobalObject, scope, createRangeError(lexicalGlobalObject, "Invalid prepare flags"_s));
            return {};
        }
        flags = static_cast<unsigned int>(prepareFlags);
    }

    sqlite3_stmt* statement = nullptr;

    int rc = sqlite3_prepare_v3(db, sql.begin(), -1, flags, &statement, nullptr);

    if (rc != SQLITE_OK) {
        if (!scope.exception())
            throwException(lexicalGlobalObject, scope, createSQLiteError(lexicalGlobalObject, db));
        return {};
    }

    // nullptr with SQLITE_OK: the input contained no SQL (only whitespace and/or comments)
    if (!statement) {
        throwException(lexicalGlobalObject, scope, createRangeError(lexicalGlobalObject, "Invalid SQL statement"_s));
        return {};
    }

    JSSQLStatement* sqlStatement = JSSQLStatement::create(
        static_cast<Zig::GlobalObject*>(lexicalGlobalObject), statement, uncheckedDowncast<JSSQLDatabase>(callFrame->argument(0)));

    if (internalFlagsValue.isInt32()) {
        const int32_t internalFlags = internalFlagsValue.asInt32();
        sqlStatement->m_bindingNames.strict = (internalFlags & kStrictFlag) != 0;
        sqlStatement->useBigInt64 = (internalFlags & kSafeIntegersFlag) != 0;
        sqlStatement->ownedByDatabase = (internalFlags & kOwnedByDatabaseFlag) != 0;
    }

    if (!bindings.isUndefined() && !SQLiteBinder { lexicalGlobalObject, scope, versionDB, statement, sqlStatement, sqlStatement->m_bindingNames, sqlStatement->useBigInt64 }.bind(bindings, true)) {
        // Nobody gets this statement. Left to the collector, it would keep the file open after db.close().
        sqlStatement->finalizeStatement();
        return {};
    }
    return JSValue::encode(JSValue(sqlStatement));
}

JSSQLStatementConstructor* JSSQLStatementConstructor::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
{
    NativeExecutable* executable = vm.getHostFunction(jsSQLStatementPrepareStatementFunction, ImplementationVisibility::Private, callHostFunctionAsConstructor, 0, String("SQLStatement"_s));
    JSSQLStatementConstructor* ptr = new (NotNull, JSC::allocateCell<JSSQLStatementConstructor>(vm)) JSSQLStatementConstructor(vm, executable, globalObject, structure);
    ptr->finishCreation(vm);

    return ptr;
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementOpenStatementFunction, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue pathValue = callFrame->argument(0);
    if (!pathValue.isString()) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected string"_s));
        return {};
    }

    if (!Bun::loadSQLite(lexicalGlobalObject, scope)) [[unlikely]]
        return {};

    auto path = toCString(lexicalGlobalObject, scope, "filename"_s, pathValue);
    RETURN_IF_EXCEPTION(scope, {});
    int openFlags = DEFAULT_SQLITE_FLAGS;
    if (callFrame->argumentCount() > 1) {
        JSValue flags = callFrame->argument(1);
        if (!flags.isNumber()) {
            throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected number"_s));
            return {};
        }

        openFlags = JSC::toInt32(flags.asNumber());
    }

    sqlite3* db = nullptr;
    int statusCode = sqlite3_open_v2(path.legacyCStringPointer(), &db, openFlags, nullptr);
    SQLiteHandle handle { db };

    if (statusCode != SQLITE_OK) {
        throwException(lexicalGlobalObject, scope, createSQLiteError(lexicalGlobalObject, db));
        return {};
    }

    sqlite3_extended_result_codes(db, 1);

    sqlite3_db_config(db, SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION, 1, NULL);
    sqlite3_db_config(db, SQLITE_DBCONFIG_DEFENSIVE, 1, NULL);
    RELEASE_AND_RETURN(scope, JSValue::encode(JSSQLDatabase::create(lexicalGlobalObject, WTF::move(handle))));
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementCloseStatementFunction, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    VersionSqlite3* versionDB = databaseForHandle(lexicalGlobalObject, scope, callFrame->argument(0));
    if (!versionDB) [[unlikely]]
        return {};

    bool force = callFrame->argument(1).toBoolean(lexicalGlobalObject);

    // no-op if already closed; close(true) after close(false) still force-finalizes whatever was kept
    if (!versionDB->db || (versionDB->closed && !force)) {
        return JSValue::encode(jsUndefined());
    }

    int statusCode = versionDB->close(force);
    if (!versionDB->db)
        uncheckedDowncast<JSSQLDatabase>(callFrame->argument(0))->dropCallbacks();
    if (statusCode != SQLITE_OK) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, WTF::String::fromUTF8(sqlite3_errstr(statusCode))));
        return {};
    }
    return JSValue::encode(jsUndefined());
}

// What db.function() and db.aggregate() give to SqliteUserFunction.h.
struct SQLiteCallbacks {
    JSC::JSGlobalObject* globalObject;
    // What calls the function (a statement, db.run()) holds a reference.
    VersionSqlite3* connection;
    WTF::String name;
    bool safeIntegers;

    JSValue toJS(sqlite3_value* value) const
    {
        auto& vm = JSC::getVM(globalObject);
        return safeIntegers ? WebCore::toJS<true>(vm, globalObject, Bun::SqliteArgument { value }) : WebCore::toJS<false>(vm, globalObject, Bun::SqliteArgument { value });
    }

    void setResult(sqlite3_context* context, JSValue value) const
    {
        auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
        if (fromJS(globalObject, scope, Bun::SqliteResult { context }, value, safeIntegers) == kUnsupportedValue)
            throwTypeError(globalObject, scope, makeString("User-defined function "_s, name, "() returned an invalid value"_s));
    }

    struct CallbackScope : WTF::SetForScope<bool> {
        explicit CallbackScope(const SQLiteCallbacks& callbacks)
            : SetForScope(callbacks.connection->inCallback, true)
        {
        }
    };
    static constexpr bool undefinedKeepsAccumulator = true;
    static JSValue thisOfStartAndResult() { return jsUndefined(); }
};

// db.function(): (handle, name, argumentCount, flags, safeIntegers, function).
// db.aggregate(): (handle, name, argumentCount, flags, safeIntegers, start, step, inverse, result).
JSC_DEFINE_HOST_FUNCTION(jsSQLStatementDefineFunction, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    VersionSqlite3* versionDB = databaseForHandle(lexicalGlobalObject, scope, callFrame->argument(0));
    if (!versionDB) [[unlikely]]
        return {};
    auto* database = uncheckedDowncast<JSSQLDatabase>(callFrame->argument(0));

    const bool isAggregate = callFrame->argumentCount() > 6;
    const auto& callback = [&](unsigned index) {
        JSValue value = callFrame->argument(index);
        return value.isCallable() ? value.getObject() : nullptr;
    };
    JSObject* function = callback(isAggregate ? 6 : 5);
    if (!callFrame->argument(1).isString() || !callFrame->argument(2).isInt32() || !callFrame->argument(3).isInt32() || !function) [[unlikely]] {
        throwTypeError(lexicalGlobalObject, scope, "Expected a name, two integers and a function"_s);
        return {};
    }

    auto name = callFrame->argument(1).toWTFString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto nameUTF8 = toCString(lexicalGlobalObject, scope, "name"_s, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    int argumentCount = callFrame->argument(2).asInt32();
    int flags = SQLITE_UTF8 | (callFrame->argument(3).asInt32() & (SQLITE_DETERMINISTIC | SQLITE_DIRECTONLY));

    sqlite3* db = versionDB->handle();
    if (!db) [[unlikely]] {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Database has closed"_s));
        return {};
    }

    SQLiteCallbacks callbacks { lexicalGlobalObject, versionDB, name, callFrame->argument(4).isTrue() };
    Bun::SqliteCallbackRoots::Values roots { function };
    int rc;
    if (isAggregate) {
        roots = { function, callFrame->argument(5), callback(7), callback(8) };
        rc = Bun::SqliteUserAggregate<SQLiteCallbacks>::create(db, nameUTF8.legacyCStringPointer(), argumentCount, flags, WTF::move(callbacks), callFrame->argument(5), function, callback(7), callback(8));
    } else {
        rc = Bun::SqliteUserFunction<SQLiteCallbacks>::create(db, nameUTF8.legacyCStringPointer(), argumentCount, flags, WTF::move(callbacks), function);
    }

    if (rc != SQLITE_OK) [[unlikely]] {
        // A name or an argument count that SQLite refuses is SQLITE_MISUSE, which leaves no message on the connection.
        bool hasMessage = (sqlite3_errcode(db) & 0xff) == (rc & 0xff);
        throwException(lexicalGlobalObject, scope, hasMessage ? createSQLiteError(lexicalGlobalObject, db) : createSQLiteError(lexicalGlobalObject, rc, sqlite3_errstr(rc), -1));
        return {};
    }

    database->m_callbacks.set(vm, database, name, argumentCount, roots);
    return JSValue::encode(jsUndefined());
}

static std::optional<unsigned> updateHookIndex(int operation)
{
    switch (operation) {
    case SQLITE_INSERT:
        return 0;
    case SQLITE_UPDATE:
        return 1;
    case SQLITE_DELETE:
        return 2;
    default:
        return std::nullopt;
    }
}

// What runs the statement (a JSSQLStatement, db.run()) keeps the cell alive.
static void callUpdateHook(void* cell, int operation, const char* schema, const char* table, sqlite3_int64 rowid)
{
    if (Bun::sqliteScriptIsForbidden) [[unlikely]]
        return;
    auto* database = static_cast<JSSQLDatabase*>(cell);
    auto index = updateHookIndex(operation);
    JSObject* hook = index ? database->m_updateHooks[*index].get() : nullptr;
    if (!hook)
        return;

    auto* globalObject = database->globalObject();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    if (scope.exception()) [[unlikely]]
        return;

    JSObject* wrapper = database->m_wrapper.get();
    MarkedArgumentBuffer arguments;
    arguments.append(wrapper);
    arguments.append(jsString(vm, Bun::sqliteText(table)));
    arguments.append(database->m_safeIntegers ? JSBigInt::createFrom(globalObject, static_cast<int64_t>(rowid)) : jsNumber(static_cast<int64_t>(rowid)));
    arguments.append(jsString(vm, Bun::sqliteText(schema)));

    WTF::SetForScope inCallback { database->record().inCallback, true };
    if (!scope.exception()) [[likely]]
        JSC::call(globalObject, hook, JSC::getCallData(hook), wrapper, arguments);
    // SQLite goes on with the statement whatever happens here.
    if (auto* exception = scope.exception(); exception && !vm.hasPendingTerminationException()) [[unlikely]] {
        scope.clearException();
        Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(globalObject, exception);
        RETURN_IF_EXCEPTION(scope, void());
    }
}

// (handle, operation). Null with an exception pending.
static JSC::WriteBarrier<JSObject>* updateHookOf(JSC::JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, JSC::CallFrame* callFrame)
{
    if (!databaseForHandle(lexicalGlobalObject, scope, callFrame->argument(0))) [[unlikely]]
        return nullptr;

    JSValue operation = callFrame->argument(1);
    auto index = operation.isInt32() ? updateHookIndex(operation.asInt32()) : std::nullopt;
    if (!index) [[unlikely]] {
        throwTypeError(lexicalGlobalObject, scope, "Expected SQLITE_INSERT, SQLITE_UPDATE or SQLITE_DELETE"_s);
        return nullptr;
    }
    return &uncheckedDowncast<JSSQLDatabase>(callFrame->argument(0))->m_updateHooks[*index];
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementGetUpdateHookFunction, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* hook = updateHookOf(lexicalGlobalObject, scope, callFrame);
    if (!hook) [[unlikely]]
        return {};
    return JSValue::encode(*hook ? JSValue(hook->get()) : jsNull());
}

// (handle, operation, hook, database, internalFlags)
JSC_DEFINE_HOST_FUNCTION(jsSQLStatementSetUpdateHookFunction, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* hook = updateHookOf(lexicalGlobalObject, scope, callFrame);
    if (!hook) [[unlikely]]
        return {};
    auto* database = uncheckedDowncast<JSSQLDatabase>(callFrame->argument(0));

    JSValue value = callFrame->argument(2);
    if (!value.isUndefinedOrNull() && !value.isCallable()) [[unlikely]] {
        throwTypeError(lexicalGlobalObject, scope, "Expected a function or null"_s);
        return {};
    }

    sqlite3* db = database->record().handle();
    if (!db) [[unlikely]] {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Database has closed"_s));
        return {};
    }

    hook->setMayBeNull(vm, database, value.getObject());
    const auto& hooks = database->m_updateHooks;
    const bool hasHook = hooks[0] || hooks[1] || hooks[2];
    database->m_wrapper.setMayBeNull(vm, database, hasHook ? callFrame->argument(3).getObject() : nullptr);
    database->m_safeIntegers = callFrame->argument(4).isInt32() && (callFrame->argument(4).asInt32() & kSafeIntegersFlag);
    sqlite3_update_hook(db, hasHook ? callUpdateHook : nullptr, database);
    database->record().hasUpdateHook |= hasHook;
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementFcntlFunction, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue databaseFileName = callFrame->argument(1);
    JSValue opNumber = callFrame->argument(2);
    JSValue resultValue = callFrame->argument(3);

    VersionSqlite3* versionDB = databaseForHandle(lexicalGlobalObject, scope, callFrame->argument(0));
    if (!versionDB) [[unlikely]]
        return {};

    if (!opNumber.isNumber()) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected number"_s));
        return {};
    }

    int op = JSC::toInt32(opNumber.asNumber());

    sqlite3* db = versionDB->handle();
    // no-op if already closed
    if (!db) {
        return JSValue::encode(jsUndefined());
    }

    UTF8CString fileNameStr;

    if (databaseFileName.isString()) {
        fileNameStr = toCString(lexicalGlobalObject, scope, "zDbName"_s, databaseFileName);
        RETURN_IF_EXCEPTION(scope, {});
    }

    // SQLite dereferences pArg without a null check. -1 is "query" for the in/out opcodes.
    union {
        int64_t number;
        char* string;
    } scratch;
    scratch.number = -1;
    void* resultPtr = &scratch;
    if (resultValue.isNumber()) {
        scratch.number = JSC::toInt32(resultValue.asNumber());
    } else if (auto* view = dynamicDowncast<JSC::JSArrayBufferView>(resultValue)) {
        if (view->isDetached()) {
            throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "TypedArray is detached"_s));
            return {};
        }

        if (view->byteLength() < sizeof(int64_t)) {
            throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "TypedArray must be at least 8 bytes"_s));
            return {};
        }

        resultPtr = view->vector();
        if (resultPtr == nullptr) {
            throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected buffer"_s));
            return {};
        }
    } else if (resultValue.isUndefinedOrNull()) {
        // NULL is a value for this opcode: no proxy file.
        if (op == SQLITE_FCNTL_SET_LOCKPROXYFILE)
            resultPtr = nullptr;
    } else {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected result to be a number, null or a TypedArray"_s));
        return {};
    }

    // SQLite allocates the string of these two opcodes, and the caller frees it.
    bool ownsString = resultPtr == &scratch && (op == SQLITE_FCNTL_VFSNAME || op == SQLITE_FCNTL_TEMPFILENAME);
    if (ownsString)
        scratch.string = nullptr;

    int statusCode = sqlite3_file_control(db, fileNameStr.isNull() ? nullptr : fileNameStr.legacyCStringPointer(), op, resultPtr);

    if (ownsString)
        sqlite3_free(scratch.string);

    if (statusCode == SQLITE_ERROR) {
        throwException(lexicalGlobalObject, scope, createSQLiteError(lexicalGlobalObject, db));
        return {};
    }

    return JSValue::encode(jsNumber(statusCode));
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementHandleNumberFunction, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    VersionSqlite3* versionDB = databaseForHandle(lexicalGlobalObject, scope, callFrame->argument(0));
    if (!versionDB) [[unlikely]]
        return {};

    return JSValue::encode(jsNumber(versionDB->handleNumber));
}

/* Hash table for constructor */
static const HashTableValue JSSQLStatementConstructorTableValues[] = {
    { "open"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementOpenStatementFunction, 2 } },
    { "close"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementCloseStatementFunction, 1 } },
    { "prepare"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementPrepareStatementFunction, 2 } },
    { "run"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementExecuteFunction, 3 } },
    { "isInTransaction"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementIsInTransactionFunction, 1 } },
    { "loadExtension"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementLoadExtensionFunction, 2 } },
    { "setCustomSQLite"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementSetCustomSQLite, 1 } },
    { "serialize"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementSerialize, 1 } },
    { "deserialize"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementDeserialize, 2 } },
    { "fcntl"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementFcntlFunction, 2 } },
    { "handleNumber"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementHandleNumberFunction, 1 } },
    { "defineFunction"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementDefineFunction, 6 } },
    { "updateHook"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementGetUpdateHookFunction, 2 } },
    { "setUpdateHook"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementSetUpdateHookFunction, 5 } },
};

const ClassInfo JSSQLStatementConstructor::s_info = { "SQLStatement"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSSQLStatementConstructor) };

void JSSQLStatementConstructor::finishCreation(VM& vm)
{
    Base::finishCreation(vm);

    // TODO: use LazyClassStructure?
    auto* instanceObject = JSSQLStatement::create(static_cast<Zig::GlobalObject*>(globalObject()), nullptr, nullptr);
    JSValue proto = instanceObject->getPrototype(globalObject());

    this->putDirect(vm, vm.propertyNames->prototype, proto, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);

    Bun::reifyStaticPropertyTable(vm, JSSQLStatementConstructor::info(), JSSQLStatementConstructorTableValues, *this);
    Bun::putToStringTagWithoutTransition(vm, this, info());

    ASSERT(inherits(info()));
}

template<bool useBigInt64>
static inline JSC::JSValue constructResultObject(JSC::JSGlobalObject* lexicalGlobalObject, JSSQLStatement* castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stmt = castedThis->stmt;
    JSC::JSObject* result;

    if (auto* structure = castedThis->_structure.get()) [[likely]] {
        if (unsigned outOfLineCapacity = structure->outOfLineCapacity()) [[unlikely]]
            result = JSC::JSFinalObject::createWithButterfly(vm, structure, JSC::Butterfly::create(vm, nullptr, 0, outOfLineCapacity, false, JSC::IndexingHeader(), 0));
        else
            result = JSC::constructEmptyObject(vm, structure);

        int i = 0;
        for (auto slot : castedThis->columnSlots) {
            int column = i++;
            if (slot.kind == SQLiteColumnSlot::Kind::Shadowed) [[unlikely]]
                continue;
            auto value = toJS<useBigInt64>(vm, lexicalGlobalObject, Bun::SqliteColumn { stmt, column });
            RETURN_IF_EXCEPTION(scope, {});
            if (slot.kind == SQLiteColumnSlot::Kind::Offset) [[likely]] {
                result->putDirectOffset(vm, slot.value, value);
            } else {
                result->putDirectIndex(lexicalGlobalObject, slot.value, value);
                RETURN_IF_EXCEPTION(scope, {});
            }
        }
    } else {
        JSObject* prototype = castedThis->userPrototype ? castedThis->userPrototype.get() : lexicalGlobalObject->objectPrototype();
        result = JSC::constructEmptyObject(lexicalGlobalObject, prototype, JSFinalObject::maxInlineCapacity);

        int i = 0;
        for (const auto& name : castedThis->columnNames) {
            auto value = toJS<useBigInt64>(vm, lexicalGlobalObject, Bun::SqliteColumn { stmt, i++ });
            RETURN_IF_EXCEPTION(scope, {});
            result->putDirectMayBeIndex(lexicalGlobalObject, name, value);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    RELEASE_AND_RETURN(scope, result);
}

static inline JSC::JSValue constructResultObject(JSC::JSGlobalObject* lexicalGlobalObject, JSSQLStatement* castedThis)
{
    return castedThis->useBigInt64 ? constructResultObject<true>(lexicalGlobalObject, castedThis) : constructResultObject<false>(lexicalGlobalObject, castedThis);
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementSetPrototypeFunction, (JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* castedThis = dynamicDowncast<JSSQLStatement>(callFrame->thisValue());

    CHECK_THIS
    if (castedThis->version_db)
        CHECK_NOT_BUSY(castedThis->version_db)

    JSValue classValue = callFrame->argument(0);

    if (classValue.isUndefined() || classValue == lexicalGlobalObject->objectConstructor()) {
        castedThis->userPrototype.clear();
    } else if (JSObject* classObject = classValue.getObject()) {
        if (!classObject->isConstructor()) {
            throwTypeError(lexicalGlobalObject, scope, "Expected a constructor"_s);
            return {};
        }

        JSValue prototype = classObject->getIfPropertyExists(lexicalGlobalObject, vm.propertyNames->prototype);
        RETURN_IF_EXCEPTION(scope, {});
        if (!prototype) [[unlikely]] {
            throwTypeError(lexicalGlobalObject, scope, "Expected constructor to have a prototype"_s);
            return {};
        }

        if (!prototype.isObject()) {
            throwTypeError(lexicalGlobalObject, scope, "Expected a constructor prototype to be an object"_s);
            return {};
        }

        castedThis->userPrototype.set(vm, castedThis, prototype.getObject());
    } else {
        throwTypeError(lexicalGlobalObject, scope, "Expected class to be a constructor or undefined"_s);
        return {};
    }

    castedThis->dropRowShape();
    return JSValue::encode(jsUndefined());
}

// The run that starts here takes the cursor from the one before it. Null with an exception pending.
static JSSQLStatement* resetAndBind(JSC::JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, JSC::JSValue thisValue, JSC::JSValue arguments)
{
    auto* castedThis = dynamicDowncast<JSSQLStatement>(thisValue);
    CHECK_THIS
    CHECK_PREPARED

    auto* stmt = castedThis->stmt;
    if (sqlite3_reset(stmt) != SQLITE_OK) [[unlikely]] {
        throwException(lexicalGlobalObject, scope, createSQLiteError(lexicalGlobalObject, sqlite3_db_handle(stmt)));
        return nullptr;
    }

    if (!arguments.isUndefined() && !SQLiteBinder { lexicalGlobalObject, scope, castedThis->version_db.get(), stmt, castedThis, castedThis->m_bindingNames, castedThis->useBigInt64 }.bind(arguments))
        return nullptr;

    return castedThis;
}

// In the host function that runs a statement. However that call is left, the run ends with it: every RETURN_IF_EXCEPTION can raise
// the termination of a Worker, and a write that stayed on a row would be committed by whatever ended it later.
class StatementRun {
public:
    // Null once there is nothing to end.
    sqlite3_stmt* stmt;

    ~StatementRun()
    {
        if (stmt) [[unlikely]]
            sqlite3_reset(stmt);
    }
};

// Not inline: the registers that this needs would be saved and restored for every row.
static NEVER_INLINE void throwStepError(JSC::JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, sqlite3_stmt* stmt)
{
    // What a user function threw is pending already.
    if (!scope.exception())
        throwException(lexicalGlobalObject, scope, createSQLiteError(lexicalGlobalObject, sqlite3_db_handle(stmt)));
}

// SQLITE_ROW or SQLITE_DONE. Anything else is thrown.
static ALWAYS_INLINE int step(JSC::JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, sqlite3_stmt* stmt)
{
    int status = sqlite3_step(stmt);
    if (status != SQLITE_ROW && status != SQLITE_DONE) [[unlikely]]
        throwStepError(lexicalGlobalObject, scope, stmt);
    return status;
}

static JSC::EncodedJSValue collectRows(JSC::JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, JSSQLStatement* castedThis, int status, const auto& constructRow)
{
    auto* stmt = castedThis->stmt;
    JSC::JSArray* rows = JSC::JSArray::create(JSC::getVM(lexicalGlobalObject), lexicalGlobalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithContiguous), 0);

    while (status == SQLITE_ROW) {
        JSC::JSValue row = constructRow();
        RETURN_IF_EXCEPTION(scope, {});

        // Not push(): an indexed setter on a prototype would get the row in place of the array, and the array as `this`.
        rows->putDirectIndex(lexicalGlobalObject, rows->length(), row);
        RETURN_IF_EXCEPTION(scope, {});

        status = step(lexicalGlobalObject, scope, stmt);
        RETURN_IF_EXCEPTION(scope, {});
    }

    return JSValue::encode(rows);
}

// values() and raw(): a row is the array of what `toValue` makes of each column.
template<JSValue (*toValue)(JSC::VM&, JSC::JSGlobalObject*, Bun::SqliteColumn)>
static JSC::EncodedJSValue collectArrays(JSC::JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, JSSQLStatement* castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto* stmt = castedThis->stmt;
    int status = step(lexicalGlobalObject, scope, stmt);
    RETURN_IF_EXCEPTION(scope, {});

    const int columnCount = sqlite3_column_count(stmt);
    return collectRows(lexicalGlobalObject, scope, castedThis, status, [&]() -> JSC::JSValue {
        MarkedArgumentBuffer arguments;
        arguments.ensureCapacity(columnCount);
        for (int i = 0; i < columnCount; i++) {
            JSValue value = toValue(vm, lexicalGlobalObject, { stmt, i });
            if (scope.exception()) [[unlikely]]
                return {};
            arguments.append(value);
        }
        return JSC::constructArray(lexicalGlobalObject, lexicalGlobalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithContiguous), arguments);
    });
}

// A number that only this run of the statement has. (EXPLAIN does not count as a run.)
static int runCount(sqlite3_stmt* stmt)
{
    return sqlite3_stmt_status(stmt, SQLITE_STMTSTATUS_RUN, 0);
}

// The next row, or null at the end.
template<bool isFirstStep>
static JSC::EncodedJSValue stepIterator(JSC::JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, JSSQLStatement* castedThis)
{
    int status = step(lexicalGlobalObject, scope, castedThis->stmt);
    RETURN_IF_EXCEPTION(scope, {});
    if (status == SQLITE_DONE)
        return JSValue::encode(jsNull());

    // Without names: as() in the loop body.
    if (isFirstStep || castedThis->columnNames.isEmpty()) {
        castedThis->updateRowShape(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }

    return JSValue::encode(constructResultObject(lexicalGlobalObject, castedThis));
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementExecuteStatementFunctionIterate, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* castedThis = resetAndBind(lexicalGlobalObject, scope, callFrame->thisValue(), callFrame->argument(0));
    if (!castedThis)
        return {};

    StatementRun run { castedThis->stmt };
    JSC::EncodedJSValue row = stepIterator<true>(lexicalGlobalObject, scope, castedThis);
    RETURN_IF_EXCEPTION(scope, {});
    // iterateNext() goes on from this row.
    run.stmt = nullptr;
    return row;
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementFunctionIterateNext, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* castedThis = dynamicDowncast<JSSQLStatement>(callFrame->thisValue());

    CHECK_THIS
    CHECK_PREPARED

    auto* stmt = castedThis->stmt;
    // Not busy: a call that failed to bind has reset the statement without a new run.
    if (callFrame->argument(0) != jsNumber(runCount(stmt)) || !sqlite3_stmt_busy(stmt)) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "This iterator was invalidated: its statement was run again. Use db.prepare() to get a statement with a cursor of its own."_s));
        return {};
    }

    StatementRun run { stmt };
    JSC::EncodedJSValue row = stepIterator<false>(lexicalGlobalObject, scope, castedThis);
    RETURN_IF_EXCEPTION(scope, {});
    run.stmt = nullptr;
    return row;
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementFunctionIterateEnd, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* castedThis = dynamicDowncast<JSSQLStatement>(callFrame->thisValue());

    CHECK_THIS

    auto* stmt = castedThis->stmt;
    if (!stmt)
        return JSValue::encode(jsUndefined());
    CHECK_NOT_BUSY(castedThis->version_db)

    // For INSERT ... RETURNING that was left after a row, the reset is the commit, and it can fail.
    if (callFrame->argument(0) == jsNumber(runCount(stmt)) && sqlite3_reset(stmt) != SQLITE_OK) {
        throwException(lexicalGlobalObject, scope, createSQLiteError(lexicalGlobalObject, sqlite3_db_handle(stmt)));
        return {};
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementExecuteStatementFunctionAll, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* castedThis = resetAndBind(lexicalGlobalObject, scope, callFrame->thisValue(), callFrame->argument(0));
    if (!castedThis)
        return {};

    StatementRun run { castedThis->stmt };
    int status = step(lexicalGlobalObject, scope, castedThis->stmt);
    RETURN_IF_EXCEPTION(scope, {});
    if (status == SQLITE_ROW) {
        castedThis->updateRowShape(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }

    JSC::EncodedJSValue rows = castedThis->useBigInt64
        ? collectRows(lexicalGlobalObject, scope, castedThis, status, [&] { return constructResultObject<true>(lexicalGlobalObject, castedThis); })
        : collectRows(lexicalGlobalObject, scope, castedThis, status, [&] { return constructResultObject<false>(lexicalGlobalObject, castedThis); });
    RETURN_IF_EXCEPTION(scope, {});
    // At SQLITE_DONE.
    run.stmt = nullptr;
    return rows;
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementExecuteStatementFunctionGet, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* castedThis = resetAndBind(lexicalGlobalObject, scope, callFrame->thisValue(), callFrame->argument(0));
    if (!castedThis)
        return {};

    auto* stmt = castedThis->stmt;
    StatementRun run { stmt };
    JSC::EncodedJSValue row = stepIterator<true>(lexicalGlobalObject, scope, castedThis);
    RETURN_IF_EXCEPTION(scope, {});
    if (JSValue::decode(row).isNull()) {
        run.stmt = nullptr;
        return row;
    }

    // The other rows are not read. For INSERT ... RETURNING, which has made all its changes by now, this is the commit.
    int status = sqlite3_reset(std::exchange(run.stmt, nullptr));
    RETURN_IF_EXCEPTION(scope, {});
    if (status != SQLITE_OK) [[unlikely]] {
        throwException(lexicalGlobalObject, scope, createSQLiteError(lexicalGlobalObject, sqlite3_db_handle(stmt)));
        return {};
    }

    return row;
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementExecuteStatementFunctionRows, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* castedThis = resetAndBind(lexicalGlobalObject, scope, callFrame->thisValue(), callFrame->argument(0));
    if (!castedThis)
        return {};

    StatementRun run { castedThis->stmt };
    JSC::EncodedJSValue rows = castedThis->useBigInt64
        ? collectArrays<toJS<true, Bun::SqliteColumn>>(lexicalGlobalObject, scope, castedThis)
        : collectArrays<toJS<false, Bun::SqliteColumn>>(lexicalGlobalObject, scope, castedThis);
    RETURN_IF_EXCEPTION(scope, {});
    run.stmt = nullptr;
    return rows;
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementExecuteStatementFunctionRawRows, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* castedThis = resetAndBind(lexicalGlobalObject, scope, callFrame->thisValue(), callFrame->argument(0));
    if (!castedThis)
        return {};

    StatementRun run { castedThis->stmt };
    JSC::EncodedJSValue rows = collectArrays<toJSAsBuffer>(lexicalGlobalObject, scope, castedThis);
    RETURN_IF_EXCEPTION(scope, {});
    run.stmt = nullptr;
    return rows;
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementExecuteStatementFunctionRun, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* castedThis = resetAndBind(lexicalGlobalObject, scope, callFrame->thisValue(), callFrame->argument(1));
    if (!castedThis)
        return {};

    auto* stmt = castedThis->stmt;
    auto* db = sqlite3_db_handle(stmt);
    // COMMIT and RELEASE are read-only, but they flush FTS5, which moves sqlite3_total_changes64().
    const bool canWrite = !sqlite3_stmt_readonly(stmt);
    const int64_t totalChangesBefore = canWrite ? sqlite3_total_changes64(db) : 0;

    StatementRun run { stmt };
    int status;
    do {
        status = step(lexicalGlobalObject, scope, stmt);
        RETURN_IF_EXCEPTION(scope, {});
    } while (status == SQLITE_ROW);
    run.stmt = nullptr;

    putChanges(lexicalGlobalObject, scope, callFrame->argument(0), db, canWrite ? changesSince(db, totalChangesBefore) : 0, castedThis->useBigInt64);
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(jsUndefined()));
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementToStringFunction, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    JSSQLStatement* castedThis = dynamicDowncast<JSSQLStatement>(callFrame->thisValue());
    auto scope = DECLARE_THROW_SCOPE(vm);

    CHECK_THIS

    char* string = sqlite3_expanded_sql(castedThis->stmt);
    if (!string) {
        RELEASE_AND_RETURN(scope, JSValue::encode(jsEmptyString(vm)));
    }
    auto* jsString = JSC::jsString(vm, Bun::sqliteText(string));
    sqlite3_free(string);
    RELEASE_AND_RETURN(scope, JSValue::encode(jsString));
}

JSC_DEFINE_CUSTOM_GETTER(jsSqlStatementGetColumnNames, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName attributeName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    JSSQLStatement* castedThis = dynamicDowncast<JSSQLStatement>(JSValue::decode(thisValue));
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_THIS
    CHECK_PREPARED

    auto* stmt = castedThis->stmt;
    int count = sqlite3_column_count(stmt);
    JSC::JSArray* array = JSC::constructEmptyArray(lexicalGlobalObject, static_cast<ArrayAllocationProfile*>(nullptr), count);
    RETURN_IF_EXCEPTION(scope, {});
    for (int i = 0; i < count; i++) {
        array->putDirectIndex(lexicalGlobalObject, i, jsString(vm, Bun::sqliteText(sqlite3_column_name(stmt, i))));
        RETURN_IF_EXCEPTION(scope, {});
    }
    return JSC::JSValue::encode(array);
}

static JSC::EncodedJSValue readStatement(JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue thisValue, const auto& read)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    JSSQLStatement* castedThis = dynamicDowncast<JSSQLStatement>(JSValue::decode(thisValue));
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_THIS
    CHECK_PREPARED

    return JSValue::encode(read(castedThis));
}

JSC_DEFINE_CUSTOM_GETTER(jsSqlStatementGetColumnCount, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName attributeName))
{
    return readStatement(lexicalGlobalObject, thisValue, [](JSSQLStatement* statement) { return jsNumber(sqlite3_column_count(statement->stmt)); });
}

JSC_DEFINE_CUSTOM_GETTER(jsSqlStatementGetParamCount, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName attributeName))
{
    return readStatement(lexicalGlobalObject, thisValue, [](JSSQLStatement* statement) { return jsNumber(sqlite3_bind_parameter_count(statement->stmt)); });
}

JSC_DEFINE_CUSTOM_GETTER(jsSqlStatementGetIsFinalized, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName attributeName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    JSSQLStatement* castedThis = dynamicDowncast<JSSQLStatement>(JSValue::decode(thisValue));
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_THIS
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::jsBoolean(!castedThis->stmt)));
}

JSC_DEFINE_CUSTOM_GETTER(jsSqlStatementGetReadonly, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName attributeName))
{
    return readStatement(lexicalGlobalObject, thisValue, [](JSSQLStatement* statement) { return jsBoolean(sqlite3_stmt_readonly(statement->stmt)); });
}

JSC_DEFINE_CUSTOM_GETTER(jsSqlStatementGetRunCount, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName attributeName))
{
    return readStatement(lexicalGlobalObject, thisValue, [](JSSQLStatement* statement) { return jsNumber(runCount(statement->stmt)); });
}

JSC_DEFINE_CUSTOM_GETTER(jsSqlStatementGetColumnTypes, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName attributeName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    JSSQLStatement* castedThis = dynamicDowncast<JSSQLStatement>(JSValue::decode(thisValue));
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_THIS
    CHECK_PREPARED

    // The types are those of the first row, so the statement runs. Only one that writes nothing may.
    auto* stmt = castedThis->stmt;
    if (!sqlite3_stmt_readonly(stmt)) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "columnTypes is not available for non-read-only statements (INSERT, UPDATE, DELETE, etc.)"_s));
        return {};
    }

    if (sqlite3_reset(stmt) != SQLITE_OK) {
        throwException(lexicalGlobalObject, scope, createSQLiteError(lexicalGlobalObject, sqlite3_db_handle(stmt)));
        return {};
    }

    StatementRun run { stmt };
    int status = step(lexicalGlobalObject, scope, stmt);
    RETURN_IF_EXCEPTION(scope, {});

    MarkedArgumentBuffer args;
    // The count comes after the step, which can prepare the statement again with other columns.
    for (int i = 0, count = sqlite3_column_count(stmt); i < count; i++) {
        // Without a row, every column is NULL.
        switch (status == SQLITE_ROW ? sqlite3_column_type(stmt, i) : SQLITE_NULL) {
        case SQLITE_INTEGER:
            args.append(jsString(vm, makeAtomString("INTEGER"_s)));
            break;
        case SQLITE_FLOAT:
            args.append(jsString(vm, makeAtomString("FLOAT"_s)));
            break;
        case SQLITE3_TEXT:
            args.append(jsString(vm, makeAtomString("TEXT"_s)));
            break;
        case SQLITE_BLOB:
            args.append(jsString(vm, makeAtomString("BLOB"_s)));
            break;
        case SQLITE_NULL:
            args.append(jsString(vm, makeAtomString("NULL"_s)));
            break;
        default:
            args.append(jsNull());
            break;
        }
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(constructArray(lexicalGlobalObject, static_cast<ArrayAllocationProfile*>(nullptr), args)));
}

JSC_DEFINE_CUSTOM_GETTER(jsSqlStatementGetColumnDeclaredTypes, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName attributeName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    JSSQLStatement* castedThis = dynamicDowncast<JSSQLStatement>(JSValue::decode(thisValue));
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_THIS
    CHECK_PREPARED

    int count = sqlite3_column_count(castedThis->stmt);
    JSC::JSArray* array = JSC::constructEmptyArray(lexicalGlobalObject, static_cast<ArrayAllocationProfile*>(nullptr), count);
    RETURN_IF_EXCEPTION(scope, {});

    // Use declared types only - return raw strings as-is, null when no declared type
    for (int i = 0; i < count; i++) {
        // Null for an expression. jsString, not jsNontrivialString: CREATE TABLE t (a "X") declares one character.
        const char* declType = sqlite3_column_decltype(castedThis->stmt, i);
        array->putDirectIndex(lexicalGlobalObject, i, declType ? JSValue(jsString(vm, Bun::sqliteText(declType))) : jsNull());
        RETURN_IF_EXCEPTION(scope, {});
    }

    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(array));
}

JSC_DEFINE_CUSTOM_GETTER(jsSqlStatementGetSafeIntegers, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName attributeName))
{
    return readStatement(lexicalGlobalObject, thisValue, [](JSSQLStatement* statement) { return jsBoolean(statement->useBigInt64); });
}

JSC_DEFINE_CUSTOM_SETTER(jsSqlStatementSetSafeIntegers, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, PropertyName attributeName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    JSSQLStatement* castedThis = dynamicDowncast<JSSQLStatement>(JSValue::decode(thisValue));
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_THIS
    CHECK_PREPARED

    bool value = JSValue::decode(encodedValue).toBoolean(lexicalGlobalObject);
    castedThis->useBigInt64 = value;

    return true;
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementSetColumnNameTransformFunction, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    JSSQLStatement* castedThis = dynamicDowncast<JSSQLStatement>(callFrame->thisValue());
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_THIS
    CHECK_PREPARED

    JSValue value = callFrame->argument(0);
    if (!value.isUndefinedOrNull() && !value.isCallable()) [[unlikely]] {
        throwTypeError(lexicalGlobalObject, scope, "Expected a function or null"_s);
        return {};
    }

    castedThis->columnNameTransform.setMayBeNull(vm, castedThis, value.getObject());
    castedThis->dropRowShape();
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementFunctionFinalize, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    JSSQLStatement* castedThis = dynamicDowncast<JSSQLStatement>(callFrame->thisValue());
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_THIS

    if (castedThis->stmt) {
        CHECK_NOT_BUSY(castedThis->version_db)
        castedThis->finalizeStatement();
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(jsUndefined()));
}

const ClassInfo JSSQLStatement::s_info = { "SQLStatement"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSSQLStatement) };

/* Hash table for prototype */

void JSSQLStatement::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    vm.heap.reportExtraMemoryAllocated(this, m_statementSize);
}

JSSQLStatement::~JSSQLStatement()
{
    if (this->version_db) {
        this->version_db->statements.remove(this);
        if (this->version_db->hasUpdateHook && Bun::sqliteCommitsWhenFinalized(stmt)) {
            this->version_db->orphans.append(stmt);
            this->version_db->closeIfDrained();
            return;
        }
    }
    finalizeStatement(false);
}

void JSSQLStatement::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSSQLStatement>(cell);
    if (thisObject->stmt)
        analyzer.setWrappedObjectForCell(cell, thisObject->stmt);

    Base::analyzeHeap(cell, analyzer);
}

template<typename Visitor>
void JSSQLStatement::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSSQLStatement* thisObject = uncheckedDowncast<JSSQLStatement>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    visitor.reportExtraMemoryVisited(thisObject->extraMemorySize());

    visitor.append(thisObject->m_database);
    visitor.append(thisObject->_structure);
    visitor.append(thisObject->userPrototype);
    visitor.append(thisObject->columnNameTransform);
}

DEFINE_VISIT_CHILDREN(JSSQLStatement);

JSValue createJSSQLStatementConstructor(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* object = JSC::constructEmptyObject(globalObject);
    auto* diff = InternalFieldTuple::create(vm, globalObject->internalFieldTupleStructure(), jsUndefined(), jsUndefined());

    auto* constructor = JSSQLStatementConstructor::create(
        vm,
        globalObject,
        JSSQLStatementConstructor::createStructure(vm, globalObject, globalObject->m_functionPrototype.get()));
    RETURN_IF_EXCEPTION(scope, {});

    object->putDirectIndex(globalObject, 0, constructor);
    RETURN_IF_EXCEPTION(scope, {});
    object->putDirectIndex(globalObject, 1, diff);
    RETURN_IF_EXCEPTION(scope, {});

    return object;
}

} // namespace WebCore

int VersionSqlite3::close(bool force, bool mayCallScript)
{
    // Finalizing can run JS, and a GC during that JS can remove entries from `statements`, so move the handles out first.
    for (auto* statement : statements) {
        if (!statement->stmt || !(force || statement->ownedByDatabase))
            continue;
        orphans.append(std::exchange(statement->stmt, nullptr));
        statement->finalizedByClose = true;
    }
    while (!orphans.isEmpty())
        Bun::sqliteFinalize(orphans.takeLast(), mayCallScript);
    closed = true;
    if (!force) {
        closeIfDrained();
        return SQLITE_OK;
    }
    // Remaining statements are not bun's to finalize: vtab modules (FTS5)
    // finalize their cached statements during disconnect inside sqlite3_close*,
    // and a re-entrant close() from a bound-parameter getter leaves db.run()'s
    // transient statement live on this stack (close_v2 defers until it drains).
    int statusCode = sqlite3_close(db);
    if (statusCode == SQLITE_BUSY) {
        sqlite3_close_v2(db);
        statusCode = SQLITE_OK;
    }
    db = nullptr;
    return statusCode;
}

void VersionSqlite3::abandonStatements()
{
    for (auto* statement : statements)
        statement->stmt = nullptr;
}

void VersionSqlite3::finalizeOrphans(JSC::JSGlobalObject* globalObject)
{
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(*vm);
    while (!orphans.isEmpty()) {
        sqlite3_finalize(orphans.takeLast());
        // An exception from a user function is unrelated to the current call, so report it instead of throwing it.
        if (auto* exception = scope.exception(); exception && !vm->hasPendingTerminationException()) [[unlikely]] {
            scope.clearException();
            Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(globalObject, exception);
        }
    }
    closeIfDrained();
}

// Drained = every bun-tracked statement finalized. Statements sqlite3 still
// holds (vtab modules' cached ones) don't count; close_v2 finalizes those.
void VersionSqlite3::closeIfDrained()
{
    if (!closed || !db)
        return;
    for (auto* statement : statements) {
        if (statement->stmt)
            return;
    }
    // The GC can call this, so don't run JS.
    while (!orphans.isEmpty())
        Bun::sqliteFinalize(orphans.takeLast(), false);
    closeHandle();
}
