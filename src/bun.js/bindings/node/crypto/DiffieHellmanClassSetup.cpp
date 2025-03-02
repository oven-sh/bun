#include "DiffieHellmanClassSetup.h"
#include "JSDiffieHellman.h"
#include "JSDiffieHellmanPrototype.h"
#include "JSDiffieHellmanConstructor.h"
#include "JSDiffieHellmanGroup.h"
#include "JSDiffieHellmanGroupPrototype.h"
#include "JSDiffieHellmanGroupConstructor.h"
#include <JavaScriptCore/VMTrapsInlines.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/ObjectPrototype.h>

namespace Bun {

void setupDiffieHellmanClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* prototypeStructure = JSDiffieHellmanPrototype::createStructure(init.vm, init.global, init.global->objectPrototype());
    auto* prototype = JSDiffieHellmanPrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSDiffieHellmanConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSDiffieHellmanConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSDiffieHellman::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

void setupDiffieHellmanGroupClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* prototypeStructure = JSDiffieHellmanGroupPrototype::createStructure(init.vm, init.global, init.global->objectPrototype());
    auto* prototype = JSDiffieHellmanGroupPrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSDiffieHellmanGroupConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSDiffieHellmanGroupConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSDiffieHellmanGroup::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun
