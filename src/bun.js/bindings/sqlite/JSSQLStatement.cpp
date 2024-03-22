#include "root.h"

#include "JSSQLStatement.h"
#include <JavaScriptCore/JSObjectInlines.h>
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
#include <atomic>

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
            sqlite3_close_v2(db->db);
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

JSC_DECLARE_HOST_FUNCTION(jsSQLStatementFunctionFinalize);
JSC_DECLARE_HOST_FUNCTION(jsSQLStatementToStringFunction);

JSC_DECLARE_CUSTOM_GETTER(jsSqlStatementGetColumnNames);
JSC_DECLARE_CUSTOM_GETTER(jsSqlStatementGetColumnCount);
JSC_DECLARE_CUSTOM_GETTER(jsSqlStatementGetParamCount);

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
    uint64_t version;
    bool hasExecuted = false;
    std::unique_ptr<PropertyNameArray> columnNames;
    mutable JSC::WriteBarrier<JSC::JSObject> _prototype;
    mutable JSC::WriteBarrier<JSC::Structure> _structure;
    size_t extraMemorySize = 0;

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
    { "values"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementExecuteStatementFunctionRows, 1 } },
    { "finalize"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementFunctionFinalize, 0 } },
    { "toString"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSQLStatementToStringFunction, 0 } },
    { "columns"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsSqlStatementGetColumnNames, 0 } },
    { "columnsCount"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsSqlStatementGetColumnCount, 0 } },
    { "paramsCount"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsSqlStatementGetParamCount, 0 } },
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
        PropertyOffset offset;
        auto columnNames = castedThis->columnNames.get();
        bool anyHoles = false;
        for (int i = 0; i < count; i++) {
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

            columnNames->add(Identifier::fromString(vm, WTF::String::fromUTF8(name, len)));
        }

        if (LIKELY(!anyHoles)) {
            Structure* structure = globalObject.structureCache().emptyObjectStructureForPrototype(&globalObject, globalObject.objectPrototype(), columnNames->size());
            vm.writeBarrier(castedThis, structure);

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
        }
    }

    // Slow path:

    JSC::ObjectInitializationScope initializationScope(vm);

    // 64 is the maximum we can preallocate here
    // see https://github.com/oven-sh/bun/issues/987
    JSC::JSObject* object = JSC::constructEmptyObject(lexicalGlobalObject, lexicalGlobalObject->objectPrototype(), std::min(static_cast<unsigned>(count), JSFinalObject::maxInlineCapacity));

    for (int i = 0; i < count; i++) {
        const char* name = sqlite3_column_name(stmt, i);

        if (name == nullptr)
            break;

        size_t len = strlen(name);
        if (len == 0)
            break;

        auto wtfString = WTF::String::fromUTF8(name, len);
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

        object->putDirect(vm, key, primitive, 0);
        castedThis->columnNames->add(key);
    }
    castedThis->_prototype.set(vm, castedThis, object);
}

void JSSQLStatement::destroy(JSC::JSCell* cell)
{
    JSSQLStatement* thisObject = static_cast<JSSQLStatement*>(cell);
    thisObject->~JSSQLStatement();
}

static inline bool rebindValue(JSC::JSGlobalObject* lexicalGlobalObject, sqlite3* db, sqlite3_stmt* stmt, int i, JSC::JSValue value, JSC::ThrowScope& scope, bool clone)
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

        auto roped = str->tryGetValue(lexicalGlobalObject);
        if (UNLIKELY(!roped)) {
            throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Out of memory :("_s));
            return false;
        }

        if (roped.is8Bit() && roped.containsOnlyASCII()) {
            CHECK_BIND(sqlite3_bind_text(stmt, i, reinterpret_cast<const char*>(roped.characters8()), roped.length(), transientOrStatic));
        } else if (!roped.is8Bit()) {
            CHECK_BIND(sqlite3_bind_text16(stmt, i, roped.characters16(), roped.length() * 2, transientOrStatic));
        } else {
            auto utf8 = roped.utf8();
            CHECK_BIND(sqlite3_bind_text(stmt, i, utf8.data(), utf8.length(), SQLITE_TRANSIENT));
        }

    } else if (UNLIKELY(value.isHeapBigInt())) {
        CHECK_BIND(sqlite3_bind_int64(stmt, i, JSBigInt::toBigInt64(value)));
    } else if (JSC::JSArrayBufferView* buffer = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(value)) {
        CHECK_BIND(sqlite3_bind_blob(stmt, i, buffer->vector(), buffer->byteLength(), transientOrStatic));
    } else {
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Binding expected string, TypedArray, boolean, number, bigint or null"_s));
        return false;
    }

    return true;
