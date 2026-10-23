#include "DevServerSourceProvider.h"
#include "BunBuiltinNames.h"
#include "BunString.h"

// Implemented on the Rust side to handle registration.
extern "C" void Bun__addDevServerSourceProvider(void* bun_vm, Bake::DevServerSourceProvider* opaque_source_provider, const BunString* specifier);

// Exported for the Rust side to access DevServerSourceProvider.
extern "C" BunString DevServerSourceProvider__getSourceSlice(Bake::DevServerSourceProvider* provider)
{
    return Bun::toStringView(provider->source());
}

extern "C" MiCString DevServerSourceProvider__getSourceMapJSON(Bake::DevServerSourceProvider* provider)
{
    return provider->sourceMapJSON();
}

extern "C" void DevServerSourceProvider__attachSourceMap(Bake::DevServerSourceProvider* provider, JSC::JSGlobalObject* globalObject, const char* sourceMapJSONPtr, size_t sourceMapJSONLength)
{
    provider->attachSourceMap(globalObject, sourceMapJSONPtr, sourceMapJSONLength);
}

extern "C" void DevServerSourceProvider__deref(Bake::DevServerSourceProvider* provider)
{
    provider->deref();
}
