#include "root.h"
#include "JSRequireCache.h"

#include "BunCompiledModules.h"
#include "BunModuleRegistry.h"
#include "IsolatedModuleCache.h"
#include "JSCommonJSModule.h"
#include "ModuleGraph.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/AbstractModuleRecord.h>
#include <JavaScriptCore/JSMapInlines.h>
#include <JavaScriptCore/JSMapIterator.h>
#include <JavaScriptCore/JSModuleNamespaceObject.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <JavaScriptCore/WeakGCMapInlines.h>

namespace Bun {
using namespace JSC;

// "Object": what `Bun.inspect()` and a heap snapshot name an object without a constructor by.
const ClassInfo JSRequireCache::s_info = { "Object"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSRequireCache) };

static JSC_DECLARE_CUSTOM_GETTER(jsRequireCacheEntryMadeOnRead);

JSRequireCache* JSRequireCache::create(VM& vm, Zig::GlobalObject* globalObject, JSMap* requireMap, JSCommonJSModule* owner)
{
    auto* structure = Bun::createClassStructure(vm, globalObject, jsNull(), TypeInfo(ObjectType, StructureFlags), info(), NonArray | MayHaveIndexedAccessors);
    auto* cache = new (NotNull, allocateCell<JSRequireCache>(vm)) JSRequireCache(vm, structure);
    cache->finishCreation(vm);
    cache->m_requireMap.set(vm, cache, requireMap);
    cache->m_owner.setMayBeNull(vm, cache, owner);
    return cache;
}

template<typename Visitor>
void JSRequireCache::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSRequireCache>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_requireMap);
    visitor.append(thisObject->m_owner);
}

DEFINE_VISIT_CHILDREN(JSRequireCache);

Zig::GlobalObject* JSRequireCache::zigGlobalObject() const
{
    return uncheckedDowncast<Zig::GlobalObject>(globalObject());
}

// The loader whose registry the cache lists: that of the owner's Bun.ModuleGraph, which is null once the graph is disposed, or else the running test file's.
static JSModuleLoader* loaderOf(Zig::GlobalObject* globalObject, JSCommonJSModule* owner)
{
    if (auto* graph = owner ? owner->moduleGraph() : nullptr)
        return graph->disposed() ? nullptr : graph->loader();
    return Bun::testFileModuleLoader(globalObject);
}

bool JSRequireCache::seesCompiledModules(Zig::GlobalObject* globalObject) const
{
    return Bun::hasCompiledModules() && loaderOf(globalObject, m_owner.get()) == globalObject->moduleLoader();
}

// Node.js never adds builtin modules to require.cache. Serving them from the ESM registry would hand out the frozen module namespace object,
// which breaks CJS patchers like require-in-the-middle that read require.cache and expect a mutable exports object. The same applies to bun:*
// builtins. Users can still write their own entries for builtins; those live in the require map.
static bool isBuiltinKey(StringView key)
{
    return key.startsWith("node:"_s) || key.startsWith("bun:"_s);
}

// An executable that `bun build --compile --aot` made never lists its own files, which run once: the cache holds the files that were loaded from
// outside of the executable, as in a bundled executable. A test run that is compiled in place shows its files, as plain does.
static bool hidesCompiledFiles(Zig::GlobalObject* globalObject)
{
    return Bun::hasCompiledModules() && !Bun::requireCacheListsCompiledFiles(globalObject);
}

static bool isHiddenKey(Zig::GlobalObject* globalObject, UniquedStringImpl* key)
{
    return hidesCompiledFiles(globalObject) && Bun::isHiddenFromRequireCache(String(key));
}

// The require map is asked with a JSString, and a property name is not one. An atom keeps one JSString for as long as something holds it, so that
// reading a key again allocates nothing.
static JSString* stringOfKey(VM& vm, UniquedStringImpl* key)
{
    DeferGC deferGC(vm);
    return vm.atomStringToJSStringMap.ensureValue(key, [&] {
        return jsString(vm, String(key));
    });
}

