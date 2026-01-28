#include "root.h"
#include <JavaScriptCore/JSCell.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include "ZigGlobalObject.h"
#include <JavaScriptCore/Structure.h>
#include <bun-uws/src/App.h>
#include "ZigGeneratedClasses.h"
#include "AsyncContextFrame.h"
#include "ServerRouteList.h"
#include "decodeURIComponentSIMD.h"
#include "JSBunRequest.h"
#include <JavaScriptCore/PropertyName.h>

namespace Bun {
using namespace JSC;
using namespace WebCore;

/**
  ServerRouteList holds all the callbacks used by routes in Bun.serve()

  The easier approach would be an std.array_list.Managed of JSC.Strong in Zig, but that
  would mean that now we're holding a Strong reference for every single
  callback. This would show up in profiling, and it's a lot of strong
  references. We could use a JSArray instead, but that would incur unnecessary
  overhead when reading values from the array.

  So instead, we have this class that uses a FixedVector of WriteBarriers to
  the JSCell of the callback.

  When the ServerRouteList is destroyed, it will clear the FixedVector and
  allow the callbacks to be GC'd.

  This also lets us hold structures for the params objects for each route, which
  we create lazily. This makes it fast to create the params object for a route.
  and is generally better for the JIT since it will see the same structure repeatedly.
 */
class ServerRouteList final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    struct IdentifierRange {
        uint16_t start;
        uint16_t count;
    };

    static ServerRouteList* create(
        JSC::VM& vm,
        JSC::Structure* structure,
        std::span<EncodedJSValue> callbacks,
        std::span<ZigString> paths)
    {
        auto* routeList = new (NotNull, JSC::allocateCell<ServerRouteList>(vm)) ServerRouteList(vm, structure, callbacks, paths);
        routeList->finishCreation(vm, callbacks, paths);
        return routeList;
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        return JSC::Structure::create(vm, globalObject, globalObject->nullPrototype(), JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static void destroy(JSCell* cell)
    {
        static_cast<ServerRouteList*>(cell)->~ServerRouteList();
    }

    ~ServerRouteList()
    {
        m_routes.clear();
        m_paramsObjectStructures.clear();
        m_pathIdentifiers.clear();
        m_pathIdentifierRanges.clear();
    }

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<ServerRouteList, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForServerRouteList.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForServerRouteList = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForServerRouteList.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForServerRouteList = std::forward<decltype(space)>(space); });
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    JSValue callRoute(Zig::GlobalObject* globalObject, uint32_t index, void* requestPtr, EncodedJSValue serverObject, EncodedJSValue* requestObject, uWS::HttpRequest* req);

private:
    Structure* structureForParamsObject(JSC::VM& vm, JSC::JSGlobalObject* globalObject, uint32_t index, std::span<const Identifier> identifiers);
    JSObject* paramsObjectForRoute(JSC::VM& vm, JSC::JSGlobalObject* globalObject, uint32_t index, uWS::HttpRequest* req);

    ServerRouteList(JSC::VM& vm, JSC::Structure* structure, std::span<EncodedJSValue> callbacks, std::span<ZigString> paths)
        : Base(vm, structure)
        , m_routes(callbacks.size())
        , m_paramsObjectStructures(paths.size())
        , m_pathIdentifierRanges(paths.size() * 2)
    {
        ASSERT(callbacks.size() == paths.size());
    }

    WTF::FixedVector<JSC::WriteBarrier<JSC::JSCell>> m_routes;
    WTF::FixedVector<JSC::WriteBarrier<Structure>> m_paramsObjectStructures;
    WTF::FixedVector<IdentifierRange> m_pathIdentifierRanges;
    WTF::Vector<Identifier> m_pathIdentifiers;

