

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
#include <JavaScriptCore/JSObjectInlines.h>
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
#include <JavaScriptCore/PropertyNameArray.h>
#include "GCDefferalContext.h"

#include <JavaScriptCore/DOMJITAbstractHeap.h>
#include "DOMJITIDLConvert.h"
#include "DOMJITIDLType.h"
#include "JSBuffer.h"
#include "DOMJITIDLTypeFilter.h"
#include "DOMJITHelpers.h"
#include <JavaScriptCore/DFGAbstractHeap.h>
#include "simdutf.h"
#include <JavaScriptCore/ObjectPrototype.h>
#include "BunBuiltinNames.h"
#include "sqlite3_error_codes.h"
#include "wtf/BitVector.h"
#include "wtf/FastBitVector.h"
#include "wtf/IsoMalloc.h"
#include "wtf/Vector.h"
#include <atomic>
#include "wtf/LazyRef.h"
#include "wtf/text/StringToIntegerConversion.h"
#include <JavaScriptCore/InternalFieldTuple.h>

static constexpr int32_t kSafeIntegersFlag = 1 << 1;
static constexpr int32_t kStrictFlag = 1 << 2;

#ifndef BREAKING_CHANGES_BUN_1_2
#define BREAKING_CHANGES_BUN_1_2 0
#endif

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

#else
static inline int lazyLoadSQLite()
{
    return 0;
}

#endif
/* ******************************************************************************** */

#if !USE(SYSTEM_MALLOC)
#include <bmalloc/BPlatform.h>
#define ENABLE_SQLITE_FAST_MALLOC (BENABLE(MALLOC_SIZE) && BENABLE(MALLOC_GOOD_SIZE))
#endif

static std::atomic<int64_t> sqlite_malloc_amount = 0;

static void enableFastMallocForSQLite()
{
#if ENABLE(SQLITE_FAST_MALLOC)
    int returnCode = sqlite3_config(SQLITE_CONFIG_LOOKASIDE, 0, 0);
    ASSERT_WITH_MESSAGE(returnCode == SQLITE_OK, "Unable to reduce lookaside buffer size");

    static sqlite3_mem_methods fastMallocMethods = {
        [](int n) {
            auto* ret = fastMalloc(n);
            sqlite_malloc_amount += fastMallocSize(ret);
            return ret;
        },
        [](void* p) {
            sqlite_malloc_amount -= fastMallocSize(p);
            return fastFree(p);
        },
        [](void* p, int n) {
            sqlite_malloc_amount -= fastMallocSize(p);
            auto* out = fastRealloc(p, n);
            sqlite_malloc_amount += fastMallocSize(out);

            return out;
        },
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

static void initializeSQLite()
{
    static std::once_flag onceFlag;
    std::call_once(onceFlag, [] {
        enableFastMallocForSQLite();
    });
}

static WTF::String sqliteString(const char* str)
{
    auto res = WTF::String::fromUTF8(str);
    sqlite3_free((void*)str);
    return res;
}

static void sqlite_free_typed_array(void* ctx, void* buf)
{
    sqlite3_free((void*)buf);
}

static int DEFAULT_SQLITE_FLAGS
    = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE;
static unsigned int DEFAULT_SQLITE_PREPARE_FLAGS = SQLITE_PREPARE_PERSISTENT;
static int MAX_SQLITE_PREPARE_FLAG = SQLITE_PREPARE_PERSISTENT | SQLITE_PREPARE_NORMALIZE | SQLITE_PREPARE_NO_VTAB;

static inline JSC::JSValue jsNumberFromSQLite(sqlite3_stmt* stmt, unsigned int i)
{
    int64_t num = sqlite3_column_int64(stmt, i);
    return num > INT_MAX || num < INT_MIN ? JSC::jsDoubleNumber(static_cast<double>(num)) : JSC::jsNumber(static_cast<int>(num));
}

static inline JSC::JSValue jsBigIntFromSQLite(JSC::JSGlobalObject* globalObject, sqlite3_stmt* stmt, unsigned int i)
{
    int64_t num = sqlite3_column_int64(stmt, i);
    return JSC::JSBigInt::createFrom(globalObject, num);
}

#define CHECK_THIS                                                                                               \
    if (UNLIKELY(!castedThis)) {                                                                                 \
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected SQLStatement"_s)); \
        return JSValue::encode(jsUndefined());                                                                   \
    }

#define DO_REBIND(param)                                                                                                \
    if (param.isObject()) {                                                                                             \
        JSC::JSValue reb = castedThis->rebind(lexicalGlobalObject, param, true, castedThis->version_db->db);            \
        if (UNLIKELY(!reb.isNumber())) {                                                                                \
            return JSValue::encode(reb); /* this means an error */                                                      \
        }                                                                                                               \
    } else {                                                                                                            \
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Expected object or array"_s)); \
        return JSValue::encode(jsUndefined());                                                                          \
    }

#define CHECK_PREPARED                                                                                             \
    if (UNLIKELY(castedThis->stmt == nullptr || castedThis->version_db == nullptr)) {                              \
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Statement has finalized"_s)); \
        return JSValue::encode(jsUndefined());                                                                     \
    }

#define CHECK_PREPARED_JIT                                                                                         \
    if (UNLIKELY(castedThis->stmt == nullptr || castedThis->version_db == nullptr)) {                              \
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Statement has finalized"_s)); \
        return {};                                                                                                 \
    }

class VersionSqlite3 {
public:
    explicit VersionSqlite3(sqlite3* db)
        : db(db)
        , version(0)
    {
    }
    sqlite3* db;
    std::atomic<uint64_t> version;
};

class SQLiteSingleton {
public:
    Vector<VersionSqlite3*> databases;
    Vector<std::atomic<uint64_t>> schema_versions;
};

static SQLiteSingleton* _instance = nullptr;

static Vector<VersionSqlite3*>& databases()
{
    if (!_instance) {
        _instance = new SQLiteSingleton();
        _instance->databases = Vector<VersionSqlite3*>();
        _instance->databases.reserveInitialCapacity(4);
        _instance->schema_versions = Vector<std::atomic<uint64_t>>();
    }

    return _instance->databases;
}

extern "C" void Bun__closeAllSQLiteDatabasesForTermination()
{
    if (!_instance) {
        return;
    }
    auto& dbs = _instance->databases;

    for (auto& db : dbs) {
        if (db->db)
            sqlite3_close(db->db);
    }
}

namespace WebCore {
using namespace JSC;

JSC_DECLARE_HOST_FUNCTION(jsSQLStatementPrepareStatementFunction);
JSC_DECLARE_HOST_FUNCTION(jsSQLStatementExecuteFunction);
JSC_DECLARE_HOST_FUNCTION(jsSQLStatementOpenStatementFunction);
JSC_DECLARE_HOST_FUNCTION(jsSQLStatementIsInTransactionFunction);

JSC_DECLARE_HOST_FUNCTION(jsSQLStatementLoadExtensionFunction);

JSC_DECLARE_HOST_FUNCTION(jsSQLStatementExecuteStatementFunction);
JSC_DECLARE_HOST_FUNCTION(jsSQLStatementExecuteStatementFunctionRun);
JSC_DECLARE_HOST_FUNCTION(jsSQLStatementExecuteStatementFunctionGet);
JSC_DECLARE_HOST_FUNCTION(jsSQLStatementExecuteStatementFunctionAll);
JSC_DECLARE_HOST_FUNCTION(jsSQLStatementExecuteStatementFunctionRows);

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

JSC_DECLARE_CUSTOM_GETTER(jsSqlStatementGetSafeIntegers);
JSC_DECLARE_CUSTOM_SETTER(jsSqlStatementSetSafeIntegers);

static JSValue createSQLiteError(JSC::JSGlobalObject* globalObject, sqlite3* db)
{
    auto& vm = globalObject->vm();
    int code = sqlite3_extended_errcode(db);
    int byteOffset = sqlite3_error_offset(db);

    const char* msg = sqlite3_errmsg(db);
    WTF::String str = WTF::String::fromUTF8(msg);
    JSC::JSObject* object = JSC::createError(globalObject, str);
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

class SQLiteBindingsMap {
public:
    SQLiteBindingsMap() = default;
    SQLiteBindingsMap(uint16_t count = 0, bool trimLeadingPrefix = false)
    {
        this->trimLeadingPrefix = trimLeadingPrefix;
        hasLoadedNames = false;
        reset(count);
    }

    void reset(uint16_t count = 0)
    {
        ASSERT(count <= std::numeric_limits<uint16_t>::max());
        if (this->count != count) {
            hasLoadedNames = false;
            bindingNames.clear();
        }
        this->count = count;
    }

    void ensureNamesLoaded(JSC::VM& vm, sqlite3_stmt* stmt)
    {
        if (hasLoadedNames)
            return;

        hasLoadedNames = true;
        hasOutOfOrderNames = false;

        size_t count = this->count;
        size_t prefixOffset = trimLeadingPrefix ? 1 : 0;
        bindingNames.clear();

        bool hasLoadedBindingNames = false;
        size_t indexedCount = 0;

        for (size_t i = 0; i < count; i++) {
            const unsigned char* name = reinterpret_cast<const unsigned char*>(sqlite3_bind_parameter_name(stmt, i + 1));

            // INSERT INTO cats (name, age) VALUES (?, ?) RETURNING name
            if (name == nullptr) {
                indexedCount++;
                if (hasLoadedBindingNames) {
                    bindingNames[i] = Identifier(Identifier::EmptyIdentifier);
                }
                continue;
            }

            if (!hasLoadedBindingNames) {
                bindingNames.resize(count);
                hasLoadedBindingNames = true;
            }
            name += prefixOffset;
            size_t namelen = strlen(reinterpret_cast<const char*>(name));
            if (prefixOffset == 1 && name[0] >= '0' && name[0] <= '9') {
                auto integer = WTF::parseInteger<uint64_t>(StringView({ name, namelen }), 10);
                if (integer.has_value()) {
                    hasOutOfOrderNames = true;
                    bindingNames.clear();
                    break;
                }
            }

            WTF::String wtfString = WTF::String::fromUTF8ReplacingInvalidSequences({ name, namelen });
            bindingNames[i] = Identifier::fromString(vm, wtfString);
        }

        isOnlyIndexed = indexedCount == count;
    }

    Vector<Identifier> bindingNames;
    uint16_t count = 0;
    bool hasLoadedNames : 1 = false;
    bool isOnlyIndexed : 1 = false;
    bool trimLeadingPrefix : 1 = false;
    bool hasOutOfOrderNames : 1 = false;
};

class JSSQLStatement : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr bool needsDestruction = true;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSSQLStatement* create(JSDOMGlobalObject* globalObject, sqlite3_stmt* stmt, VersionSqlite3* version_db, int64_t memorySizeChange = 0)
    {
        Structure* structure = globalObject->JSSQLStatementStructure();
        JSSQLStatement* ptr = new (NotNull, JSC::allocateCell<JSSQLStatement>(globalObject->vm())) JSSQLStatement(structure, *globalObject, stmt, version_db, memorySizeChange);
        ptr->finishCreation(globalObject->vm());
        return ptr;
    }
    static void destroy(JSC::JSCell*);
    template<typename, SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return WebCore::subspaceForImpl<JSSQLStatement, UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSSQLStatement.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSSQLStatement = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSSQLStatement.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSSQLStatement = std::forward<decltype(space)>(space); });
    }
    DECLARE_VISIT_CHILDREN;
    DECLARE_EXPORT_INFO;
    template<typename Visitor> void visitAdditionalChildren(Visitor&);
    template<typename Visitor> static void visitOutputConstraints(JSCell*, Visitor&);

    size_t static estimatedSize(JSCell* cell, VM& vm)
    {
        auto* thisObject = jsCast<JSSQLStatement*>(cell);
        return Base::estimatedSize(thisObject, vm) + thisObject->extraMemorySize;
    }

    static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);

    JSC::JSValue rebind(JSGlobalObject* globalObject, JSC::JSValue values, bool clone, sqlite3* db);

    bool need_update() { return version_db->version.load() != version; }
    void update_version() { version = version_db->version.load(); }

    ~JSSQLStatement();

    sqlite3_stmt* stmt;
    VersionSqlite3* version_db;
    uint64_t version = 0;
    // Tracks which columns are valid in the current result set. Used to handle duplicate column names.
    // The bit at index i is set if the column at index i is valid.
    WTF::BitVector validColumns;
    std::unique_ptr<PropertyNameArray> columnNames;
    mutable JSC::WriteBarrier<JSC::JSObject> _prototype;
    mutable JSC::WriteBarrier<JSC::Structure> _structure;
    mutable JSC::WriteBarrier<JSC::JSObject> userPrototype;
    size_t extraMemorySize = 0;
    SQLiteBindingsMap m_bindingNames = { 0, false };
    bool hasExecuted : 1 = false;
    bool useBigInt64 : 1 = false;

protected:
    JSSQLStatement(JSC::Structure* structure, JSDOMGlobalObject& globalObject, sqlite3_stmt* stmt, VersionSqlite3* version_db, int64_t memorySizeChange = 0)
        : Base(globalObject.vm(), structure)
        , stmt(stmt)
        , version_db(version_db)
        , columnNames(new PropertyNameArray(globalObject.vm(), PropertyNameMode::Strings, PrivateSymbolMode::Exclude))
        , extraMemorySize(memorySizeChange > 0 ? memorySizeChange : 0)
    {
    }

    void finishCreation(JSC::VM& vm);
};

template<bool useBigInt64>
static JSValue toJS(JSC::VM& vm, JSC::JSGlobalObject* globalObject, sqlite3_stmt* stmt, int i)
{
    switch (sqlite3_column_type(stmt, i)) {
    case SQLITE_INTEGER: {
        if constexpr (!useBigInt64) {
            // https://github.com/oven-sh/bun/issues/1536
            return jsNumberFromSQLite(stmt, i);
        } else {
            // https://github.com/oven-sh/bun/issues/1536
            return jsBigIntFromSQLite(globalObject, stmt, i);
        }
    }
    case SQLITE_FLOAT: {
        return jsDoubleNumber(sqlite3_column_double(stmt, i));
    }
    // > Note that the SQLITE_TEXT constant was also used in SQLite version
    // > 2 for a completely different meaning. Software that links against
    // > both SQLite version 2 and SQLite version 3 should use SQLITE3_TEXT,
    // > not SQLITE_TEXT.
    case SQLITE3_TEXT: {
        size_t len = sqlite3_column_bytes(stmt, i);
        const unsigned char* text = len > 0 ? sqlite3_column_text(stmt, i) : nullptr;
        if (UNLIKELY(text == nullptr || len == 0)) {
            return jsEmptyString(vm);
        }

        return len < 64 ? jsString(vm, WTF::String::fromUTF8({ text, len })) : JSC::JSValue::decode(Bun__encoding__toStringUTF8(text, len, globalObject));
    }
    case SQLITE_BLOB: {
        size_t len = sqlite3_column_bytes(stmt, i);
        const void* blob = len > 0 ? sqlite3_column_blob(stmt, i) : nullptr;
        if (LIKELY(len > 0 && blob != nullptr)) {
            JSC::JSUint8Array* array = JSC::JSUint8Array::createUninitialized(globalObject, globalObject->m_typedArrayUint8.get(globalObject), len);
            memcpy(array->vector(), blob, len);
            return array;
        }

        return JSC::JSUint8Array::create(globalObject, globalObject->m_typedArrayUint8.get(globalObject), 0);
    }
    default: {
        break;
    }
    }

    return jsNull();
}
extern "C" {
static JSC_DECLARE_JIT_OPERATION_WITHOUT_WTF_INTERNAL(jsSQLStatementExecuteStatementFunctionGetWithoutTypeChecking, JSC::EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, JSSQLStatement* castedThis));
}

static const JSC::DOMJIT::Signature DOMJITSignatureForjsSQLStatementExecuteStatementFunctionGet(
    jsSQLStatementExecuteStatementFunctionGetWithoutTypeChecking,
    JSSQLStatement::info(),
    // We use HeapRange::top() because MiscFields and SideState and HeapObjectIdentity were not enough to tell the compiler that it cannot skip calling the function.
    // https://github.com/oven-sh/bun/issues/7694
    JSC::DOMJIT::Effect::forDef(JSC::DOMJIT::HeapRange::top(), JSC::DOMJIT::HeapRange::top(), JSC::DOMJIT::HeapRange::top()),
    JSC::SpecFinalObject);

static const HashTableValue JSSQLStatementPrototypeTableValues[] = {
    { "run"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementExecuteStatementFunctionRun, 1 } },
    { "get"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DOMJITFunction), NoIntrinsic, { HashTableValue::DOMJITFunctionType, jsSQLStatementExecuteStatementFunctionGet, &DOMJITSignatureForjsSQLStatementExecuteStatementFunctionGet } },
    { "all"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementExecuteStatementFunctionAll, 1 } },
    { "as"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementSetPrototypeFunction, 1 } },
    { "values"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementExecuteStatementFunctionRows, 1 } },
    { "finalize"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementFunctionFinalize, 0 } },
    { "toString"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementToStringFunction, 0 } },
    { "columns"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsSqlStatementGetColumnNames, 0 } },
    { "columnsCount"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsSqlStatementGetColumnCount, 0 } },
    { "paramsCount"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsSqlStatementGetParamCount, 0 } },
    { "safeIntegers"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsSqlStatementGetSafeIntegers, jsSqlStatementSetSafeIntegers } },

};

class JSSQLStatementPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static JSSQLStatementPrototype* create(JSC::VM& vm, JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSSQLStatementPrototype* ptr = new (NotNull, JSC::allocateCell<JSSQLStatementPrototype>(vm)) JSSQLStatementPrototype(vm, globalObject, structure);
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
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSSQLStatementPrototype(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        Base::finishCreation(vm);
        reifyStaticProperties(vm, JSSQLStatementPrototype::info(), JSSQLStatementPrototypeTableValues, *this);
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

static void initializeColumnNames(JSC::JSGlobalObject* lexicalGlobalObject, JSSQLStatement* castedThis)
{
    if (!castedThis->hasExecuted) {
        castedThis->hasExecuted = true;
    } else {
        // reinitialize column
        castedThis->columnNames.reset(new PropertyNameArray(
            castedThis->columnNames->vm(),
            castedThis->columnNames->propertyNameMode(),
            castedThis->columnNames->privateSymbolMode()));
    }
    castedThis->validColumns.clearAll();
    castedThis->update_version();

    JSC::VM& vm = lexicalGlobalObject->vm();

    auto* stmt = castedThis->stmt;

    castedThis->_structure.clear();
    castedThis->_prototype.clear();

    int count = sqlite3_column_count(stmt);
    if (count < 1)
        return;

    // Fast path:
    if (count <= JSFinalObject::maxInlineCapacity) {
        // 64 is the maximum we can preallocate here
        // see https://github.com/oven-sh/bun/issues/987
        // also see https://github.com/oven-sh/bun/issues/1646
        auto& globalObject = *lexicalGlobalObject;

        auto columnNames = castedThis->columnNames.get();
        bool anyHoles = false;
        for (int i = count - 1; i >= 0; i--) {
            const char* name = sqlite3_column_name(stmt, i);

            if (name == nullptr) {
                anyHoles = true;
                break;
            }

            size_t len = strlen(name);
            if (len == 0) {
                anyHoles = true;
                break;
            }

            // When joining multiple tables, the same column names can appear multiple times
            // columnNames de-dupes property names internally
            // We can't have two properties with the same name, so we use validColumns to track this.
            auto preCount = columnNames->size();
            columnNames->add(
                Identifier::fromString(vm, WTF::String::fromUTF8({ name, len })));
            auto curCount = columnNames->size();

            if (preCount != curCount) {
                castedThis->validColumns.set(i);
            }
        }

        if (LIKELY(!anyHoles)) {
            PropertyOffset offset;
            JSObject* prototype = castedThis->userPrototype ? castedThis->userPrototype.get() : globalObject.objectPrototype();
            Structure* structure = globalObject.structureCache().emptyObjectStructureForPrototype(&globalObject, prototype, columnNames->size());
            vm.writeBarrier(castedThis, structure);

            // We iterated over the columns in reverse order so we need to reverse the columnNames here
            // Importantly we reverse before adding the properties to the structure to ensure that index accesses
            // later refer to the correct property.
            columnNames->data()->propertyNameVector().reverse();
            for (const auto& propertyName : *columnNames) {
                structure = Structure::addPropertyTransition(vm, structure, propertyName, 0, offset);
            }
            castedThis->_structure.set(vm, castedThis, structure);

            // We are done.
            return;
        } else {
            // If for any reason we do not have column names, disable the fast path.
            columnNames->releaseData();
            castedThis->columnNames.reset(new PropertyNameArray(
                castedThis->columnNames->vm(),
                castedThis->columnNames->propertyNameMode(),
                castedThis->columnNames->privateSymbolMode()));
            castedThis->validColumns.clearAll();
        }
    }

    // Slow path:

    JSC::ObjectInitializationScope initializationScope(vm);

    // 64 is the maximum we can preallocate here
    // see https://github.com/oven-sh/bun/issues/987
    JSObject* prototype = castedThis->userPrototype ? castedThis->userPrototype.get() : lexicalGlobalObject->objectPrototype();
    JSC::JSObject* object = JSC::constructEmptyObject(lexicalGlobalObject, prototype, std::min(static_cast<unsigned>(count), JSFinalObject::maxInlineCapacity));

    for (int i = count - 1; i >= 0; i--) {
        const char* name = sqlite3_column_name(stmt, i);

        if (name == nullptr)
            break;

        size_t len = strlen(name);
        if (len == 0)
            break;

        auto wtfString = WTF::String::fromUTF8({ name, len });
        auto str = JSValue(jsString(vm, wtfString));
        auto key = str.toPropertyKey(lexicalGlobalObject);
        JSC::JSValue primitive = JSC::jsUndefined();
        auto decl = sqlite3_column_decltype(stmt, i);
        if (decl != nullptr) {
            switch (decl[0]) {
            case 'F':
            case 'D':
            case 'I': {
                primitive = jsNumber(0);
                break;
            }
            case 'V':
            case 'T': {
                primitive = jsEmptyString(vm);
                break;
            }
            }
        }

        auto preCount = castedThis->columnNames->size();
        castedThis->columnNames->add(key);
        auto curCount = castedThis->columnNames->size();

        // only put the property if it's not a duplicate
        if (preCount != curCount) {
            castedThis->validColumns.set(i);
            object->putDirect(vm, key, primitive, 0);
        }
    }
    // We iterated over the columns in reverse order so we need to reverse the columnNames here
    castedThis->columnNames->data()->propertyNameVector().reverse();
    castedThis->_prototype.set(vm, castedThis, object);
}

void JSSQLStatement::destroy(JSC::JSCell* cell)
{
    JSSQLStatement* thisObject = static_cast<JSSQLStatement*>(cell);
    thisObject->~JSSQLStatement();
}

static inline bool rebindValue(JSC::JSGlobalObject* lexicalGlobalObject, sqlite3* db, sqlite3_stmt* stmt, int i, JSC::JSValue value, JSC::ThrowScope& scope, bool clone, bool isSafeInteger)
{
    auto throwSQLiteError = [&]() -> void {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, WTF::String::fromUTF8(sqlite3_errmsg(db))));
    };

#define CHECK_BIND(param)                \
    int result = param;                  \
    if (UNLIKELY(result != SQLITE_OK)) { \
        throwSQLiteError();              \
        return false;                    \
    }

    // only clone if necessary
    // SQLite has a way to call a destructor
    // but there doesn't seem to be a way to pass a pointer?
    // we can't use it if there's no pointer to ref/unref
    auto transientOrStatic = (void (*)(void*))(clone ? SQLITE_TRANSIENT : SQLITE_STATIC);

    if (value.isUndefinedOrNull()) {
        CHECK_BIND(sqlite3_bind_null(stmt, i));
    } else if (value.isBoolean()) {
        CHECK_BIND(sqlite3_bind_int(stmt, i, value.toBoolean(lexicalGlobalObject) ? 1 : 0));
    } else if (value.isAnyInt()) {
        int64_t val = value.asAnyInt();
        if (val < INT_MIN || val > INT_MAX) {
            CHECK_BIND(sqlite3_bind_int64(stmt, i, val));
        } else {
            CHECK_BIND(sqlite3_bind_int(stmt, i, val))
        }
    } else if (value.isNumber()) {
        CHECK_BIND(sqlite3_bind_double(stmt, i, value.asDouble()))
    } else if (value.isString()) {
        auto* str = value.toStringOrNull(lexicalGlobalObject);
        if (UNLIKELY(!str)) {
            throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Expected string"_s));
            return false;
        }

        String roped = str->tryGetValue(lexicalGlobalObject);
        if (UNLIKELY(!roped)) {
            throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Out of memory :("_s));
            return false;
        }

        if (roped.is8Bit() && roped.containsOnlyASCII()) {
            CHECK_BIND(sqlite3_bind_text(stmt, i, reinterpret_cast<const char*>(roped.span8().data()), roped.length(), transientOrStatic));
        } else if (!roped.is8Bit()) {
            CHECK_BIND(sqlite3_bind_text16(stmt, i, roped.span16().data(), roped.length() * 2, transientOrStatic));
        } else {
            auto utf8 = roped.utf8();
            CHECK_BIND(sqlite3_bind_text(stmt, i, utf8.data(), utf8.length(), SQLITE_TRANSIENT));
        }

    } else if (UNLIKELY(value.isHeapBigInt())) {
        if (!isSafeInteger) {
            CHECK_BIND(sqlite3_bind_int64(stmt, i, JSBigInt::toBigInt64(value)));
        } else {
            JSBigInt* bigInt = value.asHeapBigInt();
            const auto min = JSBigInt::compare(bigInt, std::numeric_limits<int64_t>::min());
            const auto max = JSBigInt::compare(bigInt, std::numeric_limits<int64_t>::max());
            if (LIKELY((min == JSBigInt::ComparisonResult::GreaterThan || min == JSBigInt::ComparisonResult::Equal) && (max == JSBigInt::ComparisonResult::LessThan || max == JSBigInt::ComparisonResult::Equal))) {
                CHECK_BIND(sqlite3_bind_int64(stmt, i, JSBigInt::toBigInt64(value)));
            } else {
                throwRangeError(lexicalGlobalObject, scope, makeString("BigInt value '"_s, bigInt->toString(lexicalGlobalObject, 10), "' is out of range"_s));
                sqlite3_clear_bindings(stmt);
                return false;
            }
        }

    } else if (JSC::JSArrayBufferView* buffer = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(value)) {
        CHECK_BIND(sqlite3_bind_blob(stmt, i, buffer->vector(), buffer->byteLength(), transientOrStatic));
    } else {
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Binding expected string, TypedArray, boolean, number, bigint or null"_s));
        return false;
    }

    return true;
#undef CHECK_BIND
}

static JSC::JSValue rebindObject(JSC::JSGlobalObject* globalObject, SQLiteBindingsMap& bindings, JSC::JSObject* target, JSC::ThrowScope& scope, sqlite3* db, sqlite3_stmt* stmt, bool clone, bool safeIntegers)
{
    int count = 0;

    JSC::VM& vm = globalObject->vm();
    auto& structure = *target->structure();
    bindings.ensureNamesLoaded(vm, stmt);
    const auto& bindingNames = bindings.bindingNames;
    size_t size = bindings.count;

    const bool trimLeadingPrefix = bindings.trimLeadingPrefix;
    const bool throwOnMissing = trimLeadingPrefix;

    // Did they reorder the columns?
    //
    // { ?2: "foo", ?1: "bar" }
    //
    if (UNLIKELY(bindings.hasOutOfOrderNames)) {

        const auto& getValue = [&](const char* name, size_t i) -> JSValue {
            JSValue value = {};
            if (name == nullptr) {
                return target->getDirectIndex(globalObject, i);
            }

            if (trimLeadingPrefix) {
                name += 1;
            }

            const WTF::String str = WTF::String::fromUTF8ReplacingInvalidSequences({ reinterpret_cast<const unsigned char*>(name), strlen(name) });

            if (trimLeadingPrefix && name[0] >= '0' && name[0] <= '9') {
                auto integer = WTF::parseInteger<int32_t>(str, 10);
                if (integer.has_value()) {
                    return target->getDirectIndex(globalObject, integer.value() - 1);
                }
            }

            const auto identifier = Identifier::fromString(vm, str);
            PropertySlot slot(target, PropertySlot::InternalMethodType::GetOwnProperty);
            if (!target->getOwnNonIndexPropertySlot(vm, &structure, identifier, slot)) {
                return JSValue();
            }

            if (LIKELY(!slot.isTaintedByOpaqueObject())) {
                return slot.getValue(globalObject, identifier);
            }

            return target->get(globalObject, identifier);
        };

        for (size_t i = 0; i < size; i++) {
            auto* name = sqlite3_bind_parameter_name(stmt, i + 1);

            JSValue value = getValue(name, i);
            if (!value && !scope.exception()) {
                if (throwOnMissing) {
                    throwException(globalObject, scope, createError(globalObject, makeString("Missing parameter \""_s, reinterpret_cast<const unsigned char*>(name), "\""_s)));
                } else {
                    continue;
                }
            }
            RETURN_IF_EXCEPTION(scope, JSValue());

            if (!rebindValue(globalObject, db, stmt, i + 1, value, scope, clone, safeIntegers)) {
                return JSValue();
            }

            RETURN_IF_EXCEPTION(scope, {});
            count++;
        }
    }
    // Does it only contain indexed properties?
    //
    // { 0: "foo", 1: "bar", "2": "baz" }
    //
    else if (UNLIKELY(bindings.isOnlyIndexed)) {
        for (size_t i = 0; i < size; i++) {
            JSValue value = target->getDirectIndex(globalObject, i);
            if (!value && !scope.exception()) {
                if (throwOnMissing) {
                    throwException(globalObject, scope, createError(globalObject, makeString("Missing parameter \""_s, i + 1, "\""_s)));
                } else {
                    continue;
                }
            }

            RETURN_IF_EXCEPTION(scope, JSValue());

            if (!rebindValue(globalObject, db, stmt, i + 1, value, scope, clone, safeIntegers)) {
                return JSValue();
            }

            RETURN_IF_EXCEPTION(scope, {});
            count++;
        }
    }
    // Is it a simple object with no getters or setters?
    //
    // { foo: "bar", baz: "qux" }
    //
    else if (target->canUseFastGetOwnProperty(structure)) {
        for (size_t i = 0; i < size; i++) {
            const auto& property = bindingNames[i];
            JSValue value = property.isEmpty() ? target->getDirectIndex(globalObject, i) : target->fastGetOwnProperty(vm, structure, bindingNames[i]);
            if (!value && !scope.exception()) {
                if (throwOnMissing) {
                    throwException(globalObject, scope, createError(globalObject, makeString("Missing parameter \""_s, property.isEmpty() ? String::number(i) : property.string(), "\""_s)));
                } else {
                    continue;
                }
            }

            RETURN_IF_EXCEPTION(scope, JSValue());

            if (!rebindValue(globalObject, db, stmt, i + 1, value, scope, clone, safeIntegers)) {
                return JSValue();
            }

            RETURN_IF_EXCEPTION(scope, {});
            count++;
        }
    } else {
        for (size_t i = 0; i < size; i++) {
            PropertySlot slot(target, PropertySlot::InternalMethodType::GetOwnProperty);
            const auto& property = bindingNames[i];
            bool hasProperty = property.isEmpty() ? target->methodTable()->getOwnPropertySlotByIndex(target, globalObject, i, slot) : target->methodTable()->getOwnPropertySlot(target, globalObject, property, slot);
            if (!hasProperty && !scope.exception()) {
                if (throwOnMissing) {
                    throwException(globalObject, scope, createError(globalObject, makeString("Missing parameter \""_s, property.isEmpty() ? String::number(i) : property.string(), "\""_s)));
                } else {
                    continue;
                }
            }

            RETURN_IF_EXCEPTION(scope, JSValue());

            JSValue value;
            if (LIKELY(!slot.isTaintedByOpaqueObject()))
                value = slot.getValue(globalObject, property);
            else {
                value = target->get(globalObject, property);
                RETURN_IF_EXCEPTION(scope, JSValue());
            }

            RETURN_IF_EXCEPTION(scope, JSValue());

            if (!rebindValue(globalObject, db, stmt, i + 1, value, scope, clone, safeIntegers)) {
                return JSValue();
            }

            RETURN_IF_EXCEPTION(scope, {});
            count++;
        }
    }

    return jsNumber(count);
}

static JSC::JSValue rebindStatement(JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSValue values, JSC::ThrowScope& scope, sqlite3* db, sqlite3_stmt* stmt, bool clone, SQLiteBindingsMap& bindings, bool safeIntegers)
{
    sqlite3_clear_bindings(stmt);
    JSC::JSArray* array = jsDynamicCast<JSC::JSArray*>(values);
    bindings.reset(sqlite3_bind_parameter_count(stmt));

    if (!array) {
        if (JSC::JSObject* object = values.getObject()) {
            auto res = rebindObject(lexicalGlobalObject, bindings, object, scope, db, stmt, clone, safeIntegers);
            RETURN_IF_EXCEPTION(scope, {});
            return res;
        }

        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected array"_s));
        return {};
    }

    int count = array->length();

    if (count == 0) {
        return jsNumber(0);
    }

    int required = bindings.count;
    if (count != required) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, makeString("SQLite query expected "_s, required, " values, received "_s, count)));
        return {};
    }

    int i = 0;
    for (; i < count; i++) {
        JSC::JSValue value = array->getIndexQuickly(i);
        if (!rebindValue(lexicalGlobalObject, db, stmt, i + 1, value, scope, clone, safeIntegers)) {
            return {};
        }
        RETURN_IF_EXCEPTION(scope, {});
    }

    return jsNumber(i);
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementSetCustomSQLite, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    JSSQLStatementConstructor* thisObject = jsDynamicCast<JSSQLStatementConstructor*>(thisValue.getObject());
    if (UNLIKELY(!thisObject)) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected SQL"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    if (callFrame->argumentCount() < 1) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected 1 argument"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    JSC::JSValue sqliteStrValue = callFrame->argument(0);
    if (UNLIKELY(!sqliteStrValue.isString())) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected SQLite path"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