// JSMap compiles its hash table into every caller: these three hold the one copy of each operation that the hooks share.
// JSMap::get() answers undefined for a key that the map does not have, and `isStored` tells that apart from a key that holds undefined.
static NEVER_INLINE JSValue entryInMap(JSGlobalObject* globalObject, JSMap* map, JSString* key, bool& isStored)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    isStored = false;
    JSValue stored = map->get(globalObject, key);
    RETURN_IF_EXCEPTION(scope, {});
    isStored = !stored.isUndefined();
    if (!isStored) {
        isStored = map->has(globalObject, key);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return stored;
}

static NEVER_INLINE void setInMap(JSGlobalObject* globalObject, JSMap* map, JSString* key, JSValue value)
{
    map->set(globalObject, key, value);
}

static NEVER_INLINE void removeFromMap(JSGlobalObject* globalObject, JSMap* map, JSString* key)
{
    map->remove(globalObject, key);
}

static AbstractModuleRecord* evaluatedModuleRecord(Zig::GlobalObject* globalObject, JSCommonJSModule* owner, UniquedStringImpl* key)
{
    auto* loader = loaderOf(globalObject, owner);
    if (!loader)
        return nullptr;
    auto* entry = loader->registryEntry(Identifier::fromUid(globalObject->vm(), key));
    return entry && isModuleEvaluated(entry->record()) ? entry->record() : nullptr;
}

bool JSRequireCache::isListedByLoader(Zig::GlobalObject* globalObject, UniquedStringImpl* key) const
{
    if (isBuiltinKey(key))
        return seesCompiledModules(globalObject) && Bun::isLibraryModuleInRequireCache(globalObject, String(key));
    if (evaluatedModuleRecord(globalObject, m_owner.get(), key))
        return true;
    return seesCompiledModules(globalObject) && Bun::isEvaluatedCompiledFile(globalObject, String(key));
}

JSValue JSRequireCache::entryMadeOnRead(UniquedStringImpl* key)
{
    auto* globalObject = zigGlobalObject();
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSString* keyString = stringOfKey(vm, key);
    JSMap* map = m_requireMap.get();
    bool isStored;
    JSValue stored = entryInMap(globalObject, map, keyString, isStored);
    RETURN_IF_EXCEPTION(scope, {});
    if (stored.toBoolean(globalObject))
        return stored;

    // A module of a compiled program is in no require map: the engine answers for it, and makes its module object when somebody first asks for one.
    if (seesCompiledModules(globalObject)) {
        JSValue compiled = Bun::compiledRequireCacheEntry(globalObject, String(key));
        RETURN_IF_EXCEPTION(scope, {});
        if (compiled)
            return compiled;
    }

    if (isStored)
        return stored;
    if (isBuiltinKey(key))
        return jsUndefined();

    // An ES module that only `import` has loaded gets its module object here: the namespace object is made for it, and the record keeps that.
    auto* record = evaluatedModuleRecord(globalObject, m_owner.get(), key);
    if (!record)
        return jsUndefined();
    JSValue moduleNamespace;
    if (Bun::isRecordOfCompiledModule(record)) [[unlikely]] {
        moduleNamespace = Bun::loadCompiledModuleNamespace(globalObject, String(key));
        RETURN_IF_EXCEPTION(scope, {});
        if (!moduleNamespace)
            return jsUndefined();
    } else {
        moduleNamespace = record->getModuleNamespace(globalObject, false);
        RETURN_IF_EXCEPTION(scope, {});
    }
    auto* module = createCommonJSModuleForRequirer(globalObject, keyString, moduleNamespace, true, m_owner ? JSValue(m_owner.get()) : jsUndefined());
    RETURN_IF_EXCEPTION(scope, {});
    setInMap(globalObject, map, keyString, module);
    RETURN_IF_EXCEPTION(scope, {});
    return module;
}

