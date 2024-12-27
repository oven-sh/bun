#include "root.h"

#include <JavaScriptCore/LazyClassStructure.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>

#include "ZigGlobalObject.h"
#include "BunStreamStructures.h"

#include "BunReadableStream.h"
#include "BunReadableStreamPrototype.h"
#include "BunReadableStreamConstructor.h"

#include "BunReadableStreamDefaultReader.h"
#include "BunReadableStreamDefaultReaderPrototype.h"
#include "BunReadableStreamDefaultReaderConstructor.h"

#include "BunReadableStreamDefaultController.h"
#include "BunReadableStreamDefaultControllerPrototype.h"
#include "BunReadableStreamDefaultControllerConstructor.h"

#include "BunReadableStreamBYOBReader.h"
#include "BunReadableStreamBYOBReaderPrototype.h"
#include "BunReadableStreamBYOBReaderConstructor.h"

#include "BunWritableStream.h"
#include "BunWritableStreamPrototype.h"
#include "BunWritableStreamConstructor.h"

#include "BunWritableStreamDefaultWriter.h"
#include "BunWritableStreamDefaultWriterPrototype.h"
#include "BunWritableStreamDefaultWriterConstructor.h"

#include "BunWritableStreamDefaultController.h"
#include "BunWritableStreamDefaultControllerPrototype.h"
#include "BunWritableStreamDefaultControllerConstructor.h"

#include "BunTransformStream.h"
#include "BunTransformStreamPrototype.h"
#include "BunTransformStreamConstructor.h"

#include "BunTransformStreamDefaultController.h"
#include "BunTransformStreamDefaultControllerPrototype.h"
#include "BunTransformStreamDefaultControllerConstructor.h"

namespace Bun {

void StreamStructures::initialize(VM& vm, JSC::JSGlobalObject* _globalObject)
{

#define INIT_WHATWG_STREAM_CONSTRUCTOR(ConstructorName)                                                                                                                                       \
    m_##ConstructorName.initLater(                                                                                                                                                            \
        [](LazyClassStructure::Initializer& init) {                                                                                                                                           \
            auto* globalObject = reinterpret_cast<Zig::GlobalObject*>(init.global);                                                                                                           \
            auto* prototype = ConstructorName##Prototype::create(init.vm, globalObject, ConstructorName##Prototype::createStructure(init.vm, globalObject, globalObject->objectPrototype())); \
            auto* structure = ConstructorName::createStructure(init.vm, globalObject, prototype);                                                                                             \
            auto* constructor = ConstructorName##Constructor::create(init.vm, globalObject, prototype);                                                                                       \
            init.setPrototype(prototype);                                                                                                                                                     \
            init.setStructure(structure);                                                                                                                                                     \
            init.setConstructor(constructor);                                                                                                                                                 \
        });

    FOR_EACH_WHATWG_STREAM_CLASS_TYPE(INIT_WHATWG_STREAM_CONSTRUCTOR)

#undef INIT_WHATWG_STREAM_CONSTRUCTOR
}

}
