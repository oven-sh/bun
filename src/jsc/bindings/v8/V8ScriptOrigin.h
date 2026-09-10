#pragma once

#include "v8.h"
#include "V8Data.h"
#include "V8Local.h"

namespace v8 {

class Value;

// Layout-compatible with v8-message.h. Addons read the fields through the inline accessors, so the
// field order and types must match V8 exactly.
class ScriptOriginOptions {
public:
    ScriptOriginOptions(bool is_shared_cross_origin = false, bool is_opaque = false, bool is_wasm = false, bool is_module = false)
        : flags_((is_shared_cross_origin ? kIsSharedCrossOrigin : 0) | (is_wasm ? kIsWasm : 0) | (is_opaque ? kIsOpaque : 0) | (is_module ? kIsModule : 0))
    {
    }

    bool IsSharedCrossOrigin() const { return (flags_ & kIsSharedCrossOrigin) != 0; }
    bool IsOpaque() const { return (flags_ & kIsOpaque) != 0; }
    bool IsWasm() const { return (flags_ & kIsWasm) != 0; }
    bool IsModule() const { return (flags_ & kIsModule) != 0; }
    int Flags() const { return flags_; }

private:
    enum {
        kIsSharedCrossOrigin = 1,
        kIsOpaque = 1 << 1,
        kIsWasm = 1 << 2,
        kIsModule = 1 << 3
    };
    const int flags_;
};

class ScriptOrigin {
public:
    ScriptOrigin(Local<Value> resource_name,
        int resource_line_offset = 0,
        int resource_column_offset = 0,
        bool resource_is_shared_cross_origin = false,
        int script_id = -1,
        Local<Value> source_map_url = Local<Value>(),
        bool resource_is_opaque = false,
        bool is_wasm = false,
        bool is_module = false,
        Local<Data> host_defined_options = Local<Data>())
        : resource_name_(resource_name)
        , resource_line_offset_(resource_line_offset)
        , resource_column_offset_(resource_column_offset)
        , options_(resource_is_shared_cross_origin, resource_is_opaque, is_wasm, is_module)
        , script_id_(script_id)
        , source_map_url_(source_map_url)
        , host_defined_options_(host_defined_options)
    {
    }

    Local<Value> ResourceName() const { return resource_name_; }
    int LineOffset() const { return resource_line_offset_; }
    int ColumnOffset() const { return resource_column_offset_; }
    int ScriptId() const { return script_id_; }
    Local<Value> SourceMapUrl() const { return source_map_url_; }
    Local<Data> GetHostDefinedOptions() const { return host_defined_options_; }
    ScriptOriginOptions Options() const { return options_; }

private:
    // V8's inline constructor calls this, so an addon that builds a ScriptOrigin links against it.
    // Private to match V8's declaration (affects the MSVC mangling).
    BUN_EXPORT void VerifyHostDefinedOptions() const;

    Local<Value> resource_name_;
    int resource_line_offset_;
    int resource_column_offset_;
    ScriptOriginOptions options_;
    int script_id_;
    Local<Value> source_map_url_;
    Local<Data> host_defined_options_;
};

} // namespace v8
