#include "root.h"
#include "JSRequireCache.h"

#include "BunCompiledModules.h"
#include "BunModuleRegistry.h"
#include "IsolatedModuleCache.h"
#include "JSCommonJSModule.h"
#include "ModuleGraph.h"
#include "ZigGlobalObject.h"
#include "headers.h"
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
    // A thread runs a compiled program from its start, or never.
    cache->m_isOverCompiledProgram = Bun::hasCompiledModules();
    cache->m_hidesCompiledFiles = cache->m_isOverCompiledProgram && !Bun::requireCacheListsCompiledFiles(globalObject);
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
    return m_isOverCompiledProgram && loaderOf(globalObject, m_owner.get()) == globalObject->moduleLoader();
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
bool JSRequireCache::isHiddenKey(UniquedStringImpl* key) const
{
    return m_hidesCompiledFiles && Bun::isHiddenFromRequireCache(String(key));
}

// The require map is asked with a JSString, and a property name is not one. An atom keeps one JSString for as long as something holds it, so that
// reading a key again allocates nothing.
static JSString* stringOfKey(VM& vm, UniquedStringImpl* key)
{
    if (JSString* string = vm.atomStringToJSStringMap.get(key)) [[likely]]
        return string;
    DeferGC deferGC(vm);
    return vm.atomStringToJSStringMap.ensureValue(key, [&] {
        return jsString(vm, String(key));
    });
}

// JSMap::get() answers undefined for a key that the map does not have, and `isStored` tells that apart from a key that holds undefined.
// JSMap compiles its hash table into every caller, which takes several KB: the map is read here alone, and written through JSC__JSMap__set().
static NEVER_INLINE JSValue entryInMap(JSGlobalObject* globalObject, JSMap* map, JSString* key, bool& isStored)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    isStored = false;
    JSValue stored = JSValue::decode(JSC__JSMap__get(map, globalObject, JSValue::encode(key)));
    RETURN_IF_EXCEPTION(scope, {});
    isStored = !stored.isUndefined();
    if (!isStored) {
        isStored = map->has(globalObject, key);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return stored;
}

// A property that the object itself holds: a symbol, or what Object.defineProperty() gave a shape that no entry has.
static NEVER_INLINE bool ownPropertySlot(JSObject* object, JSGlobalObject* globalObject, PropertyName propertyName, PropertySlot& slot)
{
    return JSObject::getOwnPropertySlot(object, globalObject, propertyName, slot);
}

// False: the object holds no property. It has no inline storage, so that the first property brings the butterfly.
static ALWAYS_INLINE bool mayOwnProperties(JSRequireCache* cache)
{
    return !!cache->butterfly();
}

static bool ownsProperty(JSRequireCache* cache, JSGlobalObject* globalObject, PropertyName propertyName)
{
    PropertySlot slot(cache, PropertySlot::InternalMethodType::GetOwnProperty);
    return mayOwnProperties(cache) && ownPropertySlot(cache, globalObject, propertyName, slot);
}

// The object holds a property that is not configurable under the name: a deletion is refused, and the loader keeps its entry.
static bool holdsForGood(JSRequireCache* cache, JSGlobalObject* globalObject, PropertyName propertyName)
{
    PropertySlot slot(cache, PropertySlot::InternalMethodType::GetOwnProperty);
    return mayOwnProperties(cache) && ownPropertySlot(cache, globalObject, propertyName, slot) && (slot.attributes() & PropertyAttribute::DontDelete);
}

static AbstractModuleRecord* evaluatedModuleRecord(Zig::GlobalObject* globalObject, JSCommonJSModule* owner, UniquedStringImpl* key)
{
    auto* loader = loaderOf(globalObject, owner);
    if (!loader)
        return nullptr;
    auto* entry = loader->registryEntry(Identifier::fromUid(globalObject->vm(), key));
    return entry && isModuleEvaluated(entry->record()) ? entry->record() : nullptr;
}