#if LAZY_LOAD_SQLITE
    if (sqlite3_handle) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "SQLite already loaded\nThis function can only be called before SQLite has been loaded and exactly once. SQLite auto-loads when the first time you open a Database."_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    sqlite3_lib_path = sqliteStrValue.toWTFString(lexicalGlobalObject).utf8().data();
    if (lazyLoadSQLite() == -1) {
        sqlite3_handle = nullptr;
        WTF::String msg = WTF::String::fromUTF8(dlerror());
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, msg));
        return JSValue::encode(JSC::jsUndefined());
    }

#endif

    initializeSQLite();

    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::jsBoolean(true)));
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementDeserialize, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    JSSQLStatementConstructor* thisObject = jsDynamicCast<JSSQLStatementConstructor*>(thisValue.getObject());
    JSC::JSArrayBufferView* array = jsDynamicCast<JSC::JSArrayBufferView*>(callFrame->argument(0));
    unsigned int flags = SQLITE_DESERIALIZE_FREEONCLOSE | SQLITE_DESERIALIZE_RESIZEABLE;
    JSC::EnsureStillAliveScope ensureAliveArray(array);

    if (callFrame->argumentCount() > 1 and callFrame->argument(1).toBoolean(lexicalGlobalObject)) {
        flags |= SQLITE_DESERIALIZE_READONLY;
    }

    if (UNLIKELY(!thisObject)) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected SQL"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    if (callFrame->argumentCount() < 1) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected 1 argument"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    if (UNLIKELY(!array)) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected Uint8Array or Buffer"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    if (UNLIKELY(array->isDetached())) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "TypedArray is detached"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

#if LAZY_LOAD_SQLITE
    if (UNLIKELY(lazyLoadSQLite() < 0)) {
        WTF::String msg = WTF::String::fromUTF8(dlerror());
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, msg));
        return JSValue::encode(JSC::jsUndefined());
    }
#endif
    initializeSQLite();

    size_t byteLength = array->byteLength();
    void* ptr = array->vector();
    if (UNLIKELY(ptr == nullptr || byteLength == 0)) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "ArrayBuffer must not be empty"_s));
        return JSValue::encode(JSC::jsUndefined());
    }
    void* data = sqlite3_malloc64(byteLength);
    if (UNLIKELY(data == nullptr)) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Failed to allocate memory"_s));
        return JSValue::encode(JSC::jsUndefined());
    }
    if (byteLength) {
        memcpy(data, ptr, byteLength);
    }

    sqlite3* db = nullptr;
    if (sqlite3_open_v2(":memory:", &db, DEFAULT_SQLITE_FLAGS, nullptr) != SQLITE_OK) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Failed to open SQLite"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    int status = sqlite3_db_config(db, SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION, 1, NULL);
    if (status != SQLITE_OK) {
        // TODO: log a warning here that we can't load extensions
    }
    status = sqlite3_db_config(db, SQLITE_DBCONFIG_DEFENSIVE, 1, NULL);
    if (status != SQLITE_OK) {
        // TODO: log a warning here that defensive mode is not enabled
    }

    status = sqlite3_deserialize(db, "main", reinterpret_cast<unsigned char*>(data), byteLength, byteLength, flags);
    if (status == SQLITE_BUSY) {
        sqlite3_free(data);
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "SQLITE_BUSY"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    if (status != SQLITE_OK) {
        sqlite3_free(data);
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, status == SQLITE_ERROR ? "unable to deserialize database"_s : sqliteString(sqlite3_errstr(status))));
        return JSValue::encode(JSC::jsUndefined());
    }

    auto count = databases().size();
    databases().append(new VersionSqlite3(db));
    RELEASE_AND_RETURN(scope, JSValue::encode(jsNumber(count)));
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementSerialize, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    JSSQLStatementConstructor* thisObject = jsDynamicCast<JSSQLStatementConstructor*>(thisValue.getObject());
    if (UNLIKELY(!thisObject)) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected SQL"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    int32_t dbIndex = callFrame->argument(0).toInt32(lexicalGlobalObject);
    if (UNLIKELY(dbIndex < 0 || dbIndex >= databases().size())) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Invalid database handle"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    sqlite3* db = databases()[dbIndex]->db;
    if (UNLIKELY(!db)) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Can't do this on a closed database"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    WTF::String attachedName = callFrame->argument(1).toWTFString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(JSC::jsUndefined()));

    if (attachedName.isEmpty()) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected attached database name"_s));
        return JSValue::encode(JSC::jsUndefined());
    }
    sqlite3_int64 length = -1;
    unsigned char* data = sqlite3_serialize(db, attachedName.utf8().data(), &length, 0);
    if (UNLIKELY(data == nullptr && length)) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Out of memory"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    RELEASE_AND_RETURN(scope, JSBuffer__bufferFromPointerAndLengthAndDeinit(lexicalGlobalObject, reinterpret_cast<char*>(data), static_cast<unsigned int>(length), data, sqlite_free_typed_array));
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementLoadExtensionFunction, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    JSSQLStatementConstructor* thisObject = jsDynamicCast<JSSQLStatementConstructor*>(thisValue.getObject());
    if (UNLIKELY(!thisObject)) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected SQL"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    int32_t dbIndex = callFrame->argument(0).toInt32(lexicalGlobalObject);
    if (UNLIKELY(dbIndex < 0 || dbIndex >= databases().size())) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Invalid database handle"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    JSC::JSValue extension = callFrame->argument(1);
    if (UNLIKELY(!extension.isString())) {
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Expected string"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    auto extensionString = extension.toWTFString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});

    sqlite3* db = databases()[dbIndex]->db;
    if (UNLIKELY(!db)) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Can't do this on a closed database"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    if (sqlite3_compileoption_used("SQLITE_OMIT_LOAD_EXTENSION")) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "This build of sqlite3 does not support dynamic extension loading"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    auto entryPointStr = callFrame->argumentCount() > 2 && callFrame->argument(2).isString() ? callFrame->argument(2).toWTFString(lexicalGlobalObject) : String();
    const char* entryPoint = entryPointStr.length() == 0 ? NULL : entryPointStr.utf8().data();
    char* error;
    int rc = sqlite3_load_extension(db, extensionString.utf8().data(), entryPoint, &error);

    // TODO: can we disable loading extensions after this?
    if (rc != SQLITE_OK) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, error ? sqliteString(error) : String::fromUTF8(sqlite3_errmsg(db))));
        return JSValue::encode(JSC::jsUndefined());
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::jsUndefined()));
}

static bool isSkippedInSQLiteQuery(const char c)
{
    return c == ' ' || c == ';' || (c >= '\t' && c <= '\r');
}

// This runs a query one-off
// without the overhead of a long-lived statement object
// does not return anything
JSC_DEFINE_HOST_FUNCTION(jsSQLStatementExecuteFunction, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    JSSQLStatementConstructor* thisObject = jsDynamicCast<JSSQLStatementConstructor*>(thisValue.getObject());
    if (UNLIKELY(!thisObject)) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected SQL"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    if (callFrame->argumentCount() < 2) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected at least 2 arguments"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    int32_t handle = callFrame->argument(0).toInt32(lexicalGlobalObject);
    if (databases().size() < handle) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Invalid database handle"_s));
        return JSValue::encode(JSC::jsUndefined());
    }
    sqlite3* db = databases()[handle]->db;

    if (UNLIKELY(!db)) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Database has closed"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    JSC::JSValue internalFlagsValue = callFrame->argument(1);
    JSC::JSValue diffValue = callFrame->argument(2);

    JSC::JSValue sqlValue = callFrame->argument(3);
    if (UNLIKELY(!sqlValue.isString())) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected SQL string"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    EnsureStillAliveScope bindingsAliveScope = callFrame->argument(4);

    auto sqlString = sqlValue.toWTFString(lexicalGlobalObject);
    if (UNLIKELY(sqlString.length() == 0)) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "SQL string mustn't be blank"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    CString utf8;

    const char* sqlStringHead;
    const char* end;
    bool didSetBindings = false;

    if (
        // fast path: ascii latin1 string is utf8
        sqlString.is8Bit() && simdutf::validate_ascii(reinterpret_cast<const char*>(sqlString.span8().data()), sqlString.length())) {

        sqlStringHead = reinterpret_cast<const char*>(sqlString.span8().data());
        end = sqlStringHead + sqlString.length();
    } else {
        // slow path: utf16 or latin1 string with supplemental characters
        utf8 = sqlString.utf8();
        sqlStringHead = utf8.data();
        end = sqlStringHead + utf8.length();
    }

    bool didExecuteAny = false;

    int rc = SQLITE_OK;

#if ASSERT_ENABLED
    int maxSqlStringBytes = end - sqlStringHead;
#endif

    bool strict = internalFlagsValue.isInt32() && (internalFlagsValue.asInt32() & kStrictFlag) != 0;
    bool safeIntegers = internalFlagsValue.isInt32() && (internalFlagsValue.asInt32() & kSafeIntegersFlag) != 0;

    const int total_changes_before = sqlite3_total_changes(db);

    while (sqlStringHead && sqlStringHead < end) {
        if (UNLIKELY(isSkippedInSQLiteQuery(*sqlStringHead))) {
            sqlStringHead++;

            while (sqlStringHead < end && isSkippedInSQLiteQuery(*sqlStringHead))
                sqlStringHead++;
        }

        AutoDestructingSQLiteStatement sql;
        const char* tail = nullptr;

        // Bounds checks
        ASSERT(end >= sqlStringHead);
        ASSERT(end - sqlStringHead >= 0);
        ASSERT(end - sqlStringHead <= maxSqlStringBytes);

        rc = sqlite3_prepare_v3(db, sqlStringHead, end - sqlStringHead, 0, &sql.stmt, &tail);

        if (rc != SQLITE_OK)
            break;

        if (!sql.stmt) {
            // this happens for an empty statement
            sqlStringHead = tail;
            continue;
        }

        // First statement gets the bindings.
        if (!didSetBindings && !bindingsAliveScope.value().isUndefinedOrNull()) {
            if (bindingsAliveScope.value().isObject()) {
                int count = sqlite3_bind_parameter_count(sql.stmt);

                SQLiteBindingsMap bindings { static_cast<uint16_t>(count > -1 ? count : 0), strict };
                JSC::JSValue reb = rebindStatement(lexicalGlobalObject, bindingsAliveScope.value(), scope, db, sql.stmt, false, bindings, safeIntegers);
                RETURN_IF_EXCEPTION(scope, {});

                if (UNLIKELY(!reb.isNumber())) {
                    return JSValue::encode(reb); /* this means an error */
                }
            } else {
                throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Expected bindings to be an object or array"_s));
                return JSValue::encode(jsUndefined());
            }
            didSetBindings = true;
        }

        do {
            rc = sqlite3_step(sql.stmt);
        } while (rc == SQLITE_ROW);

        didExecuteAny = true;
        sqlStringHead = tail;
    }

    if (UNLIKELY(rc != SQLITE_OK && rc != SQLITE_DONE)) {
        throwException(lexicalGlobalObject, scope, createSQLiteError(lexicalGlobalObject, db));
        return JSValue::encode(JSC::jsUndefined());
    }

    if (!didExecuteAny) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Query contained no valid SQL statement; likely empty query."_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    if (auto* diff = JSC::jsDynamicCast<JSC::InternalFieldTuple*>(diffValue)) {
        const int total_changes_after = sqlite3_total_changes(db);
        int64_t last_insert_rowid = sqlite3_last_insert_rowid(db);
        diff->putInternalField(vm, 0, JSC::jsNumber(total_changes_after - total_changes_before));
        if (safeIntegers) {
            diff->putInternalField(vm, 1, JSBigInt::createFrom(lexicalGlobalObject, last_insert_rowid));
        } else {
            diff->putInternalField(vm, 1, JSC::jsNumber(last_insert_rowid));
        }
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementIsInTransactionFunction, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    JSSQLStatementConstructor* thisObject = jsDynamicCast<JSSQLStatementConstructor*>(thisValue.getObject());
    if (UNLIKELY(!thisObject)) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected SQLStatement"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    JSC::JSValue dbNumber = callFrame->argument(0);

    if (!dbNumber.isNumber()) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Invalid database handle"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    int32_t handle = dbNumber.toInt32(lexicalGlobalObject);

    if (handle < 0 || handle > databases().size()) {
        throwException(lexicalGlobalObject, scope, createRangeError(lexicalGlobalObject, "Invalid database handle"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    sqlite3* db = databases()[handle]->db;

    if (UNLIKELY(!db)) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Database has closed"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(jsBoolean(!sqlite3_get_autocommit(db))));
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementPrepareStatementFunction, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    JSSQLStatementConstructor* thisObject = jsDynamicCast<JSSQLStatementConstructor*>(thisValue.getObject());
    if (UNLIKELY(!thisObject)) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected SQLStatement"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    JSC::JSValue dbNumber = callFrame->argument(0);
    JSC::JSValue sqlValue = callFrame->argument(1);
    JSC::JSValue bindings = callFrame->argument(2);
    JSC::JSValue prepareFlagsValue = callFrame->argument(3);
    JSC::JSValue internalFlagsValue = callFrame->argument(4);

    if (!dbNumber.isNumber() || !sqlValue.isString()) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "SQLStatement requires a number and a string"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    int32_t handle = dbNumber.toInt32(lexicalGlobalObject);
    if (handle < 0 || handle > databases().size()) {
        throwException(lexicalGlobalObject, scope, createRangeError(lexicalGlobalObject, "Invalid database handle"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    sqlite3* db = databases()[handle]->db;
    if (!db) {
        throwException(lexicalGlobalObject, scope, createRangeError(lexicalGlobalObject, "Cannot use a closed database"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    auto sqlString = sqlValue.toWTFString(lexicalGlobalObject);
    if (!sqlString.length()) {
        throwException(lexicalGlobalObject, scope, createRangeError(lexicalGlobalObject, "Invalid SQL statement"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    unsigned int flags = DEFAULT_SQLITE_PREPARE_FLAGS;
    if (prepareFlagsValue.isNumber()) {

        int prepareFlags = prepareFlagsValue.toInt32(lexicalGlobalObject);
        if (prepareFlags < 0 || prepareFlags > MAX_SQLITE_PREPARE_FLAG) {
            throwException(lexicalGlobalObject, scope, createRangeError(lexicalGlobalObject, "Invalid prepare flags"_s));
            return JSValue::encode(JSC::jsUndefined());
        }
        flags = static_cast<unsigned int>(prepareFlags);
    }

    sqlite3_stmt* statement = nullptr;

    // This is inherently somewhat racy if using Worker
    // but that should be okay.
    int64_t currentMemoryUsage = sqlite_malloc_amount;

    int rc = SQLITE_OK;
    if (
        // fast path: ascii latin1 string is utf8
        sqlString.is8Bit() && simdutf::validate_ascii(reinterpret_cast<const char*>(sqlString.span8().data()), sqlString.length())) {
        rc = sqlite3_prepare_v3(db, reinterpret_cast<const char*>(sqlString.span8().data()), sqlString.length(), flags, &statement, nullptr);
    } else {
        // slow path: utf16 or latin1 string with supplemental characters
        CString utf8 = sqlString.utf8();
        rc = sqlite3_prepare_v3(db, utf8.data(), utf8.length(), flags, &statement, nullptr);
    }

    if (rc != SQLITE_OK) {
        throwException(lexicalGlobalObject, scope, createSQLiteError(lexicalGlobalObject, db));
        return JSValue::encode(JSC::jsUndefined());
    }

    int64_t memoryChange = sqlite_malloc_amount - currentMemoryUsage;

    JSSQLStatement* sqlStatement = JSSQLStatement::create(
        reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject), statement, databases()[handle], memoryChange);

    if (internalFlagsValue.isInt32()) {
        const int32_t internalFlags = internalFlagsValue.asInt32();
        sqlStatement->m_bindingNames.trimLeadingPrefix = (internalFlags & kStrictFlag) != 0;
        sqlStatement->useBigInt64 = (internalFlags & kSafeIntegersFlag) != 0;
    }

    if (bindings.isObject()) {
        auto* castedThis = sqlStatement;
        DO_REBIND(bindings)
    }
    return JSValue::encode(JSValue(sqlStatement));
}

JSSQLStatementConstructor* JSSQLStatementConstructor::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
{
    NativeExecutable* executable = vm.getHostFunction(jsSQLStatementPrepareStatementFunction, ImplementationVisibility::Private, callHostFunctionAsConstructor, String("SQLStatement"_s));
    JSSQLStatementConstructor* ptr = new (NotNull, JSC::allocateCell<JSSQLStatementConstructor>(vm)) JSSQLStatementConstructor(vm, executable, globalObject, structure);
    ptr->finishCreation(vm);

    return ptr;
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementOpenStatementFunction, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    JSSQLStatementConstructor* constructor = jsDynamicCast<JSSQLStatementConstructor*>(thisValue.getObject());
    if (!constructor) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected SQLStatement"_s));
        return JSValue::encode(jsUndefined());
    }

    if (callFrame->argumentCount() < 1) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected 1 argument"_s));
        return JSValue::encode(jsUndefined());
    }

    JSValue pathValue = callFrame->argument(0);
    if (!pathValue.isString()) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected string"_s));
        return JSValue::encode(jsUndefined());
    }

#if LAZY_LOAD_SQLITE
    if (UNLIKELY(lazyLoadSQLite() < 0)) {
        WTF::String msg = WTF::String::fromUTF8(dlerror());
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, msg));
        return JSValue::encode(JSC::jsUndefined());
    }
#endif
    initializeSQLite();

    auto catchScope = DECLARE_CATCH_SCOPE(vm);
    String path = pathValue.toWTFString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(catchScope, JSValue::encode(jsUndefined()));
    catchScope.clearException();
    int openFlags = DEFAULT_SQLITE_FLAGS;
    if (callFrame->argumentCount() > 1) {
        JSValue flags = callFrame->argument(1);
        if (!flags.isNumber()) {
            throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected number"_s));
            return JSValue::encode(jsUndefined());
        }

        openFlags = flags.toInt32(lexicalGlobalObject);
    }

    JSValue finalizationTarget = callFrame->argument(2);

    sqlite3* db = nullptr;
    int statusCode = sqlite3_open_v2(path.utf8().data(), &db, openFlags, nullptr);

    if (statusCode != SQLITE_OK) {
        throwException(lexicalGlobalObject, scope, createSQLiteError(lexicalGlobalObject, db));

        return JSValue::encode(jsUndefined());
    }

    sqlite3_extended_result_codes(db, 1);

    int status = sqlite3_db_config(db, SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION, 1, NULL);
    if (status != SQLITE_OK) {
        // TODO: log a warning here that extensions are unsupported.
    }

    status = sqlite3_db_config(db, SQLITE_DBCONFIG_DEFENSIVE, 1, NULL);
    if (status != SQLITE_OK) {
        // TODO: log a warning here that defensive mode is unsupported.
    }
    auto index = databases().size();

    databases().append(new VersionSqlite3(db));
    if (finalizationTarget.isObject()) {
        vm.heap.addFinalizer(finalizationTarget.getObject(), [index](JSC::JSCell* ptr) -> void {
            auto* db = databases()[index];
            if (!db->db) {
                return;
            }
            sqlite3_close_v2(db->db);
            databases()[index]->db = nullptr;
        });
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(jsNumber(index)));
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementCloseStatementFunction, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{

    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    JSSQLStatementConstructor* constructor = jsDynamicCast<JSSQLStatementConstructor*>(thisValue.getObject());

    if (!constructor) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected SQLStatement"_s));
        return JSValue::encode(jsUndefined());
    }

    if (callFrame->argumentCount() < 1) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected 1 argument"_s));
        return JSValue::encode(jsUndefined());
    }

    JSValue dbNumber = callFrame->argument(0);
    JSValue throwOnError = callFrame->argument(1);
    if (!dbNumber.isNumber()) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected number"_s));
        return JSValue::encode(jsUndefined());
    }

    int dbIndex = dbNumber.toInt32(lexicalGlobalObject);

    if (dbIndex < 0 || dbIndex >= databases().size()) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Invalid database handle"_s));
        return JSValue::encode(jsUndefined());
    }

    bool shouldThrowOnError = (throwOnError.isEmpty() || throwOnError.isUndefined()) ? false : throwOnError.toBoolean(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});

    sqlite3* db = databases()[dbIndex]->db;
    // no-op if already closed
    if (!db) {
        return JSValue::encode(jsUndefined());
    }

    // sqlite3_close_v2 is used for automatic GC cleanup
    int statusCode = shouldThrowOnError ? sqlite3_close(db) : sqlite3_close_v2(db);
    if (statusCode != SQLITE_OK) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, WTF::String::fromUTF8(sqlite3_errstr(statusCode))));
        return JSValue::encode(jsUndefined());
    }

    databases()[dbIndex]->db = nullptr;
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementFcntlFunction, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    JSSQLStatementConstructor* thisObject = jsDynamicCast<JSSQLStatementConstructor*>(thisValue.getObject());
    if (UNLIKELY(!thisObject)) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected SQLStatement"_s));
        return JSValue::encode(jsUndefined());
    }

    if (callFrame->argumentCount() < 2) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected 2 arguments"_s));
        return JSValue::encode(jsUndefined());
    }

    JSValue dbNumber = callFrame->argument(0);
    JSValue databaseFileName = callFrame->argument(1);
    JSValue opNumber = callFrame->argument(2);
    JSValue resultValue = callFrame->argument(3);

    if (!dbNumber.isNumber() || !opNumber.isNumber()) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected number"_s));
        return JSValue::encode(jsUndefined());
    }

    int dbIndex = dbNumber.toInt32(lexicalGlobalObject);
    int op = opNumber.toInt32(lexicalGlobalObject);

    if (dbIndex < 0 || dbIndex >= databases().size()) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Invalid database handle"_s));
        return JSValue::encode(jsUndefined());
    }

    sqlite3* db = databases()[dbIndex]->db;
    // no-op if already closed
    if (!db) {
        return JSValue::encode(jsUndefined());
    }

    CString fileNameStr;

    if (databaseFileName.isString()) {
        fileNameStr = databaseFileName.toWTFString(lexicalGlobalObject).utf8();
        RETURN_IF_EXCEPTION(scope, {});
    }

    int resultInt = -1;
    void* resultPtr = nullptr;
    if (resultValue.isObject()) {
        if (auto* view = jsDynamicCast<JSC::JSArrayBufferView*>(resultValue.getObject())) {
            if (view->isDetached()) {
                throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "TypedArray is detached"_s));
                return JSValue::encode(jsUndefined());
            }

            resultPtr = view->vector();
            if (resultPtr == nullptr) {
                throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected buffer"_s));
                return JSValue::encode(jsUndefined());
            }
        }
    } else if (resultValue.isNumber()) {
        resultInt = resultValue.toInt32(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, {});

        resultPtr = &resultInt;
    } else if (resultValue.isNull()) {

    } else {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected result to be a number, null or a TypedArray"_s));
        return {};
    }

    int statusCode = sqlite3_file_control(db, fileNameStr.isNull() ? nullptr : fileNameStr.data(), op, resultPtr);

    if (statusCode == SQLITE_ERROR) {
        throwException(lexicalGlobalObject, scope, createSQLiteError(lexicalGlobalObject, db));
        return JSValue::encode(jsUndefined());
    }

    return JSValue::encode(jsNumber(statusCode));
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
};

const ClassInfo JSSQLStatementConstructor::s_info = { "SQLStatement"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSSQLStatementConstructor) };

void JSSQLStatementConstructor::finishCreation(VM& vm)
{
    Base::finishCreation(vm);

    // TODO: use LazyClassStructure?
    auto* instanceObject = JSSQLStatement::create(reinterpret_cast<Zig::GlobalObject*>(globalObject()), nullptr, nullptr);
    JSValue proto = instanceObject->getPrototype(vm, globalObject());

    this->putDirect(vm, vm.propertyNames->prototype, proto, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);

    reifyStaticProperties(vm, JSSQLStatementConstructor::info(), JSSQLStatementConstructorTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();

    ASSERT(inherits(info()));
}

template<bool useBigInt64>
static inline JSC::JSValue constructResultObject(JSC::JSGlobalObject* lexicalGlobalObject, JSSQLStatement* castedThis)
{
    auto& columnNames = castedThis->columnNames->data()->propertyNameVector();
    int count = columnNames.size();
    auto& vm = lexicalGlobalObject->vm();

    // 64 is the maximum we can preallocate here
    // see https://github.com/oven-sh/bun/issues/987
    JSC::JSObject* result;

    auto* stmt = castedThis->stmt;

    if (auto* structure = castedThis->_structure.get()) {
        result = JSC::constructEmptyObject(vm, structure);

        // i: the index of columns returned from SQLite
        // j: the index of object property
        for (int i = 0, j = 0; j < count; i++, j++) {
            if (!castedThis->validColumns.get(i)) {
                // this column is duplicate, skip
                j -= 1;
                continue;
            }
            result->putDirectOffset(vm, j, toJS<useBigInt64>(vm, lexicalGlobalObject, stmt, i));
        }

    } else {
        if (count <= JSFinalObject::maxInlineCapacity) {
            result = JSC::JSFinalObject::create(vm, castedThis->_prototype.get()->structure());
        } else {
            JSObject* prototype = castedThis->userPrototype ? castedThis->userPrototype.get() : lexicalGlobalObject->objectPrototype();
            result = JSC::JSFinalObject::create(vm, JSC::JSFinalObject::createStructure(vm, lexicalGlobalObject, prototype, JSFinalObject::maxInlineCapacity));
        }

        for (int i = 0, j = 0; j < count; i++, j++) {
            if (!castedThis->validColumns.get(i)) {
                j -= 1;
                continue;
            }
            const auto& name = columnNames[j];
            result->putDirect(vm, name, toJS<useBigInt64>(vm, lexicalGlobalObject, stmt, i), 0);
        }
    }

    return JSValue(result);
}

static inline JSC::JSArray* constructResultRow(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSSQLStatement* castedThis, size_t columnCount)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* stmt = castedThis->stmt;

    MarkedArgumentBuffer arguments;
    arguments.ensureCapacity(columnCount);
    if (castedThis->useBigInt64) {
        for (size_t i = 0; i < columnCount; i++) {
            JSValue value = toJS<true>(vm, lexicalGlobalObject, stmt, i);
            RETURN_IF_EXCEPTION(throwScope, nullptr);
            arguments.append(value);
        }
    } else {
        for (size_t i = 0; i < columnCount; i++) {
            JSValue value = toJS<false>(vm, lexicalGlobalObject, stmt, i);
            RETURN_IF_EXCEPTION(throwScope, nullptr);
            arguments.append(value);
        }
    }

    JSC::ObjectInitializationScope initializationScope(vm);
    Structure* arrayStructure = lexicalGlobalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithContiguous);
    JSC::JSArray* result;

    if (LIKELY(result = JSC::JSArray::tryCreateUninitializedRestricted(initializationScope, arrayStructure, columnCount))) {
        for (size_t i = 0; i < columnCount; i++) {
            result->initializeIndex(initializationScope, i, arguments.at(i));
        }
    } else {
        RETURN_IF_EXCEPTION(throwScope, nullptr);
        result = JSC::constructArray(lexicalGlobalObject, arrayStructure, arguments);
    }

    return result;
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementSetPrototypeFunction, (JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* castedThis = jsCast<JSSQLStatement*>(callFrame->thisValue());

    CHECK_THIS

    JSValue classValue = callFrame->argument(0);

    if (classValue.isObject()) {
        JSObject* classObject = classValue.getObject();
        if (classObject == lexicalGlobalObject->objectConstructor()) {
            castedThis->userPrototype.clear();

            // Force the prototypes to be re-created
            if (castedThis->version_db) {
                castedThis->version_db->version++;
            }

            return JSValue::encode(jsUndefined());
        }

        if (!classObject->isConstructor()) {
            throwTypeError(lexicalGlobalObject, scope, "Expected a constructor"_s);
            return JSValue::encode(jsUndefined());
        }

        JSValue prototype = classObject->getIfPropertyExists(lexicalGlobalObject, vm.propertyNames->prototype);
        if (UNLIKELY(!prototype && !scope.exception())) {
            throwTypeError(lexicalGlobalObject, scope, "Expected constructor to have a prototype"_s);
        }

        RETURN_IF_EXCEPTION(scope, JSValue::encode(jsUndefined()));

        if (!prototype.isObject()) {
            throwTypeError(lexicalGlobalObject, scope, "Expected a constructor prototype to be an object"_s);
            return {};
        }

        castedThis->userPrototype.set(vm, classObject, prototype.getObject());

        // Force the prototypes to be re-created
        if (castedThis->version_db) {
            castedThis->version_db->version++;
        }
    } else if (classValue.isUndefined()) {
        castedThis->userPrototype.clear();

        // Force the prototypes to be re-created
        if (castedThis->version_db) {
            castedThis->version_db->version++;
        }
    } else {
        throwTypeError(lexicalGlobalObject, scope, "Expected class to be a constructor or undefined"_s);
        return JSValue::encode(jsUndefined());
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementExecuteStatementFunctionAll, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto castedThis = jsDynamicCast<JSSQLStatement*>(callFrame->thisValue());

    CHECK_THIS

    auto* stmt = castedThis->stmt;
    CHECK_PREPARED
    int statusCode = sqlite3_reset(stmt);

    if (UNLIKELY(statusCode != SQLITE_OK)) {
        throwException(lexicalGlobalObject, scope, createSQLiteError(lexicalGlobalObject, castedThis->version_db->db));
        return JSValue::encode(jsUndefined());
    }

    int64_t currentMemoryUsage = sqlite_malloc_amount;

    if (callFrame->argumentCount() > 0) {
        auto arg0 = callFrame->argument(0);
        DO_REBIND(arg0);
    }

    int status = sqlite3_step(stmt);
    if (!sqlite3_stmt_readonly(stmt)) {
        castedThis->version_db->version++;
    }

    if (!castedThis->hasExecuted || castedThis->need_update()) {
        initializeColumnNames(lexicalGlobalObject, castedThis);
    }

    size_t columnCount = castedThis->columnNames->size();
    JSValue result = jsUndefined();
    if (status == SQLITE_ROW) {
        // this is a count from UPDATE or another query like that
        if (columnCount == 0) {
            result = jsNumber(sqlite3_changes(castedThis->version_db->db));

            while (status == SQLITE_ROW) {
                status = sqlite3_step(stmt);
            }
        } else {
            bool useBigInt64 = castedThis->useBigInt64;
            JSC::JSArray* resultArray = JSC::constructEmptyArray(lexicalGlobalObject, nullptr, 0);
            if (useBigInt64) {
                do {
                    JSC::JSValue result = constructResultObject<true>(lexicalGlobalObject, castedThis);
                    resultArray->push(lexicalGlobalObject, result);
                    status = sqlite3_step(stmt);
                } while (status == SQLITE_ROW);
            } else {
                do {
                    JSC::JSValue result = constructResultObject<false>(lexicalGlobalObject, castedThis);
                    resultArray->push(lexicalGlobalObject, result);
                    status = sqlite3_step(stmt);
                } while (status == SQLITE_ROW);
            }
            result = resultArray;
        }
    } else if (status == SQLITE_DONE) {
        result = JSC::constructEmptyArray(lexicalGlobalObject, nullptr, 0);
    }

    if (UNLIKELY(status != SQLITE_DONE && status != SQLITE_OK)) {
        throwException(lexicalGlobalObject, scope, createSQLiteError(lexicalGlobalObject, castedThis->version_db->db));
        sqlite3_reset(stmt);
        return JSValue::encode(jsUndefined());
    }

    int64_t memoryChange = sqlite_malloc_amount - currentMemoryUsage;
    if (memoryChange > 255) {
        vm.heap.deprecatedReportExtraMemory(memoryChange);
    }

    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(result));
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementExecuteStatementFunctionGet, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{

    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto castedThis = jsDynamicCast<JSSQLStatement*>(callFrame->thisValue());

    CHECK_THIS

    auto* stmt = castedThis->stmt;
    CHECK_PREPARED

    int statusCode = sqlite3_reset(stmt);
    if (UNLIKELY(statusCode != SQLITE_OK)) {
        throwException(lexicalGlobalObject, scope, createSQLiteError(lexicalGlobalObject, castedThis->version_db->db));
        return JSValue::encode(jsUndefined());
    }

    if (callFrame->argumentCount() > 0) {
        auto arg0 = callFrame->argument(0);
        DO_REBIND(arg0);
    }

    int status = sqlite3_step(stmt);
    if (!sqlite3_stmt_readonly(stmt)) {
        castedThis->version_db->version++;
    }

    if (!castedThis->hasExecuted || castedThis->need_update()) {
        initializeColumnNames(lexicalGlobalObject, castedThis);
    }

    JSValue result = jsNull();
    if (status == SQLITE_ROW) {
        bool useBigInt64 = castedThis->useBigInt64;

        result = useBigInt64 ? constructResultObject<true>(lexicalGlobalObject, castedThis)
                             : constructResultObject<false>(lexicalGlobalObject, castedThis);
        while (status == SQLITE_ROW) {
            status = sqlite3_step(stmt);
        }
    }

    if (status == SQLITE_DONE || status == SQLITE_OK) {
        RELEASE_AND_RETURN(scope, JSValue::encode(result));
    } else {
        throwException(lexicalGlobalObject, scope, createSQLiteError(lexicalGlobalObject, castedThis->version_db->db));
        sqlite3_reset(stmt);
        return JSValue::encode(jsUndefined());
    }
}

JSC_DEFINE_JIT_OPERATION(jsSQLStatementExecuteStatementFunctionGetWithoutTypeChecking, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, JSSQLStatement* castedThis))
{
    VM& vm = JSC::getVM(lexicalGlobalObject);
    IGNORE_WARNINGS_BEGIN("frame-address")
    CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
    IGNORE_WARNINGS_END
    JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* stmt = castedThis->stmt;
    CHECK_PREPARED_JIT

    int statusCode = sqlite3_reset(stmt);
    if (UNLIKELY(statusCode != SQLITE_OK)) {
        throwException(lexicalGlobalObject, scope, createSQLiteError(lexicalGlobalObject, castedThis->version_db->db));
        return { .value = 0 };
    }

    int status = sqlite3_step(stmt);
    if (!sqlite3_stmt_readonly(stmt)) {
        castedThis->version_db->version++;
    }

    if (!castedThis->hasExecuted || castedThis->need_update()) {
        initializeColumnNames(lexicalGlobalObject, castedThis);
    }

    JSValue result = jsNull();
    if (status == SQLITE_ROW) {
        bool useBigInt64 = castedThis->useBigInt64;

        result = useBigInt64 ? constructResultObject<true>(lexicalGlobalObject, castedThis)
                             : constructResultObject<false>(lexicalGlobalObject, castedThis);
        while (status == SQLITE_ROW) {
            status = sqlite3_step(stmt);
        }
    }

    if (status == SQLITE_DONE || status == SQLITE_OK) {
        RELEASE_AND_RETURN(scope, { JSValue::encode(result) });
    } else {
        throwException(lexicalGlobalObject, scope, createSQLiteError(lexicalGlobalObject, castedThis->version_db->db));
        sqlite3_reset(stmt);
        return { JSValue::encode(jsUndefined()) };
    }
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementExecuteStatementFunctionRows, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{

    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto castedThis = jsDynamicCast<JSSQLStatement*>(callFrame->thisValue());

    CHECK_THIS;

    auto* stmt = castedThis->stmt;
    CHECK_PREPARED

    int statusCode = sqlite3_reset(stmt);
    if (UNLIKELY(statusCode != SQLITE_OK)) {
        throwException(lexicalGlobalObject, scope, createSQLiteError(lexicalGlobalObject, castedThis->version_db->db));
        sqlite3_reset(stmt);
        return JSValue::encode(jsUndefined());
    }

    int count = callFrame->argumentCount();
    if (count > 0) {
        auto arg0 = callFrame->argument(0);
        DO_REBIND(arg0);
    }

    int status = sqlite3_step(stmt);
    if (!sqlite3_stmt_readonly(stmt)) {
        castedThis->version_db->version++;
    }

    if (!castedThis->hasExecuted || castedThis->need_update()) {
        initializeColumnNames(lexicalGlobalObject, castedThis);
    }

    size_t columnCount = castedThis->columnNames->size();
    JSValue result = jsNull();
    if (status == SQLITE_ROW) {
        // this is a count from UPDATE or another query like that
        if (columnCount == 0) {
            while (status == SQLITE_ROW) {
                status = sqlite3_step(stmt);
            }

            result = jsNumber(sqlite3_column_count(stmt));

        } else {

            JSC::JSArray* resultArray = JSC::constructEmptyArray(lexicalGlobalObject, nullptr, 0);
            {
                size_t columnCount = sqlite3_column_count(stmt);

                do {
                    JSC::JSArray* row = constructResultRow(vm, lexicalGlobalObject, castedThis, columnCount);
                    if (UNLIKELY(!row || scope.exception())) {
                        sqlite3_reset(stmt);
                        RELEASE_AND_RETURN(scope, {});
                    }
                    resultArray->push(lexicalGlobalObject, row);
                    status = sqlite3_step(stmt);
                } while (status == SQLITE_ROW);
            }

            result = resultArray;
        }
    } else if (status == SQLITE_DONE && columnCount != 0) {
        // breaking change in Bun v0.6.8
        result = JSC::constructEmptyArray(lexicalGlobalObject, nullptr, 0);
    }

    if (UNLIKELY(status != SQLITE_DONE && status != SQLITE_OK)) {
        throwException(lexicalGlobalObject, scope, createSQLiteError(lexicalGlobalObject, castedThis->version_db->db));
        sqlite3_reset(stmt);
        return JSValue::encode(jsUndefined());
    }

    // sqlite3_reset(stmt);
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(result));
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementExecuteStatementFunctionRun, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{

    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto castedThis = jsDynamicCast<JSSQLStatement*>(callFrame->thisValue());

    CHECK_THIS

    auto* stmt = castedThis->stmt;
    CHECK_PREPARED

    int statusCode = sqlite3_reset(stmt);
    if (UNLIKELY(statusCode != SQLITE_OK)) {
        throwException(lexicalGlobalObject, scope, createSQLiteError(lexicalGlobalObject, castedThis->version_db->db));
        return JSValue::encode(jsUndefined());
    }

    JSValue diffValue = callFrame->argument(0);

    if (callFrame->argumentCount() > 1) {
        auto arg0 = callFrame->argument(1);
        DO_REBIND(arg0);
    }

    int total_changes_before = sqlite3_total_changes(castedThis->version_db->db);

    int status = sqlite3_step(stmt);
    if (!sqlite3_stmt_readonly(stmt)) {
        castedThis->version_db->version++;
    }

    if (!castedThis->hasExecuted || castedThis->need_update()) {
        initializeColumnNames(lexicalGlobalObject, castedThis);
    }

    while (status == SQLITE_ROW) {
        status = sqlite3_step(stmt);
    }

    if (UNLIKELY(status != SQLITE_DONE && status != SQLITE_OK)) {
        throwException(lexicalGlobalObject, scope, createSQLiteError(lexicalGlobalObject, castedThis->version_db->db));
        sqlite3_reset(stmt);
        return JSValue::encode(jsUndefined());
    }

    if (auto* diff = JSC::jsDynamicCast<JSC::InternalFieldTuple*>(diffValue)) {
        auto* db = castedThis->version_db->db;
        const int total_changes_after = sqlite3_total_changes(db);
        int64_t last_insert_rowid = sqlite3_last_insert_rowid(db);
        diff->putInternalField(vm, 0, JSC::jsNumber(total_changes_after - total_changes_before));
        if (castedThis->useBigInt64) {
            diff->putInternalField(vm, 1, JSBigInt::createFrom(lexicalGlobalObject, last_insert_rowid));
        } else {
            diff->putInternalField(vm, 1, JSC::jsNumber(last_insert_rowid));
        }
    }

    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(jsUndefined()));
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementToStringFunction, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    JSSQLStatement* castedThis = jsDynamicCast<JSSQLStatement*>(callFrame->thisValue());
    auto scope = DECLARE_THROW_SCOPE(vm);

    CHECK_THIS

    char* string = sqlite3_expanded_sql(castedThis->stmt);
    if (!string) {
        RELEASE_AND_RETURN(scope, JSValue::encode(jsEmptyString(vm)));
    }
    size_t length = strlen(string);
    JSString* jsString = JSC::jsString(vm, WTF::String::fromUTF8({ string, length }));
    sqlite3_free(string);

    RELEASE_AND_RETURN(scope, JSValue::encode(jsString));
}

