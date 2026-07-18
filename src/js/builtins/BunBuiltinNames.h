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
    macro(Loader) \
    macro(ReadableByteStreamController) \
    macro(ReadableStream) \
    macro(ReadableStreamBYOBReader) \
    macro(ReadableStreamBYOBRequest) \
    macro(ReadableStreamDefaultController) \
    macro(ReadableStreamDefaultReader) \
    macro(SQL) \
    macro(TextEncoderStreamEncoder) \
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
    macro(asyncSQLitePendingRegistry) \
    macro(atimeMs) \
    macro(attributes) \
    macro(autoAllocateChunkSize) \
    macro(basename) \
    macro(birthtimeMs) \
    macro(blob) \
    macro(body) \
    macro(bunNativePtr) \
    macro(bunNativeType) \
    macro(byobRequest) \
    macro(bytes) \
    macro(cancel) \
    macro(checkBufferRead) \
    macro(checks) \
    macro(cloneArrayBuffer) \
    macro(close) \
    macro(cmd) \
    macro(code) \
    macro(controller) \
    macro(createCommonJSModule) \
    macro(createFIFO) \
    macro(createInternalModuleById) \
    macro(createUninitializedArrayBuffer) \
    macro(ctimeMs) \
    macro(data) \
    macro(dataView) \
    macro(decode) \
    macro(dest) \
    macro(dirname) \
    macro(disturbed) \
    macro(domain) \
    macro(drain) \
    macro(encode) \
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
    macro(fulfillModuleSync) \
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
    macro(internalModuleRegistry) \
    macro(internalRequire) \
    macro(isAbortSignal) \
    macro(isAbsolute) \
    macro(isUncloneable) \
    macro(isUntransferable) \
    macro(join) \
    macro(json) \
    macro(key) \
    macro(lazy) \
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
    macro(post) \
    macro(preventAbort) \
    macro(preventCancel) \
    macro(preventClose) \
    macro(processBindingConstants) \
    macro(props) \
    macro(pull) \
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
    macro(resume) \
    macro(sameSite) \
    macro(secure) \
    macro(self) \
    macro(setHandlers) \
    macro(signal) \
    macro(size) \
    macro(specifier) \
    macro(start) \
    macro(started) \
    macro(state) \
    macro(status) \
    macro(statusText) \
    macro(stream) \
    macro(structuredCloneForStream) \
    macro(syscall) \
    macro(text) \
    macro(textDecoder) \
    macro(textDecoderStreamDecoder) \
    macro(textEncoderStreamEncoder) \
    macro(toClass) \
    macro(toNamespacedPath) \
    macro(transform) \
    macro(type) \
    macro(updateRef) \
    macro(url) \
    macro(validated) \
    macro(view) \
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
    ~BunBuiltinNames();

public:
    BUN_COMMON_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME(DECLARE_BUILTIN_IDENTIFIER_ACCESSOR)

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
    BUN_COMMON_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME(DECLARE_BUILTIN_NAMES)
};

} // namespace WebCore

#ifdef ORIGINAL_ASSERT_ENABLED
#undef ASSERT_ENABLED
#define ASSERT_ENABLED 1
#undef ORIGINAL_ASSERT_ENABLED
#endif
