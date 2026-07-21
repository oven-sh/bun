// StreamsForward.h — forward declarations + the shared scoped enums for the Web Streams C++
// implementation. Class headers include THIS file instead of each other so there are no
// include cycles: it contains NO class definitions and NO function declarations (those live
// in WebStreamsInternals.h) and is safe to include from anywhere.
//
// Namespaces:
//   - JS cell classes live in `namespace WebCore` (required by the reused registration
//     plumbing: WEBCORE_GENERATED_CONSTRUCTOR_GETTER expands to `WebCore::JS<Name>`).
//   - enums / structs / free abstract ops live in `namespace Bun::WebStreams`.
#pragma once

#include <cstdint>

namespace JSC {
class JSGlobalObject;
class VM;
class CallFrame;
class JSCell;
class JSObject;
class JSValue;
class JSPromise;
class JSArrayBuffer;
class JSArrayBufferView;
class JSFunction;
class Structure;
class InternalFieldTuple;
}

namespace Zig {
class GlobalObject;
}

namespace WebCore {

class AbortSignal;
// NOTE: JSDOMGlobalObject is deliberately NOT forward-declared here. In Bun it is not a
// class but a type alias (`using JSDOMGlobalObject = Zig::GlobalObject;` in
// ZigGlobalObject.h), so `class JSDOMGlobalObject;` is a typedef-redefinition error.
// Any header that names it must `#include "JSDOMGlobalObject.h"` (they all already do).

// The public (globalThis-exposed) classes.
class JSReadableStream;
class JSReadableStreamDefaultReader;
class JSReadableStreamBYOBReader;
class JSReadableStreamDefaultController;
class JSReadableByteStreamController;
class JSReadableStreamBYOBRequest;
class JSWritableStream;
class JSWritableStreamDefaultWriter;
class JSWritableStreamDefaultController;
class JSTransformStream;
class JSTransformStreamDefaultController;
class JSByteLengthQueuingStrategy;
class JSCountQueuingStrategy;
class JSReadableStreamAsyncIterator;

// The shared, NON-polymorphic reader base (the ReadableStreamGenericReader mixin).
class JSReadableStreamReaderBase;

// Internal (non-exposed) cells.
class JSReadRequest;
class JSReadIntoRequest;
class JSPullIntoDescriptor;
class JSStreamPipeToOperation;
class JSStreamTeeState;
class JSCrossRealmTransformState;
class JSStreamFromIterableContext;
class JSStreamsRuntime;

// The Bun-native layer cells & classes.
class JSDirectStreamController;
class JSBunStandaloneTextSink; // the standalone Text sink (BunStandaloneTextSink.h)
class JSOneShotDirectSink; // consumeDirectStreamToArrayBuffer's throwaway controller
class JSReadableStreamIntoArrayOperation; // the array pump's reader/chunks/result state
class JSNativeStreamSourceAdapter;
class JSDirectSinkCloseState;
class JSAsyncIteratorSourceOperation;
class JSReadStreamIntoSinkOperation;
class JSResumableSinkPumpOperation;
class JSTextEncoderStream;
class JSTextDecoderStream;

} // namespace WebCore