JSC_DEFINE_CUSTOM_GETTER(jsSqlStatementGetColumnNames, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName attributeName))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    JSSQLStatement* castedThis = jsDynamicCast<JSSQLStatement*>(JSValue::decode(thisValue));
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_THIS

    if (!castedThis->hasExecuted || castedThis->need_update()) {
        initializeColumnNames(lexicalGlobalObject, castedThis);
    }
    JSC::JSArray* array;
    auto* columnNames = castedThis->columnNames.get();
    if (columnNames->size() > 0) {
        if (castedThis->_prototype) {
            array = ownPropertyKeys(lexicalGlobalObject, castedThis->_prototype.get(), PropertyNameMode::Strings, DontEnumPropertiesMode::Exclude);
        } else {
            array = JSC::constructEmptyArray(lexicalGlobalObject, nullptr, columnNames->size());
            unsigned int i = 0;
            for (const auto& column : *columnNames) {
                array->putDirectIndex(lexicalGlobalObject, i++, jsString(vm, column.string()));
            }
        }
    } else {
        array = JSC::constructEmptyArray(lexicalGlobalObject, nullptr, 0);
    }
    return JSC::JSValue::encode(array);
}

JSC_DEFINE_CUSTOM_GETTER(jsSqlStatementGetColumnCount, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName attributeName))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    JSSQLStatement* castedThis = jsDynamicCast<JSSQLStatement*>(JSValue::decode(thisValue));
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_THIS
    CHECK_PREPARED

    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::jsNumber(sqlite3_column_count(castedThis->stmt))));
}

