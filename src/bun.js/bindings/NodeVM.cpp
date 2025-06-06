#include "root.h"

#include "JavaScriptCore/PropertySlot.h"
#include "JavaScriptCore/ExecutableInfo.h"
#include "JavaScriptCore/WriteBarrierInlines.h"
#include "ErrorCode.h"
#include <JavaScriptCore/SourceOrigin.h>
#include <JavaScriptCore/SourceProvider.h>

#include "BunClientData.h"
#include "NodeVM.h"
#include "NodeVMScript.h"
#include "NodeVMModule.h"
#include "NodeVMSourceTextModule.h"
#include "NodeVMSyntheticModule.h"

#include "JavaScriptCore/JSObjectInlines.h"
#include "wtf/text/ExternalStringImpl.h"

#include "JavaScriptCore/FunctionPrototype.h"
#include "JavaScriptCore/FunctionConstructor.h"
#include "JavaScriptCore/HeapAnalyzer.h"

#include "JavaScriptCore/JSDestructibleObjectHeapCellType.h"
#include "JavaScriptCore/SlotVisitorMacros.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/SubspaceInlines.h"
#include "wtf/GetPtr.h"
#include "wtf/PointerPreparations.h"
#include "wtf/URL.h"
#include "JavaScriptCore/TypedArrayInlines.h"
#include "JavaScriptCore/PropertyNameArray.h"
#include "JavaScriptCore/JSWeakMap.h"
#include "JavaScriptCore/JSWeakMapInlines.h"
#include "JavaScriptCore/JSWithScope.h"
#include "JavaScriptCore/JSGlobalProxyInlines.h"
#include "GCDefferalContext.h"
#include "JSBuffer.h"

#include <JavaScriptCore/DOMJITAbstractHeap.h>
#include <JavaScriptCore/DFGAbstractHeap.h>
#include <JavaScriptCore/Completion.h>
#include "JavaScriptCore/LazyClassStructureInlines.h"
#include "JavaScriptCore/Parser.h"
#include "JavaScriptCore/SourceCodeKey.h"
#include "JavaScriptCore/UnlinkedFunctionExecutable.h"
#include "NodeValidator.h"

#include "AsyncContextFrame.h"
#include "JavaScriptCore/JSCInlines.h"
#include "JavaScriptCore/JSInternalPromise.h"
#include "JavaScriptCore/JSNativeStdFunction.h"
#include "JavaScriptCore/BytecodeCacheError.h"
#include "JavaScriptCore/CodeCache.h"
#include "JavaScriptCore/FunctionCodeBlock.h"
#include "JavaScriptCore/JIT.h"
#include "JavaScriptCore/ProgramCodeBlock.h"
#include "NodeVMScriptFetcher.h"
#include "wtf/FileHandle.h"

#include "../vm/SigintWatcher.h"

namespace Bun {
using namespace WebCore;

namespace NodeVM {

bool extractCachedData(JSValue cachedDataValue, WTF::Vector<uint8_t>& outCachedData)
{
    if (!cachedDataValue.isCell()) {
        return false;
    }

    if (auto* arrayBufferView = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(cachedDataValue)) {
        if (!arrayBufferView->isDetached()) {
            outCachedData = arrayBufferView->span();
            return true;
        }
    } else if (auto* arrayBuffer = JSC::jsDynamicCast<JSC::JSArrayBuffer*>(cachedDataValue); arrayBuffer && arrayBuffer->impl()) {
        outCachedData = arrayBuffer->impl()->toVector();
        return true;
    }

    return false;
}

JSC::JSFunction* constructAnonymousFunction(JSC::JSGlobalObject* globalObject, const ArgList& args, const SourceOrigin& sourceOrigin, CompileFunctionOptions&& options, JSC::SourceTaintedOrigin sourceTaintOrigin, JSC::JSScope* scope)
{
    ASSERT(scope);

    VM& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    TextPosition position(options.lineOffset, options.columnOffset);
    LexicallyScopedFeatures lexicallyScopedFeatures = globalObject->globalScopeExtension() ? TaintedByWithScopeLexicallyScopedFeature : NoLexicallyScopedFeatures;

    // First try parsing the code as is without wrapping it in an anonymous function expression.
    // This is to reject cases where the user passes in a string like "});(function() {".
    if (!args.isEmpty() && args.at(0).isString()) {
        ParserError error;
        String code = args.at(0).toWTFString(globalObject);

        SourceCode sourceCode(
            JSC::StringSourceProvider::create(code, sourceOrigin, options.filename, sourceTaintOrigin, position, SourceProviderSourceType::Program),
            position.m_line.oneBasedInt(), position.m_column.oneBasedInt());

        if (!checkSyntax(vm, sourceCode, error)) {
            ASSERT(error.isValid());

            bool actuallyValid = true;

            if (error.type() == ParserError::ErrorType::SyntaxError && error.syntaxErrorType() == ParserError::SyntaxErrorIrrecoverable) {
                String message = error.message();
                if (message == "Return statements are only valid inside functions.") {
                    actuallyValid = false;
                } else {
                    const JSToken& token = error.token();
                    int start = token.m_startPosition.offset;
                    int end = token.m_endPosition.offset;
                    if (start >= 0 && start < end) {
                        StringView tokenView = sourceCode.view().substring(start, end - start);
                        error = ParserError(ParserError::SyntaxError, ParserError::SyntaxErrorIrrecoverable, token, makeString("Unexpected token '"_s, tokenView, '\''), error.line());
                    }
                }
            }

            if (actuallyValid) {
                auto exception = error.toErrorObject(globalObject, sourceCode, -1);
                throwException(globalObject, throwScope, exception);
                return nullptr;
            }
        }
    }

    // wrap the arguments in an anonymous function expression
    int startOffset = 0;
    String code = stringifyAnonymousFunction(globalObject, args, throwScope, &startOffset);
    EXCEPTION_ASSERT(!!throwScope.exception() == code.isNull());

    SourceCode sourceCode(
        JSC::StringSourceProvider::create(code, sourceOrigin, WTFMove(options.filename), sourceTaintOrigin, position, SourceProviderSourceType::Program),
        position.m_line.oneBasedInt(), position.m_column.oneBasedInt());

    CodeCache* cache = vm.codeCache();
    ProgramExecutable* programExecutable = ProgramExecutable::create(globalObject, sourceCode);

    UnlinkedProgramCodeBlock* unlinkedProgramCodeBlock = nullptr;
    RefPtr<CachedBytecode> cachedBytecode;

    TriState bytecodeAccepted = TriState::Indeterminate;

    if (!options.cachedData.isEmpty()) {
        cachedBytecode = CachedBytecode::create(std::span(options.cachedData), nullptr, {});
        SourceCodeKey key(sourceCode, {}, JSC::SourceCodeType::ProgramType, lexicallyScopedFeatures, JSC::JSParserScriptMode::Classic, JSC::DerivedContextType::None, JSC::EvalContextType::None, false, {}, std::nullopt);
        unlinkedProgramCodeBlock = JSC::decodeCodeBlock<UnlinkedProgramCodeBlock>(vm, key, *cachedBytecode);
        if (unlinkedProgramCodeBlock == nullptr) {
            bytecodeAccepted = TriState::False;
        } else {
            bytecodeAccepted = TriState::True;
        }
    }

    ParserError error;

    if (unlinkedProgramCodeBlock == nullptr) {
        unlinkedProgramCodeBlock = cache->getUnlinkedProgramCodeBlock(vm, programExecutable, sourceCode, {}, error);
    }

    if (!unlinkedProgramCodeBlock || error.isValid()) {
        return nullptr;
    }

    ProgramCodeBlock* programCodeBlock = nullptr;
    {
        DeferGC deferGC(vm);
        programCodeBlock = ProgramCodeBlock::create(vm, programExecutable, unlinkedProgramCodeBlock, scope);
    }

    if (!programCodeBlock || programCodeBlock->numberOfFunctionExprs() == 0) {
        return nullptr;
    }

    FunctionExecutable* functionExecutable = programCodeBlock->functionExpr(0);
    if (!functionExecutable) {
        return nullptr;
    }

    Structure* structure = JSFunction::selectStructureForNewFuncExp(globalObject, functionExecutable);
    JSFunction* function = JSFunction::create(vm, globalObject, functionExecutable, scope, structure);

    if (bytecodeAccepted == TriState::Indeterminate) {
        if (options.produceCachedData) {
            RefPtr<JSC::CachedBytecode> producedBytecode = getBytecode(globalObject, programExecutable, sourceCode);
            if (producedBytecode) {
                JSC::JSUint8Array* buffer = WebCore::createBuffer(globalObject, producedBytecode->span());
                function->putDirect(vm, JSC::Identifier::fromString(vm, "cachedData"_s), buffer);
                function->putDirect(vm, JSC::Identifier::fromString(vm, "cachedDataProduced"_s), jsBoolean(true));
            } else {
                function->putDirect(vm, JSC::Identifier::fromString(vm, "cachedDataProduced"_s), jsBoolean(false));
            }
        }
    } else {
        function->putDirect(vm, JSC::Identifier::fromString(vm, "cachedDataRejected"_s), jsBoolean(bytecodeAccepted == TriState::False));
    }

    return function;
}

JSInternalPromise* importModule(JSGlobalObject* globalObject, JSString* moduleNameValue, JSValue parameters, const SourceOrigin& sourceOrigin)
{
    if (auto* fetcher = sourceOrigin.fetcher(); !fetcher || fetcher->fetcherType() != ScriptFetcher::Type::NodeVM) {
        return nullptr;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* fetcher = static_cast<NodeVMScriptFetcher*>(sourceOrigin.fetcher());

    JSValue dynamicImportCallback = fetcher->dynamicImportCallback();

    if (!dynamicImportCallback || !dynamicImportCallback.isCallable()) {
        return nullptr;
    }

    JSFunction* owner = fetcher->owner();

    MarkedArgumentBuffer args;
    args.append(moduleNameValue);
    args.append(owner ? owner : jsUndefined());
    args.append(parameters);

    JSValue result = AsyncContextFrame::call(globalObject, dynamicImportCallback, jsUndefined(), args);

    RETURN_IF_EXCEPTION(scope, nullptr);

    if (auto* promise = jsDynamicCast<JSInternalPromise*>(result)) {
        return promise;
    }

    auto* promise = JSInternalPromise::create(vm, globalObject->internalPromiseStructure());

    RETURN_IF_EXCEPTION(scope, nullptr);

    auto* transformer = JSNativeStdFunction::create(vm, globalObject, 1, {}, [](JSGlobalObject* globalObject, CallFrame* callFrame) -> JSC::EncodedJSValue {
        VM& vm = globalObject->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);

        JSValue argument = callFrame->argument(0);

        if (JSObject* object = argument.getObject()) {
            JSValue result = object->get(globalObject, JSC::Identifier::fromString(vm, "namespace"_s));
            RETURN_IF_EXCEPTION(scope, {});
            if (!result.isUndefinedOrNull()) {
                return JSValue::encode(result);
            }
        }

        return JSValue::encode(argument);
    });

    RETURN_IF_EXCEPTION(scope, nullptr);

    promise->fulfill(globalObject, result);
    RETURN_IF_EXCEPTION(scope, nullptr);

    promise = promise->then(globalObject, transformer, nullptr);
    RETURN_IF_EXCEPTION(scope, nullptr);

    return promise;
}

// Helper function to create an anonymous function expression with parameters
String stringifyAnonymousFunction(JSGlobalObject* globalObject, const ArgList& args, ThrowScope& scope, int* outOffset)
{
    // How we stringify functions is important for creating anonymous function expressions
    String program;
    if (args.isEmpty()) {
        // No arguments, just an empty function body
        program = "(function () {\n\n})"_s;
    } else if (args.size() == 1) {
        // Just the function body
        auto body = args.at(0).toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        program = tryMakeString("(function () {\n"_s, body, "\n})"_s);
        *outOffset = "(function () {\n"_s.length();

        if (!program) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }
    } else {
        // Process parameters and body
        unsigned parameterCount = args.size() - 1;
        StringBuilder paramString;

        for (unsigned i = 0; i < parameterCount; ++i) {
            auto param = args.at(i).toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});