JSRequireCache::Listed JSRequireCache::listedByLoader(Zig::GlobalObject* globalObject, UniquedStringImpl* key) const
{
    bool seesCompiled = seesCompiledModules(globalObject);
    if (seesCompiled && Bun::isLibraryModuleInRequireCache(globalObject, String(key)))
        return Listed::WithEntry;
    if (isBuiltinKey(key))
        return Listed::No;
    if (evaluatedModuleRecord(globalObject, m_owner.get(), key))
        return Listed::WithoutEntry;
    if (!seesCompiled || !Bun::isEvaluatedCompiledFile(globalObject, String(key)))
        return Listed::No;
    return Bun::isCompiledESModule(String(key)) ? Listed::WithoutEntry : Listed::WithEntry;
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
    JSC__JSMap__set(map, globalObject, JSValue::encode(keyString), JSValue::encode(module));
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
        return ownPropertySlot(object, lexicalGlobalObject, propertyName, slot);

    slot.disableCaching();
    if (slot.isVMInquiry()) {
        slot.setIsTaintedByOpaqueObject();
        return false;
    }
    if (thisObject->isHiddenKey(key))
        return false;

    auto* globalObject = thisObject->zigGlobalObject();
    bool isStored;
    JSValue stored = entryInMap(globalObject, thisObject->m_requireMap.get(), stringOfKey(vm, key), isStored);
    RETURN_IF_EXCEPTION(scope, false);

    // A property that a definition left on the object gives the key its shape. The value of a data property is the entry while the require map
    // has one: the loader reads and replaces the entry there.
    if (mayOwnProperties(thisObject) && ownPropertySlot(object, lexicalGlobalObject, propertyName, slot)) [[unlikely]] {
        slot.disableCaching();
        if (isStored && slot.isValue())
            slot.setValue(thisObject, slot.attributes(), stored);
        return true;
    }

    if (isStored) {
        // A compiled file that ran again left the falsy value that asked for it in the require map: the engine holds its entry.
        if (thisObject->m_isOverCompiledProgram && !stored.toBoolean(globalObject) && thisObject->seesCompiledModules(globalObject)) [[unlikely]]
            slot.setCustom(thisObject, 0, jsRequireCacheEntryMadeOnRead);
        else
            slot.setValue(thisObject, 0, stored);
        return true;
    }

    switch (thisObject->listedByLoader(globalObject, key)) {
    case Listed::No:
        return false;
    case Listed::WithoutEntry:
        // Only a read of the key makes the entry. A property descriptor holds no value until then, and says so to whoever copies properties:
        // Object.assign() and Object.entries() read the key.
        if (slot.internalMethodType() == PropertySlot::InternalMethodType::GetOwnProperty) {
            slot.setValue(thisObject, static_cast<unsigned>(PropertyAttribute::ReadOnly), jsUndefined());
            slot.setIsTaintedByOpaqueObject();
            return true;
        }
        break;
    case Listed::WithEntry:
        break;
    }
    // `in`, Object.hasOwn() and a listing ask for no value.
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
    JSC__JSMap__set(m_requireMap.get(), globalObject, JSValue::encode(stringOfKey(vm, key)), JSValue::encode(value));
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
    if (mayOwnProperties(thisObject)) [[unlikely]] {
        PropertySlot own(thisObject, PropertySlot::InternalMethodType::GetOwnProperty);
        if (ownPropertySlot(thisObject, lexicalGlobalObject, propertyName, own)) {
            // A setter or a read-only property that a definition left on the object answers. A value that the property takes is the loader's entry too.
            if (own.isValue() && !(own.attributes() & PropertyAttribute::ReadOnly)) {
                thisObject->store(globalObject, key, value);
                RETURN_IF_EXCEPTION(scope, false);
            }
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

    if (isHiddenKey(key))
        return false;

    String path(key);
    if (seesCompiledModules(globalObject)) {
        Bun::didDeleteRequireCacheEntry(globalObject, path);
        RETURN_IF_EXCEPTION(scope, false);
    }
    JSC__JSMap__remove(m_requireMap.get(), globalObject, JSValue::encode(stringOfKey(vm, key)));
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

    if (holdsForGood(thisObject, lexicalGlobalObject, propertyName)) [[unlikely]]
        return false;
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

    auto name = Identifier::from(vm, index);
    if (holdsForGood(thisObject, lexicalGlobalObject, name)) [[unlikely]]
        return false;
    bool isShown = thisObject->takeOut(thisObject->zigGlobalObject(), name.impl());
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
        // A property of the object itself stands in front of the key: the key is listed in its place here if that property is listed at all, and
        // add() below takes a name that it has already for none.
        Structure* structure = thisObject->structure();
        bool ownsProperties = structure->outOfLineSize() || hasIndexedProperties(structure->indexingType());
        auto isListed = [&](PropertyName name) {
            if (thisObject->isHiddenKey(name.uid())) [[unlikely]]
                return false;
            PropertySlot own(thisObject, PropertySlot::InternalMethodType::GetOwnProperty);
            if (!ownsProperties || !ownPropertySlot(thisObject, lexicalGlobalObject, name, own)) [[likely]]
                return true;
            return mode == DontEnumPropertiesMode::Include || !(own.attributes() & PropertyAttribute::DontEnum);
        };

        auto* iterator = JSMapIterator::create(vm, globalObject->mapIteratorStructure(), thisObject->m_requireMap.get(), IterationKind::Keys);
        RETURN_IF_EXCEPTION(scope, );
        JSValue key;
        while (iterator->next(globalObject, key)) {
            if (!key.isString()) [[unlikely]]
                continue;
            auto name = asString(key)->toIdentifier(globalObject);
            RETURN_IF_EXCEPTION(scope, );
            if (isListed(name))
                propertyNames.add(name);
        }
        RETURN_IF_EXCEPTION(scope, );

        bool seesCompiled = thisObject->seesCompiledModules(globalObject);
        auto addListedByLoader = [&](UniquedStringImpl* key) {
            if (isBuiltinKey(key) && !(seesCompiled && Bun::isLibraryModuleInRequireCache(globalObject, String(key))))
                return;
            if (isListed(Identifier::fromUid(vm, key)))
                propertyNames.add(key);
        };
        if (auto* loader = loaderOf(globalObject, thisObject->m_owner.get())) {
            Bun::forEachModuleRegistrySpecifier(loader, [&](UniquedStringImpl* specifier, ModuleRegistryEntry* entry) {
                if (isModuleEvaluated(entry->record()))
                    addListedByLoader(specifier);
            });
        }
        if (seesCompiled) {
            Bun::forEachEvaluatedCompiledFile(globalObject, [&](const String& path) {
                addListedByLoader(Identifier::fromString(vm, path).impl());
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
    // The cache shows nothing under the path of a file of the executable. A definition there leaves no property: the loader takes a value that
    // it names, as it takes a store.
    if (thisObject->isHiddenKey(key)) [[unlikely]] {
        if (!descriptor.value())
            return true;
        RELEASE_AND_RETURN(scope, thisObject->store(globalObject, key, descriptor.value()));
    }

    // The definition is of the property that the object itself holds under the key, if it holds one, and else of the entry.
    bool isOwn = ownsProperty(thisObject, lexicalGlobalObject, propertyName);
    bool isEntry = false;
    if (!isOwn) {
        entryInMap(globalObject, thisObject->m_requireMap.get(), stringOfKey(vm, key), isEntry);
        RETURN_IF_EXCEPTION(scope, false);
        isEntry = isEntry || thisObject->listedByLoader(globalObject, key) != Listed::No;
    }

    // A definition that leaves the key a writable, enumerable and configurable data property is a store, as an assignment is. What a definition
    // leaves out stays as it is for an entry, and is false for a key that is new.
    bool refusesWrite = descriptor.writablePresent() ? !descriptor.writable() : !isEntry;
    bool hidesKey = descriptor.enumerablePresent() ? !descriptor.enumerable() : !isEntry;
    bool locksKey = descriptor.configurablePresent() ? !descriptor.configurable() : !isEntry;
    if (!isOwn && !descriptor.isAccessorDescriptor() && !refusesWrite && !hidesKey && !locksKey) {
        if (!descriptor.value() && isEntry)
            return true;
        RELEASE_AND_RETURN(scope, thisObject->store(globalObject, key, descriptor.value() ? descriptor.value() : jsUndefined()));
    }

    // The require map holds no other shape. The object itself holds the property from here on, in front of the entry, which the loader keeps:
    // the next require() of the file answers with it, and loads nothing again.
    if (!isEntry) {
        bool isDefined = Base::defineOwnProperty(object, lexicalGlobalObject, propertyName, descriptor, shouldThrow);
        RETURN_IF_EXCEPTION(scope, false);
        if (!isDefined || !descriptor.value())
            return isDefined;
        // A value that a definition names is the loader's entry too.
        RELEASE_AND_RETURN(scope, thisObject->store(globalObject, key, descriptor.value()));
    }

    // What the definition leaves out is as the entry has it.
    PropertyDescriptor ownDescriptor = descriptor;
    if (!ownDescriptor.enumerablePresent())
        ownDescriptor.setEnumerable(true);
    if (!ownDescriptor.configurablePresent())
        ownDescriptor.setConfigurable(true);
    if (!ownDescriptor.isAccessorDescriptor()) {
        if (!ownDescriptor.writablePresent())
            ownDescriptor.setWritable(true);
        if (!ownDescriptor.value()) {
            // The read makes the entry of a key that only the loader lists.
            JSValue current = object->get(lexicalGlobalObject, propertyName);
            RETURN_IF_EXCEPTION(scope, false);
            ownDescriptor.setValue(current);
        }
    }
    if (descriptor.value()) {
        thisObject->store(globalObject, key, descriptor.value());
        RETURN_IF_EXCEPTION(scope, false);
    }

    if (std::optional<uint32_t> index = parseIndex(propertyName))
        RELEASE_AND_RETURN(scope, thisObject->defineOwnIndexedProperty(lexicalGlobalObject, *index, ownDescriptor, shouldThrow));
    // JSObject::defineOwnProperty() would read what the key has now from this object, which answers with a value only for an entry that is made.
    if (ownDescriptor.isAccessorDescriptor())
        thisObject->putDirectAccessor(lexicalGlobalObject, propertyName, ownDescriptor.slowGetterSetter(lexicalGlobalObject), (ownDescriptor.attributes() | PropertyAttribute::Accessor) & ~PropertyAttribute::ReadOnly);
    else
        thisObject->putDirect(vm, propertyName, ownDescriptor.value(), ownDescriptor.attributes() & ~PropertyAttribute::Accessor);
    return true;
}

} // namespace Bun