JSC_DEFINE_CUSTOM_GETTER(jsSqlStatementGetParamCount, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName attributeName))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    JSSQLStatement* castedThis = jsDynamicCast<JSSQLStatement*>(JSValue::decode(thisValue));
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_THIS
    CHECK_PREPARED

    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::jsNumber(sqlite3_bind_parameter_count(castedThis->stmt))));
}

JSC_DEFINE_CUSTOM_GETTER(jsSqlStatementGetSafeIntegers, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName attributeName))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    JSSQLStatement* castedThis = jsDynamicCast<JSSQLStatement*>(JSValue::decode(thisValue));
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_THIS
    CHECK_PREPARED

    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::jsBoolean(castedThis->useBigInt64)));
}

JSC_DEFINE_CUSTOM_SETTER(jsSqlStatementSetSafeIntegers, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, PropertyName attributeName))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    JSSQLStatement* castedThis = jsDynamicCast<JSSQLStatement*>(JSValue::decode(thisValue));
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_THIS
    CHECK_PREPARED

    bool value = JSValue::decode(encodedValue).toBoolean(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, false);
    castedThis->useBigInt64 = value;

    return true;
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementFunctionFinalize, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    JSSQLStatement* castedThis = jsDynamicCast<JSSQLStatement*>(callFrame->thisValue());
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_THIS

    if (castedThis->stmt) {
        sqlite3_finalize(castedThis->stmt);
        castedThis->stmt = nullptr;
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(jsUndefined()));
}

const ClassInfo JSSQLStatement::s_info = { "SQLStatement"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSSQLStatement) };

/* Hash table for prototype */

void JSSQLStatement::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    vm.heap.reportExtraMemoryAllocated(this, this->extraMemorySize);
}

JSSQLStatement::~JSSQLStatement()
{
    if (this->stmt) {
        sqlite3_finalize(this->stmt);
    }

    if (auto* columnNames = this->columnNames.get()) {
        columnNames->releaseData();
        this->columnNames = nullptr;
    }
}

void JSSQLStatement::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = jsCast<JSSQLStatement*>(cell);
    if (thisObject->stmt)
        analyzer.setWrappedObjectForCell(cell, thisObject->stmt);

    Base::analyzeHeap(cell, analyzer);
}

JSC::JSValue JSSQLStatement::rebind(JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSValue values, bool clone, sqlite3* db)
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stmt = this->stmt;

    auto val = rebindStatement(lexicalGlobalObject, values, scope, this->version_db->db, stmt, clone, this->m_bindingNames, this->useBigInt64);
    if (val.isNumber()) {
        RELEASE_AND_RETURN(scope, val);
    } else {
        return val;
    }
}

template<typename Visitor>
void JSSQLStatement::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSSQLStatement* thisObject = jsCast<JSSQLStatement*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    visitor.reportExtraMemoryVisited(thisObject->extraMemorySize);

    visitor.append(thisObject->_structure);
    visitor.append(thisObject->_prototype);
    visitor.append(thisObject->userPrototype);
}

DEFINE_VISIT_CHILDREN(JSSQLStatement);

template<typename Visitor>
void JSSQLStatement::visitAdditionalChildren(Visitor& visitor)
{
    JSSQLStatement* thisObject = this;
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());

    visitor.append(thisObject->_structure);
    visitor.append(thisObject->_prototype);
    visitor.append(thisObject->userPrototype);
}

template<typename Visitor>
void JSSQLStatement::visitOutputConstraints(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = jsCast<JSSQLStatement*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitOutputConstraints(thisObject, visitor);
    thisObject->visitAdditionalChildren(visitor);
}

template void JSSQLStatement::visitOutputConstraints(JSCell*, AbstractSlotVisitor&);
template void JSSQLStatement::visitOutputConstraints(JSCell*, SlotVisitor&);

JSValue createJSSQLStatementConstructor(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    JSObject* object = JSC::constructEmptyObject(globalObject);
    auto* diff = InternalFieldTuple::create(vm, globalObject->internalFieldTupleStructure(), jsUndefined(), jsUndefined());

    auto* constructor = JSSQLStatementConstructor::create(
        vm,
        globalObject,
        JSSQLStatementConstructor::createStructure(vm, globalObject, globalObject->m_functionPrototype.get()));

    object->putDirectIndex(globalObject, 0, constructor);
    object->putDirectIndex(globalObject, 1, diff);

    return object;
}

} // namespace WebCore