            if (i > 0) {
                paramString.append(", "_s);
            }

            paramString.append(param);
        }

        auto body = args.at(parameterCount).toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        program = tryMakeString("(function ("_s, paramString.toString(), ") {\n"_s, body, "\n})"_s);
        *outOffset = "(function ("_s.length() + paramString.length() + ") {\n"_s.length();

        if (!program) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }
    }

    return program;
}

RefPtr<JSC::CachedBytecode> getBytecode(JSGlobalObject* globalObject, JSC::ProgramExecutable* executable, const JSC::SourceCode& source)
{
    VM& vm = JSC::getVM(globalObject);
    JSC::CodeCache* cache = vm.codeCache();
    JSC::ParserError parserError;
    JSC::UnlinkedProgramCodeBlock* unlinked = cache->getUnlinkedProgramCodeBlock(vm, executable, source, {}, parserError);
    if (!unlinked || parserError.isValid()) {
        return nullptr;
    }
    JSC::LexicallyScopedFeatures lexicallyScopedFeatures = globalObject->globalScopeExtension() ? TaintedByWithScopeLexicallyScopedFeature : NoLexicallyScopedFeatures;
    JSC::BytecodeCacheError bytecodeCacheError;
    FileSystem::FileHandle fileHandle;
    return JSC::serializeBytecode(vm, unlinked, source, JSC::SourceCodeType::ProgramType, lexicallyScopedFeatures, JSParserScriptMode::Classic, fileHandle, bytecodeCacheError, {});
}

RefPtr<JSC::CachedBytecode> getBytecode(JSGlobalObject* globalObject, JSC::ModuleProgramExecutable* executable, const JSC::SourceCode& source)
{
    VM& vm = JSC::getVM(globalObject);
    JSC::CodeCache* cache = vm.codeCache();
    JSC::ParserError parserError;
    JSC::UnlinkedModuleProgramCodeBlock* unlinked = cache->getUnlinkedModuleProgramCodeBlock(vm, executable, source, {}, parserError);
    if (!unlinked || parserError.isValid()) {
        return nullptr;
    }
    JSC::LexicallyScopedFeatures lexicallyScopedFeatures = globalObject->globalScopeExtension() ? TaintedByWithScopeLexicallyScopedFeature : NoLexicallyScopedFeatures;
    JSC::BytecodeCacheError bytecodeCacheError;
    FileSystem::FileHandle fileHandle;
    return JSC::serializeBytecode(vm, unlinked, source, JSC::SourceCodeType::ProgramType, lexicallyScopedFeatures, JSParserScriptMode::Classic, fileHandle, bytecodeCacheError, {});
}

