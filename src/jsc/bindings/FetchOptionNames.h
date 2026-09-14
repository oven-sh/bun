#pragma once
#include <cstdint>

// Keys fetch() reads off its init object: (enumerator, property name). Each is
// atomized on first use and kept on the VM's client data, so a VM that never
// calls fetch() with an init object pays nothing. The order must match
// `FetchOptionName` in src/jsc/lib.rs, which checks `Count`.
#define BUN_FETCH_OPTION_NAMES(macro) \
    macro(Compress, "compress") \
    macro(Context, "context") \
    macro(Decompress, "decompress") \
    macro(Keepalive, "keepalive") \
    macro(Lookup, "lookup") \
    macro(MaxRedirects, "maxRedirects") \
    macro(OnStats, "onStats") \
    macro(Protocol, "protocol") \
    macro(Proxy, "proxy") \
    macro(S3, "s3") \
    macro(Timeout, "timeout") \
    macro(Tls, "tls") \
    macro(Unix, "unix") \
    macro(Verbose, "verbose")

namespace Bun {

enum class FetchOptionName : uint8_t {
#define BUN_FETCH_OPTION_ENUMERATOR(enumerator, name) enumerator,
    BUN_FETCH_OPTION_NAMES(BUN_FETCH_OPTION_ENUMERATOR)
#undef BUN_FETCH_OPTION_ENUMERATOR
    Count,
};

} // namespace Bun
