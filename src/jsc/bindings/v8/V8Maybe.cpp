#include "V8Maybe.h"
#include "v8_compatibility_assertions.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::Maybe<int>)
ASSERT_V8_TYPE_FIELD_OFFSET_MATCHES(v8::Maybe<int>, m_hasValue, has_value_)
ASSERT_V8_TYPE_FIELD_OFFSET_MATCHES(v8::Maybe<int>, m_value, value_)
