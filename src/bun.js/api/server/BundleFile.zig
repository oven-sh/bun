//! Represents a single output file from a bundle build.
//! Created by JSBundle after a build completes. Exposes name, kind, type, size,
//! and a file() method that returns a Blob for lazy content access.
pub const BundleFile = @This();
pub const js = jsc.Codegen.JSBundleFile;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

/// Output filename (e.g., "App-a1b2c3.js")
file_name: []const u8,
/// Output kind
output_kind: OutputKind,
/// MIME type string (e.g., "application/javascript")
mime_type: []const u8,
/// File size in bytes
file_size: u64,
/// The blob backing this file's content
blob: jsc.WebCore.Blob,

pub const OutputKind = enum {
    @"entry-point",
    chunk,
    asset,
    sourcemap,
};

pub fn init(
    file_name: []const u8,
    output_kind: OutputKind,
    mime_type: []const u8,
    file_size: u64,
    blob: jsc.WebCore.Blob,
) *BundleFile {
    return bun.new(BundleFile, .{
        .file_name = bun.handleOom(bun.default_allocator.dupe(u8, file_name)),
        .output_kind = output_kind,
        .mime_type = bun.handleOom(bun.default_allocator.dupe(u8, mime_type)),
        .file_size = file_size,
        .blob = blob,
    });
}

pub fn updateBlob(this: *BundleFile, new_blob: jsc.WebCore.Blob, new_size: u64) void {
    this.blob.deinit();
    this.blob = new_blob;
    this.file_size = new_size;
}

pub fn finalize(this: *BundleFile) void {
    this.deinit();
}

fn deinit(this: *BundleFile) void {
    this.blob.deinit();
    bun.default_allocator.free(this.file_name);
    bun.default_allocator.free(this.mime_type);
    bun.destroy(this);
}

pub fn getName(this: *BundleFile, globalObject: *JSGlobalObject) bun.JSError!JSValue {
    return bun.String.createUTF8ForJS(globalObject, this.file_name);
}

pub fn getKind(this: *BundleFile, globalObject: *JSGlobalObject) JSValue {
    return bun.String.createUTF8ForJS(globalObject, @tagName(this.output_kind)) catch return .js_undefined;
}

pub fn getType(this: *BundleFile, globalObject: *JSGlobalObject) JSValue {
    return bun.String.createUTF8ForJS(globalObject, this.mime_type) catch return .js_undefined;
}

pub fn getSize(this: *BundleFile, _: *JSGlobalObject) JSValue {
    return JSValue.jsNumber(this.file_size);
}

pub fn getFile(
    this: *BundleFile,
    globalObject: *JSGlobalObject,
    _: *jsc.CallFrame,
) bun.JSError!JSValue {
    // Create a new heap-allocated Blob backed by the same store.
    // dupe() increments the store ref count; Blob.new() heap-allocates with ref_count=1.
    return jsc.WebCore.Blob.new(this.blob.dupe()).toJS(globalObject);
}

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