namespace Bun {
namespace WebStreams {

// [[state]] machines

// ReadableStream.[[state]]: "readable" | "closed" | "errored"
enum class ReadableStreamState : uint8_t {
    Readable,
    Closed,
    Errored,
};

// WritableStream.[[state]]: "writable" | "erroring" | "errored" | "closed"
enum class WritableStreamState : uint8_t {
    Writable,
    Erroring,
    Errored,
    Closed,
};

// Algorithm kind tags. SourceKind::Direct deliberately DOES NOT EXIST: a Bun `type:"direct"`
// stream is a JSDirectStreamController (ControllerKind::Direct), never a spec controller.

// Which arm runs a readable controller's pull/cancel/start algorithms. No closures are stored.
enum class SourceKind : uint8_t {
    JavaScript, // new ReadableStream({...}) — user underlyingSource (underlyingObject + methods)
    Nothing, // new ReadableStream() with no source, or an already-drained native stream
    Transform, // the readable half of a TransformStream (context = the JSTransformStream)
    TeeBranch, // a ReadableStreamDefaultTee branch      (context = the JSStreamTeeState)
    ByteTeeBranch, // a ReadableByteStreamTee branch     (context = the JSStreamTeeState)
    FromIterable, // ReadableStream.from(asyncIterable)  (context = JSStreamFromIterableContext)
    CrossRealm, // receiving end of a postMessage transfer (context = JSCrossRealmTransformState)
    Native, // Bun: lazily-materialized native source on a BYTE controller
            // (context = JSNativeStreamSourceAdapter)
};

// Which arm runs a writable controller's write/close/abort algorithms.
// The Bun JSSink layer never uses a WritableStream, so it adds no arm.
enum class SinkKind : uint8_t {
    JavaScript, // user underlyingSink
    Nothing, // new WritableStream() with no sink
    Transform, // the writable half of a TransformStream (context = the JSTransformStream)
    CrossRealm, // SetUpCrossRealmTransformWritable (context = JSCrossRealmTransformState)
};

// Which arm runs a transform controller's transform/flush/cancel algorithms.
enum class TransformerKind : uint8_t {
    JavaScript, // user transformer
    Identity, // new TransformStream() with no `transform` member: enqueue the chunk unchanged
    TextEncoder, // TextEncoderStream (context = the JSTextEncoderStream cell)
    TextDecoder, // TextDecoderStream (context = the JSTextDecoderStream cell)
};

// JSReadableStream Bun-mode members

// Replaces the `$start` thunk. Tells materializeIfNeeded() what to do.
enum class BunStreamMode : uint8_t {
    Default, // an ordinary spec stream (controller may still be None)
    DirectPending, // type:"direct", not yet consumed
    NativePending, // $lazy native stream, not yet consumed
};

// The tag for JSReadableStream::m_controller — the subsystem's ONE erased back-pointer.
// Every switch over this enum is TOTAL.
enum class ControllerKind : uint8_t {
    None, // no controller installed (unmaterialized / drained)
    Default, // JSReadableStreamDefaultController
    Byte, // JSReadableByteStreamController
    Direct, // JSDirectStreamController (Bun `type:"direct"`, JS-consumption path)
    NativeSink, // a generated JSReadable*Controller JSSink cell (Bun native-sink path)
};

// Readers & read requests

// Pull-into descriptor / release bookkeeping "reader type": "default" / "byob" / "none".
enum class ReaderType : uint8_t {
    Default,
    Byob,
    None,
};

// JSReadRequest::m_kind — ONE concrete cell, a kind tag, no C++ virtuals. readMany() uses
// the Promise kind; the Bun native-sink pumps each have a dedicated kind so their per-chunk
// path allocates no Promise / iterator-result object.
enum class ReadRequestKind : uint8_t {
    Promise, // public reader.read(): context = the JSPromise it resolves
    PipeTo, // context = the JSStreamPipeToOperation
    DefaultTee, // context = the JSStreamTeeState
    ByteTee, // context = the JSStreamTeeState (byte tee's default-reader read request)
    AsyncIterator, // context = InternalFieldTuple{asyncIterator, the next() result promise}
    ReadStreamIntoSink, // Bun: readStreamIntoSink pump read (context = JSReadStreamIntoSinkOperation)
    ResumableSinkPump, // Bun: ResumableSink pump read (context = JSResumableSinkPumpOperation)
};

// JSReadIntoRequest::m_kind (the BYOB parallel of ReadRequestKind).
enum class ReadIntoRequestKind : uint8_t {
    Promise, // public byobReader.read(view): context = the JSPromise
    ByteTee, // the byte tee's BYOB read-into request: context = the JSStreamTeeState
};

// Bun `type:"direct"`

// The 3 direct sink flavors carried by ONE JSDirectStreamController.
enum class DirectSinkKind : uint8_t {
    ArrayBuffer, // a real Bun.ArrayBufferSink
    Text, // the rope + pieces accumulator
    Array, // chunks pushed into a JSArray
};

// WebIDL enums & small closed sets

// WebIDL `enum ReadableStreamType { "bytes" }`; an unknown string throws TypeError during
// dictionary conversion.
enum class ReadableStreamType : uint8_t { Bytes };

// WebIDL `enum ReadableStreamReaderMode { "byob" }` (getReader(options).mode)
enum class ReadableStreamReaderMode : uint8_t { Byob };

// Cross-realm transform protocol message `type`: "chunk" | "pull" | "error" | "close".
enum class CrossRealmMessageType : uint8_t { Chunk,
    Pull,
    Error,
    Close };

} // namespace WebStreams
} // namespace Bun

// The class headers (namespace WebCore) use the enum names unqualified. Import EXACTLY the
// streams enums into WebCore — never `using namespace Bun::WebStreams` in a header.
namespace WebCore {
using Bun::WebStreams::BunStreamMode;
using Bun::WebStreams::ControllerKind;
using Bun::WebStreams::CrossRealmMessageType;
using Bun::WebStreams::DirectSinkKind;
using Bun::WebStreams::ReadableStreamReaderMode;
using Bun::WebStreams::ReadableStreamState;
using Bun::WebStreams::ReadableStreamType;
using Bun::WebStreams::ReaderType;
using Bun::WebStreams::ReadIntoRequestKind;
using Bun::WebStreams::ReadRequestKind;
using Bun::WebStreams::SinkKind;
using Bun::WebStreams::SourceKind;
using Bun::WebStreams::TransformerKind;
using Bun::WebStreams::WritableStreamState;
} // namespace WebCore