JSC::EncodedJSValue createCachedData(JSGlobalObject* globalObject, const JSC::SourceCode& source)
{
    VM& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::ProgramExecutable* executable = JSC::ProgramExecutable::create(globalObject, source);
    RETURN_IF_EXCEPTION(scope, {});

    RefPtr<JSC::CachedBytecode> bytecode = getBytecode(globalObject, executable, source);
    RETURN_IF_EXCEPTION(scope, {});

    if (!bytecode) [[unlikely]] {
        return throwVMError(globalObject, scope, "createCachedData failed"_s);
    }

    std::span<const uint8_t> bytes = bytecode->span();
    JSC::JSUint8Array* buffer = WebCore::createBuffer(globalObject, bytes);

    RETURN_IF_EXCEPTION(scope, {});
    ASSERT(buffer);

    return JSValue::encode(buffer);
}

bool handleException(JSGlobalObject* globalObject, VM& vm, NakedPtr<JSC::Exception> exception, ThrowScope& throwScope)
{
    if (auto* errorInstance = jsDynamicCast<ErrorInstance*>(exception->value())) {
        errorInstance->materializeErrorInfoIfNeeded(vm, vm.propertyNames->stack);
        RETURN_IF_EXCEPTION(throwScope, {});
        JSValue stack_jsval = errorInstance->get(globalObject, vm.propertyNames->stack);
        RETURN_IF_EXCEPTION(throwScope, {});
        if (!stack_jsval.isString()) {
            return false;
        }
        String stack = stack_jsval.toWTFString(globalObject);

        auto& e_stack = exception->stack();
        size_t stack_size = e_stack.size();
        if (stack_size == 0) {
            return false;
        }
        auto& stack_frame = e_stack[0];
        auto source_url = stack_frame.sourceURL(vm);
        if (source_url.isEmpty()) {
            // copy what Node does: https://github.com/nodejs/node/blob/afe3909483a2d5ae6b847055f544da40571fb28d/lib/vm.js#L94
            source_url = "evalmachine.<anonymous>"_s;
        }
        auto line_and_column = stack_frame.computeLineAndColumn();

        String prepend = makeString(source_url, ":"_s, line_and_column.line, "\n"_s, stack);
        errorInstance->putDirect(vm, vm.propertyNames->stack, jsString(vm, prepend), JSC::PropertyAttribute::DontEnum | 0);

        JSC::throwException(globalObject, throwScope, exception.get());
        return true;
    }
    return false;
}

// Returns an encoded exception if the options are invalid.
// Otherwise, returns an empty optional.
std::optional<JSC::EncodedJSValue> getNodeVMContextOptions(JSGlobalObject* globalObject, JSC::VM& vm, JSC::ThrowScope& scope, JSValue optionsArg, NodeVMContextOptions& outOptions, ASCIILiteral codeGenerationKey)
{
    outOptions = {};

    // If options is provided, validate name and origin properties
    if (!optionsArg.isObject()) {
        return std::nullopt;
    }

    JSObject* options = asObject(optionsArg);

    // Check name property
    if (JSValue nameValue = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "name"_s))) {
        RETURN_IF_EXCEPTION(scope, {});
        if (!nameValue.isUndefined() && !nameValue.isString()) {
            return ERR::INVALID_ARG_TYPE(scope, globalObject, "options.name"_s, "string"_s, nameValue);
        }
    }

    // Check origin property
    if (JSValue originValue = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "origin"_s))) {
        RETURN_IF_EXCEPTION(scope, {});
        if (!originValue.isUndefined() && !originValue.isString()) {
            return ERR::INVALID_ARG_TYPE(scope, globalObject, "options.origin"_s, "string"_s, originValue);
        }
    }

    if (JSValue codeGenerationValue = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, codeGenerationKey))) {
        RETURN_IF_EXCEPTION(scope, {});

        if (codeGenerationValue.isUndefined()) {
            return std::nullopt;
        }

        if (!codeGenerationValue.isObject()) {
            return ERR::INVALID_ARG_TYPE(scope, globalObject, WTF::makeString("options."_s, codeGenerationKey), "object"_s, codeGenerationValue);
        }

        JSObject* codeGenerationObject = asObject(codeGenerationValue);

        if (JSValue allowStringsValue = codeGenerationObject->getIfPropertyExists(globalObject, Identifier::fromString(vm, "strings"_s))) {
            RETURN_IF_EXCEPTION(scope, {});
            if (!allowStringsValue.isBoolean()) {
                return ERR::INVALID_ARG_TYPE(scope, globalObject, WTF::makeString("options."_s, codeGenerationKey, ".strings"_s), "boolean"_s, allowStringsValue);
            }

            outOptions.allowStrings = allowStringsValue.toBoolean(globalObject);
        }

        if (JSValue allowWasmValue = codeGenerationObject->getIfPropertyExists(globalObject, Identifier::fromString(vm, "wasm"_s))) {
            RETURN_IF_EXCEPTION(scope, {});
            if (!allowWasmValue.isBoolean()) {
                return ERR::INVALID_ARG_TYPE(scope, globalObject, WTF::makeString("options."_s, codeGenerationKey, ".wasm"_s), "boolean"_s, allowWasmValue);
            }

            outOptions.allowWasm = allowWasmValue.toBoolean(globalObject);
        }
    }

    return std::nullopt;
}

NodeVMGlobalObject* getGlobalObjectFromContext(JSGlobalObject* globalObject, JSValue contextValue, bool canThrow)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    if (contextValue.isUndefinedOrNull()) {
        if (canThrow) {
            ERR::INVALID_ARG_TYPE(scope, globalObject, "context"_s, "object"_s, contextValue);
        }
        return nullptr;
    }

    if (!contextValue.isObject()) {
        if (canThrow) {
            ERR::INVALID_ARG_TYPE(scope, globalObject, "context"_s, "object"_s, contextValue);
        }
        return nullptr;
    }

    JSObject* context = asObject(contextValue);
    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    JSValue scopeValue = zigGlobalObject->vmModuleContextMap()->get(context);
    if (scopeValue.isUndefined()) {
        if (canThrow) {
            INVALID_ARG_VALUE_VM_VARIATION(scope, globalObject, "contextifiedObject"_s, context);
        }
        return nullptr;
    }

    NodeVMGlobalObject* nodeVmGlobalObject = jsDynamicCast<NodeVMGlobalObject*>(scopeValue);
    if (!nodeVmGlobalObject) {
        if (canThrow) {
            INVALID_ARG_VALUE_VM_VARIATION(scope, globalObject, "contextifiedObject"_s, context);
        }
        return nullptr;
    }

    return nodeVmGlobalObject;
}

/// For some reason Node has this error message with a grammatical error and we have to match it so the tests pass:
/// `The "<name>" argument must be an vm.Context`
JSC::EncodedJSValue INVALID_ARG_VALUE_VM_VARIATION(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, WTF::ASCIILiteral name, JSC::JSValue value)
{
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_INVALID_ARG_TYPE, makeString("The \""_s, name, "\" argument must be an vm.Context"_s)));
    return {};
}

} // namespace NodeVM

using namespace NodeVM;

NodeVMGlobalObject::NodeVMGlobalObject(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure)
{
}

template<typename, JSC::SubspaceAccess mode> JSC::GCClient::IsoSubspace* NodeVMGlobalObject::subspaceFor(JSC::VM& vm)
{
    if constexpr (mode == JSC::SubspaceAccess::Concurrently)
        return nullptr;
    return WebCore::subspaceForImpl<NodeVMGlobalObject, WebCore::UseCustomHeapCellType::Yes>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForNodeVMGlobalObject.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForNodeVMGlobalObject = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForNodeVMGlobalObject.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForNodeVMGlobalObject = std::forward<decltype(space)>(space); },
        [](auto& server) -> JSC::HeapCellType& { return server.m_heapCellTypeForNodeVMGlobalObject; });
}

