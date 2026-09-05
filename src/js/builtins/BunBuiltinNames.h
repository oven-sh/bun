// clang-format off
#pragma once

#ifdef ASSERT_ENABLED
#if ASSERT_ENABLED
#define ORIGINAL_ASSERT_ENABLED 1
#undef ASSERT_ENABLED
#define ASSERT_ENABLED 0
#endif
#endif

#include "root.h"

#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/BuiltinUtils.h>
#include "BunBuiltinNames+extras.h"

namespace WebCore {

using namespace JSC;

// Keep this list sorted.
#define BUN_COMMON_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME(macro) \
    macro($$typeof) \
    macro(AbortSignal) \
    macro(Buffer) \
    macro(ReadableByteStreamController) \
    macro(ReadableStream) \
    macro(ReadableStreamBYOBReader) \
    macro(ReadableStreamBYOBRequest) \
    macro(ReadableStreamDefaultController) \
    macro(ReadableStreamDefaultReader) \
    macro(SQL) \
    macro(TransformStream) \
    macro(TransformStreamDefaultController) \
    macro(WritableStream) \
    macro(WritableStreamDefaultController) \
    macro(WritableStreamDefaultWriter) \
    macro(_debugInfo) \
    macro(_debugStack) \
    macro(_debugTask) \
    macro(_events) \
    macro(_owner) \
    macro(_store) \
    macro(abort) \
    macro(addAbortAlgorithmToSignal) \
    macro(arrayBuffer) \
    macro(asUint8Array) \
    macro(atimeMs) \
    macro(attributes) \
    macro(autoAllocateChunkSize) \
    macro(basename) \
    macro(birthtimeMs) \
    macro(blob) \
    macro(body) \
    macro(bunNativePtr) \
    macro(bytes) \
    macro(cancel) \
    macro(checks) \
    macro(close) \
    macro(cmd) \
    macro(code) \
    macro(createCommonJSModule) \
    macro(createFIFO) \
    macro(createInternalModuleById) \
    macro(createUninitializedArrayBuffer) \
    macro(ctimeMs) \
    macro(data) \
    macro(decode) \
    macro(dest) \
    macro(dirname) \
    macro(domain) \
    macro(drain) \
    macro(encoding) \
    macro(end) \
    macro(errno) \
    macro(esmLoadSync) \
    macro(esmNamespaceForCjs) \
    macro(esmRegistryDelete) \
    macro(esmRegistryEvaluatedKeys) \
    macro(evaluateCommonJSModule) \
    macro(evictIsolationSourceProviderCache) \
    macro(expires) \
    macro(exports) \
    macro(extname) \
    macro(fastPath) \
    macro(fatal) \
    macro(fd) \
    macro(filename) \
    macro(flush) \
    macro(format) \
    macro(handleEvent) \
    macro(headers) \
    macro(highWaterMark) \
    macro(host) \
    macro(hostDefinedImportType) \
    macro(hostname) \
    macro(httpOnly) \
    macro(ignoreBOM) \
    macro(importer) \
    macro(inherits) \
    macro(internal) \
    macro(internalMessage) \
    macro(internalModuleRegistry) \
    macro(internalRequire) \
    macro(isAbortSignal) \
    macro(isAbsolute) \
    macro(isUncloneable) \
    macro(isUntransferable) \
    macro(join) \
    macro(json) \
    macro(kResistStopPropagation) \
    macro(key) \
    macro(lazy) \
    macro(lazyPropertyLoaders) \
    macro(lazyPropertyValues) \
    macro(lineText) \
    macro(loadEsmIntoCjs) \
    macro(main) \
    macro(makeAbortError) \
    macro(makeDOMException) \
    macro(makeErrorWithCode) \
    macro(makeGetterTypeError) \
    macro(maxAge) \
    macro(metafileJson) \
    macro(method) \
    macro(min) \
    macro(mockedFunction) \
    macro(mode) \
    macro(mtimeMs) \
    macro(napiDlopenHandle) \
    macro(napiWrappedContents) \
    macro(normalize) \
    macro(onClose) \
    macro(onDrain) \
    macro(originalColumn) \
    macro(originalLine) \
    macro(overridableRequire) \
    macro(parse) \
    macro(partitioned) \
    macro(path) \
    macro(paths) \
    macro(peekPromiseSettledValue) \
    macro(peekPromiseStatus) \
    macro(pokePromiseAsHandled) \
    macro(port) \
    macro(preventAbort) \
    macro(preventCancel) \
    macro(preventClose) \
    macro(processBindingConstants) \
    macro(props) \
    macro(pull) \
    macro(rawHeaders) \
    macro(read) \
    macro(readable) \
    macro(readableType) \
    macro(redirect) \
    macro(relative) \
    macro(removeAbortAlgorithmFromSignal) \
    macro(require) \
    macro(requireESM) \
    macro(requireMap) \
    macro(requireNativeModule) \
    macro(resolveSync) \
    macro(sameSite) \
    macro(secure) \
    macro(self) \
    macro(sharedFd) \
    macro(signal) \
    macro(size) \
    macro(specifier) \
    macro(start) \
    macro(status) \
    macro(statusCode) \
    macro(statusMessage) \
    macro(statusText) \
    macro(stream) \
    macro(syscall) \
    macro(text) \
    macro(textDecoderStreamDecoder) \
    macro(textEncoderStreamEncoder) \
    macro(toClass) \
    macro(toNamespacedPath) \
    macro(transform) \
    macro(type) \
    macro(updateRef) \
    macro(url) \
    macro(validated) \
    macro(vmErrorDecorated) \
    macro(warning) \
    macro(webStreamClosedPromise) \
    macro(webStreamControllerError) \
    macro(writable) \
    macro(writableType) \
    macro(write) \
    macro(writer) \
    macro(written) \
    BUN_ADDITIONAL_BUILTIN_NAMES(macro)
// --- END of BUN_COMMON_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME ---

class BunBuiltinNames {
    WTF_MAKE_NONCOPYABLE(BunBuiltinNames);
    friend class JSVMClientData;
    explicit BunBuiltinNames(JSC::VM&);

public:
    ~BunBuiltinNames();
    // For a VM without JSVMClientData that still needs to parse builtins (ahead-of-time bytecode generation).
    static std::unique_ptr<BunBuiltinNames> createStandalone(JSC::VM& vm) { return std::unique_ptr<BunBuiltinNames>(new BunBuiltinNames(vm)); }

