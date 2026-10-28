// Testing-only JS binding for the kernels in highway_jpeg.cpp, in its own TU so that those stay free of JSC/WebKit headers
// (as in highway_strings_testing.cpp).

#include "root.h"

#include "highway_jpeg_testing.h"

#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSArrayBufferView.h>
#include <JavaScriptCore/JSCJSValue.h>
#include <JavaScriptCore/JSCast.h>

extern "C" bool highway_jpeg_from_ycc(const uint8_t* y, const uint8_t* cb, const uint8_t* cr, const uint8_t* k, uint8_t* out, size_t n);
extern "C" bool highway_jpeg_to_ycc(const uint8_t* rgba, uint8_t* y, uint8_t* cb, uint8_t* cr, size_t n);
extern "C" bool highway_jpeg_h2v2_downsample(const uint8_t* row0, const uint8_t* row1, uint8_t* out, size_t n);
extern "C" bool highway_jpeg_h2v1_fancy(const uint8_t* in, uint8_t* out, size_t n);
extern "C" bool highway_jpeg_h2v2_fancy(const uint8_t* near_row, const uint8_t* far_row, uint8_t* out, size_t n);

namespace Bun {

// `rows` are the pointers of the kernel in its order, each with at least the bytes that the kernel reads or writes there
// for `n`. Returns what the kernel returns.
BUN_DEFINE_HOST_FUNCTION(Bun__highwayJpegForTesting, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto op = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    size_t n = callFrame->argument(1).toUInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // The row that is argument `index`, which has `n * bytesPerSample` bytes. Null after a throw, or for no row.
    auto row = [&](unsigned index, size_t bytesPerSample, bool optional = false) -> uint8_t* {
        if (scope.exception()) return nullptr;
        JSC::JSValue value = callFrame->argument(2 + index);
        if (optional && value.isUndefinedOrNull()) return nullptr;
        auto* view = dynamicDowncast<JSC::JSArrayBufferView>(value);
        if (!view || view->isDetached() || view->byteLength() < n * bytesPerSample) {
            throwTypeError(globalObject, scope, "each row must be an attached ArrayBufferView that is long enough"_s);
            return nullptr;
        }
        return static_cast<uint8_t*>(view->vector());
    };

    bool result;
    if (op == "fromYcc"_s) {
        uint8_t *y = row(0, 1), *cb = row(1, 1), *cr = row(2, 1), *k = row(3, 1, true), *out = row(4, 4);
        RETURN_IF_EXCEPTION(scope, {});
        result = highway_jpeg_from_ycc(y, cb, cr, k, out, n);
    } else if (op == "toYcc"_s) {
        uint8_t *rgba = row(0, 4), *y = row(1, 1), *cb = row(2, 1), *cr = row(3, 1);
        RETURN_IF_EXCEPTION(scope, {});
        result = highway_jpeg_to_ycc(rgba, y, cb, cr, n);
    } else if (op == "h2v2Downsample"_s) {
        uint8_t *row0 = row(0, 2), *row1 = row(1, 2), *out = row(2, 1);
        RETURN_IF_EXCEPTION(scope, {});
        result = highway_jpeg_h2v2_downsample(row0, row1, out, n);
    } else if (op == "h2v1Fancy"_s) {
        uint8_t *in = row(0, 1), *out = row(1, 2);
        RETURN_IF_EXCEPTION(scope, {});
        result = highway_jpeg_h2v1_fancy(in, out, n);
    } else if (op == "h2v2Fancy"_s) {
        uint8_t *nearRow = row(0, 1), *farRow = row(1, 1), *out = row(2, 2);
        RETURN_IF_EXCEPTION(scope, {});
        result = highway_jpeg_h2v2_fancy(nearRow, farRow, out, n);
    } else {
        throwTypeError(globalObject, scope, "unknown op"_s);
        return {};
    }
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::jsBoolean(result)));
}

} // namespace Bun
