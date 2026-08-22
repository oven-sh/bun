#pragma once

#include "root.h"

namespace Bun {

// Native form of Node's internal/streams/lazy_transform for the crypto classes: their
// prototypes chain directly to Transform.prototype and carry these two accessors, which
// run the (JS) Transform constructor the first time _readableState / _writableState is
// touched, so a Hash/Hmac that is never used as a stream never pays for the stream state.
JSC_DECLARE_CUSTOM_GETTER(jsLazyTransformStateGetter);
JSC_DECLARE_CUSTOM_SETTER(jsLazyTransformStateSetter);

// internal/streams/transform's Transform constructor. Loads the streams modules on first use, which can
// throw; otherwise never null.
JSC::JSObject* transformConstructor(JSC::JSGlobalObject*);

} // namespace Bun
