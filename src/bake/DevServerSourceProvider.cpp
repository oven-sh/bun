#include "DevServerSourceProvider.h"
#include "BunBuiltinNames.h"
#include "BunString.h"

// The Zig implementation will be provided to handle registration
extern "C" void Bun__addDevServerSourceProvider(void* bun_vm, Bake::DevServerSourceProvider* opaque_source_provider, BunString* specifier);

// Export functions for Zig to access DevServerSourceProvider
extern "C" BunString DevServerSourceProvider__getSourceSlice(Bake::DevServerSourceProvider* provider)
{
    return Bun::toStringView(provider->source());
}

extern "C" MiCString DevServerSourceProvider__getSourceMapJSON(Bake::DevServerSourceProvider* provider)
{
    return provider->sourceMapJSON();
}
