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

#define BUN_COMMON_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME(macro) \
    macro(_events) \
    macro(abortAlgorithm) \
    macro(AbortSignal) \
    macro(abortSteps) \
    macro(addAbortAlgorithmToSignal) \
    macro(addEventListener) \
    macro(appendFromJS) \
    macro(argv) \
    macro(assignToStream) \
    macro(associatedReadableByteStreamController) \
    macro(autoAllocateChunkSize) \
    macro(backpressure) \
    macro(backpressureChangePromise) \
    macro(basename) \
    macro(body) \
    macro(Buffer) \
    macro(Bun) \
    macro(bunNativePtr) \
    macro(bunNativeType) \
    macro(byobRequest) \
    macro(cancel) \
    macro(cancelAlgorithm) \
    macro(chdir) \
    macro(cloneArrayBuffer) \
    macro(close) \
    macro(closeAlgorithm) \
    macro(closed) \
    macro(closedPromise) \
    macro(closedPromiseCapability) \
    macro(closeRequest) \
    macro(closeRequested) \
    macro(code) \
    macro(connect) \
    macro(controlledReadableStream) \
    macro(controller) \
    macro(cork) \
    macro(createCommonJSModule) \
    macro(createEmptyReadableStream) \
    macro(createFIFO) \
    macro(createInternalModuleById) \
    macro(createNativeReadableStream) \
    macro(createReadableStream) \
    macro(createUninitializedArrayBuffer) \
    macro(createUsedReadableStream) \
    macro(createWritableStreamFromInternal) \
    macro(cwd) \
    macro(data) \
    macro(dataView) \
    macro(decode) \
    macro(delimiter) \
    macro(dest) \
    macro(destroy) \
    macro(dir) \
    macro(direct) \
    macro(dirname) \
    macro(disturbed) \
    macro(document) \
    macro(encode) \
    macro(encoding) \
    macro(end) \
    macro(errno) \
    macro(errorSteps) \
    macro(evaluateCommonJSModule) \
    macro(evaluated) \
    macro(execArgv) \
    macro(exports) \
    macro(extname) \
    macro(failureKind) \
    macro(fatal) \
    macro(fd) \
    macro(fetch) \
    macro(fetchRequest) \
    macro(file) \
    macro(filename) \
    macro(fillFromJS) \
    macro(finishConsumingStream) \
    macro(flush) \
    macro(flushAlgorithm) \
    macro(format) \
    macro(fulfillModuleSync) \
    macro(getInternalWritableStream) \
    macro(handleEvent) \
    macro(hash) \
    macro(header) \
    macro(headers) \
    macro(highWaterMark) \
    macro(host) \
    macro(hostname) \
    macro(href) \
    macro(ignoreBOM) \
    macro(importer) \
    macro(inFlightCloseRequest) \
    macro(inFlightWriteRequest) \
    macro(initializeWith) \
    macro(internalModuleRegistry) \
    macro(internalRequire) \
    macro(internalStream) \
    macro(internalWritable) \
    macro(isAbortSignal) \
    macro(isAbsolute) \
    macro(isDisturbed) \
    macro(isPaused) \
    macro(isWindows) \
    macro(join) \
    macro(kind) \
    macro(lazy) \
    macro(lazyStreamPrototypeMap) \
    macro(lineText) \
    macro(loadCJS2ESM) \
    macro(Loader) \
    macro(localStreams) \
    macro(main) \
    macro(makeDOMException) \
    macro(makeErrorWithCode) \
    macro(makeGetterTypeError) \
    macro(makeThisTypeError) \
    macro(method) \
    macro(mockedFunction) \
    macro(nextTick) \
    macro(normalize) \
    macro(on) \
    macro(once) \
    macro(options) \
    macro(origin) \
    macro(originalColumn) \
    macro(originalLine) \
    macro(overridableRequire) \
    macro(ownerReadableStream) \
    macro(parse) \
    macro(password) \
    macro(patch) \
    macro(path) \
    macro(pathname) \
    macro(paths) \
    macro(pause) \
    macro(pendingAbortRequest) \
    macro(pendingPullIntos) \
    macro(pid) \
    macro(pipe) \
    macro(port) \
    macro(post) \
    macro(ppid) \
    macro(prependEventListener) \
    macro(process) \
    macro(processBindingConstants) \
    macro(protocol) \
    macro(pull) \
    macro(pullAgain) \
    macro(pullAlgorithm) \
    macro(pulling) \
    macro(put) \
    macro(queue) \
    macro(read) \
    macro(readable) \
    macro(ReadableByteStreamController) \
    macro(ReadableStream) \
    macro(ReadableStreamBYOBReader) \
    macro(ReadableStreamBYOBRequest) \
    macro(readableStreamController) \
    macro(ReadableStreamDefaultController) \
    macro(ReadableStreamDefaultReader) \
    macro(readableStreamToArray) \
    macro(reader) \
    macro(readIntoRequests) \
    macro(readRequests) \
    macro(readyPromise) \
    macro(readyPromiseCapability) \
    macro(redirect) \
    macro(relative) \
    macro(releaseLock) \
    macro(removeAbortAlgorithmFromSignal) \
    macro(removeEventListener) \
    macro(require) \
    macro(requireESM) \
    macro(requireMap) \
    macro(requireNativeModule) \
    macro(resolveSync) \
    macro(resume) \
    macro(self) \
    macro(sep) \
    macro(setBody) \
    macro(setStatus) \
    macro(setup) \
    macro(sink) \
    macro(size) \
    macro(start) \
    macro(startAlgorithm) \
    macro(startConsumingStream) \
    macro(startDirectStream) \
    macro(started) \
    macro(startedPromise) \
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
    macro(TextEncoderStreamEncoder) \
    macro(textEncoderStreamTransform) \
    macro(toClass) \
    macro(toNamespacedPath) \
    macro(trace) \
    macro(transformAlgorithm) \
    macro(TransformStream) \
    macro(TransformStreamDefaultController) \
    macro(uncork) \
    macro(underlyingByteSource) \
    macro(underlyingSink) \
    macro(underlyingSource) \
    macro(unpipe) \
    macro(unshift) \
    macro(url) \
    macro(username) \
    macro(version) \
    macro(versions) \
    macro(view) \
    macro(warning) \
    macro(writable) \
    macro(WritableStream) \
    macro(WritableStreamDefaultController) \
    macro(WritableStreamDefaultWriter) \
    macro(write) \
    macro(writeAlgorithm) \
    macro(writer) \
    macro(writeRequests) \
    macro(writing) \
    macro(written) \
    macro(napiDlopenHandle) \
    macro(napiWrappedContents) \
    BUN_ADDITIONAL_BUILTIN_NAMES(macro)
// --- END of BUN_COMMON_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME ---

class BunBuiltinNames {
public:
    // FIXME: Remove the __attribute__((nodebug)) when <rdar://68246686> is fixed.
#if COMPILER(CLANG)
    __attribute__((nodebug))
#endif
    explicit BunBuiltinNames(JSC::VM& vm)
        : m_vm(vm)
        BUN_COMMON_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME(INITIALIZE_BUILTIN_NAMES)
    {
#define EXPORT_NAME(name) m_vm.propertyNames->appendExternalName(name##PublicName(), name##PrivateName());
        BUN_COMMON_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME(EXPORT_NAME)
#undef EXPORT_NAME
    }

    BUN_COMMON_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME(DECLARE_BUILTIN_IDENTIFIER_ACCESSOR)

    const JSC::Identifier& resolvePublicName() const { return m_vm.propertyNames->resolve;}

private:
    JSC::VM& m_vm;
    BUN_COMMON_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME(DECLARE_BUILTIN_NAMES)
};

} // namespace WebCore

#ifdef ORIGINAL_ASSERT_ENABLED
#undef ASSERT_ENABLED
#define ASSERT_ENABLED 1
#undef ORIGINAL_ASSERT_ENABLED
#endif
