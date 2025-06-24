
#include "ProcessBindingBuffer.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include "JSBuffer.h"

namespace Bun {
using namespace JSC;

#define PROCESS_BINDING_NOT_IMPLEMENTED(str)                                                                                                      \
    JSC_DEFINE_HOST_FUNCTION(ProcessBinding_Buffer_##str, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame * callFrame))                \
    {                                                                                                                                             \
        {                                                                                                                                         \
            auto& vm = JSC::getVM(lexicalGlobalObject);                                                                                           \
            auto throwScope = DECLARE_THROW_SCOPE(vm);                                                                                            \
            auto prelude = "process.binding('buffer')."_s;                                                                                        \
            auto name = #str##_s;                                                                                                                 \
            auto finale = " is not implemented in Bun. If that breaks something, please file an issue and include a reproducible code sample."_s; \
            auto message = makeString(prelude, name, finale);                                                                                     \
            throwScope.throwException(lexicalGlobalObject, createError(lexicalGlobalObject, message));                                            \
            return {};                                                                                                                            \
        }                                                                                                                                         \
    }

PROCESS_BINDING_NOT_IMPLEMENTED(asciiSlice)

PROCESS_BINDING_NOT_IMPLEMENTED(asciiWriteStatic)

PROCESS_BINDING_NOT_IMPLEMENTED(atob)

PROCESS_BINDING_NOT_IMPLEMENTED(base64Slice)

PROCESS_BINDING_NOT_IMPLEMENTED(base64Write)

PROCESS_BINDING_NOT_IMPLEMENTED(base64urlSlice)

PROCESS_BINDING_NOT_IMPLEMENTED(base64urlWrite)

PROCESS_BINDING_NOT_IMPLEMENTED(btoa)

PROCESS_BINDING_NOT_IMPLEMENTED(byteLengthUtf8)

PROCESS_BINDING_NOT_IMPLEMENTED(compare)

PROCESS_BINDING_NOT_IMPLEMENTED(compareOffset)

PROCESS_BINDING_NOT_IMPLEMENTED(copy)

PROCESS_BINDING_NOT_IMPLEMENTED(copyArrayBuffer)

PROCESS_BINDING_NOT_IMPLEMENTED(detachArrayBuffer)

PROCESS_BINDING_NOT_IMPLEMENTED(fill)

PROCESS_BINDING_NOT_IMPLEMENTED(getZeroFillToggle)

PROCESS_BINDING_NOT_IMPLEMENTED(hexSlice)

PROCESS_BINDING_NOT_IMPLEMENTED(hexWrite)

PROCESS_BINDING_NOT_IMPLEMENTED(indexOfBuffer)

PROCESS_BINDING_NOT_IMPLEMENTED(indexOfNumber)

PROCESS_BINDING_NOT_IMPLEMENTED(indexOfString)

PROCESS_BINDING_NOT_IMPLEMENTED(isAscii)

PROCESS_BINDING_NOT_IMPLEMENTED(isUtf8)

PROCESS_BINDING_NOT_IMPLEMENTED(latin1Slice)

PROCESS_BINDING_NOT_IMPLEMENTED(latin1WriteStatic)

PROCESS_BINDING_NOT_IMPLEMENTED(swap16)

PROCESS_BINDING_NOT_IMPLEMENTED(swap32)

PROCESS_BINDING_NOT_IMPLEMENTED(swap64)

PROCESS_BINDING_NOT_IMPLEMENTED(ucs2Slice)

PROCESS_BINDING_NOT_IMPLEMENTED(ucs2Write)

PROCESS_BINDING_NOT_IMPLEMENTED(utf8Slice)

PROCESS_BINDING_NOT_IMPLEMENTED(utf8WriteStatic)

/* Source for ProcessBindingBuffer.lut.h
@begin processBindingBufferTable
    asciiSlice                    ProcessBinding_Buffer_asciiSlice               Function 1
    asciiWriteStatic              ProcessBinding_Buffer_asciiWriteStatic         Function 1
    atob                          ProcessBinding_Buffer_atob                     Function 1
    base64Slice                   ProcessBinding_Buffer_base64Slice              Function 1
    base64Write                   ProcessBinding_Buffer_base64Write              Function 1
    base64urlSlice                ProcessBinding_Buffer_base64urlSlice           Function 1
    base64urlWrite                ProcessBinding_Buffer_base64urlWrite           Function 1
    btoa                          ProcessBinding_Buffer_btoa                     Function 1
    byteLengthUtf8                ProcessBinding_Buffer_byteLengthUtf8           Function 1
    compare                       ProcessBinding_Buffer_compare                  Function 1
    compareOffset                 ProcessBinding_Buffer_compareOffset            Function 1
    copy                          ProcessBinding_Buffer_copy                     Function 1
    copyArrayBuffer               ProcessBinding_Buffer_copyArrayBuffer          Function 1
    detachArrayBuffer             ProcessBinding_Buffer_detachArrayBuffer        Function 1
    fill                          ProcessBinding_Buffer_fill                     Function 1
    getZeroFillToggle             ProcessBinding_Buffer_getZeroFillToggle        Function 1
    hexSlice                      ProcessBinding_Buffer_hexSlice                 Function 1
    hexWrite                      ProcessBinding_Buffer_hexWrite                 Function 1
    indexOfBuffer                 ProcessBinding_Buffer_indexOfBuffer            Function 1
    indexOfNumber                 ProcessBinding_Buffer_indexOfNumber            Function 1
    indexOfString                 ProcessBinding_Buffer_indexOfString            Function 1
    isAscii                       ProcessBinding_Buffer_isAscii                  Function 1
    isUtf8                        ProcessBinding_Buffer_isUtf8                   Function 1
    latin1Slice                   ProcessBinding_Buffer_latin1Slice              Function 1
    latin1WriteStatic             ProcessBinding_Buffer_latin1WriteStatic        Function 1
    swap16                        ProcessBinding_Buffer_swap16                   Function 1
    swap32                        ProcessBinding_Buffer_swap32                   Function 1
    swap64                        ProcessBinding_Buffer_swap64                   Function 1
    ucs2Slice                     ProcessBinding_Buffer_ucs2Slice                Function 1
    ucs2Write                     ProcessBinding_Buffer_ucs2Write                Function 1
    utf8Slice                     ProcessBinding_Buffer_utf8Slice                Function 1
    utf8WriteStatic               ProcessBinding_Buffer_utf8WriteStatic          Function 1
@end
*/
#include "ProcessBindingBuffer.lut.h"

const ClassInfo ProcessBindingBuffer::s_info = { "ProcessBindingBuffer"_s, &Base::s_info, &processBindingBufferTable, nullptr, CREATE_METHOD_TABLE(ProcessBindingBuffer) };

ProcessBindingBuffer* ProcessBindingBuffer::create(VM& vm, Structure* structure)
{
    ProcessBindingBuffer* obj = new (NotNull, allocateCell<ProcessBindingBuffer>(vm)) ProcessBindingBuffer(vm, structure);
    obj->finishCreation(vm);
    return obj;
}

Structure* ProcessBindingBuffer::createStructure(VM& vm, JSGlobalObject* globalObject)
{
    return Structure::create(vm, globalObject, jsNull(), TypeInfo(ObjectType, StructureFlags), ProcessBindingBuffer::info());
}

void ProcessBindingBuffer::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    putDirect(vm, Identifier::fromString(vm, "kMaxLength"_s), jsNumber(Bun::Buffer::kMaxLength), 0);
    putDirect(vm, Identifier::fromString(vm, "kStringMaxLength"_s), jsNumber(Bun::Buffer::kStringMaxLength), 0);
}

template<typename Visitor>
void ProcessBindingBuffer::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    ProcessBindingBuffer* thisObject = jsCast<ProcessBindingBuffer*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}

DEFINE_VISIT_CHILDREN(ProcessBindingBuffer);

} // namespace Bun
