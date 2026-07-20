#include "DevServerSourceProvider.h"
#include "BunBuiltinNames.h"
#include "BunString.h"

// Implemented on the Rust side to handle registration.
extern "C" void Bun__addDevServerSourceProvider(void* bun_vm, Bake::DevServerSourceProvider* opaque_source_provider, BunString* specifier);

// Exported for the Rust side to access DevServerSourceProvider.
extern "C" BunString DevServerSourceProvider__getSourceSlice(Bake::DevServerSourceProvider* provider)
{
    return Bun::toStringView(provider->source());
}

extern "C" MiCString DevServerSourceProvider__getSourceMapJSON(Bake::DevServerSourceProvider* provider)
{
    return provider->sourceMapJSON();
}
