#include "JSSocketAddressPrototype.h"

// const ClassInfo JSX509CertificatePrototype::s_info = { "X509Certificate"_s,
// &Base::s_info, nullptr, nullptr,
// CREATE_METHOD_TABLE(JSX509CertificatePrototype) };

using namespace JSC;

namespace Bun {

const ClassInfo JSSocketAddressPrototype::s_info = { "SocketAddress"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSSocketAddressPrototype) };

} // namespace Bun
