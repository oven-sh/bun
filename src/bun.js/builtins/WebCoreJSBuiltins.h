#pragma once
namespace Zig {
class GlobalObject;
}
#include "BundlerPluginBuiltins.h"
#include "ByteLengthQueuingStrategyBuiltins.h"
#include "WritableStreamInternalsBuiltins.h"
#include "TransformStreamInternalsBuiltins.h"
#include "ProcessObjectInternalsBuiltins.h"
#include "TransformStreamBuiltins.h"
#include "JSBufferPrototypeBuiltins.h"
#include "ReadableByteStreamControllerBuiltins.h"
#include "ConsoleObjectBuiltins.h"
#include "ReadableStreamInternalsBuiltins.h"
#include "TransformStreamDefaultControllerBuiltins.h"
#include "ReadableStreamBYOBReaderBuiltins.h"
#include "JSBufferConstructorBuiltins.h"
#include "ReadableStreamDefaultReaderBuiltins.h"
#include "StreamInternalsBuiltins.h"
#include "ImportMetaObjectBuiltins.h"
#include "CountQueuingStrategyBuiltins.h"
#include "ReadableStreamBYOBRequestBuiltins.h"
#include "WritableStreamDefaultWriterBuiltins.h"
#include "ReadableStreamBuiltins.h"
#include "ReadableStreamDefaultControllerBuiltins.h"
#include "ReadableByteStreamInternalsBuiltins.h"
#include "WritableStreamDefaultControllerBuiltins.h"

#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/WeakInlines.h>

namespace WebCore {

class JSBuiltinFunctions {
public:
    explicit JSBuiltinFunctions(JSC::VM& vm)
        : m_vm(vm)
        , m_bundlerPluginBuiltins(m_vm)
        , m_byteLengthQueuingStrategyBuiltins(m_vm)
        , m_writableStreamInternalsBuiltins(m_vm)
        , m_transformStreamInternalsBuiltins(m_vm)
        , m_processObjectInternalsBuiltins(m_vm)
        , m_transformStreamBuiltins(m_vm)
        , m_jsBufferPrototypeBuiltins(m_vm)
        , m_readableByteStreamControllerBuiltins(m_vm)
        , m_consoleObjectBuiltins(m_vm)
        , m_readableStreamInternalsBuiltins(m_vm)
        , m_transformStreamDefaultControllerBuiltins(m_vm)
        , m_readableStreamBYOBReaderBuiltins(m_vm)
        , m_jsBufferConstructorBuiltins(m_vm)
        , m_readableStreamDefaultReaderBuiltins(m_vm)
        , m_streamInternalsBuiltins(m_vm)
        , m_importMetaObjectBuiltins(m_vm)
        , m_countQueuingStrategyBuiltins(m_vm)
        , m_readableStreamBYOBRequestBuiltins(m_vm)
        , m_writableStreamDefaultWriterBuiltins(m_vm)
        , m_readableStreamBuiltins(m_vm)
        , m_readableStreamDefaultControllerBuiltins(m_vm)
        , m_readableByteStreamInternalsBuiltins(m_vm)
        , m_writableStreamDefaultControllerBuiltins(m_vm)