JSC_DEFINE_CUSTOM_GETTER(jsRequireCacheEntryMadeOnRead, (JSGlobalObject*, EncodedJSValue thisValue, PropertyName propertyName))
{
    auto* cache = dynamicDowncast<JSRequireCache>(JSValue::decode(thisValue));
    if (!cache) [[unlikely]]
        return JSValue::encode(jsUndefined());
    return JSValue::encode(cache->entryMadeOnRead(propertyName.uid()));
}

bool JSRequireCache::getOwnPropertySlot(JSObject* object, JSGlobalObject* lexicalGlobalObject, PropertyName propertyName, PropertySlot& slot)
{
    auto* thisObject = uncheckedDowncast<JSRequireCache>(object);
    VM& vm = getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* key = propertyName.uid();
    if (!key || key->isSymbol())
        RELEASE_AND_RETURN(scope, Base::getOwnPropertySlot(object, lexicalGlobalObject, propertyName, slot));

    slot.disableCaching();
    if (slot.isVMInquiry()) {
        slot.setIsTaintedByOpaqueObject();
        return false;
    }

    auto* globalObject = thisObject->zigGlobalObject();
    if (isHiddenKey(globalObject, key))
        return false;

    bool isStored;
    JSValue stored = entryInMap(globalObject, thisObject->m_requireMap.get(), stringOfKey(vm, key), isStored);
    RETURN_IF_EXCEPTION(scope, false);
    if (isStored) {
        // A compiled file that ran again left the falsy value that asked for it in the require map: the engine holds its entry.
        if (Bun::hasCompiledModules() && !stored.toBoolean(globalObject) && thisObject->seesCompiledModules(globalObject)) [[unlikely]]
            slot.setCustom(thisObject, 0, jsRequireCacheEntryMadeOnRead);
        else
            slot.setValue(thisObject, 0, stored);
        return true;
    }

    if (Base::getOwnPropertySlot(object, lexicalGlobalObject, propertyName, slot))
        return true;

    if (!thisObject->isListedByLoader(globalObject, key))
        return false;
    // `in`, Object.hasOwn() and a listing ask for no value, and make no entry.
    slot.setCustom(thisObject, 0, jsRequireCacheEntryMadeOnRead);
    return true;
}

bool JSRequireCache::getOwnPropertySlotByIndex(JSObject* object, JSGlobalObject* lexicalGlobalObject, unsigned index, PropertySlot& slot)
{
    return getOwnPropertySlot(object, lexicalGlobalObject, Identifier::from(getVM(lexicalGlobalObject), index), slot);
}

bool JSRequireCache::store(Zig::GlobalObject* globalObject, UniquedStringImpl* key, JSValue value)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // The code of an ahead-of-time executable calls the module that a name stood for when it was compiled: it refuses a store that its build did not see.
    if (seesCompiledModules(globalObject)) {
        Bun::willSetRequireCacheEntry(globalObject, String(key), value);
        RETURN_IF_EXCEPTION(scope, false);
    }
    setInMap(globalObject, m_requireMap.get(), stringOfKey(vm, key), value);
    RETURN_IF_EXCEPTION(scope, false);
    return true;
}

