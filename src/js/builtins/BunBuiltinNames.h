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
    macro(_events) \
    macro(abortAlgorithm) \
    macro(abortSteps) \
    macro(addAbortAlgorithmToSignal) \
    macro(assignToStream) \
    macro(associatedReadableByteStreamController) \
    macro(atimeMs) \
    macro(attributes) \
    macro(autoAllocateChunkSize) \
    macro(backpressure) \
    macro(backpressureChangePromise) \
    macro(basename) \
    macro(birthtimeMs) \
    macro(body) \
    macro(bunNativePtr) \
    macro(bunNativeType) \
    macro(byobRequest) \
    macro(cancel) \
    macro(cancelAlgorithm) \
    macro(checks) \
    macro(checkBufferRead) \
    macro(cloneArrayBuffer) \
    macro(close) \
    macro(closeAlgorithm) \
    macro(closeRequest) \
    macro(closeRequested) \
    macro(closedPromise) \
    macro(closedPromiseCapability) \
    macro(cmd) \
    macro(code) \
    macro(controlledReadableStream) \
    macro(controller) \
    macro(createCommonJSModule) \
    macro(createEmptyReadableStream) \
    macro(createFIFO) \
    macro(createInternalModuleById) \
    macro(createNativeReadableStream) \
    macro(createUninitializedArrayBuffer) \
    macro(createUsedReadableStream) \
    macro(createWritableStreamFromInternal) \
    macro(ctimeMs) \
    macro(data) \
    macro(dataView) \
    macro(decode) \
    macro(dest) \
    macro(dirname) \
    macro(disturbed) \
    macro(domain) \
    macro(encoding) \
    macro(end) \
    macro(errno) \
    macro(errorSteps) \
    macro(evaluateCommonJSModule) \
    macro(evictIsolationSourceProviderCache) \
    macro(expires) \
    macro(exports) \
    macro(extname) \
    macro(fastPath) \
    macro(fatal) \
    macro(fd) \
    macro(filename) \
    macro(flushAlgorithm) \
    macro(format) \
    macro(fulfillModuleSync) \
    macro(esmNamespaceForCjs) \
    macro(esmRegistryDelete) \
    macro(esmRegistryEvaluatedKeys) \
    macro(esmLoadSync) \
    macro(getInternalWritableStream) \
    macro(handleEvent) \
    macro(headers) \
    macro(highWaterMark) \
    macro(host) \
    macro(hostDefinedImportType) \
    macro(hostname) \
    macro(httpOnly) \
    macro(ignoreBOM) \
    macro(importer) \
    macro(inFlightCloseRequest) \
    macro(inFlightWriteRequest) \
    macro(inherits) \
    macro(internalModuleRegistry) \
    macro(internalRequire) \
    macro(internalWritable) \
    macro(isAbortSignal) \
    macro(isAbsolute) \
    macro(join) \
    macro(lazy) \
    macro(lazyStreamPrototypeMap) \
    macro(lineText) \
    macro(loadEsmIntoCjs) \
    macro(main) \
    macro(makeAbortError) \
    macro(makeDOMException) \
    macro(makeErrorWithCode) \
    macro(makeGetterTypeError) \
    macro(maxAge) \
    macro(method) \
    macro(metafileJson) \
    macro(mockedFunction) \
    macro(mode) \
    macro(mtimeMs) \
    macro(napiDlopenHandle) \
    macro(napiWrappedContents) \
    macro(normalize) \
    macro(originalColumn) \
    macro(originalLine) \
    macro(overridableRequire) \
    macro(ownerReadableStream) \
    macro(parse) \
    macro(partitioned) \
    macro(path) \
    macro(paths) \
    macro(pendingAbortRequest) \
    macro(pendingPullIntos) \
    macro(port) \
    macro(post) \
    macro(processBindingConstants) \
    macro(pull) \
    macro(pullAgain) \
    macro(pullAlgorithm) \
    macro(pulling) \
    macro(queue) \
    macro(read) \
    macro(readIntoRequests) \
    macro(readRequests) \
    macro(readable) \
    macro(readableStreamController) \
    macro(reader) \
    macro(readyPromise) \
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
    macro(signal) \
    macro(sink) \
    macro(size) \
    macro(specifier) \
    macro(start) \
    macro(startAlgorithm) \
    macro(startDirectStream) \
    macro(started) \
    macro(state) \
    macro(status) \
    macro(statusText) \
    macro(storedError) \
    macro(strategy) \
    macro(strategyHWM) \
    macro(strategySizeAlgorithm) \
    macro(stream) \
    macro(structuredCloneForStream) \
    macro(syscall) \
    macro(textDecoder) \
    macro(textDecoderStreamDecoder) \
    macro(textDecoderStreamTransform) \
    macro(textEncoderStreamEncoder) \
    macro(textEncoderStreamTransform) \
    macro(toClass) \
    macro(toNamespacedPath) \
    macro(transformAlgorithm) \
    macro(underlyingByteSource) \
    macro(underlyingSink) \
    macro(underlyingSource) \
    macro(url) \
    macro(view) \
    macro(warning) \
    macro(writable) \
    macro(write) \
    macro(writeAlgorithm) \
    macro(writeRequests) \
    macro(writer) \
    macro(written) \
    macro($$typeof) \
    macro(type) \
    macro(key) \
    macro(props) \
    macro(validated) \
    macro(_store) \
    macro(_owner) \
    macro(_debugInfo) \
    macro(_debugStack) \
    macro(_debugTask) \
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
