#pragma once

#include "BundlerPluginBuiltins.h"
#include "ByteLengthQueuingStrategyBuiltins.h"
#include "ConsoleObjectBuiltins.h"
#include "CountQueuingStrategyBuiltins.h"
#include "ImportMetaObjectBuiltins.h"
#include "JSBufferConstructorBuiltins.h"
#include "JSBufferPrototypeBuiltins.h"
#include "ProcessObjectInternalsBuiltins.h"
#include "ReadableByteStreamControllerBuiltins.h"
#include "ReadableByteStreamInternalsBuiltins.h"
#include "ReadableStreamBuiltins.h"
#include "ReadableStreamBYOBReaderBuiltins.h"
#include "ReadableStreamBYOBRequestBuiltins.h"
#include "ReadableStreamDefaultControllerBuiltins.h"
#include "ReadableStreamDefaultReaderBuiltins.h"
#include "ReadableStreamInternalsBuiltins.h"
#include "StreamInternalsBuiltins.h"
#include "TransformStreamBuiltins.h"
#include "TransformStreamDefaultControllerBuiltins.h"
#include "TransformStreamInternalsBuiltins.h"
#include "WritableStreamDefaultControllerBuiltins.h"
#include "WritableStreamDefaultWriterBuiltins.h"
#include "WritableStreamInternalsBuiltins.h"

#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/WeakInlines.h>

namespace WebCore {

class JSBuiltinFunctions {
public:
    explicit JSBuiltinFunctions(JSC::VM& vm)
        : m_vm(vm)
        , m_bundlerPluginBuiltins(m_vm)
        , m_byteLengthQueuingStrategyBuiltins(m_vm)
        , m_consoleObjectBuiltins(m_vm)
        , m_countQueuingStrategyBuiltins(m_vm)
        , m_importMetaObjectBuiltins(m_vm)
        , m_jsBufferConstructorBuiltins(m_vm)
        , m_jsBufferPrototypeBuiltins(m_vm)
        , m_processObjectInternalsBuiltins(m_vm)
        , m_readableByteStreamControllerBuiltins(m_vm)
        , m_readableByteStreamInternalsBuiltins(m_vm)
        , m_readableStreamBuiltins(m_vm)
        , m_readableStreamBYOBReaderBuiltins(m_vm)
        , m_readableStreamBYOBRequestBuiltins(m_vm)
        , m_readableStreamDefaultControllerBuiltins(m_vm)
        , m_readableStreamDefaultReaderBuiltins(m_vm)
        , m_readableStreamInternalsBuiltins(m_vm)
        , m_streamInternalsBuiltins(m_vm)
        , m_transformStreamBuiltins(m_vm)
        , m_transformStreamDefaultControllerBuiltins(m_vm)
        , m_transformStreamInternalsBuiltins(m_vm)
        , m_writableStreamDefaultControllerBuiltins(m_vm)
        , m_writableStreamDefaultWriterBuiltins(m_vm)
        , m_writableStreamInternalsBuiltins(m_vm)