bool JSRequireCache::put(JSCell* cell, JSGlobalObject* lexicalGlobalObject, PropertyName propertyName, JSValue value, PutPropertySlot& slot)
{
    auto* thisObject = uncheckedDowncast<JSRequireCache>(cell);
    VM& vm = getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // A write to an object that inherits from the cache is that object's.
    auto* key = propertyName.uid();
    if (slot.thisValue() != cell || !key || key->isSymbol()) [[unlikely]]
        RELEASE_AND_RETURN(scope, Base::put(cell, lexicalGlobalObject, propertyName, value, slot));

    auto* globalObject = thisObject->zigGlobalObject();
    PropertySlot own(thisObject, PropertySlot::InternalMethodType::GetOwnProperty);
    if (Base::getOwnPropertySlot(thisObject, lexicalGlobalObject, propertyName, own)) [[unlikely]] {
        // A setter or a read-only property that Object.defineProperty() left on the object answers, unless the require map has the key since.
        bool isStored;
        entryInMap(globalObject, thisObject->m_requireMap.get(), stringOfKey(vm, key), isStored);
        RETURN_IF_EXCEPTION(scope, false);
        if (!isStored) {
            // JSObject::put() hands an index back to putByIndex().
            if (std::optional<uint32_t> index = parseIndex(propertyName))
                RELEASE_AND_RETURN(scope, Base::putByIndex(cell, lexicalGlobalObject, *index, value, slot.isStrictMode()));
            RELEASE_AND_RETURN(scope, Base::put(cell, lexicalGlobalObject, propertyName, value, slot));
        }
    }
    RELEASE_AND_RETURN(scope, thisObject->store(globalObject, key, value));
}

bool JSRequireCache::putByIndex(JSCell* cell, JSGlobalObject* lexicalGlobalObject, unsigned index, JSValue value, bool shouldThrow)
{
    PutPropertySlot slot(cell, shouldThrow);
    return put(cell, lexicalGlobalObject, Identifier::from(getVM(lexicalGlobalObject), index), value, slot);
}

bool JSRequireCache::takeOut(Zig::GlobalObject* globalObject, UniquedStringImpl* key)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (isHiddenKey(globalObject, key))
        return false;

    String path(key);
    if (seesCompiledModules(globalObject)) {
        Bun::didDeleteRequireCacheEntry(globalObject, path);
        RETURN_IF_EXCEPTION(scope, false);
    }
    removeFromMap(globalObject, m_requireMap.get(), stringOfKey(vm, key));
    RETURN_IF_EXCEPTION(scope, false);

    if (auto* loader = loaderOf(globalObject, m_owner.get())) {
        // A module whose load is in flight is not in require.cache and is not evicted.
        bool isLoading = false;
        for (auto& [mapKey, entry] : loader->moduleMap()) {
            if (mapKey.first == key && entry && !isModuleLoadSettled(entry.get())) {
                isLoading = true;
                break;
            }
        }
        if (!isLoading)
            loader->removeEntry(Identifier::fromUid(vm, key)); // takes the loader's cellLock itself
    }
    Bun::IsolatedModuleCache::evict(vm, path);
    return true;
}

bool JSRequireCache::deleteProperty(JSCell* cell, JSGlobalObject* lexicalGlobalObject, PropertyName propertyName, DeletePropertySlot& slot)
{
    auto* thisObject = uncheckedDowncast<JSRequireCache>(cell);
    VM& vm = getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* key = propertyName.uid();
    if (!key || key->isSymbol())
        RELEASE_AND_RETURN(scope, Base::deleteProperty(cell, lexicalGlobalObject, propertyName, slot));
    // JSObject::deleteProperty() hands an index to deletePropertyByIndex().
    if (std::optional<uint32_t> index = parseIndex(propertyName))
        RELEASE_AND_RETURN(scope, deletePropertyByIndex(cell, lexicalGlobalObject, *index));

    bool isShown = thisObject->takeOut(thisObject->zigGlobalObject(), key);
    RETURN_IF_EXCEPTION(scope, false);
    if (!isShown)
        return true;
    RELEASE_AND_RETURN(scope, Base::deleteProperty(cell, lexicalGlobalObject, propertyName, slot));
}

bool JSRequireCache::deletePropertyByIndex(JSCell* cell, JSGlobalObject* lexicalGlobalObject, unsigned index)
{
    auto* thisObject = uncheckedDowncast<JSRequireCache>(cell);
    VM& vm = getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    bool isShown = thisObject->takeOut(thisObject->zigGlobalObject(), Identifier::from(vm, index).impl());
    RETURN_IF_EXCEPTION(scope, false);
    if (!isShown)
        return true;
    RELEASE_AND_RETURN(scope, Base::deletePropertyByIndex(cell, lexicalGlobalObject, index));
}

