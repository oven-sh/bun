#include "V8ScriptOrigin.h"
#include "v8_compatibility_assertions.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::ScriptOriginOptions)
ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::ScriptOrigin)

namespace v8 {

Local<Value> ScriptOrigin::ResourceName() const
{
    return resource_name_;
}

int ScriptOrigin::LineOffset() const
{
    return resource_line_offset_;
}

int ScriptOrigin::ColumnOffset() const
{
    return resource_column_offset_;
}

int ScriptOrigin::ScriptId() const
{
    return script_id_;
}

Local<Value> ScriptOrigin::SourceMapUrl() const
{
    return source_map_url_;
}

Local<Data> ScriptOrigin::GetHostDefinedOptions() const
{
    return host_defined_options_;
}

ScriptOriginOptions ScriptOrigin::Options() const
{
    return options_;
}

void ScriptOrigin::VerifyHostDefinedOptions() const
{
    // V8 checks that host_defined_options_ is a PrimitiveArray. Bun does not use host defined
    // options, so there is nothing to check.
}

} // namespace v8
