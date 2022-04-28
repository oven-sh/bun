#pragma once

namespace WebCore {

class ExtendedDOMClientIsoSubspaces;
class ExtendedDOMIsoSubspaces;

class DOMWrapperWorld;
}

#include "root.h"
#include "JSBufferPrototypeBuiltins.h"

namespace WebCore {

class JSBuiltinFunctions {
public:
    explicit JSBuiltinFunctions(JSC::VM& vm)
        : m_vm(vm)
        , m_jsBufferPrototypeBuiltins(m_vm)
    // , m_byteLengthQueuingStrategyBuiltins(m_vm)
    // , m_countQueuingStrategyBuiltins(m_vm)
    // , m_readableByteStreamControllerBuiltins(m_vm)
    // , m_readableByteStreamInternalsBuiltins(m_vm)
    // , m_readableStreamBuiltins(m_vm)
    // , m_readableStreamBYOBReaderBuiltins(m_vm)
    // , m_readableStreamBYOBRequestBuiltins(m_vm)
    // , m_readableStreamDefaultControllerBuiltins(m_vm)
    // , m_readableStreamDefaultReaderBuiltins(m_vm)
    // , m_readableStreamInternalsBuiltins(m_vm)
    // , m_streamInternalsBuiltins(m_vm)
    // , m_transformStreamBuiltins(m_vm)
    // , m_transformStreamDefaultControllerBuiltins(m_vm)
    // , m_transformStreamInternalsBuiltins(m_vm)
    // , m_writableStreamDefaultControllerBuiltins(m_vm)
    // , m_writableStreamDefaultWriterBuiltins(m_vm)
    // , m_writableStreamInternalsBuiltins(m_vm)
    // , m_jsDOMBindingInternalsBuiltins(m_vm)
    // , m_textDecoderStreamBuiltins(m_vm)
    // , m_textEncoderStreamBuiltins(m_vm)
    {
        // m_jsBufferPrototypeBuiltins.exportNames();

        // m_readableByteStreamInternalsBuiltins.exportNames();
        // m_readableStreamInternalsBuiltins.exportNames();
        // m_streamInternalsBuiltins.exportNames();
        // m_transformStreamInternalsBuiltins.exportNames();
        // m_writableStreamInternalsBuiltins.exportNames();
        // m_jsDOMBindingInternalsBuiltins.exportNames();
    }