void JSRequireCache::getOwnPropertyNames(JSObject* object, JSGlobalObject* lexicalGlobalObject, PropertyNameArrayBuilder& propertyNames, DontEnumPropertiesMode mode)
{
    auto* thisObject = uncheckedDowncast<JSRequireCache>(object);
    VM& vm = getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (propertyNames.includeStringProperties()) {
        auto* globalObject = thisObject->zigGlobalObject();
        bool hidesFiles = hidesCompiledFiles(globalObject);
        auto isHidden = [&](UniquedStringImpl* key) {
            return hidesFiles && Bun::isHiddenFromRequireCache(String(key));
        };

        auto* iterator = JSMapIterator::create(vm, globalObject->mapIteratorStructure(), thisObject->m_requireMap.get(), IterationKind::Keys);
        RETURN_IF_EXCEPTION(scope, );
        JSValue key;
        while (iterator->next(globalObject, key)) {
            if (!key.isString()) [[unlikely]]
                continue;
            auto name = asString(key)->toIdentifier(globalObject);
            RETURN_IF_EXCEPTION(scope, );
            if (!isHidden(name.impl()))
                propertyNames.add(name);
        }
        RETURN_IF_EXCEPTION(scope, );

        // A key that the require map has too is listed once: add() takes a name that it has already for none. A property of the object itself
        // stands in front of what the loader lists, and is listed below as what it is.
        Structure* structure = thisObject->structure();
        bool ownsProperties = structure->inlineSize() || structure->outOfLineSize() || hasIndexedProperties(structure->indexingType());
        bool seesCompiled = thisObject->seesCompiledModules(globalObject);
        auto addListed = [&](UniquedStringImpl* key) {
            if (isBuiltinKey(key) && !(seesCompiled && Bun::isLibraryModuleInRequireCache(globalObject, String(key))))
                return;
            if (isHidden(key)) [[unlikely]]
                return;
            if (ownsProperties) [[unlikely]] {
                PropertySlot own(thisObject, PropertySlot::InternalMethodType::GetOwnProperty);
                if (Base::getOwnPropertySlot(thisObject, lexicalGlobalObject, Identifier::fromUid(vm, key), own))
                    return;
            }
            propertyNames.add(key);
        };
        if (auto* loader = loaderOf(globalObject, thisObject->m_owner.get())) {
            Bun::forEachModuleRegistrySpecifier(loader, [&](UniquedStringImpl* specifier, ModuleRegistryEntry* entry) {
                if (isModuleEvaluated(entry->record()))
                    addListed(specifier);
            });
        }
        if (seesCompiled) {
            Bun::forEachEvaluatedCompiledFile(globalObject, [&](const String& path) {
                addListed(Identifier::fromString(vm, path).impl());
            });
        }
    }

    RELEASE_AND_RETURN(scope, Base::getOwnPropertyNames(object, lexicalGlobalObject, propertyNames, mode));
}

