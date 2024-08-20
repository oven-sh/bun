#include "v8_api_internal.h"

namespace v8 {
namespace api_internal {

void ToLocalEmpty()
{
    BUN_PANIC("Attempt to unwrap an empty v8::MaybeLocal");
}

}
}