NodeVMGlobalObject* NodeVMGlobalObject::create(JSC::VM& vm, JSC::Structure* structure, NodeVMContextOptions options)
{
    auto* cell = new (NotNull, JSC::allocateCell<NodeVMGlobalObject>(vm)) NodeVMGlobalObject(vm, structure);
    cell->finishCreation(vm, options);
    return cell;
}

Structure* NodeVMGlobalObject::createStructure(JSC::VM& vm, JSC::JSValue prototype)
{
    // ~IsImmutablePrototypeExoticObject is necessary for JSDOM to work (it relies on __proto__ = on the GlobalObject).
    return JSC::Structure::create(vm, nullptr, prototype, JSC::TypeInfo(JSC::GlobalObjectType, StructureFlags & ~IsImmutablePrototypeExoticObject), info());
}

void NodeVMGlobalObject::finishCreation(JSC::VM& vm, NodeVMContextOptions options)
{
    Base::finishCreation(vm);
    setEvalEnabled(options.allowStrings, "Code generation from strings disallowed for this context"_s);
    setWebAssemblyEnabled(options.allowWasm, "Wasm code generation disallowed by embedder"_s);
    vm.ensureTerminationException();
}

void NodeVMGlobalObject::destroy(JSCell* cell)
{
    static_cast<NodeVMGlobalObject*>(cell)->~NodeVMGlobalObject();
}

NodeVMGlobalObject::~NodeVMGlobalObject()
{
    SigintWatcher::get().unregisterGlobalObject(this);
}

void NodeVMGlobalObject::setContextifiedObject(JSC::JSObject* contextifiedObject)
{
    m_sandbox.set(vm(), this, contextifiedObject);
}

void NodeVMGlobalObject::clearContextifiedObject()
{
    m_sandbox.clear();
}

void NodeVMGlobalObject::sigintReceived()
{
    vm().notifyNeedTermination();
}

bool NodeVMGlobalObject::put(JSCell* cell, JSGlobalObject* globalObject, PropertyName propertyName, JSValue value, PutPropertySlot& slot)
{
    auto* thisObject = jsCast<NodeVMGlobalObject*>(cell);

    if (!thisObject->m_sandbox) {
        return Base::put(cell, globalObject, propertyName, value, slot);
    }

    auto* sandbox = thisObject->m_sandbox.get();

    VM& vm = JSC::getVM(globalObject);
    JSValue thisValue = slot.thisValue();
    bool isContextualStore = thisValue != JSValue(globalObject);
    if (auto* proxy = jsDynamicCast<JSGlobalProxy*>(thisValue); proxy && proxy->target() == globalObject) {
        isContextualStore = false;
    }
    bool isDeclaredOnGlobalObject = slot.type() == JSC::PutPropertySlot::NewProperty;
    auto scope = DECLARE_THROW_SCOPE(vm);
    PropertySlot getter(sandbox, PropertySlot::InternalMethodType::Get, nullptr);
    bool isDeclaredOnSandbox = sandbox->getPropertySlot(globalObject, propertyName, getter);
    RETURN_IF_EXCEPTION(scope, false);

    bool isDeclared = isDeclaredOnGlobalObject || isDeclaredOnSandbox;
    bool isFunction = value.isCallable();

    if (slot.isStrictMode() && !isDeclared && isContextualStore && !isFunction) {
        return Base::put(cell, globalObject, propertyName, value, slot);
    }

    if (!isDeclared && value.isSymbol()) {
        return Base::put(cell, globalObject, propertyName, value, slot);
    }

    slot.setThisValue(sandbox);

    if (!sandbox->methodTable()->put(sandbox, globalObject, propertyName, value, slot)) {
        return false;
    }
    RETURN_IF_EXCEPTION(scope, false);

    if (isDeclaredOnSandbox && getter.isAccessor() and (getter.attributes() & PropertyAttribute::DontEnum) == 0) {
        return true;
    }

    slot.setThisValue(thisValue);

    return Base::put(cell, globalObject, propertyName, value, slot);
}

// This is copy-pasted from JSC's ProxyObject.cpp
static const ASCIILiteral s_proxyAlreadyRevokedErrorMessage { "Proxy has already been revoked. No more operations are allowed to be performed on it"_s };

bool NodeVMGlobalObject::getOwnPropertySlot(JSObject* cell, JSGlobalObject* globalObject, PropertyName propertyName, PropertySlot& slot)
{
    VM& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsCast<NodeVMGlobalObject*>(cell);
    if (thisObject->m_sandbox) {
        auto* contextifiedObject = thisObject->m_sandbox.get();
        slot.setThisValue(contextifiedObject);
        // Unfortunately we must special case ProxyObjects. Why?
        //
        // When we run this:
        //
        // ```js
        // vm.runInNewContext("String", new Proxy({}, {}))
        // ```
        //
        // It always returns undefined (it should return the String constructor function).
        //
        // This is because JSC seems to always return true when calling
        // `contextifiedObject->methodTable()->getOwnPropertySlot` for ProxyObjects, so
        // we never fall through to call `Base::getOwnPropertySlot` to fetch it from the globalObject.
        //
        // This only happens when `slot.internalMethodType() == JSC::PropertySlot::InternalMethodType::Get`
        // and there is no `get` trap set on the proxy object.
        if (slot.internalMethodType() == JSC::PropertySlot::InternalMethodType::Get && contextifiedObject->type() == JSC::ProxyObjectType) {
            JSC::ProxyObject* proxyObject = jsCast<JSC::ProxyObject*>(contextifiedObject);

            JSValue handlerValue = proxyObject->handler();
            if (handlerValue.isNull())
                return throwTypeError(globalObject, scope, s_proxyAlreadyRevokedErrorMessage);

            JSObject* handler = jsCast<JSObject*>(handlerValue);
            CallData callData;
            JSObject* getHandler = proxyObject->getHandlerTrap(globalObject, handler, callData, vm.propertyNames->get, ProxyObject::HandlerTrap::Get);
            RETURN_IF_EXCEPTION(scope, {});

            // If there is a `get` trap, we don't need to our special handling
            if (getHandler) {
                if (contextifiedObject->methodTable()->getOwnPropertySlot(contextifiedObject, globalObject, propertyName, slot)) {
                    return true;
                }
                goto try_from_global;
            }

            // A lot of this is copy-pasted from JSC's `ProxyObject::getOwnPropertySlotCommon` function in
            // ProxyObject.cpp, need to make sure we keep this in sync when we update JSC...

            slot.disableCaching();
            slot.setIsTaintedByOpaqueObject();

            if (slot.isVMInquiry()) {
                goto try_from_global;
            }

            JSValue receiver = slot.thisValue();

            // We're going to have to look this up ourselves
            PropertySlot target_slot(receiver, PropertySlot::InternalMethodType::Get);
            JSObject* target = proxyObject->target();
            bool hasProperty = target->getPropertySlot(globalObject, propertyName, target_slot);
            EXCEPTION_ASSERT(!scope.exception() || !hasProperty);
            if (hasProperty) {
                unsigned ignoredAttributes = 0;
                JSValue result = target_slot.getValue(globalObject, propertyName);
                RETURN_IF_EXCEPTION(scope, {});
                slot.setValue(proxyObject, ignoredAttributes, result);
                RETURN_IF_EXCEPTION(scope, {});
                return true;
            }

            goto try_from_global;
        }

        if (contextifiedObject->getPropertySlot(globalObject, propertyName, slot)) {
            return true;
        }

    try_from_global:

        slot.setThisValue(globalObject);
        RETURN_IF_EXCEPTION(scope, false);
    }

    return Base::getOwnPropertySlot(cell, globalObject, propertyName, slot);
}