    // ByteLengthQueuingStrategyBuiltinsWrapper& byteLengthQueuingStrategyBuiltins() { return m_byteLengthQueuingStrategyBuiltins; }
    // CountQueuingStrategyBuiltinsWrapper& countQueuingStrategyBuiltins() { return m_countQueuingStrategyBuiltins; }
    // ReadableByteStreamControllerBuiltinsWrapper& readableByteStreamControllerBuiltins() { return m_readableByteStreamControllerBuiltins; }
    // ReadableByteStreamInternalsBuiltinsWrapper& readableByteStreamInternalsBuiltins() { return m_readableByteStreamInternalsBuiltins; }
    // ReadableStreamBuiltinsWrapper& readableStreamBuiltins() { return m_readableStreamBuiltins; }
    // ReadableStreamBYOBReaderBuiltinsWrapper& readableStreamBYOBReaderBuiltins() { return m_readableStreamBYOBReaderBuiltins; }
    // ReadableStreamBYOBRequestBuiltinsWrapper& readableStreamBYOBRequestBuiltins() { return m_readableStreamBYOBRequestBuiltins; }
    // ReadableStreamDefaultControllerBuiltinsWrapper& readableStreamDefaultControllerBuiltins() { return m_readableStreamDefaultControllerBuiltins; }
    // ReadableStreamDefaultReaderBuiltinsWrapper& readableStreamDefaultReaderBuiltins() { return m_readableStreamDefaultReaderBuiltins; }
    // ReadableStreamInternalsBuiltinsWrapper& readableStreamInternalsBuiltins() { return m_readableStreamInternalsBuiltins; }
    // StreamInternalsBuiltinsWrapper& streamInternalsBuiltins() { return m_streamInternalsBuiltins; }
    // TransformStreamBuiltinsWrapper& transformStreamBuiltins() { return m_transformStreamBuiltins; }
    // TransformStreamDefaultControllerBuiltinsWrapper& transformStreamDefaultControllerBuiltins() { return m_transformStreamDefaultControllerBuiltins; }
    // TransformStreamInternalsBuiltinsWrapper& transformStreamInternalsBuiltins() { return m_transformStreamInternalsBuiltins; }
    // WritableStreamDefaultControllerBuiltinsWrapper& writableStreamDefaultControllerBuiltins() { return m_writableStreamDefaultControllerBuiltins; }
    // WritableStreamDefaultWriterBuiltinsWrapper& writableStreamDefaultWriterBuiltins() { return m_writableStreamDefaultWriterBuiltins; }
    // WritableStreamInternalsBuiltinsWrapper& writableStreamInternalsBuiltins() { return m_writableStreamInternalsBuiltins; }
    // JSDOMBindingInternalsBuiltinsWrapper& jsDOMBindingInternalsBuiltins() { return m_jsDOMBindingInternalsBuiltins; }
    // TextDecoderStreamBuiltinsWrapper& textDecoderStreamBuiltins() { return m_textDecoderStreamBuiltins; }
    // TextEncoderStreamBuiltinsWrapper& textEncoderStreamBuiltins() { return m_textEncoderStreamBuiltins; }
    JSBufferPrototypeBuiltinsWrapper& jsBufferPrototypeBuiltins() { return m_jsBufferPrototypeBuiltins; }

private:
    JSC::VM& m_vm;
    JSBufferPrototypeBuiltinsWrapper m_jsBufferPrototypeBuiltins;
    // ByteLengthQueuingStrategyBuiltinsWrapper m_byteLengthQueuingStrategyBuiltins;
    // CountQueuingStrategyBuiltinsWrapper m_countQueuingStrategyBuiltins;
    // ReadableByteStreamControllerBuiltinsWrapper m_readableByteStreamControllerBuiltins;
    // ReadableByteStreamInternalsBuiltinsWrapper m_readableByteStreamInternalsBuiltins;
    // ReadableStreamBuiltinsWrapper m_readableStreamBuiltins;
    // ReadableStreamBYOBReaderBuiltinsWrapper m_readableStreamBYOBReaderBuiltins;
    // ReadableStreamBYOBRequestBuiltinsWrapper m_readableStreamBYOBRequestBuiltins;
    // ReadableStreamDefaultControllerBuiltinsWrapper m_readableStreamDefaultControllerBuiltins;
    // ReadableStreamDefaultReaderBuiltinsWrapper m_readableStreamDefaultReaderBuiltins;
    // ReadableStreamInternalsBuiltinsWrapper m_readableStreamInternalsBuiltins;
    // StreamInternalsBuiltinsWrapper m_streamInternalsBuiltins;
    // TransformStreamBuiltinsWrapper m_transformStreamBuiltins;
    // TransformStreamDefaultControllerBuiltinsWrapper m_transformStreamDefaultControllerBuiltins;
    // TransformStreamInternalsBuiltinsWrapper m_transformStreamInternalsBuiltins;
    // WritableStreamDefaultControllerBuiltinsWrapper m_writableStreamDefaultControllerBuiltins;
    // WritableStreamDefaultWriterBuiltinsWrapper m_writableStreamDefaultWriterBuiltins;
    // WritableStreamInternalsBuiltinsWrapper m_writableStreamInternalsBuiltins;
    // JSDOMBindingInternalsBuiltinsWrapper m_jsDOMBindingInternalsBuiltins;
    // TextDecoderStreamBuiltinsWrapper m_textDecoderStreamBuiltins;
    // TextEncoderStreamBuiltinsWrapper m_textEncoderStreamBuiltins;
};

}