    {
        m_writableStreamInternalsBuiltins.exportNames();
        m_transformStreamInternalsBuiltins.exportNames();
        m_readableStreamInternalsBuiltins.exportNames();
        m_streamInternalsBuiltins.exportNames();
        m_readableByteStreamInternalsBuiltins.exportNames();
    }
    BundlerPluginBuiltinsWrapper& bundlerPluginBuiltins() { return m_bundlerPluginBuiltins; }
    ByteLengthQueuingStrategyBuiltinsWrapper& byteLengthQueuingStrategyBuiltins() { return m_byteLengthQueuingStrategyBuiltins; }
    WritableStreamInternalsBuiltinsWrapper& writableStreamInternalsBuiltins() { return m_writableStreamInternalsBuiltins; }
    TransformStreamInternalsBuiltinsWrapper& transformStreamInternalsBuiltins() { return m_transformStreamInternalsBuiltins; }
    ProcessObjectInternalsBuiltinsWrapper& processObjectInternalsBuiltins() { return m_processObjectInternalsBuiltins; }
    TransformStreamBuiltinsWrapper& transformStreamBuiltins() { return m_transformStreamBuiltins; }
    JSBufferPrototypeBuiltinsWrapper& jsBufferPrototypeBuiltins() { return m_jsBufferPrototypeBuiltins; }
    ReadableByteStreamControllerBuiltinsWrapper& readableByteStreamControllerBuiltins() { return m_readableByteStreamControllerBuiltins; }
    ConsoleObjectBuiltinsWrapper& consoleObjectBuiltins() { return m_consoleObjectBuiltins; }
    ReadableStreamInternalsBuiltinsWrapper& readableStreamInternalsBuiltins() { return m_readableStreamInternalsBuiltins; }
    TransformStreamDefaultControllerBuiltinsWrapper& transformStreamDefaultControllerBuiltins() { return m_transformStreamDefaultControllerBuiltins; }
    ReadableStreamBYOBReaderBuiltinsWrapper& readableStreamBYOBReaderBuiltins() { return m_readableStreamBYOBReaderBuiltins; }
    JSBufferConstructorBuiltinsWrapper& jsBufferConstructorBuiltins() { return m_jsBufferConstructorBuiltins; }
    ReadableStreamDefaultReaderBuiltinsWrapper& readableStreamDefaultReaderBuiltins() { return m_readableStreamDefaultReaderBuiltins; }
    StreamInternalsBuiltinsWrapper& streamInternalsBuiltins() { return m_streamInternalsBuiltins; }
    ImportMetaObjectBuiltinsWrapper& importMetaObjectBuiltins() { return m_importMetaObjectBuiltins; }
    CountQueuingStrategyBuiltinsWrapper& countQueuingStrategyBuiltins() { return m_countQueuingStrategyBuiltins; }
    ReadableStreamBYOBRequestBuiltinsWrapper& readableStreamBYOBRequestBuiltins() { return m_readableStreamBYOBRequestBuiltins; }
    WritableStreamDefaultWriterBuiltinsWrapper& writableStreamDefaultWriterBuiltins() { return m_writableStreamDefaultWriterBuiltins; }
    ReadableStreamBuiltinsWrapper& readableStreamBuiltins() { return m_readableStreamBuiltins; }
    ReadableStreamDefaultControllerBuiltinsWrapper& readableStreamDefaultControllerBuiltins() { return m_readableStreamDefaultControllerBuiltins; }
    ReadableByteStreamInternalsBuiltinsWrapper& readableByteStreamInternalsBuiltins() { return m_readableByteStreamInternalsBuiltins; }
    WritableStreamDefaultControllerBuiltinsWrapper& writableStreamDefaultControllerBuiltins() { return m_writableStreamDefaultControllerBuiltins; }

private:
    JSC::VM& m_vm;
    BundlerPluginBuiltinsWrapper m_bundlerPluginBuiltins;
    ByteLengthQueuingStrategyBuiltinsWrapper m_byteLengthQueuingStrategyBuiltins;
    WritableStreamInternalsBuiltinsWrapper m_writableStreamInternalsBuiltins;
    TransformStreamInternalsBuiltinsWrapper m_transformStreamInternalsBuiltins;
    ProcessObjectInternalsBuiltinsWrapper m_processObjectInternalsBuiltins;
    TransformStreamBuiltinsWrapper m_transformStreamBuiltins;
    JSBufferPrototypeBuiltinsWrapper m_jsBufferPrototypeBuiltins;
    ReadableByteStreamControllerBuiltinsWrapper m_readableByteStreamControllerBuiltins;
    ConsoleObjectBuiltinsWrapper m_consoleObjectBuiltins;
    ReadableStreamInternalsBuiltinsWrapper m_readableStreamInternalsBuiltins;
    TransformStreamDefaultControllerBuiltinsWrapper m_transformStreamDefaultControllerBuiltins;
    ReadableStreamBYOBReaderBuiltinsWrapper m_readableStreamBYOBReaderBuiltins;
    JSBufferConstructorBuiltinsWrapper m_jsBufferConstructorBuiltins;
    ReadableStreamDefaultReaderBuiltinsWrapper m_readableStreamDefaultReaderBuiltins;
    StreamInternalsBuiltinsWrapper m_streamInternalsBuiltins;
    ImportMetaObjectBuiltinsWrapper m_importMetaObjectBuiltins;
    CountQueuingStrategyBuiltinsWrapper m_countQueuingStrategyBuiltins;
    ReadableStreamBYOBRequestBuiltinsWrapper m_readableStreamBYOBRequestBuiltins;
    WritableStreamDefaultWriterBuiltinsWrapper m_writableStreamDefaultWriterBuiltins;
    ReadableStreamBuiltinsWrapper m_readableStreamBuiltins;
    ReadableStreamDefaultControllerBuiltinsWrapper m_readableStreamDefaultControllerBuiltins;
    ReadableByteStreamInternalsBuiltinsWrapper m_readableByteStreamInternalsBuiltins;
    WritableStreamDefaultControllerBuiltinsWrapper m_writableStreamDefaultControllerBuiltins;
;
};

class JSBuiltinInternalFunctions {
public:
    explicit JSBuiltinInternalFunctions(JSC::VM&);

    template<typename Visitor> void visit(Visitor&);
    void initialize(Zig::GlobalObject&);
    WritableStreamInternalsBuiltinFunctions& writableStreamInternals() { return m_writableStreamInternals; }
    TransformStreamInternalsBuiltinFunctions& transformStreamInternals() { return m_transformStreamInternals; }
    ReadableStreamInternalsBuiltinFunctions& readableStreamInternals() { return m_readableStreamInternals; }
    StreamInternalsBuiltinFunctions& streamInternals() { return m_streamInternals; }
    ReadableByteStreamInternalsBuiltinFunctions& readableByteStreamInternals() { return m_readableByteStreamInternals; }

private:
    JSC::VM& m_vm;
    WritableStreamInternalsBuiltinFunctions m_writableStreamInternals;
    TransformStreamInternalsBuiltinFunctions m_transformStreamInternals;
    ReadableStreamInternalsBuiltinFunctions m_readableStreamInternals;
    StreamInternalsBuiltinFunctions m_streamInternals;
    ReadableByteStreamInternalsBuiltinFunctions m_readableByteStreamInternals;

};

} // namespace WebCore