bool JSRequireCache::defineOwnProperty(JSObject* object, JSGlobalObject* lexicalGlobalObject, PropertyName propertyName, const PropertyDescriptor& descriptor, bool shouldThrow)
{
    auto* thisObject = uncheckedDowncast<JSRequireCache>(object);
    VM& vm = getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* key = propertyName.uid();
    if (!key || key->isSymbol())
        RELEASE_AND_RETURN(scope, Base::defineOwnProperty(object, lexicalGlobalObject, propertyName, descriptor, shouldThrow));

    auto* globalObject = thisObject->zigGlobalObject();
    JSMap* map = thisObject->m_requireMap.get();
    JSString* keyString = stringOfKey(vm, key);
    bool isStored;
    entryInMap(globalObject, map, keyString, isStored);
    RETURN_IF_EXCEPTION(scope, false);
    bool isOwn = false;
    {
        PropertySlot own(thisObject, PropertySlot::InternalMethodType::GetOwnProperty);
        isOwn = Base::getOwnPropertySlot(thisObject, lexicalGlobalObject, propertyName, own);
    }
    bool isEntry = isStored || (!isOwn && !isHiddenKey(globalObject, key) && thisObject->isListedByLoader(globalObject, key));

    // A definition that leaves the key a writable, enumerable and configurable data property is a store, as an assignment is. What a definition
    // leaves out stays as it is for an entry, and is false for a key that is new.
    bool refusesWrite = descriptor.writablePresent() ? !descriptor.writable() : !isEntry;
    bool hidesKey = descriptor.enumerablePresent() ? !descriptor.enumerable() : !isEntry;
    bool locksKey = descriptor.configurablePresent() ? !descriptor.configurable() : !isEntry;
    if (!descriptor.isAccessorDescriptor() && !refusesWrite && !hidesKey && !locksKey && (isEntry || !isOwn)) {
        if (!descriptor.value() && isEntry)
            return true;
        RELEASE_AND_RETURN(scope, thisObject->store(globalObject, key, descriptor.value() ? descriptor.value() : jsUndefined()));
    }
    if (!isEntry)
        RELEASE_AND_RETURN(scope, Base::defineOwnProperty(object, lexicalGlobalObject, propertyName, descriptor, shouldThrow));

    // The require map holds no other shape: the entry leaves it, and the object itself holds the property from here on. The next require() of the
    // file finds no entry and loads it again. What the definition leaves out is as the entry had it.
    PropertyDescriptor ownDescriptor = descriptor;
    if (!ownDescriptor.enumerablePresent())
        ownDescriptor.setEnumerable(true);
    if (!ownDescriptor.configurablePresent())
        ownDescriptor.setConfigurable(true);
    if (!ownDescriptor.isAccessorDescriptor()) {
        if (!ownDescriptor.writablePresent())
            ownDescriptor.setWritable(true);
        if (!ownDescriptor.value()) {
            JSValue current = object->get(lexicalGlobalObject, propertyName);
            RETURN_IF_EXCEPTION(scope, false);
            ownDescriptor.setValue(current);
        }
    }
    if (isStored && thisObject->seesCompiledModules(globalObject)) {
        Bun::didDeleteRequireCacheEntry(globalObject, String(key));
        RETURN_IF_EXCEPTION(scope, false);
    }
    // Reading the value above has stored the entry of a key that only the loader listed.
    removeFromMap(globalObject, map, keyString);
    RETURN_IF_EXCEPTION(scope, false);

    std::optional<uint32_t> index = parseIndex(propertyName);
    // What an earlier definition left on the object was out of sight behind the entry.
    if (isOwn) {
        VM::DeletePropertyModeScope ignoreConfigurable(vm, VM::DeletePropertyMode::IgnoreConfigurable);
        if (index)
            Base::deletePropertyByIndex(object, lexicalGlobalObject, *index);
        else {
            DeletePropertySlot deleteSlot;
            Base::deleteProperty(object, lexicalGlobalObject, propertyName, deleteSlot);
        }
        RETURN_IF_EXCEPTION(scope, false);
    }
    if (index)
        RELEASE_AND_RETURN(scope, thisObject->defineOwnIndexedProperty(lexicalGlobalObject, *index, ownDescriptor, shouldThrow));
    // JSObject::defineOwnProperty() would ask this object for the property first, and that read makes the entry of a listed key again.
    if (ownDescriptor.isAccessorDescriptor())
        thisObject->putDirectAccessor(lexicalGlobalObject, propertyName, ownDescriptor.slowGetterSetter(lexicalGlobalObject), (ownDescriptor.attributes() | PropertyAttribute::Accessor) & ~PropertyAttribute::ReadOnly);
    else
        thisObject->putDirect(vm, propertyName, ownDescriptor.value(), ownDescriptor.attributes() & ~PropertyAttribute::Accessor);
    return true;
}

} // namespace Bun