    enum class Name : uint16_t {
#define BUN_BUILTIN_NAME_ENUM(name) k_##name,
        BUN_COMMON_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME(BUN_BUILTIN_NAME_ENUM)
#undef BUN_BUILTIN_NAME_ENUM
        Count_
    };
    static constexpr size_t count = static_cast<size_t>(Name::Count_);

    // The identifiers live in two arrays (built by a loop over a string table
    // in the .cpp) rather than one member per name; the accessors index them.
#define BUN_DECLARE_BUILTIN_IDENTIFIER_ACCESSOR(name) \
    const JSC::Identifier& name##PublicName() const { return m_publicNames[static_cast<size_t>(Name::k_##name)]; } \
    const JSC::Identifier& name##PrivateName() const { return m_privateNames[static_cast<size_t>(Name::k_##name)]; }
    BUN_COMMON_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME(BUN_DECLARE_BUILTIN_IDENTIFIER_ACCESSOR)
#undef BUN_DECLARE_BUILTIN_IDENTIFIER_ACCESSOR

    const JSC::Identifier& publicName(Name name) const { return m_publicNames[static_cast<size_t>(name)]; }
    const JSC::Identifier& privateName(Name name) const { return m_privateNames[static_cast<size_t>(name)]; }

    const JSC::Identifier& resolvePublicName() const { return m_vm.propertyNames->resolve;}
    const JSC::Identifier& inspectCustomPublicName() {
        if (m_inspectCustomPublicName.isEmpty()) [[unlikely]] {
            m_inspectCustomPublicName = Identifier::fromUid(m_vm.symbolRegistry().symbolForKey("nodejs.util.inspect.custom"_s));
        }
        return m_inspectCustomPublicName;
    }

private:
    JSC::VM& m_vm;
    JSC::Identifier m_inspectCustomPublicName {};
    std::array<JSC::Identifier, count> m_publicNames;
    std::array<JSC::Identifier, count> m_privateNames;
};

} // namespace WebCore

#ifdef ORIGINAL_ASSERT_ENABLED
#undef ASSERT_ENABLED
#define ASSERT_ENABLED 1
#undef ORIGINAL_ASSERT_ENABLED
#endif
