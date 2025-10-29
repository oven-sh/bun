const std = @import("std");
const bun = @import("bun");
const telemetry = bun.telemetry;
const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const JSGlobalObject = jsc.JSGlobalObject;
const ZigString = jsc.ZigString;
const attributes = @import("attributes.zig");
const AttributeKeys = attributes.AttributeKeys;
const AttributeKey = attributes.AttributeKey;
const HeaderNameList = attributes.HeaderNameList;
const ContextKind = attributes.ContextKind;

/// Configuration property identifiers for accessing telemetry configuration values.
/// Used by getConfigurationProperty() to retrieve specific configuration data.
pub const ConfigurationProperty = enum(u8) {
    RESERVED = 0,
    http_capture_headers_server_request = 1,
    http_capture_headers_server_response = 2,
    http_propagate_headers_server_response = 3,
    http_capture_headers_fetch_request = 4,
    http_capture_headers_fetch_response = 5,
    http_propagate_headers_fetch_request = 6,
    _context_storage = 7, // AsyncLocalStorage instance for context propagation

    pub const COUNT = @typeInfo(ConfigurationProperty).@"enum".fields.len;
};

/// Manages telemetry configuration properties with dual storage (JS + native)
/// Ensures consistency between JavaScript arrays and native bun.String arrays
pub const TelemetryConfig = struct {
    /// Configuration properties as JSValue arrays (indexed by ConfigurationProperty enum)
    /// Protected from GC, kept in sync with native_properties
    js_properties: [ConfigurationProperty.COUNT]JSValue,

    /// Configuration properties as native string arrays (indexed by ConfigurationProperty enum)
    /// Kept in sync with js_properties for fast native access
    native_properties: [ConfigurationProperty.COUNT]std.ArrayList(bun.String),

    /// Pre-computed HeaderNameList for header capture/propagation configuration
    /// Parsed from JS arrays during set() for O(1) header extraction
    header_properties: [ConfigurationProperty.COUNT]?HeaderNameList,

    allocator: std.mem.Allocator,
    global: *JSGlobalObject,

    /// Initialize configuration with safe default values
    /// TODO: Parse from OTEL_INSTRUMENTATION_HTTP_CAPTURE_HEADERS_* environment variables
    pub fn init(allocator: std.mem.Allocator, global: *JSGlobalObject, attribute_keys: *AttributeKeys) !TelemetryConfig {
        // Safe default headers (deny-by-default security model - only non-sensitive headers)
        const sample_request_headers = &[_][]const u8{ "content-type", "user-agent", "accept", "content-length" };
        const sample_response_headers = &[_][]const u8{ "content-type", "content-length" };

        // Create JSValue arrays for header capture configuration
        const server_req_headers_js = try JSValue.createEmptyArray(global, sample_request_headers.len);
        for (sample_request_headers, 0..) |header, i| {
            const header_str = ZigString.init(header).toJS(global);
            try server_req_headers_js.putIndex(global, @intCast(i), header_str);
        }
        server_req_headers_js.protect(); // Keep alive

        const server_res_headers_js = try JSValue.createEmptyArray(global, sample_response_headers.len);
        for (sample_response_headers, 0..) |header, i| {
            const header_str = ZigString.init(header).toJS(global);
            try server_res_headers_js.putIndex(global, @intCast(i), header_str);
        }
        server_res_headers_js.protect(); // Keep alive

        const fetch_req_headers_js = try JSValue.createEmptyArray(global, sample_request_headers.len);
        for (sample_request_headers, 0..) |header, i| {
            const header_str = ZigString.init(header).toJS(global);
            try fetch_req_headers_js.putIndex(global, @intCast(i), header_str);
        }
        fetch_req_headers_js.protect(); // Keep alive

        const fetch_res_headers_js = try JSValue.createEmptyArray(global, sample_response_headers.len);
        for (sample_response_headers, 0..) |header, i| {
            const header_str = ZigString.init(header).toJS(global);
            try fetch_res_headers_js.putIndex(global, @intCast(i), header_str);
        }
        fetch_res_headers_js.protect(); // Keep alive

        // Initialize JS configuration properties array
        var js_properties: [ConfigurationProperty.COUNT]JSValue = undefined;
        js_properties[@intFromEnum(ConfigurationProperty.RESERVED)] = .js_undefined;
        js_properties[@intFromEnum(ConfigurationProperty.http_capture_headers_server_request)] = server_req_headers_js;
        js_properties[@intFromEnum(ConfigurationProperty.http_capture_headers_server_response)] = server_res_headers_js;
        js_properties[@intFromEnum(ConfigurationProperty.http_propagate_headers_server_response)] = .js_undefined; // TODO
        js_properties[@intFromEnum(ConfigurationProperty.http_capture_headers_fetch_request)] = fetch_req_headers_js;
        js_properties[@intFromEnum(ConfigurationProperty.http_capture_headers_fetch_response)] = fetch_res_headers_js;
        js_properties[@intFromEnum(ConfigurationProperty.http_propagate_headers_fetch_request)] = .js_undefined; // TODO
        js_properties[@intFromEnum(ConfigurationProperty._context_storage)] = .js_undefined;

        // Initialize native configuration properties (bun.String arrays)
        var native_properties: [ConfigurationProperty.COUNT]std.ArrayList(bun.String) = undefined;
        for (&native_properties) |*list| {
            list.* = std.ArrayList(bun.String).init(allocator);
        }

        // Populate native arrays from sample data
        for (sample_request_headers) |header| {
            try native_properties[@intFromEnum(ConfigurationProperty.http_capture_headers_server_request)].append(bun.String.fromBytes(header));
            try native_properties[@intFromEnum(ConfigurationProperty.http_capture_headers_fetch_request)].append(bun.String.fromBytes(header));
        }
        for (sample_response_headers) |header| {
            try native_properties[@intFromEnum(ConfigurationProperty.http_capture_headers_server_response)].append(bun.String.fromBytes(header));
            try native_properties[@intFromEnum(ConfigurationProperty.http_capture_headers_fetch_response)].append(bun.String.fromBytes(header));
        }

        // Initialize header properties (pre-computed HeaderNameList for each config property)
        var header_properties: [ConfigurationProperty.COUNT]?HeaderNameList = [_]?HeaderNameList{null} ** ConfigurationProperty.COUNT;

        // Pre-compute HeaderNameList for server request headers
        header_properties[@intFromEnum(ConfigurationProperty.http_capture_headers_server_request)] = try attribute_keys.createHeaderNameList(
            global,
            server_req_headers_js,
            .server_request,
        );

        // Pre-compute HeaderNameList for server response headers
        header_properties[@intFromEnum(ConfigurationProperty.http_capture_headers_server_response)] = try attribute_keys.createHeaderNameList(
            global,
            server_res_headers_js,
            .server_response,
        );

        // Pre-compute HeaderNameList for fetch request headers
        header_properties[@intFromEnum(ConfigurationProperty.http_capture_headers_fetch_request)] = try attribute_keys.createHeaderNameList(
            global,
            fetch_req_headers_js,
            .fetch_request,
        );

        // Pre-compute HeaderNameList for fetch response headers
        header_properties[@intFromEnum(ConfigurationProperty.http_capture_headers_fetch_response)] = try attribute_keys.createHeaderNameList(
            global,
            fetch_res_headers_js,
            .fetch_response,
        );

        return TelemetryConfig{
            .js_properties = js_properties,
            .native_properties = native_properties,
            .header_properties = header_properties,
            .allocator = allocator,
            .global = global,
        };
    }

    /// Clean up all configuration resources
    pub fn deinit(self: *TelemetryConfig) void {
        // Unprotect JS configuration property JSValue arrays (skip RESERVED)
        for (1..self.js_properties.len) |i| {
            const prop_value = self.js_properties[i];
            if (!prop_value.isUndefined()) {
                prop_value.unprotect();
            }
        }

        // Clean up native configuration properties (bun.String arrays)
        for (&self.native_properties) |*list| {
            for (list.items) |str| {
                str.deref();
            }
            list.deinit();
        }

        // Clean up header properties (pre-computed HeaderNameList)
        for (&self.header_properties) |*maybe_list| {
            if (maybe_list.*) |*list| {
                list.deinit();
            }
        }
    }

    /// Get a configuration property JSValue by its enum ID
    pub fn get(self: *const TelemetryConfig, property_id: u8) JSValue {
        if (property_id >= ConfigurationProperty.COUNT) {
            return .js_undefined;
        }
        return self.js_properties[property_id];
    }

    /// Get native configuration property (bun.String array) by its enum ID
    pub fn getNative(self: *const TelemetryConfig, property_id: u8) ?[]const bun.String {
        if (property_id >= ConfigurationProperty.COUNT) {
            return null;
        }
        return self.native_properties[property_id].items;
    }

    /// Get pre-computed HeaderNameList by its enum ID
    pub fn getHeaderList(self: *const TelemetryConfig, property_id: u8) ?*const HeaderNameList {
        if (property_id >= ConfigurationProperty.COUNT) {
            return null;
        }
        if (self.header_properties[property_id]) |*list| {
            return list;
        }
        return null;
    }

    /// Validate that configuration property is properly typed
    /// All properties (except RESERVED) must be arrays of strings
    fn validate(self: *TelemetryConfig, property_id: u8) !void {
        const js_value = self.js_properties[property_id];
        const native_list = self.native_properties[property_id].items;

        // Use switch to define expected types per property
        switch (@as(ConfigurationProperty, @enumFromInt(property_id))) {
            .RESERVED => {
                // RESERVED should always be undefined
                if (!js_value.isUndefined()) {
                    return error.InvalidPropertyType;
                }
            },
            ._context_storage => {
                // Context storage can be undefined/null (not set) or an object (AsyncLocalStorage instance)
                if (!js_value.isUndefined() and !js_value.isNull()) {
                    if (!js_value.isObject()) {
                        return error.InvalidPropertyType;
                    }
                }
                // No native_list validation needed for context storage
            },
            // All capture/propagate properties must be arrays
            .http_capture_headers_server_request,
            .http_capture_headers_server_response,
            .http_propagate_headers_server_response,
            .http_capture_headers_fetch_request,
            .http_capture_headers_fetch_response,
            .http_propagate_headers_fetch_request,
            => {
                // Allow undefined/null (means not set)
                if (js_value.isUndefined() or js_value.isNull()) {
                    if (native_list.len != 0) {
                        return error.InconsistentState;
                    }
                    return;
                }

                // Must be an array
                if (!js_value.isArray()) {
                    return error.InvalidPropertyType;
                }

                // JS array length should match native array length
                const js_len = try js_value.getLength(self.global);
                if (js_len != native_list.len) {
                    return error.InconsistentState;
                }

                // All items in native list should be valid bun.String
                for (native_list) |str| {
                    if (str.isEmpty()) {
                        return error.InvalidPropertyValue;
                    }
                }
            },
        }
    }

    /// Set a configuration property, keeping both JS and native arrays in sync
    /// Unprotects old JSValue if present, validates after setting
    pub fn set(self: *TelemetryConfig, property_id: u8, js_value: JSValue) !void {
        if (property_id >= ConfigurationProperty.COUNT or property_id == @intFromEnum(ConfigurationProperty.RESERVED)) {
            return error.InvalidProperty;
        }

        // Unprotect old JSValue if present
        const old_js_value = self.js_properties[property_id];
        if (!old_js_value.isUndefined()) {
            old_js_value.unprotect();
        }

        // Clear old native strings
        var native_list = &self.native_properties[property_id];
        for (native_list.items) |str| {
            str.deref();
        }
        native_list.clearRetainingCapacity();

        // Set new JSValue and protect it
        if (!js_value.isUndefined() and !js_value.isNull()) {
            js_value.protect();
            self.js_properties[property_id] = js_value;

            // Parse JSValue array to native strings
            if (js_value.isArray()) {
                const len = try js_value.getLength(self.global);
                var i: u32 = 0;
                while (i < len) : (i += 1) {
                    const item = js_value.getIndex(self.global, i) catch continue;
                    if (item.isString()) {
                        const zig_str = item.getZigString(self.global) catch continue;
                        const bun_str = bun.String.init(zig_str);
                        try native_list.append(bun_str);
                    }
                }
            }
        } else {
            self.js_properties[property_id] = .js_undefined;
        }

        // Validate consistency between JS and native arrays
        try self.validate(property_id);

        // Pre-compute HeaderNameList for header capture/propagate properties
        // Clean up old HeaderNameList if present
        if (self.header_properties[property_id]) |*old_list| {
            old_list.deinit();
            self.header_properties[property_id] = null;
        }

        // Determine context based on property type and create HeaderNameList
        const maybe_context: ?ContextKind = switch (@as(ConfigurationProperty, @enumFromInt(property_id))) {
            .http_capture_headers_server_request => .server_request,
            .http_capture_headers_server_response => .server_response,
            .http_propagate_headers_server_response => .server_response,
            .http_capture_headers_fetch_request => .fetch_request,
            .http_capture_headers_fetch_response => .fetch_response,
            .http_propagate_headers_fetch_request => .fetch_request,
            else => null,
        };

        if (maybe_context) |context| {
            // Only create HeaderNameList if js_value is a valid array
            if (!js_value.isUndefined() and !js_value.isNull() and js_value.isArray()) {
                self.header_properties[property_id] = try bun.telemetry.semconv.createHeaderNameList(self.global, js_value, context);
            }
        }
    }

    /// Rebuild inject header configuration from multiple instrument configs
    /// Merges all injectHeaders from instruments into this TelemetryConfig
    /// Uses linear concatenation (duplicates allowed)
    ///
    /// This method is called when instruments are attached/detached to rebuild
    /// the global header propagation configuration.
    pub fn rebuildInjectConfig(
        self: *TelemetryConfig,
        kind: telemetry.InstrumentType,
        instrument_records: []const telemetry.InstrumentRecord,
    ) !void {
        // Determine which configuration properties to update based on kind
        const request_prop_id: ?u8 = switch (kind) {
            .fetch => @intFromEnum(ConfigurationProperty.http_propagate_headers_fetch_request),
            else => null,
        };

        const response_prop_id: ?u8 = switch (kind) {
            .http => @intFromEnum(ConfigurationProperty.http_propagate_headers_server_response),
            else => null,
        };

        // Early return if this kind doesn't support header injection
        if (request_prop_id == null and response_prop_id == null) return;

        // Collect all header names from instruments (linear concatenation)
        var request_headers = std.ArrayList(JSValue).init(self.allocator);
        defer request_headers.deinit();

        var response_headers = std.ArrayList(JSValue).init(self.allocator);
        defer response_headers.deinit();

        for (instrument_records) |*record| {
            if (record.instrument_config) |*inst_config| {
                // Collect request headers for fetch kind
                if (request_prop_id) |req_prop| {
                    const req_headers = inst_config.get(req_prop);
                    if (req_headers.isArray()) {
                        const len = try req_headers.getLength(self.global);
                        var i: u32 = 0;
                        while (i < len) : (i += 1) {
                            const header = try req_headers.getIndex(self.global, i);
                            try request_headers.append(header);
                        }
                    }
                }

                // Collect response headers for http kind
                if (response_prop_id) |res_prop| {
                    const res_headers = inst_config.get(res_prop);
                    if (res_headers.isArray()) {
                        const len = try res_headers.getLength(self.global);
                        var i: u32 = 0;
                        while (i < len) : (i += 1) {
                            const header = try res_headers.getIndex(self.global, i);
                            try response_headers.append(header);
                        }
                    }
                }
            }
        }

        // Create JS arrays and set configuration
        if (request_prop_id) |req_prop| {
            if (request_headers.items.len > 0) {
                const js_array = try JSValue.createEmptyArray(self.global, request_headers.items.len);
                for (request_headers.items, 0..) |header, i| {
                    try js_array.putIndex(self.global, @intCast(i), header);
                }
                try self.set(req_prop, js_array);
            } else {
                // No headers configured, set to undefined
                try self.set(req_prop, .js_undefined);
            }
        }

        if (response_prop_id) |res_prop| {
            if (response_headers.items.len > 0) {
                const js_array = try JSValue.createEmptyArray(self.global, response_headers.items.len);
                for (response_headers.items, 0..) |header, i| {
                    try js_array.putIndex(self.global, @intCast(i), header);
                }
                try self.set(res_prop, js_array);
            } else {
                // No headers configured, set to undefined
                try self.set(res_prop, .js_undefined);
            }
        }
    }

    /// Rebuild capture header configuration from multiple instrument configs
    /// Merges all captureAttributes from instruments into this TelemetryConfig
    /// Uses union (duplicates allowed)
    ///
    /// This method is called when instruments are attached/detached to rebuild
    /// the global header capture configuration.
    pub fn rebuildCaptureConfig(
        self: *TelemetryConfig,
        kind: telemetry.InstrumentType,
        instrument_records: []const telemetry.InstrumentRecord,
    ) !void {
        // Determine which configuration properties to update based on kind
        const request_prop_id: ?u8 = switch (kind) {
            .http => @intFromEnum(ConfigurationProperty.http_capture_headers_server_request),
            .fetch => @intFromEnum(ConfigurationProperty.http_capture_headers_fetch_request),
            else => null,
        };

        const response_prop_id: ?u8 = switch (kind) {
            .http => @intFromEnum(ConfigurationProperty.http_capture_headers_server_response),
            .fetch => @intFromEnum(ConfigurationProperty.http_capture_headers_fetch_response),
            else => null,
        };

        // Early return if this kind doesn't support header capture
        if (request_prop_id == null and response_prop_id == null) return;

        // Collect all header names from instruments (union)
        var request_headers = std.ArrayList(JSValue).init(self.allocator);
        defer request_headers.deinit();

        var response_headers = std.ArrayList(JSValue).init(self.allocator);
        defer response_headers.deinit();

        for (instrument_records) |*record| {
            if (record.instrument_config) |*inst_config| {
                // Collect request headers
                if (request_prop_id) |req_prop| {
                    const req_headers = inst_config.get(req_prop);
                    if (req_headers.isArray()) {
                        const len = try req_headers.getLength(self.global);
                        var i: u32 = 0;
                        while (i < len) : (i += 1) {
                            const header = try req_headers.getIndex(self.global, i);
                            try request_headers.append(header);
                        }
                    }
                }

                // Collect response headers
                if (response_prop_id) |res_prop| {
                    const res_headers = inst_config.get(res_prop);
                    if (res_headers.isArray()) {
                        const len = try res_headers.getLength(self.global);
                        var i: u32 = 0;
                        while (i < len) : (i += 1) {
                            const header = try res_headers.getIndex(self.global, i);
                            try response_headers.append(header);
                        }
                    }
                }
            }
        }

        // Create JS arrays and set configuration
        if (request_prop_id) |req_prop| {
            if (request_headers.items.len > 0) {
                const js_array = try JSValue.createEmptyArray(self.global, request_headers.items.len);
                for (request_headers.items, 0..) |header, i| {
                    try js_array.putIndex(self.global, @intCast(i), header);
                }
                try self.set(req_prop, js_array);
            } else {
                // No headers configured, set to undefined
                try self.set(req_prop, .js_undefined);
            }
        }

        if (response_prop_id) |res_prop| {
            if (response_headers.items.len > 0) {
                const js_array = try JSValue.createEmptyArray(self.global, response_headers.items.len);
                for (response_headers.items, 0..) |header, i| {
                    try js_array.putIndex(self.global, @intCast(i), header);
                }
                try self.set(res_prop, js_array);
            } else {
                // No headers configured, set to undefined
                try self.set(res_prop, .js_undefined);
            }
        }
    }
};