    void finishCreation(JSC::VM& vm, std::span<EncodedJSValue> callbacks, std::span<ZigString> paths)
    {
        Base::finishCreation(vm);
        ASSERT(callbacks.size() == paths.size());

        for (size_t i = 0; i < callbacks.size(); i++) {
            this->m_routes.at(i).setMayBeNull(vm, this, JSValue::decode(callbacks[i]).asCell());
            this->m_paramsObjectStructures.at(i).setMayBeNull(vm, this, nullptr);
        }

        std::span<IdentifierRange> pathIdentifierRanges = m_pathIdentifierRanges.mutableSpan();

        for (size_t i = 0; i < paths.size(); i++) {
            ZigString rawPath = paths[i];
            WTF::String path = Zig::toString(rawPath);
            uint32_t originalIdentifierIndex = m_pathIdentifiers.size();
            size_t startOfIdentifier = 0;
            size_t identifierCount = 0;
            for (size_t j = 0; j < path.length(); j++) {
                switch (path[j]) {
                case '/': {
                    if (startOfIdentifier && startOfIdentifier < j) {
                        WTF::String&& identifier = path.substring(startOfIdentifier, j - startOfIdentifier);
                        m_pathIdentifiers.append(JSC::Identifier::fromString(vm, identifier));
                        identifierCount++;
                    }
                    startOfIdentifier = 0;
                    break;
                }
                case ':': {
                    startOfIdentifier = j + 1;
                    break;
                }
                default: {
                    break;
                }
                }
            }
            if (startOfIdentifier && startOfIdentifier < path.length()) {
                WTF::String&& identifier = path.substring(startOfIdentifier, path.length() - startOfIdentifier);
                m_pathIdentifiers.append(JSC::Identifier::fromString(vm, identifier));
                identifierCount++;
            }

            pathIdentifierRanges[0] = { static_cast<uint16_t>(originalIdentifierIndex), static_cast<uint16_t>(identifierCount) };
            pathIdentifierRanges = pathIdentifierRanges.subspan(1);
        }
    }
};

const JSC::ClassInfo ServerRouteList::s_info = { "ServerRouteList"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(ServerRouteList) };

template<typename Visitor>
void ServerRouteList::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    ServerRouteList* thisCallSite = jsCast<ServerRouteList*>(cell);
    Base::visitChildren(thisCallSite, visitor);

    for (unsigned i = 0; i < thisCallSite->m_routes.size(); i++) {
        if (thisCallSite->m_routes[i]) visitor.append(thisCallSite->m_routes[i]);
        if (thisCallSite->m_paramsObjectStructures[i]) visitor.append(thisCallSite->m_paramsObjectStructures[i]);
    }
}
DEFINE_VISIT_CHILDREN(ServerRouteList);

Structure* ServerRouteList::structureForParamsObject(JSC::VM& vm, JSC::JSGlobalObject* globalObject, uint32_t index, std::span<const Identifier> identifiers)
{

    if (identifiers.empty()) {
        return globalObject->nullPrototypeObjectStructure();
    }

    if (!m_paramsObjectStructures.at(index)) {
        auto* zigGlobalObject = defaultGlobalObject(globalObject);
        auto* prototype = zigGlobalObject->m_JSBunRequestParamsPrototype.get(zigGlobalObject);
        unsigned inlineCapacity = std::min(identifiers.size(), static_cast<size_t>(JSC::JSFinalObject::maxInlineCapacity));
        auto* structure = Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), JSFinalObject::info(), NonArray, inlineCapacity);

        if (identifiers.size() < JSC::JSFinalObject::maxInlineCapacity) {
            PropertyOffset offset;
            for (const auto& identifier : identifiers) {
                structure = structure->addPropertyTransition(vm, structure, identifier, JSC::PropertyAttribute::DontDelete | 0, offset);
            }
        }
        m_paramsObjectStructures.at(index).set(vm, this, structure);
        return structure;
    }

    return m_paramsObjectStructures.at(index).get();
}