bool NodeVMGlobalObject::defineOwnProperty(JSObject* cell, JSGlobalObject* globalObject, PropertyName propertyName, const PropertyDescriptor& descriptor, bool shouldThrow)
{
    // if (!propertyName.isSymbol())
    //     printf("defineOwnProperty called for %s\n", propertyName.publicName()->utf8().data());
    auto* thisObject = jsCast<NodeVMGlobalObject*>(cell);
    if (!thisObject->m_sandbox) {
        return Base::defineOwnProperty(cell, globalObject, propertyName, descriptor, shouldThrow);
    }

    auto* contextifiedObject = thisObject->m_sandbox.get();
    VM& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    PropertySlot slot(globalObject, PropertySlot::InternalMethodType::GetOwnProperty, nullptr);
    bool isDeclaredOnGlobalProxy = globalObject->JSC::JSGlobalObject::getOwnPropertySlot(globalObject, globalObject, propertyName, slot);

    // If the property is set on the global as neither writable nor
    // configurable, don't change it on the global or sandbox.
    if (isDeclaredOnGlobalProxy && (slot.attributes() & PropertyAttribute::ReadOnly) != 0 && (slot.attributes() & PropertyAttribute::DontDelete) != 0) {
        return Base::defineOwnProperty(cell, globalObject, propertyName, descriptor, shouldThrow);
    }

    if (descriptor.isAccessorDescriptor()) {
        return contextifiedObject->defineOwnProperty(contextifiedObject, contextifiedObject->globalObject(), propertyName, descriptor, shouldThrow);
    }

    bool isDeclaredOnSandbox = contextifiedObject->getPropertySlot(globalObject, propertyName, slot);
    RETURN_IF_EXCEPTION(scope, false);

    if (isDeclaredOnSandbox && !isDeclaredOnGlobalProxy) {
        return contextifiedObject->defineOwnProperty(contextifiedObject, contextifiedObject->globalObject(), propertyName, descriptor, shouldThrow);
    }

    if (!contextifiedObject->defineOwnProperty(contextifiedObject, contextifiedObject->globalObject(), propertyName, descriptor, shouldThrow)) {
        return false;
    }

    return Base::defineOwnProperty(cell, globalObject, propertyName, descriptor, shouldThrow);
}

DEFINE_VISIT_CHILDREN(NodeVMGlobalObject);

template<typename Visitor>
void NodeVMGlobalObject::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    Base::visitChildren(cell, visitor);
    auto* thisObject = jsCast<NodeVMGlobalObject*>(cell);
    visitor.append(thisObject->m_sandbox);
}