    {
        m_readableByteStreamInternalsBuiltins.exportNames();
        m_readableStreamInternalsBuiltins.exportNames();
        m_streamInternalsBuiltins.exportNames();
        m_transformStreamInternalsBuiltins.exportNames();
        m_writableStreamInternalsBuiltins.exportNames();
    }
    BundlerPluginBuiltinsWrapper& bundlerPluginBuiltins() { return m_bundlerPluginBuiltins; }
    ByteLengthQueuingStrategyBuiltinsWrapper& byteLengthQueuingStrategyBuiltins() { return m_byteLengthQueuingStrategyBuiltins; }
    ConsoleObjectBuiltinsWrapper& consoleObjectBuiltins() { return m_consoleObjectBuiltins; }
    CountQueuingStrategyBuiltinsWrapper& countQueuingStrategyBuiltins() { return m_countQueuingStrategyBuiltins; }
    ImportMetaObjectBuiltinsWrapper& importMetaObjectBuiltins() { return m_importMetaObjectBuiltins; }
    JSBufferConstructorBuiltinsWrapper& jsBufferConstructorBuiltins() { return m_jsBufferConstructorBuiltins; }
    JSBufferPrototypeBuiltinsWrapper& jsBufferPrototypeBuiltins() { return m_jsBufferPrototypeBuiltins; }
    ProcessObjectInternalsBuiltinsWrapper& processObjectInternalsBuiltins() { return m_processObjectInternalsBuiltins; }
    ReadableByteStreamControllerBuiltinsWrapper& readableByteStreamControllerBuiltins() { return m_readableByteStreamControllerBuiltins; }
    ReadableByteStreamInternalsBuiltinsWrapper& readableByteStreamInternalsBuiltins() { return m_readableByteStreamInternalsBuiltins; }
    ReadableStreamBuiltinsWrapper& readableStreamBuiltins() { return m_readableStreamBuiltins; }
    ReadableStreamBYOBReaderBuiltinsWrapper& readableStreamBYOBReaderBuiltins() { return m_readableStreamBYOBReaderBuiltins; }
    ReadableStreamBYOBRequestBuiltinsWrapper& readableStreamBYOBRequestBuiltins() { return m_readableStreamBYOBRequestBuiltins; }
    ReadableStreamDefaultControllerBuiltinsWrapper& readableStreamDefaultControllerBuiltins() { return m_readableStreamDefaultControllerBuiltins; }
    ReadableStreamDefaultReaderBuiltinsWrapper& readableStreamDefaultReaderBuiltins() { return m_readableStreamDefaultReaderBuiltins; }
    ReadableStreamInternalsBuiltinsWrapper& readableStreamInternalsBuiltins() { return m_readableStreamInternalsBuiltins; }
    StreamInternalsBuiltinsWrapper& streamInternalsBuiltins() { return m_streamInternalsBuiltins; }
    TransformStreamBuiltinsWrapper& transformStreamBuiltins() { return m_transformStreamBuiltins; }
    TransformStreamDefaultControllerBuiltinsWrapper& transformStreamDefaultControllerBuiltins() { return m_transformStreamDefaultControllerBuiltins; }
    TransformStreamInternalsBuiltinsWrapper& transformStreamInternalsBuiltins() { return m_transformStreamInternalsBuiltins; }
    WritableStreamDefaultControllerBuiltinsWrapper& writableStreamDefaultControllerBuiltins() { return m_writableStreamDefaultControllerBuiltins; }
    WritableStreamDefaultWriterBuiltinsWrapper& writableStreamDefaultWriterBuiltins() { return m_writableStreamDefaultWriterBuiltins; }
    WritableStreamInternalsBuiltinsWrapper& writableStreamInternalsBuiltins() { return m_writableStreamInternalsBuiltins; }

private:
    JSC::VM& m_vm;
    BundlerPluginBuiltinsWrapper m_bundlerPluginBuiltins;
    ByteLengthQueuingStrategyBuiltinsWrapper m_byteLengthQueuingStrategyBuiltins;
    ConsoleObjectBuiltinsWrapper m_consoleObjectBuiltins;
    CountQueuingStrategyBuiltinsWrapper m_countQueuingStrategyBuiltins;
    ImportMetaObjectBuiltinsWrapper m_importMetaObjectBuiltins;
    JSBufferConstructorBuiltinsWrapper m_jsBufferConstructorBuiltins;
    JSBufferPrototypeBuiltinsWrapper m_jsBufferPrototypeBuiltins;
    ProcessObjectInternalsBuiltinsWrapper m_processObjectInternalsBuiltins;
    ReadableByteStreamControllerBuiltinsWrapper m_readableByteStreamControllerBuiltins;
    ReadableByteStreamInternalsBuiltinsWrapper m_readableByteStreamInternalsBuiltins;
    ReadableStreamBuiltinsWrapper m_readableStreamBuiltins;
    ReadableStreamBYOBReaderBuiltinsWrapper m_readableStreamBYOBReaderBuiltins;
    ReadableStreamBYOBRequestBuiltinsWrapper m_readableStreamBYOBRequestBuiltins;
    ReadableStreamDefaultControllerBuiltinsWrapper m_readableStreamDefaultControllerBuiltins;
    ReadableStreamDefaultReaderBuiltinsWrapper m_readableStreamDefaultReaderBuiltins;
    ReadableStreamInternalsBuiltinsWrapper m_readableStreamInternalsBuiltins;
    StreamInternalsBuiltinsWrapper m_streamInternalsBuiltins;
    TransformStreamBuiltinsWrapper m_transformStreamBuiltins;
    TransformStreamDefaultControllerBuiltinsWrapper m_transformStreamDefaultControllerBuiltins;
    TransformStreamInternalsBuiltinsWrapper m_transformStreamInternalsBuiltins;
    WritableStreamDefaultControllerBuiltinsWrapper m_writableStreamDefaultControllerBuiltins;
    WritableStreamDefaultWriterBuiltinsWrapper m_writableStreamDefaultWriterBuiltins;
    WritableStreamInternalsBuiltinsWrapper m_writableStreamInternalsBuiltins;
;
};

using JSDOMGlobalObject = Zig::GlobalObject;

class JSBuiltinInternalFunctions {
public:
    explicit JSBuiltinInternalFunctions(JSC::VM&);

    template<typename Visitor> void visit(Visitor&);
    void initialize(JSDOMGlobalObject&);
    ReadableByteStreamInternalsBuiltinFunctions& readableByteStreamInternals() { return m_readableByteStreamInternals; }
    ReadableStreamInternalsBuiltinFunctions& readableStreamInternals() { return m_readableStreamInternals; }
    StreamInternalsBuiltinFunctions& streamInternals() { return m_streamInternals; }
    TransformStreamInternalsBuiltinFunctions& transformStreamInternals() { return m_transformStreamInternals; }
    WritableStreamInternalsBuiltinFunctions& writableStreamInternals() { return m_writableStreamInternals; }

private:
    JSC::VM& m_vm;
    ReadableByteStreamInternalsBuiltinFunctions m_readableByteStreamInternals;
    ReadableStreamInternalsBuiltinFunctions m_readableStreamInternals;
    StreamInternalsBuiltinFunctions m_streamInternals;
    TransformStreamInternalsBuiltinFunctions m_transformStreamInternals;
    WritableStreamInternalsBuiltinFunctions m_writableStreamInternals;

};

} // namespace WebCore