JSObject* ServerRouteList::paramsObjectForRoute(JSC::VM& vm, JSC::JSGlobalObject* globalObject, uint32_t index, uWS::HttpRequest* req)
{

    // Ensure that the object doesn't get GC'd before we've had a chance to initialize it.
    MarkedArgumentBuffer args;
    IdentifierRange range = m_pathIdentifierRanges.at(index);
    size_t offset = range.start;
    size_t identifierCount = range.count;
    args.ensureCapacity(identifierCount);

    for (size_t i = 0; i < identifierCount; i++) {
        auto param = req->getParameter(static_cast<unsigned short>(i));
        if (!param.empty()) {
            const std::span<const uint8_t> paramBytes(reinterpret_cast<const uint8_t*>(param.data()), param.size());
            args.append(jsString(vm, decodeURIComponentSIMD(paramBytes)));
        } else {
            args.append(jsEmptyString(vm));
        }
    }

    const std::span<const Identifier> identifiers = m_pathIdentifiers.subspan(offset, identifierCount);

    auto* structure = structureForParamsObject(vm, globalObject, index, identifiers);
    JSObject* object = constructEmptyObject(vm, structure);

    if (identifierCount < JSC::JSFinalObject::maxInlineCapacity) {
        for (size_t i = 0; i < identifierCount; i++) {
            object->putDirectOffset(vm, i, args.at(i));
        }
    } else {
        for (size_t i = 0; i < identifierCount; i++) {
            object->putDirect(vm, identifiers[i], args.at(i));
        }
    }

    return object;
}

JSValue ServerRouteList::callRoute(Zig::GlobalObject* globalObject, uint32_t index, void* requestPtr, EncodedJSValue serverObject, EncodedJSValue* requestObject, uWS::HttpRequest* req)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* structure = globalObject->m_JSBunRequestStructure.get(globalObject);

    auto* params = paramsObjectForRoute(vm, globalObject, index, req);

    JSBunRequest* request = JSBunRequest::create(vm, structure, requestPtr, params);
    scope.assertNoException();
    *requestObject = JSValue::encode(request);

    JSValue callback = m_routes.at(index).get();
    ASSERT(callback);
    JSValue serverValue = JSValue::decode(serverObject);
    MarkedArgumentBuffer args;
    args.append(request);
    args.append(serverValue);

    auto result = AsyncContextFrame::call(globalObject, callback, serverValue, args);
    RETURN_IF_EXCEPTION(scope, {});
    return result;
}

extern "C" JSC::EncodedJSValue Bun__ServerRouteList__callRoute(
    Zig::GlobalObject* globalObject,
    uint32_t index,
    void* requestPtr,
    JSC::EncodedJSValue serverObject,
    JSC::EncodedJSValue routeListObject,
    JSC::EncodedJSValue* requestObject,
    uWS::HttpRequest* req)
{
    JSValue routeListValue = JSValue::decode(routeListObject);
    ServerRouteList* routeList = jsCast<ServerRouteList*>(routeListValue);
    return JSValue::encode(routeList->callRoute(globalObject, index, requestPtr, serverObject, requestObject, req));
}

extern "C" JSC::EncodedJSValue Bun__ServerRouteList__create(Zig::GlobalObject* globalObject, EncodedJSValue* callbacks, ZigString* paths, size_t pathsLength)
{
    auto* structure = globalObject->m_ServerRouteListStructure.get(globalObject);
    auto* routeList = ServerRouteList::create(globalObject->vm(), structure, std::span<EncodedJSValue>(callbacks, pathsLength), std::span<ZigString>(paths, pathsLength));
    return JSValue::encode(routeList);
}

Structure* createServerRouteListStructure(JSC::VM& vm, Zig::GlobalObject* globalObject)
{
    return ServerRouteList::createStructure(vm, globalObject);
}

JSObject* createJSBunRequestParamsPrototype(JSC::VM& vm, Zig::GlobalObject* globalObject)
{
    auto* prototype = constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    prototype->putDirect(vm, vm.propertyNames->toStringTagSymbol, jsString(vm, String("RequestParams"_s)), JSC::PropertyAttribute::DontEnum | 0);
    auto* structure = Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, JSC::JSFinalObject::StructureFlags), JSFinalObject::info(), NonArray);
    structure->setMayBePrototype(true);
    return JSC::constructEmptyObject(vm, structure);
}

} // namespace Bun