JSC_DEFINE_HOST_FUNCTION(vmModuleRunInNewContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue code = callFrame->argument(0);
    if (!code.isString())
        return ERR::INVALID_ARG_TYPE(scope, globalObject, "code"_s, "string"_s, code);

    JSValue contextArg = callFrame->argument(1);
    if (contextArg.isUndefined()) {
        contextArg = JSC::constructEmptyObject(globalObject);
    }

    if (!contextArg.isObject())
        return ERR::INVALID_ARG_TYPE(scope, globalObject, "context"_s, "object"_s, contextArg);

    JSObject* sandbox = asObject(contextArg);

    JSValue contextOptionsArg = callFrame->argument(2);

    NodeVMContextOptions contextOptions {};

    if (auto encodedException = getNodeVMContextOptions(globalObject, vm, scope, contextOptionsArg, contextOptions, "contextCodeGeneration")) {
        return *encodedException;
    }

    // Create context and run code
    auto* context = NodeVMGlobalObject::create(vm,
        defaultGlobalObject(globalObject)->NodeVMGlobalObjectStructure(),
        contextOptions);

    context->setContextifiedObject(sandbox);

    JSValue optionsArg = callFrame->argument(2);

    ScriptOptions options(optionsArg.toWTFString(globalObject), OrdinalNumber::fromZeroBasedInt(0), OrdinalNumber::fromZeroBasedInt(0));
    if (optionsArg.isString()) {
        options.filename = optionsArg.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    } else if (!options.fromJS(globalObject, vm, scope, optionsArg)) {
        RETURN_IF_EXCEPTION(scope, {});
    }

    RefPtr fetcher(NodeVMScriptFetcher::create(vm, options.importer));

    SourceCode sourceCode(
        JSC::StringSourceProvider::create(
            code.toString(globalObject)->value(globalObject),
            JSC::SourceOrigin(WTF::URL::fileURLWithFileSystemPath(options.filename), *fetcher),
            options.filename,
            JSC::SourceTaintedOrigin::Untainted,
            TextPosition(options.lineOffset, options.columnOffset)),
        options.lineOffset.zeroBasedInt(),
        options.columnOffset.zeroBasedInt());

    NakedPtr<JSC::Exception> exception;
    JSValue result = JSC::evaluate(context, sourceCode, context, exception);

    if (exception) [[unlikely]] {
        if (handleException(globalObject, vm, exception, scope)) {
            return {};
        }
        JSC::throwException(globalObject, scope, exception.get());
        return {};
    }

    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(vmModuleRunInThisContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = JSC::getVM(globalObject);
    auto sourceStringValue = callFrame->argument(0);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (!sourceStringValue.isString()) {
        return ERR::INVALID_ARG_TYPE(throwScope, globalObject, "code"_s, "string"_s, sourceStringValue);
    }

    auto sourceString = sourceStringValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, encodedJSUndefined());

    JSValue optionsArg = callFrame->argument(1);
    ScriptOptions options(optionsArg.toWTFString(globalObject), OrdinalNumber::fromZeroBasedInt(0), OrdinalNumber::fromZeroBasedInt(0));
    if (optionsArg.isString()) {
        options.filename = optionsArg.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(throwScope, {});
    } else if (!options.fromJS(globalObject, vm, throwScope, optionsArg)) {
        RETURN_IF_EXCEPTION(throwScope, encodedJSUndefined());
    }

    RefPtr fetcher(NodeVMScriptFetcher::create(vm, options.importer));

    SourceCode source(
        JSC::StringSourceProvider::create(sourceString, JSC::SourceOrigin(WTF::URL::fileURLWithFileSystemPath(options.filename), *fetcher), options.filename, JSC::SourceTaintedOrigin::Untainted, TextPosition(options.lineOffset, options.columnOffset)),
        options.lineOffset.zeroBasedInt(), options.columnOffset.zeroBasedInt());

    WTF::NakedPtr<JSC::Exception> exception;
    JSValue result = JSC::evaluate(globalObject, source, globalObject, exception);

    if (exception) [[unlikely]] {
        if (handleException(globalObject, vm, exception, throwScope)) {
            return {};
        }
        JSC::throwException(globalObject, throwScope, exception.get());
        return {};
    }

    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(vmModuleCompileFunction, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Step 1: Argument validation
    // Get code argument (required)
    JSValue codeArg = callFrame->argument(0);
    if (!codeArg || !codeArg.isString())
        return ERR::INVALID_ARG_TYPE(scope, globalObject, "code"_s, "string"_s, codeArg);

    // Get params argument (optional array of strings)
    MarkedArgumentBuffer parameters;
    JSValue paramsArg = callFrame->argument(1);
    if (paramsArg && !paramsArg.isUndefined()) {
        if (!paramsArg.isObject() || !isArray(globalObject, paramsArg)) {
            return ERR::INVALID_ARG_INSTANCE(scope, globalObject, "params"_s, "Array"_s, paramsArg);
        }

        auto* paramsArray = jsCast<JSArray*>(paramsArg);
        unsigned length = paramsArray->length();
        for (unsigned i = 0; i < length; i++) {
            JSValue param = paramsArray->getIndexQuickly(i);
            if (!param.isString()) {
                return ERR::INVALID_ARG_TYPE(scope, globalObject, "params"_s, "Array<string>"_s, paramsArg);
            }
            parameters.append(param);
        }
    }

    // Get options argument
    JSValue optionsArg = callFrame->argument(2);
    CompileFunctionOptions options;
    if (!options.fromJS(globalObject, vm, scope, optionsArg)) {
        RETURN_IF_EXCEPTION(scope, {});
        options = {};
        options.parsingContext = globalObject;
    }

    // Step 3: Create a new function
    // Prepare the function code by combining the parameters and body
    String sourceString = codeArg.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // Create an ArgList with the parameters and function body for constructFunction
    MarkedArgumentBuffer constructFunctionArgs;

    // Add all parameters
    for (unsigned i = 0; i < parameters.size(); i++) {
        constructFunctionArgs.append(parameters.at(i));
    }

    // Add the function body
    constructFunctionArgs.append(jsString(vm, sourceString));

    RefPtr fetcher(NodeVMScriptFetcher::create(vm, options.importer));

    // Create the source origin
    SourceOrigin sourceOrigin { WTF::URL::fileURLWithFileSystemPath(options.filename), *fetcher };

    // Process contextExtensions if they exist
    JSScope* functionScope = options.parsingContext ? options.parsingContext : globalObject;

    if (!options.contextExtensions.isUndefinedOrNull() && !options.contextExtensions.isEmpty() && options.contextExtensions.isObject() && isArray(globalObject, options.contextExtensions)) {
        auto* contextExtensionsArray = jsCast<JSArray*>(options.contextExtensions);
        unsigned length = contextExtensionsArray->length();

        if (length > 0) {
            // Get the global scope from the parsing context
            JSScope* currentScope = options.parsingContext->globalScope();

            // Create JSWithScope objects for each context extension
            for (unsigned i = 0; i < length; i++) {
                JSValue extension = contextExtensionsArray->getIndexQuickly(i);
                if (extension.isObject()) {
                    JSObject* extensionObject = asObject(extension);
                    currentScope = JSWithScope::create(vm, options.parsingContext, currentScope, extensionObject);
                }
            }

            // Use the outermost JSWithScope as our function scope
            functionScope = currentScope;
        }
    }

    options.parsingContext->setGlobalScopeExtension(functionScope);

    // Create the function using constructAnonymousFunction with the appropriate scope chain
    JSFunction* function = constructAnonymousFunction(globalObject, ArgList(constructFunctionArgs), sourceOrigin, WTFMove(options), JSC::SourceTaintedOrigin::Untainted, functionScope);
    fetcher->owner(vm, function);

    RETURN_IF_EXCEPTION(scope, {});

    if (!function) {
        return throwVMError(globalObject, scope, "Failed to compile function"_s);
    }

    return JSValue::encode(function);
}

Structure* createNodeVMGlobalObjectStructure(JSC::VM& vm)
{
    return NodeVMGlobalObject::createStructure(vm, jsNull());
}

NodeVMGlobalObject* createContextImpl(JSC::VM& vm, JSGlobalObject* globalObject, JSObject* sandbox)
{
    auto* targetContext = NodeVMGlobalObject::create(vm,
        defaultGlobalObject(globalObject)->NodeVMGlobalObjectStructure(),
        NodeVMContextOptions {});

    // Set sandbox as contextified object
    targetContext->setContextifiedObject(sandbox);

    // Store context in WeakMap for isContext checks
    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    zigGlobalObject->vmModuleContextMap()->set(vm, sandbox, targetContext);

    return targetContext;
}

JSC_DEFINE_HOST_FUNCTION(vmModule_createContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue contextArg = callFrame->argument(0);
    if (contextArg.isUndefined()) {
        contextArg = JSC::constructEmptyObject(globalObject);
    }

    if (!contextArg.isObject()) {
        return ERR::INVALID_ARG_TYPE(scope, globalObject, "context"_s, "object"_s, contextArg);
    }

    JSValue optionsArg = callFrame->argument(1);

    // Validate options argument
    if (!optionsArg.isUndefined() && !optionsArg.isObject()) {
        return ERR::INVALID_ARG_TYPE(scope, globalObject, "options"_s, "object"_s, optionsArg);
    }

    NodeVMContextOptions contextOptions {};

    if (auto encodedException = getNodeVMContextOptions(globalObject, vm, scope, optionsArg, contextOptions, "codeGeneration")) {
        return *encodedException;
    }

    JSObject* sandbox = asObject(contextArg);

    auto* targetContext = NodeVMGlobalObject::create(vm,
        defaultGlobalObject(globalObject)->NodeVMGlobalObjectStructure(),
        contextOptions);

    // Set sandbox as contextified object
    targetContext->setContextifiedObject(sandbox);

    // Store context in WeakMap for isContext checks
    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    zigGlobalObject->vmModuleContextMap()->set(vm, sandbox, targetContext);

    return JSValue::encode(sandbox);
}

JSC_DEFINE_HOST_FUNCTION(vmModule_isContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    ArgList args(callFrame);
    JSValue contextArg = callFrame->argument(0);
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    bool isContext;
    if (!contextArg || !contextArg.isObject()) {
        isContext = false;
        return ERR::INVALID_ARG_TYPE(scope, globalObject, "object"_s, "object"_s, contextArg);
    } else {
        auto* zigGlobalObject = defaultGlobalObject(globalObject);
        isContext = zigGlobalObject->vmModuleContextMap()->has(asObject(contextArg));
    }
    return JSValue::encode(jsBoolean(isContext));
}

// NodeVMGlobalObject* NodeVMGlobalObject::create(JSC::VM& vm, JSC::Structure* structure)
// {
//     auto* obj = new (NotNull, allocateCell<NodeVMGlobalObject>(vm)) NodeVMGlobalObject(vm, structure);
//     obj->finishCreation(vm);
//     return obj;
// }

// void NodeVMGlobalObject::finishCreation(VM& vm, JSObject* context)
// {
//     Base::finishCreation(vm);
//     // We don't need to store the context anymore since we use proxies
// }

// DEFINE_VISIT_CHILDREN(NodeVMGlobalObject);

// template<typename Visitor>
// void NodeVMGlobalObject::visitChildrenImpl(JSCell* cell, Visitor& visitor)
// {
//     Base::visitChildren(cell, visitor);
//     // auto* thisObject = jsCast<NodeVMGlobalObject*>(cell);
//     // visitor.append(thisObject->m_proxyTarget);
// }
const ClassInfo NodeVMGlobalObject::s_info = { "NodeVMGlobalObject"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMGlobalObject) };

bool NodeVMGlobalObject::deleteProperty(JSCell* cell, JSGlobalObject* globalObject, PropertyName propertyName, JSC::DeletePropertySlot& slot)
{
    auto* thisObject = jsCast<NodeVMGlobalObject*>(cell);
    if (!thisObject->m_sandbox) [[unlikely]] {
        return Base::deleteProperty(cell, globalObject, propertyName, slot);
    }

    VM& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* sandbox = thisObject->m_sandbox.get();
    if (!sandbox->deleteProperty(sandbox, globalObject, propertyName, slot)) {
        return false;
    }

    RETURN_IF_EXCEPTION(scope, false);
    return Base::deleteProperty(cell, globalObject, propertyName, slot);
}