#undef CHECK_BIND
}

// this function does the equivalent of
// Object.entries(obj)
// except without the intermediate array of arrays
static JSC::JSValue rebindObject(JSC::JSGlobalObject* globalObject, JSC::JSValue targetValue, JSC::ThrowScope& scope, sqlite3* db, sqlite3_stmt* stmt, bool clone)
{
    JSObject* target = targetValue.toObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    JSC::VM& vm = globalObject->vm();
    PropertyNameArray properties(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    target->methodTable()->getOwnPropertyNames(target, globalObject, properties, DontEnumPropertiesMode::Include);
    RETURN_IF_EXCEPTION(scope, {});
    int count = 0;

    for (const auto& propertyName : properties) {
        PropertySlot slot(target, PropertySlot::InternalMethodType::GetOwnProperty);
        bool hasProperty = target->methodTable()->getOwnPropertySlot(target, globalObject, propertyName, slot);
        RETURN_IF_EXCEPTION(scope, JSValue());
        if (!hasProperty)
            continue;
        if (slot.attributes() & PropertyAttribute::DontEnum)
            continue;

        JSValue value;
        if (LIKELY(!slot.isTaintedByOpaqueObject()))
            value = slot.getValue(globalObject, propertyName);
        else {
            value = target->get(globalObject, propertyName);
            RETURN_IF_EXCEPTION(scope, JSValue());
        }

        // Ensure this gets freed on scope clear
        auto utf8 = WTF::String(propertyName.string()).utf8();

        int index = sqlite3_bind_parameter_index(stmt, utf8.data());
        if (index == 0) {
            throwException(globalObject, scope, createError(globalObject, "Unknown parameter \"" + propertyName.string() + "\""_s));
            return JSValue();
        }

        if (!rebindValue(globalObject, db, stmt, index, value, scope, clone))
            return JSValue();
        RETURN_IF_EXCEPTION(scope, {});
        count++;
    }

    return jsNumber(count);
}

static JSC::JSValue rebindStatement(JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSValue values, JSC::ThrowScope& scope, sqlite3* db, sqlite3_stmt* stmt, bool clone)
{
    sqlite3_clear_bindings(stmt);
    JSC::JSArray* array = jsDynamicCast<JSC::JSArray*>(values);
    int max = sqlite3_bind_parameter_count(stmt);

    if (!array) {
        if (JSC::JSObject* object = values.getObject()) {
            auto res = rebindObject(lexicalGlobalObject, object, scope, db, stmt, clone);
            RETURN_IF_EXCEPTION(scope, {});
            return res;
        }

        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected array"_s));
        return jsUndefined();
    }

    int count = array->length();

    if (count == 0) {
        return jsNumber(0);
    }

    if (count != max) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected " + String::number(max) + " values, got " + String::number(count)));
        return jsUndefined();
    }

    int i = 0;
    for (; i < count; i++) {
        JSC::JSValue value = array->getIndexQuickly(i);
        rebindValue(lexicalGlobalObject, db, stmt, i + 1, value, scope, clone);
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
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, error ? sqliteString(error) : String::fromUTF8(reinterpret_cast<const LChar*>(sqlite3_errmsg(db)))));
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

    JSC::JSValue sqlValue = callFrame->argument(1);
    if (UNLIKELY(!sqlValue.isString())) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected SQL string"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    EnsureStillAliveScope bindingsAliveScope = callFrame->argumentCount() > 2 ? callFrame->argument(2) : jsUndefined();

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
        sqlString.is8Bit() && simdutf::validate_ascii(reinterpret_cast<const char*>(sqlString.characters8()), sqlString.length())) {

        sqlStringHead = reinterpret_cast<const char*>(sqlString.characters8());
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
                JSC::JSValue reb = rebindStatement(lexicalGlobalObject, bindingsAliveScope.value(), scope, db, sql.stmt, false);
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
        sqlString.is8Bit() && simdutf::validate_ascii(reinterpret_cast<const char*>(sqlString.characters8()), sqlString.length())) {
        rc = sqlite3_prepare_v3(db, reinterpret_cast<const char*>(sqlString.characters8()), sqlString.length(), flags, &statement, nullptr);
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

    sqlite3* db = nullptr;
    int statusCode = sqlite3_open_v2(path.utf8().data(), &db, openFlags, nullptr);

    if (statusCode != SQLITE_OK) {
        throwException(lexicalGlobalObject, scope, createSQLiteError(lexicalGlobalObject, db));

        return JSValue::encode(jsUndefined());
    }

    int status = sqlite3_db_config(db, SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION, 1, NULL);
    if (status != SQLITE_OK) {
        // TODO: log a warning here that extensions are unsupported.
    }

    status = sqlite3_db_config(db, SQLITE_DBCONFIG_DEFENSIVE, 1, NULL);
    if (status != SQLITE_OK) {
        // TODO: log a warning here that defensive mode is unsupported.
    }
    auto count = databases().size();
    sqlite3_extended_result_codes(db, 1);
    databases().append(new VersionSqlite3(db));
    RELEASE_AND_RETURN(scope, JSValue::encode(jsNumber(count)));
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
    if (!dbNumber.isNumber()) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected number"_s));
        return JSValue::encode(jsUndefined());
    }

    int dbIndex = dbNumber.toInt32(lexicalGlobalObject);

    if (dbIndex < 0 || dbIndex >= databases().size()) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Invalid database handle"_s));
        return JSValue::encode(jsUndefined());
    }

    sqlite3* db = databases()[dbIndex]->db;
    // no-op if already closed
    if (!db) {
        return JSValue::encode(jsUndefined());
    }

    int statusCode = sqlite3_close_v2(db);
    if (statusCode != SQLITE_OK) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, WTF::String::fromUTF8(sqlite3_errstr(statusCode))));
        return JSValue::encode(jsUndefined());
    }

    databases()[dbIndex]->db = nullptr;
    return JSValue::encode(jsUndefined());
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

static inline JSC::JSValue constructResultObject(JSC::JSGlobalObject* lexicalGlobalObject, JSSQLStatement* castedThis);
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

        for (unsigned int i = 0; i < count; i++) {
            JSValue value;

            // Loop 1. Fill the rowBuffer with values from SQLite
            switch (sqlite3_column_type(stmt, i)) {
            case SQLITE_INTEGER: {
                // https://github.com/oven-sh/bun/issues/1536
                value = jsNumberFromSQLite(stmt, i);
                break;
            }
            case SQLITE_FLOAT: {
                value = jsNumber(sqlite3_column_double(stmt, i));
                break;
            }
            // > Note that the SQLITE_TEXT constant was also used in SQLite version
            // > 2 for a completely different meaning. Software that links against
            // > both SQLite version 2 and SQLite version 3 should use SQLITE3_TEXT,
            // > not SQLITE_TEXT.
            case SQLITE3_TEXT: {
                size_t len = sqlite3_column_bytes(stmt, i);
                const unsigned char* text = len > 0 ? sqlite3_column_text(stmt, i) : nullptr;

                if (len > 64) {
                    value = JSC::JSValue::decode(Bun__encoding__toStringUTF8(text, len, lexicalGlobalObject));
                    break;
                } else {
                    value = jsString(vm, WTF::String::fromUTF8(text, len));
                    break;
                }
            }
            case SQLITE_BLOB: {
                size_t len = sqlite3_column_bytes(stmt, i);
                const void* blob = len > 0 ? sqlite3_column_blob(stmt, i) : nullptr;
                JSC::JSUint8Array* array = JSC::JSUint8Array::createUninitialized(lexicalGlobalObject, lexicalGlobalObject->m_typedArrayUint8.get(lexicalGlobalObject), len);

                if (LIKELY(blob && len))
                    memcpy(array->vector(), blob, len);

                value = array;
                break;
            }
            default: {
                value = jsNull();
                break;
            }
            }

            result->putDirectOffset(vm, i, value);
        }

    } else {
        if (count <= JSFinalObject::maxInlineCapacity) {
            result = JSC::JSFinalObject::create(vm, castedThis->_prototype.get()->structure());
        } else {
            result = JSC::JSFinalObject::create(vm, JSC::JSFinalObject::createStructure(vm, lexicalGlobalObject, lexicalGlobalObject->objectPrototype(), JSFinalObject::maxInlineCapacity));
        }

        for (int i = 0; i < count; i++) {
            auto name = columnNames[i];

            switch (sqlite3_column_type(stmt, i)) {
            case SQLITE_INTEGER: {
                // https://github.com/oven-sh/bun/issues/1536
                result->putDirect(vm, name, jsNumberFromSQLite(stmt, i), 0);
                break;
            }
            case SQLITE_FLOAT: {
                result->putDirect(vm, name, jsDoubleNumber(sqlite3_column_double(stmt, i)), 0);
                break;
            }
            // > Note that the SQLITE_TEXT constant was also used in SQLite version
            // > 2 for a completely different meaning. Software that links against
            // > both SQLite version 2 and SQLite version 3 should use SQLITE3_TEXT,
            // > not SQLITE_TEXT.
            case SQLITE3_TEXT: {
                size_t len = sqlite3_column_bytes(stmt, i);
                const unsigned char* text = len > 0 ? sqlite3_column_text(stmt, i) : nullptr;

                if (len > 64) {
                    result->putDirect(vm, name, JSC::JSValue::decode(Bun__encoding__toStringUTF8(text, len, lexicalGlobalObject)), 0);
                    continue;
                }

                result->putDirect(vm, name, jsString(vm, WTF::String::fromUTF8(text, len)), 0);
                break;
            }
            case SQLITE_BLOB: {
                size_t len = sqlite3_column_bytes(stmt, i);
                const void* blob = len > 0 ? sqlite3_column_blob(stmt, i) : nullptr;
                JSC::JSUint8Array* array = JSC::JSUint8Array::createUninitialized(lexicalGlobalObject, lexicalGlobalObject->m_typedArrayUint8.get(lexicalGlobalObject), len);

                if (LIKELY(blob && len))
                    memcpy(array->vector(), blob, len);

                result->putDirect(vm, name, array, 0);
                break;
            }
            default: {
                result->putDirect(vm, name, jsNull(), 0);
                break;
            }
            }
        }
    }

    return JSValue(result);
}

static inline JSC::JSArray* constructResultRow(JSC::JSGlobalObject* lexicalGlobalObject, JSSQLStatement* castedThis, ObjectInitializationScope& scope, JSC::GCDeferralContext* deferralContext);
static inline JSC::JSArray* constructResultRow(JSC::JSGlobalObject* lexicalGlobalObject, JSSQLStatement* castedThis, ObjectInitializationScope& scope, JSC::GCDeferralContext* deferralContext)
{
    int count = castedThis->columnNames->size();
    auto& vm = lexicalGlobalObject->vm();

    JSC::JSArray* result = JSArray::create(vm, lexicalGlobalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithContiguous), count);
    auto* stmt = castedThis->stmt;

    for (int i = 0; i < count; i++) {

        switch (sqlite3_column_type(stmt, i)) {
        case SQLITE_INTEGER: {
            // https://github.com/oven-sh/bun/issues/1536
            result->putDirectIndex(lexicalGlobalObject, i, jsNumberFromSQLite(stmt, i));
            break;
        }
        case SQLITE_FLOAT: {
            result->putDirectIndex(lexicalGlobalObject, i, jsDoubleNumber(sqlite3_column_double(stmt, i)));
            break;
        }
        // > Note that the SQLITE_TEXT constant was also used in SQLite version
        // > 2 for a completely different meaning. Software that links against
        // > both SQLite version 2 and SQLite version 3 should use SQLITE3_TEXT,
        // > not SQLITE_TEXT.
        case SQLITE_TEXT: {
            size_t len = sqlite3_column_bytes(stmt, i);
            const unsigned char* text = len > 0 ? sqlite3_column_text(stmt, i) : nullptr;
            if (UNLIKELY(text == nullptr || len == 0)) {
                result->putDirectIndex(lexicalGlobalObject, i, jsEmptyString(vm));
                continue;
            }
            result->putDirectIndex(lexicalGlobalObject, i, len < 64 ? jsString(vm, WTF::String::fromUTF8(text, len)) : JSC::JSValue::decode(Bun__encoding__toStringUTF8(text, len, lexicalGlobalObject)));
            break;
        }
        case SQLITE_BLOB: {
            size_t len = sqlite3_column_bytes(stmt, i);
            const void* blob = len > 0 ? sqlite3_column_blob(stmt, i) : nullptr;
            if (LIKELY(len > 0 && blob != nullptr)) {
                JSC::JSUint8Array* array = JSC::JSUint8Array::createUninitialized(lexicalGlobalObject, lexicalGlobalObject->m_typedArrayUint8.get(lexicalGlobalObject), len);
                memcpy(array->vector(), blob, len);
                result->putDirectIndex(lexicalGlobalObject, i, array);
            } else {
                result->putDirectIndex(lexicalGlobalObject, i, JSC::JSUint8Array::create(lexicalGlobalObject, lexicalGlobalObject->m_typedArrayUint8.get(lexicalGlobalObject), 0));
            }
            break;
        }
        default: {
            result->putDirectIndex(lexicalGlobalObject, i, jsNull());
            break;
        }
        }
    }

    return result;
}

static inline JSC::JSArray* constructResultRow(JSC::JSGlobalObject* lexicalGlobalObject, JSSQLStatement* castedThis, ObjectInitializationScope& scope)
{
    return constructResultRow(lexicalGlobalObject, castedThis, scope, nullptr);
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

            JSC::JSArray* resultArray = JSC::constructEmptyArray(lexicalGlobalObject, nullptr, 0);
            {
                while (status == SQLITE_ROW) {
                    JSC::JSValue result = constructResultObject(lexicalGlobalObject, castedThis);
                    resultArray->push(lexicalGlobalObject, result);
                    status = sqlite3_step(stmt);
                }
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
        result = constructResultObject(lexicalGlobalObject, castedThis);
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
    CHECK_PREPARED

    int statusCode = sqlite3_reset(stmt);
    if (UNLIKELY(statusCode != SQLITE_OK)) {
        throwException(lexicalGlobalObject, scope, createSQLiteError(lexicalGlobalObject, castedThis->version_db->db));
        return JSValue::encode(jsUndefined());
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
        result = constructResultObject(lexicalGlobalObject, castedThis);
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
            JSC::ObjectInitializationScope initializationScope(vm);
            JSC::GCDeferralContext deferralContext(vm);

            JSC::JSArray* resultArray = JSC::constructEmptyArray(lexicalGlobalObject, nullptr, 0);
            {

                while (status == SQLITE_ROW) {
                    JSC::JSValue row = constructResultRow(lexicalGlobalObject, castedThis, initializationScope, &deferralContext);
                    resultArray->push(lexicalGlobalObject, row);
                    status = sqlite3_step(stmt);
                }
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

    while (status == SQLITE_ROW) {
        status = sqlite3_step(stmt);
    }

    if (UNLIKELY(status != SQLITE_DONE && status != SQLITE_OK)) {
        throwException(lexicalGlobalObject, scope, createSQLiteError(lexicalGlobalObject, castedThis->version_db->db));
        sqlite3_reset(stmt);
        return JSValue::encode(jsUndefined());
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
    JSString* jsString = JSC::jsString(vm, WTF::String::fromUTF8(string, length));
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
    auto val = rebindStatement(lexicalGlobalObject, values, scope, this->version_db->db, stmt, clone);
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
}

DEFINE_VISIT_CHILDREN(JSSQLStatement);

template<typename Visitor>
void JSSQLStatement::visitAdditionalChildren(Visitor& visitor)
{
    JSSQLStatement* thisObject = this;
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());

    visitor.append(thisObject->_structure);
    visitor.append(thisObject->_prototype);
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
}
