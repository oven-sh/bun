#include "DevServerSourceProvider.h"
#include "BunBuiltinNames.h"
#include "BunString.h"

// Exported for the Rust side to access DevServerSourceProvider.
extern "C" BunString DevServerSourceProvider__getSourceSlice(Bake::DevServerSourceProvider* provider)
{
    return Bun::toStringView(provider->source());
}

extern "C" MiCString DevServerSourceProvider__getSourceMapJSON(Bake::DevServerSourceProvider* provider)
{
    return provider->sourceMapJSON();
}