void NodeVMGlobalObject::getOwnPropertyNames(JSObject* cell, JSGlobalObject* globalObject, JSC::PropertyNameArray& propertyNames, JSC::DontEnumPropertiesMode mode)
{
    auto* thisObject = jsCast<NodeVMGlobalObject*>(cell);

    if (thisObject->m_sandbox) {
        thisObject->m_sandbox->getOwnPropertyNames(
            thisObject->m_sandbox.get(),
            globalObject,
            propertyNames,
            mode);
    }

    Base::getOwnPropertyNames(cell, globalObject, propertyNames, mode);
}

JSC_DEFINE_HOST_FUNCTION(vmIsModuleNamespaceObject, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return JSValue::encode(jsBoolean(callFrame->argument(0).inherits(JSModuleNamespaceObject::info())));
}

JSC::JSValue createNodeVMBinding(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto* obj = constructEmptyObject(globalObject);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "Script"_s)),
        defaultGlobalObject(globalObject)->NodeVMScript(), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "Module"_s)),
        defaultGlobalObject(globalObject)->NodeVMSourceTextModule(), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "createContext"_s)),
        JSC::JSFunction::create(vm, globalObject, 0, "createContext"_s, vmModule_createContext, ImplementationVisibility::Public), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "isContext"_s)),
        JSC::JSFunction::create(vm, globalObject, 0, "isContext"_s, vmModule_isContext, ImplementationVisibility::Public), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "runInNewContext"_s)),
        JSC::JSFunction::create(vm, globalObject, 0, "runInNewContext"_s, vmModuleRunInNewContext, ImplementationVisibility::Public), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "runInThisContext"_s)),
        JSC::JSFunction::create(vm, globalObject, 0, "runInThisContext"_s, vmModuleRunInThisContext, ImplementationVisibility::Public), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "compileFunction"_s)),
        JSC::JSFunction::create(vm, globalObject, 0, "compileFunction"_s, vmModuleCompileFunction, ImplementationVisibility::Public), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "isModuleNamespaceObject"_s)),
        JSC::JSFunction::create(vm, globalObject, 0, "isModuleNamespaceObject"_s, vmIsModuleNamespaceObject, ImplementationVisibility::Public), 1);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "kUnlinked"_s)),
        JSC::jsNumber(static_cast<unsigned>(NodeVMSourceTextModule::Status::Unlinked)), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "kLinking"_s)),
        JSC::jsNumber(static_cast<unsigned>(NodeVMSourceTextModule::Status::Linking)), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "kLinked"_s)),
        JSC::jsNumber(static_cast<unsigned>(NodeVMSourceTextModule::Status::Linked)), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "kEvaluating"_s)),
        JSC::jsNumber(static_cast<unsigned>(NodeVMSourceTextModule::Status::Evaluating)), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "kEvaluated"_s)),
        JSC::jsNumber(static_cast<unsigned>(NodeVMSourceTextModule::Status::Evaluated)), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "kErrored"_s)),
        JSC::jsNumber(static_cast<unsigned>(NodeVMSourceTextModule::Status::Errored)), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "kSourceText"_s)),
        JSC::jsNumber(static_cast<unsigned>(NodeVMModule::Type::SourceText)), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "kSynthetic"_s)),
        JSC::jsNumber(static_cast<unsigned>(NodeVMModule::Type::Synthetic)), 0);
    return obj;
}

void configureNodeVM(JSC::VM& vm, Zig::GlobalObject* globalObject)
{
    globalObject->m_NodeVMScriptClassStructure.initLater(
        [](LazyClassStructure::Initializer& init) {
            auto prototype = NodeVMScript::createPrototype(init.vm, init.global);
            auto* structure = NodeVMScript::createStructure(init.vm, init.global, prototype);
            auto* constructorStructure = NodeVMScriptConstructor::createStructure(
                init.vm, init.global, init.global->m_functionPrototype.get());
            auto* constructor = NodeVMScriptConstructor::create(
                init.vm, init.global, constructorStructure, prototype);
            init.setPrototype(prototype);
            init.setStructure(structure);
            init.setConstructor(constructor);
        });

    globalObject->m_NodeVMSourceTextModuleClassStructure.initLater(
        [](LazyClassStructure::Initializer& init) {
            auto prototype = NodeVMSourceTextModule::createPrototype(init.vm, init.global);
            auto* structure = NodeVMSourceTextModule::createStructure(init.vm, init.global, prototype);
            auto* constructorStructure = NodeVMModuleConstructor::createStructure(
                init.vm, init.global, init.global->m_functionPrototype.get());
            auto* constructor = NodeVMModuleConstructor::create(
                init.vm, init.global, constructorStructure, prototype);
            init.setPrototype(prototype);
            init.setStructure(structure);
            init.setConstructor(constructor);
        });

    globalObject->m_NodeVMSyntheticModuleClassStructure.initLater(
        [](LazyClassStructure::Initializer& init) {
            auto prototype = NodeVMSyntheticModule::createPrototype(init.vm, init.global);
            auto* structure = NodeVMSyntheticModule::createStructure(init.vm, init.global, prototype);
            auto* constructorStructure = NodeVMModuleConstructor::createStructure(
                init.vm, init.global, init.global->m_functionPrototype.get());
            auto* constructor = NodeVMModuleConstructor::create(
                init.vm, init.global, constructorStructure, prototype);
            init.setPrototype(prototype);
            init.setStructure(structure);
            init.setConstructor(constructor);
        });

    globalObject->m_cachedNodeVMGlobalObjectStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, Structure>::Initializer& init) {
            init.set(createNodeVMGlobalObjectStructure(init.vm));
        });
}

BaseVMOptions::BaseVMOptions(String filename)
    : filename(WTFMove(filename))
{
}

BaseVMOptions::BaseVMOptions(String filename, OrdinalNumber lineOffset, OrdinalNumber columnOffset)
    : filename(WTFMove(filename))
    , lineOffset(lineOffset)
    , columnOffset(columnOffset)
{
}

bool BaseVMOptions::fromJS(JSC::JSGlobalObject* globalObject, JSC::VM& vm, JSC::ThrowScope& scope, JSC::JSValue optionsArg)
{
    JSObject* options = nullptr;
    bool any = false;

    if (!optionsArg.isUndefined()) {
        if (optionsArg.isObject()) {
            options = asObject(optionsArg);
        } else {
            auto _ = ERR::INVALID_ARG_TYPE(scope, globalObject, "options"_s, "object"_s, optionsArg);
            return false;
        }

        if (JSValue filenameOpt = options->getIfPropertyExists(globalObject, builtinNames(vm).filenamePublicName())) {
            if (filenameOpt.isString()) {
                this->filename = filenameOpt.toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, false);
                any = true;
            } else if (!filenameOpt.isUndefined()) {
                ERR::INVALID_ARG_TYPE(scope, globalObject, "options.filename"_s, "string"_s, filenameOpt);
                return false;
            }
        } else {
            this->filename = "evalmachine.<anonymous>"_s;
        }

        if (JSValue lineOffsetOpt = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "lineOffset"_s))) {
            if (lineOffsetOpt.isAnyInt()) {
                if (!lineOffsetOpt.isInt32()) {
                    ERR::OUT_OF_RANGE(scope, globalObject, "options.lineOffset"_s, std::numeric_limits<int32_t>().min(), std::numeric_limits<int32_t>().max(), lineOffsetOpt);
                    return false;
                }
                this->lineOffset = OrdinalNumber::fromZeroBasedInt(lineOffsetOpt.asInt32());
                any = true;
            } else if (lineOffsetOpt.isNumber()) {
                ERR::OUT_OF_RANGE(scope, globalObject, "options.lineOffset"_s, "an integer"_s, lineOffsetOpt);
                return false;
            } else if (!lineOffsetOpt.isUndefined()) {
                ERR::INVALID_ARG_TYPE(scope, globalObject, "options.lineOffset"_s, "number"_s, lineOffsetOpt);
                return false;
            }
        }

        if (JSValue columnOffsetOpt = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "columnOffset"_s))) {
            if (columnOffsetOpt.isAnyInt()) {
                if (!columnOffsetOpt.isInt32()) {
                    ERR::OUT_OF_RANGE(scope, globalObject, "options.columnOffset"_s, std::numeric_limits<int32_t>().min(), std::numeric_limits<int32_t>().max(), columnOffsetOpt);
                    return false;
                }
                int columnOffsetValue = columnOffsetOpt.asInt32();

                this->columnOffset = OrdinalNumber::fromZeroBasedInt(columnOffsetValue);
                any = true;
            } else if (columnOffsetOpt.isNumber()) {
                ERR::OUT_OF_RANGE(scope, globalObject, "options.columnOffset"_s, "an integer"_s, columnOffsetOpt);
                return false;
            } else if (!columnOffsetOpt.isUndefined()) {
                ERR::INVALID_ARG_TYPE(scope, globalObject, "options.columnOffset"_s, "number"_s, columnOffsetOpt);
                return false;
            }
        }
    }

    return any;
}

bool BaseVMOptions::validateProduceCachedData(JSC::JSGlobalObject* globalObject, JSC::VM& vm, JSC::ThrowScope& scope, JSObject* options, bool& outProduceCachedData)
{
    JSValue produceCachedDataOpt = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "produceCachedData"_s));
    if (produceCachedDataOpt && !produceCachedDataOpt.isUndefined()) {
        RETURN_IF_EXCEPTION(scope, {});
        if (!produceCachedDataOpt.isBoolean()) {
            ERR::INVALID_ARG_TYPE(scope, globalObject, "options.produceCachedData"_s, "boolean"_s, produceCachedDataOpt);
            return false;
        }
        outProduceCachedData = produceCachedDataOpt.asBoolean();
        return true;
    }
    return false;
}

bool BaseVMOptions::validateCachedData(JSC::JSGlobalObject* globalObject, JSC::VM& vm, JSC::ThrowScope& scope, JSObject* options, WTF::Vector<uint8_t>& outCachedData)
{
    JSValue cachedDataOpt = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "cachedData"_s));
    RETURN_IF_EXCEPTION(scope, {});

    if (cachedDataOpt && !cachedDataOpt.isUndefined()) {
        // Verify it's a Buffer, TypedArray or DataView and extract the data if it is.
        if (extractCachedData(cachedDataOpt, outCachedData)) {
            return true;
        }

        ERR::INVALID_ARG_INSTANCE(scope, globalObject, "options.cachedData"_s, "Buffer, TypedArray, or DataView"_s, cachedDataOpt);
    }

    return false;
}

bool BaseVMOptions::validateTimeout(JSC::JSGlobalObject* globalObject, JSC::VM& vm, JSC::ThrowScope& scope, JSObject* options, std::optional<int64_t>& outTimeout)
{
    JSValue timeoutOpt = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "timeout"_s));
    if (timeoutOpt && !timeoutOpt.isUndefined()) {
        if (!timeoutOpt.isNumber()) {
            ERR::INVALID_ARG_TYPE(scope, globalObject, "options.timeout"_s, "number"_s, timeoutOpt);
            return false;
        }

        ssize_t timeoutValue;
        V::validateInteger(scope, globalObject, timeoutOpt, "options.timeout"_s, jsNumber(1), jsNumber(std::numeric_limits<int64_t>().max()), &timeoutValue);
        RETURN_IF_EXCEPTION(scope, {});

        outTimeout = timeoutValue;
        return true;
    }
    return false;
}

bool CompileFunctionOptions::fromJS(JSC::JSGlobalObject* globalObject, JSC::VM& vm, JSC::ThrowScope& scope, JSC::JSValue optionsArg)
{
    this->parsingContext = globalObject;
    bool any = BaseVMOptions::fromJS(globalObject, vm, scope, optionsArg);
    RETURN_IF_EXCEPTION(scope, false);

    if (!optionsArg.isUndefined() && !optionsArg.isString()) {
        JSObject* options = asObject(optionsArg);

        if (validateProduceCachedData(globalObject, vm, scope, options, this->produceCachedData)) {
            RETURN_IF_EXCEPTION(scope, false);
            any = true;
        }

        if (validateCachedData(globalObject, vm, scope, options, this->cachedData)) {
            RETURN_IF_EXCEPTION(scope, false);
            any = true;
        }

        JSValue parsingContextValue = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "parsingContext"_s));
        RETURN_IF_EXCEPTION(scope, {});

        if (!parsingContextValue.isEmpty() && !parsingContextValue.isUndefined()) {
            if (parsingContextValue.isNull() || !parsingContextValue.isObject())
                return ERR::INVALID_ARG_INSTANCE(scope, globalObject, "options.parsingContext"_s, "Context"_s, parsingContextValue);

            JSObject* context = asObject(parsingContextValue);
            auto* zigGlobalObject = defaultGlobalObject(globalObject);
            JSValue scopeValue = zigGlobalObject->vmModuleContextMap()->get(context);

            if (scopeValue.isUndefined())
                return ERR::INVALID_ARG_INSTANCE(scope, globalObject, "options.parsingContext"_s, "Context"_s, parsingContextValue);

            parsingContext = jsDynamicCast<NodeVMGlobalObject*>(scopeValue);
            if (!parsingContext)
                return ERR::INVALID_ARG_INSTANCE(scope, globalObject, "options.parsingContext"_s, "Context"_s, parsingContextValue);

            any = true;
        }

        // Handle contextExtensions option
        JSValue contextExtensionsValue = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "contextExtensions"_s));
        RETURN_IF_EXCEPTION(scope, {});

        if (!contextExtensionsValue.isEmpty() && !contextExtensionsValue.isUndefined()) {
            if (contextExtensionsValue.isNull() || !contextExtensionsValue.isObject())
                return ERR::INVALID_ARG_INSTANCE(scope, globalObject, "options.contextExtensions"_s, "Array"_s, contextExtensionsValue);

            if (auto* contextExtensionsObject = asObject(contextExtensionsValue)) {
                if (!isArray(globalObject, contextExtensionsObject))
                    return ERR::INVALID_ARG_TYPE(scope, globalObject, "options.contextExtensions"_s, "Array"_s, contextExtensionsValue);

                // Validate that all items in the array are objects
                auto* contextExtensionsArray = jsCast<JSArray*>(contextExtensionsValue);
                unsigned length = contextExtensionsArray->length();
                for (unsigned i = 0; i < length; i++) {
                    JSValue extension = contextExtensionsArray->getIndexQuickly(i);
                    if (!extension.isObject())
                        return ERR::INVALID_ARG_TYPE(scope, globalObject, "options.contextExtensions[0]"_s, "object"_s, extension);
                }
            } else {
                return ERR::INVALID_ARG_TYPE(scope, globalObject, "options.contextExtensions"_s, "Array"_s, contextExtensionsValue);
            }

            this->contextExtensions = contextExtensionsValue;
            any = true;
        }

        // Handle importModuleDynamically option
        JSValue importModuleDynamicallyValue = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "importModuleDynamically"_s));
        RETURN_IF_EXCEPTION(scope, {});

        if (importModuleDynamicallyValue && importModuleDynamicallyValue.isCallable()) {
            this->importer = importModuleDynamicallyValue;
            any = true;
        }
    }

    return any;
}

} // namespace Bun
