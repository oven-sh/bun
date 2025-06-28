const std = @import("std");
const bun = @import("bun");
const string = bun.string;
const strings = bun.strings;

const Loader = @import("../options.zig").Loader;
const ComptimeStringMap = bun.ComptimeStringMap;

const MimeType = @This();

value: string,
category: Category,

pub const Map = bun.StringHashMap(MimeType);

pub fn createHashTable(allocator: std.mem.Allocator) !Map {
    @branchHint(.cold);

    const decls = comptime std.meta.declarations(all);

    var map = Map.init(allocator);
    try map.ensureTotalCapacity(@as(u32, @truncate(decls.len)));
    @setEvalBranchQuota(4000);
    inline for (decls) |decl| {
        map.putAssumeCapacityNoClobber(decl.name, @field(all, decl.name));
    }

    return map;
}

pub fn canOpenInEditor(this: MimeType) bool {
    if (this.category == .text or this.category.isCode())
        return true;

    if (this.category == .image) {
        return strings.eqlComptime(this.value, "image/svg+xml");
    }

    return false;
}

pub const Category = enum {
    none,
    image,
    text,
    html,
    font,
    other,
    css,
    json,
    audio,
    video,
    javascript,
    wasm,
    application,
    model,
    message,
    @"x-conference",
    @"x-shader",
    chemical,
    multipart,

    pub fn isCode(this: Category) bool {
        return switch (this) {
            .wasm, .json, .css, .html, .javascript => true,
            else => false,
        };
    }

    pub fn isTextLike(this: Category) bool {
        return switch (this) {
            .javascript, .html, .text, .css, .json => true,
            else => false,
        };
    }

    pub fn autosetFilename(this: Category) bool {
        return switch (this) {
            .wasm, .font, .image, .audio, .video, .javascript, .html, .text, .css, .json => false,
            else => true,
        };
    }
};

pub const none = MimeType.initComptime("", .none);
pub const other = MimeType.initComptime("application/octet-stream", .other);
pub const css = MimeType.initComptime("text/css;charset=utf-8", .css);
pub const javascript = MimeType.initComptime("text/javascript;charset=utf-8", .javascript);
pub const ico = MimeType.initComptime("image/vnd.microsoft.icon", .image);
pub const html = MimeType.initComptime("text/html;charset=utf-8", .html);
// we transpile json to javascript so that it is importable without import assertions.
pub const json = MimeType.initComptime("application/json;charset=utf-8", .json);
pub const transpiled_json = javascript;
pub const text = MimeType.initComptime("text/plain;charset=utf-8", .html);
pub const wasm = MimeType.initComptime(
    "application/wasm",
    .wasm,
);
fn initComptime(comptime str: string, t: Category) MimeType {
    return MimeType{
        .value = str,
        .category = t,
    };
}

pub fn init(str_: string, allocator: ?std.mem.Allocator, allocated: ?*bool) MimeType {
    var str = str_;
    if (std.mem.indexOfScalar(u8, str, '/')) |slash| {
        const category_ = str[0..slash];

        if (category_.len == 0 or category_[0] == '*' or str.len <= slash + 1) {
            return other;
        }

        str = str[slash + 1 ..];

        if (std.mem.indexOfScalar(u8, str, ';')) |semicolon| {
            str = str[0..semicolon];
        }

        switch (category_.len) {
            "application".len => {
                if (strings.eqlComptimeIgnoreLen(category_, "application")) {
                    if (strings.eqlComptime(str, "json") or strings.eqlComptime(str, "geo+json")) {
                        return json;
                    }
                }

                if (strings.eqlComptime(str, "octet-stream")) {
                    return other;
                }

                if (strings.eqlComptime(str, "wasm")) {
                    return wasm;
                }

                if (allocated != null and allocator != null) allocated.?.* = true;
                return MimeType{
                    .value = if (allocator) |a| a.dupe(u8, str_) catch bun.outOfMemory() else str_,
                    .category = .application,
                };
            },
            "font".len => {
                if (strings.eqlComptimeIgnoreLen(category_, "font")) {
                    if (allocated != null and allocator != null) allocated.?.* = true;
                    return MimeType{
                        .value = if (allocator) |a| a.dupe(u8, str_) catch bun.outOfMemory() else str_,
                        .category = .font,
                    };
                }

                if (strings.eqlComptimeIgnoreLen(category_, "text")) {
                    if (strings.eqlComptime(str, "css")) {
                        return css;
                    }

                    if (strings.eqlComptime(str, "html")) {
                        return html;
                    }

                    if (strings.eqlComptime(str, "javascript")) {
                        return javascript;
                    }

                    if (strings.eqlComptime(str, "plain")) {
                        return all.@"text/plain";
                    }

                    if (allocated != null and allocator != null) allocated.?.* = true;
                    return MimeType{
                        .value = if (allocator) |a| a.dupe(u8, str_) catch bun.outOfMemory() else str_,
                        .category = .text,
                    };
                }
            },
            "image".len => {
                if (strings.eqlComptimeIgnoreLen(category_, "image")) {
                    if (allocated != null and allocator != null) allocated.?.* = true;
                    return MimeType{
                        .value = if (allocator) |a| a.dupe(u8, str_) catch bun.outOfMemory() else str_,
                        .category = .image,
                    };
                }

                if (strings.eqlComptimeIgnoreLen(category_, "audio")) {
                    if (allocated != null and allocator != null) allocated.?.* = true;
                    return MimeType{
                        .value = if (allocator) |a| a.dupe(u8, str_) catch bun.outOfMemory() else str_,
                        .category = .audio,
                    };
                }

                if (strings.eqlComptimeIgnoreLen(category_, "video")) {
                    if (allocated != null and allocator != null) allocated.?.* = true;
                    return MimeType{
                        .value = if (allocator) |a| a.dupe(u8, str_) catch bun.outOfMemory() else str_,
                        .category = .video,
                    };
                }
            },
            else => {},
        }
    }

    if (allocated != null and allocator != null) allocated.?.* = true;
    return MimeType{
        .value = if (allocator) |a| a.dupe(u8, str_) catch bun.outOfMemory() else str_,
        .category = .other,
    };
}

// TODO: improve this
pub fn byLoader(loader: Loader, ext: string) MimeType {
    switch (loader) {
        .tsx, .ts, .js, .jsx, .json => {
            return javascript;
        },
        .css => {
            return css;
        },
        else => {
            return byExtension(ext);
        },
    }
}

pub fn byExtension(ext_without_leading_dot: string) MimeType {
    return byExtensionNoDefault(ext_without_leading_dot) orelse MimeType.other;
}

pub fn byExtensionNoDefault(ext_without_leading_dot: string) ?MimeType {
    return extensions.get(ext_without_leading_dot);
}

// this is partially auto-generated
pub const all = struct {
    pub const @"application/webassembly" = wasm;
    pub const @"application/1d-interleaved-parityfec": MimeType = MimeType{ .category = .application, .value = "application/1d-interleaved-parityfec" };
    pub const @"application/3gpdash-qoe-report+xml": MimeType = MimeType{ .category = .application, .value = "application/3gpdash-qoe-report+xml" };
    pub const @"application/3gpp-ims+xml": MimeType = MimeType{ .category = .application, .value = "application/3gpp-ims+xml" };
    pub const @"application/3gpphal+json": MimeType = MimeType{ .category = .application, .value = "application/3gpphal+json" };
    pub const @"application/3gpphalforms+json": MimeType = MimeType{ .category = .application, .value = "application/3gpphalforms+json" };
    pub const @"application/a2l": MimeType = MimeType{ .category = .application, .value = "application/a2l" };
    pub const @"application/ace+cbor": MimeType = MimeType{ .category = .application, .value = "application/ace+cbor" };
    pub const @"application/activemessage": MimeType = MimeType{ .category = .application, .value = "application/activemessage" };
    pub const @"application/activity+json": MimeType = MimeType{ .category = .application, .value = "application/activity+json" };
    pub const @"application/alto-cdni+json": MimeType = MimeType{ .category = .application, .value = "application/alto-cdni+json" };
    pub const @"application/alto-cdnifilter+json": MimeType = MimeType{ .category = .application, .value = "application/alto-cdnifilter+json" };
    pub const @"application/alto-costmap+json": MimeType = MimeType{ .category = .application, .value = "application/alto-costmap+json" };
    pub const @"application/alto-costmapfilter+json": MimeType = MimeType{ .category = .application, .value = "application/alto-costmapfilter+json" };
    pub const @"application/alto-directory+json": MimeType = MimeType{ .category = .application, .value = "application/alto-directory+json" };
    pub const @"application/alto-endpointcost+json": MimeType = MimeType{ .category = .application, .value = "application/alto-endpointcost+json" };
    pub const @"application/alto-endpointcostparams+json": MimeType = MimeType{ .category = .application, .value = "application/alto-endpointcostparams+json" };
    pub const @"application/alto-endpointprop+json": MimeType = MimeType{ .category = .application, .value = "application/alto-endpointprop+json" };
    pub const @"application/alto-endpointpropparams+json": MimeType = MimeType{ .category = .application, .value = "application/alto-endpointpropparams+json" };
    pub const @"application/alto-error+json": MimeType = MimeType{ .category = .application, .value = "application/alto-error+json" };
    pub const @"application/alto-networkmap+json": MimeType = MimeType{ .category = .application, .value = "application/alto-networkmap+json" };
    pub const @"application/alto-networkmapfilter+json": MimeType = MimeType{ .category = .application, .value = "application/alto-networkmapfilter+json" };
    pub const @"application/alto-propmap+json": MimeType = MimeType{ .category = .application, .value = "application/alto-propmap+json" };
    pub const @"application/alto-propmapparams+json": MimeType = MimeType{ .category = .application, .value = "application/alto-propmapparams+json" };
    pub const @"application/alto-updatestreamcontrol+json": MimeType = MimeType{ .category = .application, .value = "application/alto-updatestreamcontrol+json" };
    pub const @"application/alto-updatestreamparams+json": MimeType = MimeType{ .category = .application, .value = "application/alto-updatestreamparams+json" };
    pub const @"application/aml": MimeType = MimeType{ .category = .application, .value = "application/aml" };
    pub const @"application/andrew-inset": MimeType = MimeType{ .category = .application, .value = "application/andrew-inset" };
    pub const @"application/applefile": MimeType = MimeType{ .category = .application, .value = "application/applefile" };
    pub const @"application/applixware": MimeType = MimeType{ .category = .application, .value = "application/applixware" };
    pub const @"application/at+jwt": MimeType = MimeType{ .category = .application, .value = "application/at+jwt" };
    pub const @"application/atf": MimeType = MimeType{ .category = .application, .value = "application/atf" };
    pub const @"application/atfx": MimeType = MimeType{ .category = .application, .value = "application/atfx" };
    pub const @"application/atom+xml": MimeType = MimeType{ .category = .application, .value = "application/atom+xml" };
    pub const @"application/atomcat+xml": MimeType = MimeType{ .category = .application, .value = "application/atomcat+xml" };
    pub const @"application/atomdeleted+xml": MimeType = MimeType{ .category = .application, .value = "application/atomdeleted+xml" };
    pub const @"application/atomicmail": MimeType = MimeType{ .category = .application, .value = "application/atomicmail" };
    pub const @"application/atomsvc+xml": MimeType = MimeType{ .category = .application, .value = "application/atomsvc+xml" };
    pub const @"application/atsc-dwd+xml": MimeType = MimeType{ .category = .application, .value = "application/atsc-dwd+xml" };
    pub const @"application/atsc-dynamic-event-message": MimeType = MimeType{ .category = .application, .value = "application/atsc-dynamic-event-message" };
    pub const @"application/atsc-held+xml": MimeType = MimeType{ .category = .application, .value = "application/atsc-held+xml" };
    pub const @"application/atsc-rdt+json": MimeType = MimeType{ .category = .application, .value = "application/atsc-rdt+json" };
    pub const @"application/atsc-rsat+xml": MimeType = MimeType{ .category = .application, .value = "application/atsc-rsat+xml" };
    pub const @"application/atxml": MimeType = MimeType{ .category = .application, .value = "application/atxml" };
    pub const @"application/auth-policy+xml": MimeType = MimeType{ .category = .application, .value = "application/auth-policy+xml" };
    pub const @"application/bacnet-xdd+zip": MimeType = MimeType{ .category = .application, .value = "application/bacnet-xdd+zip" };
    pub const @"application/batch-smtp": MimeType = MimeType{ .category = .application, .value = "application/batch-smtp" };
    pub const @"application/bdoc": MimeType = MimeType{ .category = .application, .value = "application/bdoc" };
    pub const @"application/beep+xml": MimeType = MimeType{ .category = .application, .value = "application/beep+xml" };
    pub const @"application/calendar+json": MimeType = MimeType{ .category = .application, .value = "application/calendar+json" };
    pub const @"application/calendar+xml": MimeType = MimeType{ .category = .application, .value = "application/calendar+xml" };
    pub const @"application/call-completion": MimeType = MimeType{ .category = .application, .value = "application/call-completion" };
    pub const @"application/cals-1840": MimeType = MimeType{ .category = .application, .value = "application/cals-1840" };
    pub const @"application/captive+json": MimeType = MimeType{ .category = .application, .value = "application/captive+json" };
    pub const @"application/cbor": MimeType = MimeType{ .category = .application, .value = "application/cbor" };
    pub const @"application/cbor-seq": MimeType = MimeType{ .category = .application, .value = "application/cbor-seq" };
    pub const @"application/cccex": MimeType = MimeType{ .category = .application, .value = "application/cccex" };
    pub const @"application/ccmp+xml": MimeType = MimeType{ .category = .application, .value = "application/ccmp+xml" };
    pub const @"application/ccxml+xml": MimeType = MimeType{ .category = .application, .value = "application/ccxml+xml" };
    pub const @"application/cdfx+xml": MimeType = MimeType{ .category = .application, .value = "application/cdfx+xml" };
    pub const @"application/cdmi-capability": MimeType = MimeType{ .category = .application, .value = "application/cdmi-capability" };
    pub const @"application/cdmi-container": MimeType = MimeType{ .category = .application, .value = "application/cdmi-container" };
    pub const @"application/cdmi-domain": MimeType = MimeType{ .category = .application, .value = "application/cdmi-domain" };
    pub const @"application/cdmi-object": MimeType = MimeType{ .category = .application, .value = "application/cdmi-object" };
    pub const @"application/cdmi-queue": MimeType = MimeType{ .category = .application, .value = "application/cdmi-queue" };
    pub const @"application/cdni": MimeType = MimeType{ .category = .application, .value = "application/cdni" };
    pub const @"application/cea": MimeType = MimeType{ .category = .application, .value = "application/cea" };
    pub const @"application/cea-2018+xml": MimeType = MimeType{ .category = .application, .value = "application/cea-2018+xml" };
    pub const @"application/cellml+xml": MimeType = MimeType{ .category = .application, .value = "application/cellml+xml" };
    pub const @"application/cfw": MimeType = MimeType{ .category = .application, .value = "application/cfw" };
    pub const @"application/city+json": MimeType = MimeType{ .category = .application, .value = "application/city+json" };
    pub const @"application/clr": MimeType = MimeType{ .category = .application, .value = "application/clr" };
    pub const @"application/clue+xml": MimeType = MimeType{ .category = .application, .value = "application/clue+xml" };
    pub const @"application/clue_info+xml": MimeType = MimeType{ .category = .application, .value = "application/clue_info+xml" };
    pub const @"application/cms": MimeType = MimeType{ .category = .application, .value = "application/cms" };
    pub const @"application/cnrp+xml": MimeType = MimeType{ .category = .application, .value = "application/cnrp+xml" };
    pub const @"application/coap-group+json": MimeType = MimeType{ .category = .application, .value = "application/coap-group+json" };
    pub const @"application/coap-payload": MimeType = MimeType{ .category = .application, .value = "application/coap-payload" };
    pub const @"application/commonground": MimeType = MimeType{ .category = .application, .value = "application/commonground" };
    pub const @"application/conference-info+xml": MimeType = MimeType{ .category = .application, .value = "application/conference-info+xml" };
    pub const @"application/cose": MimeType = MimeType{ .category = .application, .value = "application/cose" };
    pub const @"application/cose-key": MimeType = MimeType{ .category = .application, .value = "application/cose-key" };
    pub const @"application/cose-key-set": MimeType = MimeType{ .category = .application, .value = "application/cose-key-set" };
    pub const @"application/cpl+xml": MimeType = MimeType{ .category = .application, .value = "application/cpl+xml" };
    pub const @"application/csrattrs": MimeType = MimeType{ .category = .application, .value = "application/csrattrs" };
    pub const @"application/csta+xml": MimeType = MimeType{ .category = .application, .value = "application/csta+xml" };
    pub const @"application/cstadata+xml": MimeType = MimeType{ .category = .application, .value = "application/cstadata+xml" };
    pub const @"application/csvm+json": MimeType = MimeType{ .category = .application, .value = "application/csvm+json" };
    pub const @"application/cu-seeme": MimeType = MimeType{ .category = .application, .value = "application/cu-seeme" };
    pub const @"application/cwt": MimeType = MimeType{ .category = .application, .value = "application/cwt" };
    pub const @"application/cybercash": MimeType = MimeType{ .category = .application, .value = "application/cybercash" };
    pub const @"application/dart": MimeType = MimeType{ .category = .application, .value = "application/dart" };
    pub const @"application/dash+xml": MimeType = MimeType{ .category = .application, .value = "application/dash+xml" };
    pub const @"application/dash-patch+xml": MimeType = MimeType{ .category = .application, .value = "application/dash-patch+xml" };
    pub const @"application/dashdelta": MimeType = MimeType{ .category = .application, .value = "application/dashdelta" };
    pub const @"application/davmount+xml": MimeType = MimeType{ .category = .application, .value = "application/davmount+xml" };
    pub const @"application/dca-rft": MimeType = MimeType{ .category = .application, .value = "application/dca-rft" };
    pub const @"application/dcd": MimeType = MimeType{ .category = .application, .value = "application/dcd" };
    pub const @"application/dec-dx": MimeType = MimeType{ .category = .application, .value = "application/dec-dx" };
    pub const @"application/dialog-info+xml": MimeType = MimeType{ .category = .application, .value = "application/dialog-info+xml" };
    pub const @"application/dicom": MimeType = MimeType{ .category = .application, .value = "application/dicom" };
    pub const @"application/dicom+json": MimeType = MimeType{ .category = .application, .value = "application/dicom+json" };
    pub const @"application/dicom+xml": MimeType = MimeType{ .category = .application, .value = "application/dicom+xml" };
    pub const @"application/dii": MimeType = MimeType{ .category = .application, .value = "application/dii" };
    pub const @"application/dit": MimeType = MimeType{ .category = .application, .value = "application/dit" };
    pub const @"application/dns": MimeType = MimeType{ .category = .application, .value = "application/dns" };
    pub const @"application/dns+json": MimeType = MimeType{ .category = .application, .value = "application/dns+json" };
    pub const @"application/dns-message": MimeType = MimeType{ .category = .application, .value = "application/dns-message" };
    pub const @"application/docbook+xml": MimeType = MimeType{ .category = .application, .value = "application/docbook+xml" };
    pub const @"application/dots+cbor": MimeType = MimeType{ .category = .application, .value = "application/dots+cbor" };
    pub const @"application/dskpp+xml": MimeType = MimeType{ .category = .application, .value = "application/dskpp+xml" };
    pub const @"application/dssc+der": MimeType = MimeType{ .category = .application, .value = "application/dssc+der" };
    pub const @"application/dssc+xml": MimeType = MimeType{ .category = .application, .value = "application/dssc+xml" };
    pub const @"application/dvcs": MimeType = MimeType{ .category = .application, .value = "application/dvcs" };
    pub const @"application/ecmascript": MimeType = MimeType{ .category = .application, .value = "application/ecmascript" };
    pub const @"application/edi-consent": MimeType = MimeType{ .category = .application, .value = "application/edi-consent" };
    pub const @"application/edi-x12": MimeType = MimeType{ .category = .application, .value = "application/edi-x12" };
    pub const @"application/edifact": MimeType = MimeType{ .category = .application, .value = "application/edifact" };
    pub const @"application/efi": MimeType = MimeType{ .category = .application, .value = "application/efi" };
    pub const @"application/elm+json": MimeType = MimeType{ .category = .application, .value = "application/elm+json" };
    pub const @"application/elm+xml": MimeType = MimeType{ .category = .application, .value = "application/elm+xml" };
    pub const @"application/emergencycalldata.cap+xml": MimeType = MimeType{ .category = .application, .value = "application/emergencycalldata.cap+xml" };
    pub const @"application/emergencycalldata.comment+xml": MimeType = MimeType{ .category = .application, .value = "application/emergencycalldata.comment+xml" };
    pub const @"application/emergencycalldata.control+xml": MimeType = MimeType{ .category = .application, .value = "application/emergencycalldata.control+xml" };
    pub const @"application/emergencycalldata.deviceinfo+xml": MimeType = MimeType{ .category = .application, .value = "application/emergencycalldata.deviceinfo+xml" };
    pub const @"application/emergencycalldata.ecall.msd": MimeType = MimeType{ .category = .application, .value = "application/emergencycalldata.ecall.msd" };
    pub const @"application/emergencycalldata.providerinfo+xml": MimeType = MimeType{ .category = .application, .value = "application/emergencycalldata.providerinfo+xml" };
    pub const @"application/emergencycalldata.serviceinfo+xml": MimeType = MimeType{ .category = .application, .value = "application/emergencycalldata.serviceinfo+xml" };
    pub const @"application/emergencycalldata.subscriberinfo+xml": MimeType = MimeType{ .category = .application, .value = "application/emergencycalldata.subscriberinfo+xml" };
    pub const @"application/emergencycalldata.veds+xml": MimeType = MimeType{ .category = .application, .value = "application/emergencycalldata.veds+xml" };
    pub const @"application/emma+xml": MimeType = MimeType{ .category = .application, .value = "application/emma+xml" };
    pub const @"application/emotionml+xml": MimeType = MimeType{ .category = .application, .value = "application/emotionml+xml" };
    pub const @"application/encaprtp": MimeType = MimeType{ .category = .application, .value = "application/encaprtp" };
    pub const @"application/epp+xml": MimeType = MimeType{ .category = .application, .value = "application/epp+xml" };
    pub const @"application/epub+zip": MimeType = MimeType{ .category = .application, .value = "application/epub+zip" };
    pub const @"application/eshop": MimeType = MimeType{ .category = .application, .value = "application/eshop" };
    pub const @"application/exi": MimeType = MimeType{ .category = .application, .value = "application/exi" };
    pub const @"application/expect-ct-report+json": MimeType = MimeType{ .category = .application, .value = "application/expect-ct-report+json" };
    pub const @"application/express": MimeType = MimeType{ .category = .application, .value = "application/express" };
    pub const @"application/fastinfoset": MimeType = MimeType{ .category = .application, .value = "application/fastinfoset" };
    pub const @"application/fastsoap": MimeType = MimeType{ .category = .application, .value = "application/fastsoap" };
    pub const @"application/fdt+xml": MimeType = MimeType{ .category = .application, .value = "application/fdt+xml" };
    pub const @"application/fhir+json": MimeType = MimeType{ .category = .application, .value = "application/fhir+json" };
    pub const @"application/fhir+xml": MimeType = MimeType{ .category = .application, .value = "application/fhir+xml" };
    pub const @"application/fido.trusted-apps+json": MimeType = MimeType{ .category = .application, .value = "application/fido.trusted-apps+json" };
    pub const @"application/fits": MimeType = MimeType{ .category = .application, .value = "application/fits" };
    pub const @"application/flexfec": MimeType = MimeType{ .category = .application, .value = "application/flexfec" };
    pub const @"application/font-sfnt": MimeType = MimeType{ .category = .application, .value = "application/font-sfnt" };
    pub const @"application/font-tdpfr": MimeType = MimeType{ .category = .application, .value = "application/font-tdpfr" };
    pub const @"application/font-woff": MimeType = MimeType{ .category = .application, .value = "application/font-woff" };
    pub const @"application/framework-attributes+xml": MimeType = MimeType{ .category = .application, .value = "application/framework-attributes+xml" };
    pub const @"application/geo+json": MimeType = MimeType{ .category = .application, .value = "application/geo+json" };
    pub const @"application/geo+json-seq": MimeType = MimeType{ .category = .application, .value = "application/geo+json-seq" };
    pub const @"application/geopackage+sqlite3": MimeType = MimeType{ .category = .application, .value = "application/geopackage+sqlite3" };
    pub const @"application/geoxacml+xml": MimeType = MimeType{ .category = .application, .value = "application/geoxacml+xml" };
    pub const @"application/gltf-buffer": MimeType = MimeType{ .category = .application, .value = "application/gltf-buffer" };
    pub const @"application/gml+xml": MimeType = MimeType{ .category = .application, .value = "application/gml+xml" };
    pub const @"application/gpx+xml": MimeType = MimeType{ .category = .application, .value = "application/gpx+xml" };
    pub const @"application/gxf": MimeType = MimeType{ .category = .application, .value = "application/gxf" };
    pub const @"application/gzip": MimeType = MimeType{ .category = .application, .value = "application/gzip" };
    pub const @"application/h224": MimeType = MimeType{ .category = .application, .value = "application/h224" };
    pub const @"application/held+xml": MimeType = MimeType{ .category = .application, .value = "application/held+xml" };
    pub const @"application/hjson": MimeType = MimeType{ .category = .application, .value = "application/hjson" };
    pub const @"application/http": MimeType = MimeType{ .category = .application, .value = "application/http" };
    pub const @"application/hyperstudio": MimeType = MimeType{ .category = .application, .value = "application/hyperstudio" };
    pub const @"application/ibe-key-request+xml": MimeType = MimeType{ .category = .application, .value = "application/ibe-key-request+xml" };
    pub const @"application/ibe-pkg-reply+xml": MimeType = MimeType{ .category = .application, .value = "application/ibe-pkg-reply+xml" };
    pub const @"application/ibe-pp-data": MimeType = MimeType{ .category = .application, .value = "application/ibe-pp-data" };
    pub const @"application/iges": MimeType = MimeType{ .category = .application, .value = "application/iges" };
    pub const @"application/im-iscomposing+xml": MimeType = MimeType{ .category = .application, .value = "application/im-iscomposing+xml" };
    pub const @"application/index": MimeType = MimeType{ .category = .application, .value = "application/index" };
    pub const @"application/index.cmd": MimeType = MimeType{ .category = .application, .value = "application/index.cmd" };
    pub const @"application/index.obj": MimeType = MimeType{ .category = .application, .value = "application/index.obj" };
    pub const @"application/index.response": MimeType = MimeType{ .category = .application, .value = "application/index.response" };
    pub const @"application/index.vnd": MimeType = MimeType{ .category = .application, .value = "application/index.vnd" };
    pub const @"application/inkml+xml": MimeType = MimeType{ .category = .application, .value = "application/inkml+xml" };
    pub const @"application/iotp": MimeType = MimeType{ .category = .application, .value = "application/iotp" };
    pub const @"application/ipfix": MimeType = MimeType{ .category = .application, .value = "application/ipfix" };
    pub const @"application/ipp": MimeType = MimeType{ .category = .application, .value = "application/ipp" };
    pub const @"application/isup": MimeType = MimeType{ .category = .application, .value = "application/isup" };
    pub const @"application/its+xml": MimeType = MimeType{ .category = .application, .value = "application/its+xml" };
    pub const @"application/java-archive": MimeType = MimeType{ .category = .application, .value = "application/java-archive" };
    pub const @"application/java-serialized-object": MimeType = MimeType{ .category = .application, .value = "application/java-serialized-object" };
    pub const @"application/java-vm": MimeType = MimeType{ .category = .application, .value = "application/java-vm" };
    pub const @"application/javascript" = javascript;
    pub const @"application/jf2feed+json": MimeType = MimeType{ .category = .application, .value = "application/jf2feed+json" };
    pub const @"application/jose": MimeType = MimeType{ .category = .application, .value = "application/jose" };
    pub const @"application/jose+json": MimeType = MimeType{ .category = .application, .value = "application/jose+json" };
    pub const @"application/jrd+json": MimeType = MimeType{ .category = .application, .value = "application/jrd+json" };
    pub const @"application/jscalendar+json": MimeType = MimeType{ .category = .application, .value = "application/jscalendar+json" };
    pub const @"application/json" = json;
    pub const @"application/json-patch+json": MimeType = MimeType{ .category = .application, .value = "application/json-patch+json" };
    pub const @"application/json-seq": MimeType = MimeType{ .category = .application, .value = "application/json-seq" };
    pub const @"application/json5": MimeType = MimeType{ .category = .application, .value = "application/json5" };
    pub const @"application/jsonml+json": MimeType = MimeType{ .category = .application, .value = "application/jsonml+json" };
    pub const @"application/jwk+json": MimeType = MimeType{ .category = .application, .value = "application/jwk+json" };
    pub const @"application/jwk-set+json": MimeType = MimeType{ .category = .application, .value = "application/jwk-set+json" };
    pub const @"application/jwt": MimeType = MimeType{ .category = .application, .value = "application/jwt" };
    pub const @"application/kpml-request+xml": MimeType = MimeType{ .category = .application, .value = "application/kpml-request+xml" };
    pub const @"application/kpml-response+xml": MimeType = MimeType{ .category = .application, .value = "application/kpml-response+xml" };
    pub const @"application/ld+json": MimeType = MimeType{ .category = .application, .value = "application/ld+json" };
    pub const @"application/lgr+xml": MimeType = MimeType{ .category = .application, .value = "application/lgr+xml" };
    pub const @"application/link-format": MimeType = MimeType{ .category = .application, .value = "application/link-format" };
    pub const @"application/load-control+xml": MimeType = MimeType{ .category = .application, .value = "application/load-control+xml" };
    pub const @"application/lost+xml": MimeType = MimeType{ .category = .application, .value = "application/lost+xml" };
    pub const @"application/lostsync+xml": MimeType = MimeType{ .category = .application, .value = "application/lostsync+xml" };
    pub const @"application/lpf+zip": MimeType = MimeType{ .category = .application, .value = "application/lpf+zip" };
    pub const @"application/lxf": MimeType = MimeType{ .category = .application, .value = "application/lxf" };
    pub const @"application/mac-binhex40": MimeType = MimeType{ .category = .application, .value = "application/mac-binhex40" };
    pub const @"application/mac-compactpro": MimeType = MimeType{ .category = .application, .value = "application/mac-compactpro" };
    pub const @"application/macwriteii": MimeType = MimeType{ .category = .application, .value = "application/macwriteii" };
    pub const @"application/mads+xml": MimeType = MimeType{ .category = .application, .value = "application/mads+xml" };
    pub const @"application/manifest+json": MimeType = MimeType{ .category = .application, .value = "application/manifest+json" };
    pub const @"application/marc": MimeType = MimeType{ .category = .application, .value = "application/marc" };
    pub const @"application/marcxml+xml": MimeType = MimeType{ .category = .application, .value = "application/marcxml+xml" };
    pub const @"application/mathematica": MimeType = MimeType{ .category = .application, .value = "application/mathematica" };
    pub const @"application/mathml+xml": MimeType = MimeType{ .category = .application, .value = "application/mathml+xml" };
    pub const @"application/mathml-content+xml": MimeType = MimeType{ .category = .application, .value = "application/mathml-content+xml" };
    pub const @"application/mathml-presentation+xml": MimeType = MimeType{ .category = .application, .value = "application/mathml-presentation+xml" };
    pub const @"application/mbms-associated-procedure-description+xml": MimeType = MimeType{ .category = .application, .value = "application/mbms-associated-procedure-description+xml" };
    pub const @"application/mbms-deregister+xml": MimeType = MimeType{ .category = .application, .value = "application/mbms-deregister+xml" };
    pub const @"application/mbms-envelope+xml": MimeType = MimeType{ .category = .application, .value = "application/mbms-envelope+xml" };
    pub const @"application/mbms-msk+xml": MimeType = MimeType{ .category = .application, .value = "application/mbms-msk+xml" };
    pub const @"application/mbms-msk-response+xml": MimeType = MimeType{ .category = .application, .value = "application/mbms-msk-response+xml" };
    pub const @"application/mbms-protection-description+xml": MimeType = MimeType{ .category = .application, .value = "application/mbms-protection-description+xml" };
    pub const @"application/mbms-reception-report+xml": MimeType = MimeType{ .category = .application, .value = "application/mbms-reception-report+xml" };
    pub const @"application/mbms-register+xml": MimeType = MimeType{ .category = .application, .value = "application/mbms-register+xml" };
    pub const @"application/mbms-register-response+xml": MimeType = MimeType{ .category = .application, .value = "application/mbms-register-response+xml" };
    pub const @"application/mbms-schedule+xml": MimeType = MimeType{ .category = .application, .value = "application/mbms-schedule+xml" };
    pub const @"application/mbms-user-service-description+xml": MimeType = MimeType{ .category = .application, .value = "application/mbms-user-service-description+xml" };
    pub const @"application/mbox": MimeType = MimeType{ .category = .application, .value = "application/mbox" };
    pub const @"application/media-policy-dataset+xml": MimeType = MimeType{ .category = .application, .value = "application/media-policy-dataset+xml" };
    pub const @"application/media_control+xml": MimeType = MimeType{ .category = .application, .value = "application/media_control+xml" };
    pub const @"application/mediaservercontrol+xml": MimeType = MimeType{ .category = .application, .value = "application/mediaservercontrol+xml" };
    pub const @"application/merge-patch+json": MimeType = MimeType{ .category = .application, .value = "application/merge-patch+json" };
    pub const @"application/metalink+xml": MimeType = MimeType{ .category = .application, .value = "application/metalink+xml" };
    pub const @"application/metalink4+xml": MimeType = MimeType{ .category = .application, .value = "application/metalink4+xml" };
    pub const @"application/mets+xml": MimeType = MimeType{ .category = .application, .value = "application/mets+xml" };
    pub const @"application/mf4": MimeType = MimeType{ .category = .application, .value = "application/mf4" };
    pub const @"application/mikey": MimeType = MimeType{ .category = .application, .value = "application/mikey" };
    pub const @"application/mipc": MimeType = MimeType{ .category = .application, .value = "application/mipc" };
    pub const @"application/missing-blocks+cbor-seq": MimeType = MimeType{ .category = .application, .value = "application/missing-blocks+cbor-seq" };
    pub const @"application/mmt-aei+xml": MimeType = MimeType{ .category = .application, .value = "application/mmt-aei+xml" };
    pub const @"application/mmt-usd+xml": MimeType = MimeType{ .category = .application, .value = "application/mmt-usd+xml" };
    pub const @"application/mods+xml": MimeType = MimeType{ .category = .application, .value = "application/mods+xml" };
    pub const @"application/moss-keys": MimeType = MimeType{ .category = .application, .value = "application/moss-keys" };
    pub const @"application/moss-signature": MimeType = MimeType{ .category = .application, .value = "application/moss-signature" };
    pub const @"application/mosskey-data": MimeType = MimeType{ .category = .application, .value = "application/mosskey-data" };
    pub const @"application/mosskey-request": MimeType = MimeType{ .category = .application, .value = "application/mosskey-request" };
    pub const @"application/mp21": MimeType = MimeType{ .category = .application, .value = "application/mp21" };
    pub const @"application/mp4": MimeType = MimeType{ .category = .application, .value = "application/mp4" };
    pub const @"application/mpeg4-generic": MimeType = MimeType{ .category = .application, .value = "application/mpeg4-generic" };
    pub const @"application/mpeg4-iod": MimeType = MimeType{ .category = .application, .value = "application/mpeg4-iod" };
    pub const @"application/mpeg4-iod-xmt": MimeType = MimeType{ .category = .application, .value = "application/mpeg4-iod-xmt" };
    pub const @"application/mrb-consumer+xml": MimeType = MimeType{ .category = .application, .value = "application/mrb-consumer+xml" };
    pub const @"application/mrb-publish+xml": MimeType = MimeType{ .category = .application, .value = "application/mrb-publish+xml" };
    pub const @"application/msc-ivr+xml": MimeType = MimeType{ .category = .application, .value = "application/msc-ivr+xml" };
    pub const @"application/msc-mixer+xml": MimeType = MimeType{ .category = .application, .value = "application/msc-mixer+xml" };
    pub const @"application/msword": MimeType = MimeType{ .category = .application, .value = "application/msword" };
    pub const @"application/mud+json": MimeType = MimeType{ .category = .application, .value = "application/mud+json" };
    pub const @"application/multipart-core": MimeType = MimeType{ .category = .application, .value = "application/multipart-core" };
    pub const @"application/mxf": MimeType = MimeType{ .category = .application, .value = "application/mxf" };
    pub const @"application/n-quads": MimeType = MimeType{ .category = .application, .value = "application/n-quads" };
    pub const @"application/n-triples": MimeType = MimeType{ .category = .application, .value = "application/n-triples" };
    pub const @"application/nasdata": MimeType = MimeType{ .category = .application, .value = "application/nasdata" };
    pub const @"application/news-checkgroups": MimeType = MimeType{ .category = .application, .value = "application/news-checkgroups" };
    pub const @"application/news-groupinfo": MimeType = MimeType{ .category = .application, .value = "application/news-groupinfo" };
    pub const @"application/news-transmission": MimeType = MimeType{ .category = .application, .value = "application/news-transmission" };
    pub const @"application/nlsml+xml": MimeType = MimeType{ .category = .application, .value = "application/nlsml+xml" };
    pub const @"application/nss": MimeType = MimeType{ .category = .application, .value = "application/nss" };
    pub const @"application/oauth-authz-req+jwt": MimeType = MimeType{ .category = .application, .value = "application/oauth-authz-req+jwt" };
    pub const @"application/oblivious-dns-message": MimeType = MimeType{ .category = .application, .value = "application/oblivious-dns-message" };
    pub const @"application/ocsp-request": MimeType = MimeType{ .category = .application, .value = "application/ocsp-request" };
    pub const @"application/ocsp-response": MimeType = MimeType{ .category = .application, .value = "application/ocsp-response" };
    pub const @"application/octet-stream": MimeType = MimeType{ .category = .application, .value = "application/octet-stream" };
    pub const @"application/oda": MimeType = MimeType{ .category = .application, .value = "application/oda" };
    pub const @"application/odm+xml": MimeType = MimeType{ .category = .application, .value = "application/odm+xml" };
    pub const @"application/odx": MimeType = MimeType{ .category = .application, .value = "application/odx" };
    pub const @"application/oebps-package+xml": MimeType = MimeType{ .category = .application, .value = "application/oebps-package+xml" };
    pub const @"application/ogg": MimeType = MimeType{ .category = .application, .value = "application/ogg" };
    pub const @"application/omdoc+xml": MimeType = MimeType{ .category = .application, .value = "application/omdoc+xml" };
    pub const @"application/onenote": MimeType = MimeType{ .category = .application, .value = "application/onenote" };
    pub const @"application/opc-nodeset+xml": MimeType = MimeType{ .category = .application, .value = "application/opc-nodeset+xml" };
    pub const @"application/oscore": MimeType = MimeType{ .category = .application, .value = "application/oscore" };
    pub const @"application/oxps": MimeType = MimeType{ .category = .application, .value = "application/oxps" };
    pub const @"application/p21": MimeType = MimeType{ .category = .application, .value = "application/p21" };
    pub const @"application/p21+zip": MimeType = MimeType{ .category = .application, .value = "application/p21+zip" };
    pub const @"application/p2p-overlay+xml": MimeType = MimeType{ .category = .application, .value = "application/p2p-overlay+xml" };
    pub const @"application/parityfec": MimeType = MimeType{ .category = .application, .value = "application/parityfec" };
    pub const @"application/passport": MimeType = MimeType{ .category = .application, .value = "application/passport" };
    pub const @"application/patch-ops-error+xml": MimeType = MimeType{ .category = .application, .value = "application/patch-ops-error+xml" };
    pub const @"application/pdf": MimeType = MimeType{ .category = .application, .value = "application/pdf" };
    pub const @"application/pdx": MimeType = MimeType{ .category = .application, .value = "application/pdx" };
    pub const @"application/pem-certificate-chain": MimeType = MimeType{ .category = .application, .value = "application/pem-certificate-chain" };
    pub const @"application/pgp-encrypted": MimeType = MimeType{ .category = .application, .value = "application/pgp-encrypted" };
    pub const @"application/pgp-keys": MimeType = MimeType{ .category = .application, .value = "application/pgp-keys" };
    pub const @"application/pgp-signature": MimeType = MimeType{ .category = .application, .value = "application/pgp-signature" };
    pub const @"application/pics-rules": MimeType = MimeType{ .category = .application, .value = "application/pics-rules" };
    pub const @"application/pidf+xml": MimeType = MimeType{ .category = .application, .value = "application/pidf+xml" };
    pub const @"application/pidf-diff+xml": MimeType = MimeType{ .category = .application, .value = "application/pidf-diff+xml" };
    pub const @"application/pkcs10": MimeType = MimeType{ .category = .application, .value = "application/pkcs10" };
    pub const @"application/pkcs12": MimeType = MimeType{ .category = .application, .value = "application/pkcs12" };
    pub const @"application/pkcs7-mime": MimeType = MimeType{ .category = .application, .value = "application/pkcs7-mime" };
    pub const @"application/pkcs7-signature": MimeType = MimeType{ .category = .application, .value = "application/pkcs7-signature" };
    pub const @"application/pkcs8": MimeType = MimeType{ .category = .application, .value = "application/pkcs8" };
    pub const @"application/pkcs8-encrypted": MimeType = MimeType{ .category = .application, .value = "application/pkcs8-encrypted" };
    pub const @"application/pkix-attr-cert": MimeType = MimeType{ .category = .application, .value = "application/pkix-attr-cert" };
    pub const @"application/pkix-cert": MimeType = MimeType{ .category = .application, .value = "application/pkix-cert" };
    pub const @"application/pkix-crl": MimeType = MimeType{ .category = .application, .value = "application/pkix-crl" };
    pub const @"application/pkix-pkipath": MimeType = MimeType{ .category = .application, .value = "application/pkix-pkipath" };
    pub const @"application/pkixcmp": MimeType = MimeType{ .category = .application, .value = "application/pkixcmp" };
    pub const @"application/pls+xml": MimeType = MimeType{ .category = .application, .value = "application/pls+xml" };
    pub const @"application/poc-settings+xml": MimeType = MimeType{ .category = .application, .value = "application/poc-settings+xml" };
    pub const @"application/postscript": MimeType = MimeType{ .category = .application, .value = "application/postscript" };
    pub const @"application/ppsp-tracker+json": MimeType = MimeType{ .category = .application, .value = "application/ppsp-tracker+json" };
    pub const @"application/problem+json": MimeType = MimeType{ .category = .application, .value = "application/problem+json" };
    pub const @"application/problem+xml": MimeType = MimeType{ .category = .application, .value = "application/problem+xml" };
    pub const @"application/provenance+xml": MimeType = MimeType{ .category = .application, .value = "application/provenance+xml" };
    pub const @"application/prs.alvestrand.titrax-sheet": MimeType = MimeType{ .category = .application, .value = "application/prs.alvestrand.titrax-sheet" };
    pub const @"application/prs.cww": MimeType = MimeType{ .category = .application, .value = "application/prs.cww" };
    pub const @"application/prs.cyn": MimeType = MimeType{ .category = .application, .value = "application/prs.cyn" };
    pub const @"application/prs.hpub+zip": MimeType = MimeType{ .category = .application, .value = "application/prs.hpub+zip" };
    pub const @"application/prs.nprend": MimeType = MimeType{ .category = .application, .value = "application/prs.nprend" };
    pub const @"application/prs.plucker": MimeType = MimeType{ .category = .application, .value = "application/prs.plucker" };
    pub const @"application/prs.rdf-xml-crypt": MimeType = MimeType{ .category = .application, .value = "application/prs.rdf-xml-crypt" };
    pub const @"application/prs.xsf+xml": MimeType = MimeType{ .category = .application, .value = "application/prs.xsf+xml" };
    pub const @"application/pskc+xml": MimeType = MimeType{ .category = .application, .value = "application/pskc+xml" };
    pub const @"application/pvd+json": MimeType = MimeType{ .category = .application, .value = "application/pvd+json" };
    pub const @"application/qsig": MimeType = MimeType{ .category = .application, .value = "application/qsig" };
    pub const @"application/raml+yaml": MimeType = MimeType{ .category = .application, .value = "application/raml+yaml" };
    pub const @"application/raptorfec": MimeType = MimeType{ .category = .application, .value = "application/raptorfec" };
    pub const @"application/rdap+json": MimeType = MimeType{ .category = .application, .value = "application/rdap+json" };
    pub const @"application/rdf+xml": MimeType = MimeType{ .category = .application, .value = "application/rdf+xml" };
    pub const @"application/reginfo+xml": MimeType = MimeType{ .category = .application, .value = "application/reginfo+xml" };
    pub const @"application/relax-ng-compact-syntax": MimeType = MimeType{ .category = .application, .value = "application/relax-ng-compact-syntax" };
    pub const @"application/remote-printing": MimeType = MimeType{ .category = .application, .value = "application/remote-printing" };
    pub const @"application/reputon+json": MimeType = MimeType{ .category = .application, .value = "application/reputon+json" };
    pub const @"application/resource-lists+xml": MimeType = MimeType{ .category = .application, .value = "application/resource-lists+xml" };
    pub const @"application/resource-lists-diff+xml": MimeType = MimeType{ .category = .application, .value = "application/resource-lists-diff+xml" };
    pub const @"application/rfc+xml": MimeType = MimeType{ .category = .application, .value = "application/rfc+xml" };
    pub const @"application/riscos": MimeType = MimeType{ .category = .application, .value = "application/riscos" };
    pub const @"application/rlmi+xml": MimeType = MimeType{ .category = .application, .value = "application/rlmi+xml" };
    pub const @"application/rls-services+xml": MimeType = MimeType{ .category = .application, .value = "application/rls-services+xml" };
    pub const @"application/route-apd+xml": MimeType = MimeType{ .category = .application, .value = "application/route-apd+xml" };
    pub const @"application/route-s-tsid+xml": MimeType = MimeType{ .category = .application, .value = "application/route-s-tsid+xml" };
    pub const @"application/route-usd+xml": MimeType = MimeType{ .category = .application, .value = "application/route-usd+xml" };
    pub const @"application/rpki-ghostbusters": MimeType = MimeType{ .category = .application, .value = "application/rpki-ghostbusters" };
    pub const @"application/rpki-manifest": MimeType = MimeType{ .category = .application, .value = "application/rpki-manifest" };
    pub const @"application/rpki-publication": MimeType = MimeType{ .category = .application, .value = "application/rpki-publication" };
    pub const @"application/rpki-roa": MimeType = MimeType{ .category = .application, .value = "application/rpki-roa" };
    pub const @"application/rpki-updown": MimeType = MimeType{ .category = .application, .value = "application/rpki-updown" };
    pub const @"application/rsd+xml": MimeType = MimeType{ .category = .application, .value = "application/rsd+xml" };
    pub const @"application/rss+xml": MimeType = MimeType{ .category = .application, .value = "application/rss+xml" };
    pub const @"application/rtf": MimeType = MimeType{ .category = .application, .value = "application/rtf" };
    pub const @"application/rtploopback": MimeType = MimeType{ .category = .application, .value = "application/rtploopback" };
    pub const @"application/rtx": MimeType = MimeType{ .category = .application, .value = "application/rtx" };
    pub const @"application/samlassertion+xml": MimeType = MimeType{ .category = .application, .value = "application/samlassertion+xml" };
    pub const @"application/samlmetadata+xml": MimeType = MimeType{ .category = .application, .value = "application/samlmetadata+xml" };
    pub const @"application/sarif+json": MimeType = MimeType{ .category = .application, .value = "application/sarif+json" };
    pub const @"application/sarif-external-properties+json": MimeType = MimeType{ .category = .application, .value = "application/sarif-external-properties+json" };
    pub const @"application/sbe": MimeType = MimeType{ .category = .application, .value = "application/sbe" };
    pub const @"application/sbml+xml": MimeType = MimeType{ .category = .application, .value = "application/sbml+xml" };
    pub const @"application/scaip+xml": MimeType = MimeType{ .category = .application, .value = "application/scaip+xml" };
    pub const @"application/scim+json": MimeType = MimeType{ .category = .application, .value = "application/scim+json" };
    pub const @"application/scvp-cv-request": MimeType = MimeType{ .category = .application, .value = "application/scvp-cv-request" };
    pub const @"application/scvp-cv-response": MimeType = MimeType{ .category = .application, .value = "application/scvp-cv-response" };
    pub const @"application/scvp-vp-request": MimeType = MimeType{ .category = .application, .value = "application/scvp-vp-request" };
    pub const @"application/scvp-vp-response": MimeType = MimeType{ .category = .application, .value = "application/scvp-vp-response" };
    pub const @"application/sdp": MimeType = MimeType{ .category = .application, .value = "application/sdp" };
    pub const @"application/secevent+jwt": MimeType = MimeType{ .category = .application, .value = "application/secevent+jwt" };
    pub const @"application/senml+cbor": MimeType = MimeType{ .category = .application, .value = "application/senml+cbor" };
    pub const @"application/senml+json": MimeType = MimeType{ .category = .application, .value = "application/senml+json" };
    pub const @"application/senml+xml": MimeType = MimeType{ .category = .application, .value = "application/senml+xml" };
    pub const @"application/senml-etch+cbor": MimeType = MimeType{ .category = .application, .value = "application/senml-etch+cbor" };
    pub const @"application/senml-etch+json": MimeType = MimeType{ .category = .application, .value = "application/senml-etch+json" };
    pub const @"application/senml-exi": MimeType = MimeType{ .category = .application, .value = "application/senml-exi" };
    pub const @"application/sensml+cbor": MimeType = MimeType{ .category = .application, .value = "application/sensml+cbor" };
    pub const @"application/sensml+json": MimeType = MimeType{ .category = .application, .value = "application/sensml+json" };
    pub const @"application/sensml+xml": MimeType = MimeType{ .category = .application, .value = "application/sensml+xml" };
    pub const @"application/sensml-exi": MimeType = MimeType{ .category = .application, .value = "application/sensml-exi" };
    pub const @"application/sep+xml": MimeType = MimeType{ .category = .application, .value = "application/sep+xml" };
    pub const @"application/sep-exi": MimeType = MimeType{ .category = .application, .value = "application/sep-exi" };
    pub const @"application/session-info": MimeType = MimeType{ .category = .application, .value = "application/session-info" };
    pub const @"application/set-payment": MimeType = MimeType{ .category = .application, .value = "application/set-payment" };
    pub const @"application/set-payment-initiation": MimeType = MimeType{ .category = .application, .value = "application/set-payment-initiation" };
    pub const @"application/set-registration": MimeType = MimeType{ .category = .application, .value = "application/set-registration" };
    pub const @"application/set-registration-initiation": MimeType = MimeType{ .category = .application, .value = "application/set-registration-initiation" };
    pub const @"application/sgml": MimeType = MimeType{ .category = .application, .value = "application/sgml" };
    pub const @"application/sgml-open-catalog": MimeType = MimeType{ .category = .application, .value = "application/sgml-open-catalog" };
    pub const @"application/shf+xml": MimeType = MimeType{ .category = .application, .value = "application/shf+xml" };
    pub const @"application/sieve": MimeType = MimeType{ .category = .application, .value = "application/sieve" };
    pub const @"application/simple-filter+xml": MimeType = MimeType{ .category = .application, .value = "application/simple-filter+xml" };
    pub const @"application/simple-message-summary": MimeType = MimeType{ .category = .application, .value = "application/simple-message-summary" };
    pub const @"application/simplesymbolcontainer": MimeType = MimeType{ .category = .application, .value = "application/simplesymbolcontainer" };
    pub const @"application/sipc": MimeType = MimeType{ .category = .application, .value = "application/sipc" };
    pub const @"application/slate": MimeType = MimeType{ .category = .application, .value = "application/slate" };
    pub const @"application/smil": MimeType = MimeType{ .category = .application, .value = "application/smil" };
    pub const @"application/smil+xml": MimeType = MimeType{ .category = .application, .value = "application/smil+xml" };
    pub const @"application/smpte336m": MimeType = MimeType{ .category = .application, .value = "application/smpte336m" };
    pub const @"application/soap+fastinfoset": MimeType = MimeType{ .category = .application, .value = "application/soap+fastinfoset" };
    pub const @"application/soap+xml": MimeType = MimeType{ .category = .application, .value = "application/soap+xml" };
    pub const @"application/sparql-query": MimeType = MimeType{ .category = .application, .value = "application/sparql-query" };
    pub const @"application/sparql-results+xml": MimeType = MimeType{ .category = .application, .value = "application/sparql-results+xml" };
    pub const @"application/spdx+json": MimeType = MimeType{ .category = .application, .value = "application/spdx+json" };
    pub const @"application/spirits-event+xml": MimeType = MimeType{ .category = .application, .value = "application/spirits-event+xml" };
    pub const @"application/sql": MimeType = MimeType{ .category = .application, .value = "application/sql" };
    pub const @"application/srgs": MimeType = MimeType{ .category = .application, .value = "application/srgs" };
    pub const @"application/srgs+xml": MimeType = MimeType{ .category = .application, .value = "application/srgs+xml" };
    pub const @"application/sru+xml": MimeType = MimeType{ .category = .application, .value = "application/sru+xml" };
    pub const @"application/ssdl+xml": MimeType = MimeType{ .category = .application, .value = "application/ssdl+xml" };
    pub const @"application/ssml+xml": MimeType = MimeType{ .category = .application, .value = "application/ssml+xml" };
    pub const @"application/stix+json": MimeType = MimeType{ .category = .application, .value = "application/stix+json" };
    pub const @"application/swid+xml": MimeType = MimeType{ .category = .application, .value = "application/swid+xml" };
    pub const @"application/tamp-apex-update": MimeType = MimeType{ .category = .application, .value = "application/tamp-apex-update" };
    pub const @"application/tamp-apex-update-confirm": MimeType = MimeType{ .category = .application, .value = "application/tamp-apex-update-confirm" };
    pub const @"application/tamp-community-update": MimeType = MimeType{ .category = .application, .value = "application/tamp-community-update" };
    pub const @"application/tamp-community-update-confirm": MimeType = MimeType{ .category = .application, .value = "application/tamp-community-update-confirm" };
    pub const @"application/tamp-error": MimeType = MimeType{ .category = .application, .value = "application/tamp-error" };
    pub const @"application/tamp-sequence-adjust": MimeType = MimeType{ .category = .application, .value = "application/tamp-sequence-adjust" };
    pub const @"application/tamp-sequence-adjust-confirm": MimeType = MimeType{ .category = .application, .value = "application/tamp-sequence-adjust-confirm" };
    pub const @"application/tamp-status-query": MimeType = MimeType{ .category = .application, .value = "application/tamp-status-query" };
    pub const @"application/tamp-status-response": MimeType = MimeType{ .category = .application, .value = "application/tamp-status-response" };
    pub const @"application/tamp-update": MimeType = MimeType{ .category = .application, .value = "application/tamp-update" };
    pub const @"application/tamp-update-confirm": MimeType = MimeType{ .category = .application, .value = "application/tamp-update-confirm" };
    pub const @"application/tar": MimeType = MimeType{ .category = .application, .value = "application/tar" };
    pub const @"application/taxii+json": MimeType = MimeType{ .category = .application, .value = "application/taxii+json" };
    pub const @"application/td+json": MimeType = MimeType{ .category = .application, .value = "application/td+json" };
    pub const @"application/tei+xml": MimeType = MimeType{ .category = .application, .value = "application/tei+xml" };
    pub const @"application/tetra_isi": MimeType = MimeType{ .category = .application, .value = "application/tetra_isi" };
    pub const @"application/thraud+xml": MimeType = MimeType{ .category = .application, .value = "application/thraud+xml" };
    pub const @"application/timestamp-query": MimeType = MimeType{ .category = .application, .value = "application/timestamp-query" };
    pub const @"application/timestamp-reply": MimeType = MimeType{ .category = .application, .value = "application/timestamp-reply" };
    pub const @"application/timestamped-data": MimeType = MimeType{ .category = .application, .value = "application/timestamped-data" };
    pub const @"application/tlsrpt+gzip": MimeType = MimeType{ .category = .application, .value = "application/tlsrpt+gzip" };
    pub const @"application/tlsrpt+json": MimeType = MimeType{ .category = .application, .value = "application/tlsrpt+json" };
    pub const @"application/tnauthlist": MimeType = MimeType{ .category = .application, .value = "application/tnauthlist" };
    pub const @"application/token-introspection+jwt": MimeType = MimeType{ .category = .application, .value = "application/token-introspection+jwt" };
    pub const @"application/toml": MimeType = MimeType{ .category = .application, .value = "application/toml" };
    pub const @"application/trickle-ice-sdpfrag": MimeType = MimeType{ .category = .application, .value = "application/trickle-ice-sdpfrag" };
    pub const @"application/trig": MimeType = MimeType{ .category = .application, .value = "application/trig" };
    pub const @"application/ttml+xml": MimeType = MimeType{ .category = .application, .value = "application/ttml+xml" };
    pub const @"application/tve-trigger": MimeType = MimeType{ .category = .application, .value = "application/tve-trigger" };
    pub const @"application/tzif": MimeType = MimeType{ .category = .application, .value = "application/tzif" };
    pub const @"application/tzif-leap": MimeType = MimeType{ .category = .application, .value = "application/tzif-leap" };
    pub const @"application/ubjson": MimeType = MimeType{ .category = .application, .value = "application/ubjson" };
    pub const @"application/ulpfec": MimeType = MimeType{ .category = .application, .value = "application/ulpfec" };
    pub const @"application/urc-grpsheet+xml": MimeType = MimeType{ .category = .application, .value = "application/urc-grpsheet+xml" };
    pub const @"application/urc-ressheet+xml": MimeType = MimeType{ .category = .application, .value = "application/urc-ressheet+xml" };
    pub const @"application/urc-targetdesc+xml": MimeType = MimeType{ .category = .application, .value = "application/urc-targetdesc+xml" };
    pub const @"application/urc-uisocketdesc+xml": MimeType = MimeType{ .category = .application, .value = "application/urc-uisocketdesc+xml" };
    pub const @"application/vcard+json": MimeType = MimeType{ .category = .application, .value = "application/vcard+json" };
    pub const @"application/vcard+xml": MimeType = MimeType{ .category = .application, .value = "application/vcard+xml" };
    pub const @"application/vemmi": MimeType = MimeType{ .category = .application, .value = "application/vemmi" };
    pub const @"application/vividence.scriptfile": MimeType = MimeType{ .category = .application, .value = "application/vividence.scriptfile" };
    pub const @"application/vnd.1000minds.decision-model+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.1000minds.decision-model+xml" };
    pub const @"application/vnd.3gpp-prose+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp-prose+xml" };
    pub const @"application/vnd.3gpp-prose-pc3ch+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp-prose-pc3ch+xml" };
    pub const @"application/vnd.3gpp-v2x-local-service-information": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp-v2x-local-service-information" };
    pub const @"application/vnd.3gpp.5gnas": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.5gnas" };
    pub const @"application/vnd.3gpp.access-transfer-events+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.access-transfer-events+xml" };
    pub const @"application/vnd.3gpp.bsf+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.bsf+xml" };
    pub const @"application/vnd.3gpp.gmop+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.gmop+xml" };
    pub const @"application/vnd.3gpp.gtpc": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.gtpc" };
    pub const @"application/vnd.3gpp.interworking-data": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.interworking-data" };
    pub const @"application/vnd.3gpp.lpp": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.lpp" };
    pub const @"application/vnd.3gpp.mc-signalling-ear": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.mc-signalling-ear" };
    pub const @"application/vnd.3gpp.mcdata-affiliation-command+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.mcdata-affiliation-command+xml" };
    pub const @"application/vnd.3gpp.mcdata-info+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.mcdata-info+xml" };
    pub const @"application/vnd.3gpp.mcdata-payload": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.mcdata-payload" };
    pub const @"application/vnd.3gpp.mcdata-service-config+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.mcdata-service-config+xml" };
    pub const @"application/vnd.3gpp.mcdata-signalling": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.mcdata-signalling" };
    pub const @"application/vnd.3gpp.mcdata-ue-config+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.mcdata-ue-config+xml" };
    pub const @"application/vnd.3gpp.mcdata-user-profile+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.mcdata-user-profile+xml" };
    pub const @"application/vnd.3gpp.mcptt-affiliation-command+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.mcptt-affiliation-command+xml" };
    pub const @"application/vnd.3gpp.mcptt-floor-request+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.mcptt-floor-request+xml" };
    pub const @"application/vnd.3gpp.mcptt-info+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.mcptt-info+xml" };
    pub const @"application/vnd.3gpp.mcptt-location-info+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.mcptt-location-info+xml" };
    pub const @"application/vnd.3gpp.mcptt-mbms-usage-info+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.mcptt-mbms-usage-info+xml" };
    pub const @"application/vnd.3gpp.mcptt-service-config+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.mcptt-service-config+xml" };
    pub const @"application/vnd.3gpp.mcptt-signed+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.mcptt-signed+xml" };
    pub const @"application/vnd.3gpp.mcptt-ue-config+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.mcptt-ue-config+xml" };
    pub const @"application/vnd.3gpp.mcptt-ue-init-config+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.mcptt-ue-init-config+xml" };
    pub const @"application/vnd.3gpp.mcptt-user-profile+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.mcptt-user-profile+xml" };
    pub const @"application/vnd.3gpp.mcvideo-affiliation-command+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.mcvideo-affiliation-command+xml" };
    pub const @"application/vnd.3gpp.mcvideo-affiliation-info+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.mcvideo-affiliation-info+xml" };
    pub const @"application/vnd.3gpp.mcvideo-info+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.mcvideo-info+xml" };
    pub const @"application/vnd.3gpp.mcvideo-location-info+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.mcvideo-location-info+xml" };
    pub const @"application/vnd.3gpp.mcvideo-mbms-usage-info+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.mcvideo-mbms-usage-info+xml" };
    pub const @"application/vnd.3gpp.mcvideo-service-config+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.mcvideo-service-config+xml" };
    pub const @"application/vnd.3gpp.mcvideo-transmission-request+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.mcvideo-transmission-request+xml" };
    pub const @"application/vnd.3gpp.mcvideo-ue-config+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.mcvideo-ue-config+xml" };
    pub const @"application/vnd.3gpp.mcvideo-user-profile+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.mcvideo-user-profile+xml" };
    pub const @"application/vnd.3gpp.mid-call+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.mid-call+xml" };
    pub const @"application/vnd.3gpp.ngap": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.ngap" };
    pub const @"application/vnd.3gpp.pfcp": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.pfcp" };
    pub const @"application/vnd.3gpp.pic-bw-large": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.pic-bw-large" };
    pub const @"application/vnd.3gpp.pic-bw-small": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.pic-bw-small" };
    pub const @"application/vnd.3gpp.pic-bw-var": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.pic-bw-var" };
    pub const @"application/vnd.3gpp.s1ap": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.s1ap" };
    pub const @"application/vnd.3gpp.sms": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.sms" };
    pub const @"application/vnd.3gpp.sms+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.sms+xml" };
    pub const @"application/vnd.3gpp.srvcc-ext+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.srvcc-ext+xml" };
    pub const @"application/vnd.3gpp.srvcc-info+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.srvcc-info+xml" };
    pub const @"application/vnd.3gpp.state-and-event-info+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.state-and-event-info+xml" };
    pub const @"application/vnd.3gpp.ussd+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp.ussd+xml" };
    pub const @"application/vnd.3gpp2.bcmcsinfo+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp2.bcmcsinfo+xml" };
    pub const @"application/vnd.3gpp2.sms": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp2.sms" };
    pub const @"application/vnd.3gpp2.tcap": MimeType = MimeType{ .category = .application, .value = "application/vnd.3gpp2.tcap" };
    pub const @"application/vnd.3lightssoftware.imagescal": MimeType = MimeType{ .category = .application, .value = "application/vnd.3lightssoftware.imagescal" };
    pub const @"application/vnd.3m.post-it-notes": MimeType = MimeType{ .category = .application, .value = "application/vnd.3m.post-it-notes" };
    pub const @"application/vnd.accpac.simply.aso": MimeType = MimeType{ .category = .application, .value = "application/vnd.accpac.simply.aso" };
    pub const @"application/vnd.accpac.simply.imp": MimeType = MimeType{ .category = .application, .value = "application/vnd.accpac.simply.imp" };
    pub const @"application/vnd.acucobol": MimeType = MimeType{ .category = .application, .value = "application/vnd.acucobol" };
    pub const @"application/vnd.acucorp": MimeType = MimeType{ .category = .application, .value = "application/vnd.acucorp" };
    pub const @"application/vnd.adobe.air-application-installer-package+zip": MimeType = MimeType{ .category = .application, .value = "application/vnd.adobe.air-application-installer-package+zip" };
    pub const @"application/vnd.adobe.flash.movie": MimeType = MimeType{ .category = .application, .value = "application/vnd.adobe.flash.movie" };
    pub const @"application/vnd.adobe.formscentral.fcdt": MimeType = MimeType{ .category = .application, .value = "application/vnd.adobe.formscentral.fcdt" };
    pub const @"application/vnd.adobe.fxp": MimeType = MimeType{ .category = .application, .value = "application/vnd.adobe.fxp" };
    pub const @"application/vnd.adobe.partial-upload": MimeType = MimeType{ .category = .application, .value = "application/vnd.adobe.partial-upload" };
    pub const @"application/vnd.adobe.xdp+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.adobe.xdp+xml" };
    pub const @"application/vnd.adobe.xfdf": MimeType = MimeType{ .category = .application, .value = "application/vnd.adobe.xfdf" };
    pub const @"application/vnd.aether.imp": MimeType = MimeType{ .category = .application, .value = "application/vnd.aether.imp" };
    pub const @"application/vnd.afpc.afplinedata": MimeType = MimeType{ .category = .application, .value = "application/vnd.afpc.afplinedata" };
    pub const @"application/vnd.afpc.afplinedata-pagedef": MimeType = MimeType{ .category = .application, .value = "application/vnd.afpc.afplinedata-pagedef" };
    pub const @"application/vnd.afpc.cmoca-cmresource": MimeType = MimeType{ .category = .application, .value = "application/vnd.afpc.cmoca-cmresource" };
    pub const @"application/vnd.afpc.foca-charset": MimeType = MimeType{ .category = .application, .value = "application/vnd.afpc.foca-charset" };
    pub const @"application/vnd.afpc.foca-codedfont": MimeType = MimeType{ .category = .application, .value = "application/vnd.afpc.foca-codedfont" };
    pub const @"application/vnd.afpc.foca-codepage": MimeType = MimeType{ .category = .application, .value = "application/vnd.afpc.foca-codepage" };
    pub const @"application/vnd.afpc.modca": MimeType = MimeType{ .category = .application, .value = "application/vnd.afpc.modca" };
    pub const @"application/vnd.afpc.modca-cmtable": MimeType = MimeType{ .category = .application, .value = "application/vnd.afpc.modca-cmtable" };
    pub const @"application/vnd.afpc.modca-formdef": MimeType = MimeType{ .category = .application, .value = "application/vnd.afpc.modca-formdef" };
    pub const @"application/vnd.afpc.modca-mediummap": MimeType = MimeType{ .category = .application, .value = "application/vnd.afpc.modca-mediummap" };
    pub const @"application/vnd.afpc.modca-objectcontainer": MimeType = MimeType{ .category = .application, .value = "application/vnd.afpc.modca-objectcontainer" };
    pub const @"application/vnd.afpc.modca-overlay": MimeType = MimeType{ .category = .application, .value = "application/vnd.afpc.modca-overlay" };
    pub const @"application/vnd.afpc.modca-pagesegment": MimeType = MimeType{ .category = .application, .value = "application/vnd.afpc.modca-pagesegment" };
    pub const @"application/vnd.age": MimeType = MimeType{ .category = .application, .value = "application/vnd.age" };
    pub const @"application/vnd.ah-barcode": MimeType = MimeType{ .category = .application, .value = "application/vnd.ah-barcode" };
    pub const @"application/vnd.ahead.space": MimeType = MimeType{ .category = .application, .value = "application/vnd.ahead.space" };
    pub const @"application/vnd.airzip.filesecure.azf": MimeType = MimeType{ .category = .application, .value = "application/vnd.airzip.filesecure.azf" };
    pub const @"application/vnd.airzip.filesecure.azs": MimeType = MimeType{ .category = .application, .value = "application/vnd.airzip.filesecure.azs" };
    pub const @"application/vnd.amadeus+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.amadeus+json" };
    pub const @"application/vnd.amazon.ebook": MimeType = MimeType{ .category = .application, .value = "application/vnd.amazon.ebook" };
    pub const @"application/vnd.amazon.mobi8-ebook": MimeType = MimeType{ .category = .application, .value = "application/vnd.amazon.mobi8-ebook" };
    pub const @"application/vnd.americandynamics.acc": MimeType = MimeType{ .category = .application, .value = "application/vnd.americandynamics.acc" };
    pub const @"application/vnd.amiga.ami": MimeType = MimeType{ .category = .application, .value = "application/vnd.amiga.ami" };
    pub const @"application/vnd.amundsen.maze+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.amundsen.maze+xml" };
    pub const @"application/vnd.android.ota": MimeType = MimeType{ .category = .application, .value = "application/vnd.android.ota" };
    pub const @"application/vnd.android.package-archive": MimeType = MimeType{ .category = .application, .value = "application/vnd.android.package-archive" };
    pub const @"application/vnd.anki": MimeType = MimeType{ .category = .application, .value = "application/vnd.anki" };
    pub const @"application/vnd.anser-web-certificate-issue-initiation": MimeType = MimeType{ .category = .application, .value = "application/vnd.anser-web-certificate-issue-initiation" };
    pub const @"application/vnd.anser-web-funds-transfer-initiation": MimeType = MimeType{ .category = .application, .value = "application/vnd.anser-web-funds-transfer-initiation" };
    pub const @"application/vnd.antix.game-component": MimeType = MimeType{ .category = .application, .value = "application/vnd.antix.game-component" };
    pub const @"application/vnd.apache.arrow.file": MimeType = MimeType{ .category = .application, .value = "application/vnd.apache.arrow.file" };
    pub const @"application/vnd.apache.arrow.stream": MimeType = MimeType{ .category = .application, .value = "application/vnd.apache.arrow.stream" };
    pub const @"application/vnd.apache.thrift.binary": MimeType = MimeType{ .category = .application, .value = "application/vnd.apache.thrift.binary" };
    pub const @"application/vnd.apache.thrift.compact": MimeType = MimeType{ .category = .application, .value = "application/vnd.apache.thrift.compact" };
    pub const @"application/vnd.apache.thrift.json": MimeType = MimeType{ .category = .application, .value = "application/vnd.apache.thrift.json" };
    pub const @"application/vnd.api+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.api+json" };
    pub const @"application/vnd.aplextor.warrp+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.aplextor.warrp+json" };
    pub const @"application/vnd.apothekende.reservation+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.apothekende.reservation+json" };
    pub const @"application/vnd.apple.installer+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.apple.installer+xml" };
    pub const @"application/vnd.apple.keynote": MimeType = MimeType{ .category = .application, .value = "application/vnd.apple.keynote" };
    pub const @"application/vnd.apple.mpegurl": MimeType = MimeType{ .category = .application, .value = "application/vnd.apple.mpegurl" };
    pub const @"application/vnd.apple.numbers": MimeType = MimeType{ .category = .application, .value = "application/vnd.apple.numbers" };
    pub const @"application/vnd.apple.pages": MimeType = MimeType{ .category = .application, .value = "application/vnd.apple.pages" };
    pub const @"application/vnd.apple.pkpass": MimeType = MimeType{ .category = .application, .value = "application/vnd.apple.pkpass" };
    pub const @"application/vnd.arastra.swi": MimeType = MimeType{ .category = .application, .value = "application/vnd.arastra.swi" };
    pub const @"application/vnd.aristanetworks.swi": MimeType = MimeType{ .category = .application, .value = "application/vnd.aristanetworks.swi" };
    pub const @"application/vnd.artisan+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.artisan+json" };
    pub const @"application/vnd.artsquare": MimeType = MimeType{ .category = .application, .value = "application/vnd.artsquare" };
    pub const @"application/vnd.astraea-software.iota": MimeType = MimeType{ .category = .application, .value = "application/vnd.astraea-software.iota" };
    pub const @"application/vnd.audiograph": MimeType = MimeType{ .category = .application, .value = "application/vnd.audiograph" };
    pub const @"application/vnd.autopackage": MimeType = MimeType{ .category = .application, .value = "application/vnd.autopackage" };
    pub const @"application/vnd.avalon+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.avalon+json" };
    pub const @"application/vnd.avistar+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.avistar+xml" };
    pub const @"application/vnd.balsamiq.bmml+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.balsamiq.bmml+xml" };
    pub const @"application/vnd.balsamiq.bmpr": MimeType = MimeType{ .category = .application, .value = "application/vnd.balsamiq.bmpr" };
    pub const @"application/vnd.banana-accounting": MimeType = MimeType{ .category = .application, .value = "application/vnd.banana-accounting" };
    pub const @"application/vnd.bbf.usp.error": MimeType = MimeType{ .category = .application, .value = "application/vnd.bbf.usp.error" };
    pub const @"application/vnd.bbf.usp.msg": MimeType = MimeType{ .category = .application, .value = "application/vnd.bbf.usp.msg" };
    pub const @"application/vnd.bbf.usp.msg+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.bbf.usp.msg+json" };
    pub const @"application/vnd.bekitzur-stech+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.bekitzur-stech+json" };
    pub const @"application/vnd.bint.med-content": MimeType = MimeType{ .category = .application, .value = "application/vnd.bint.med-content" };
    pub const @"application/vnd.biopax.rdf+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.biopax.rdf+xml" };
    pub const @"application/vnd.blink-idb-value-wrapper": MimeType = MimeType{ .category = .application, .value = "application/vnd.blink-idb-value-wrapper" };
    pub const @"application/vnd.blueice.multipass": MimeType = MimeType{ .category = .application, .value = "application/vnd.blueice.multipass" };
    pub const @"application/vnd.bluetooth.ep.oob": MimeType = MimeType{ .category = .application, .value = "application/vnd.bluetooth.ep.oob" };
    pub const @"application/vnd.bluetooth.le.oob": MimeType = MimeType{ .category = .application, .value = "application/vnd.bluetooth.le.oob" };
    pub const @"application/vnd.bmi": MimeType = MimeType{ .category = .application, .value = "application/vnd.bmi" };
    pub const @"application/vnd.bpf": MimeType = MimeType{ .category = .application, .value = "application/vnd.bpf" };
    pub const @"application/vnd.bpf3": MimeType = MimeType{ .category = .application, .value = "application/vnd.bpf3" };
    pub const @"application/vnd.businessobjects": MimeType = MimeType{ .category = .application, .value = "application/vnd.businessobjects" };
    pub const @"application/vnd.byu.uapi+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.byu.uapi+json" };
    pub const @"application/vnd.cab-jscript": MimeType = MimeType{ .category = .application, .value = "application/vnd.cab-jscript" };
    pub const @"application/vnd.canon-cpdl": MimeType = MimeType{ .category = .application, .value = "application/vnd.canon-cpdl" };
    pub const @"application/vnd.canon-lips": MimeType = MimeType{ .category = .application, .value = "application/vnd.canon-lips" };
    pub const @"application/vnd.capasystems-pg+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.capasystems-pg+json" };
    pub const @"application/vnd.cendio.thinlinc.clientconf": MimeType = MimeType{ .category = .application, .value = "application/vnd.cendio.thinlinc.clientconf" };
    pub const @"application/vnd.century-systems.tcp_stream": MimeType = MimeType{ .category = .application, .value = "application/vnd.century-systems.tcp_stream" };
    pub const @"application/vnd.chemdraw+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.chemdraw+xml" };
    pub const @"application/vnd.chess-pgn": MimeType = MimeType{ .category = .application, .value = "application/vnd.chess-pgn" };
    pub const @"application/vnd.chipnuts.karaoke-mmd": MimeType = MimeType{ .category = .application, .value = "application/vnd.chipnuts.karaoke-mmd" };
    pub const @"application/vnd.ciedi": MimeType = MimeType{ .category = .application, .value = "application/vnd.ciedi" };
    pub const @"application/vnd.cinderella": MimeType = MimeType{ .category = .application, .value = "application/vnd.cinderella" };
    pub const @"application/vnd.cirpack.isdn-ext": MimeType = MimeType{ .category = .application, .value = "application/vnd.cirpack.isdn-ext" };
    pub const @"application/vnd.citationstyles.style+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.citationstyles.style+xml" };
    pub const @"application/vnd.claymore": MimeType = MimeType{ .category = .application, .value = "application/vnd.claymore" };
    pub const @"application/vnd.cloanto.rp9": MimeType = MimeType{ .category = .application, .value = "application/vnd.cloanto.rp9" };
    pub const @"application/vnd.clonk.c4group": MimeType = MimeType{ .category = .application, .value = "application/vnd.clonk.c4group" };
    pub const @"application/vnd.cluetrust.cartomobile-config": MimeType = MimeType{ .category = .application, .value = "application/vnd.cluetrust.cartomobile-config" };
    pub const @"application/vnd.cluetrust.cartomobile-config-pkg": MimeType = MimeType{ .category = .application, .value = "application/vnd.cluetrust.cartomobile-config-pkg" };
    pub const @"application/vnd.coffeescript": MimeType = MimeType{ .category = .application, .value = "application/vnd.coffeescript" };
    pub const @"application/vnd.collabio.xodocuments.document": MimeType = MimeType{ .category = .application, .value = "application/vnd.collabio.xodocuments.document" };
    pub const @"application/vnd.collabio.xodocuments.document-template": MimeType = MimeType{ .category = .application, .value = "application/vnd.collabio.xodocuments.document-template" };
    pub const @"application/vnd.collabio.xodocuments.presentation": MimeType = MimeType{ .category = .application, .value = "application/vnd.collabio.xodocuments.presentation" };
    pub const @"application/vnd.collabio.xodocuments.presentation-template": MimeType = MimeType{ .category = .application, .value = "application/vnd.collabio.xodocuments.presentation-template" };
    pub const @"application/vnd.collabio.xodocuments.spreadsheet": MimeType = MimeType{ .category = .application, .value = "application/vnd.collabio.xodocuments.spreadsheet" };
    pub const @"application/vnd.collabio.xodocuments.spreadsheet-template": MimeType = MimeType{ .category = .application, .value = "application/vnd.collabio.xodocuments.spreadsheet-template" };
    pub const @"application/vnd.collection+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.collection+json" };
    pub const @"application/vnd.collection.doc+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.collection.doc+json" };
    pub const @"application/vnd.collection.next+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.collection.next+json" };
    pub const @"application/vnd.comicbook+zip": MimeType = MimeType{ .category = .application, .value = "application/vnd.comicbook+zip" };
    pub const @"application/vnd.comicbook-rar": MimeType = MimeType{ .category = .application, .value = "application/vnd.comicbook-rar" };
    pub const @"application/vnd.commerce-battelle": MimeType = MimeType{ .category = .application, .value = "application/vnd.commerce-battelle" };
    pub const @"application/vnd.commonspace": MimeType = MimeType{ .category = .application, .value = "application/vnd.commonspace" };
    pub const @"application/vnd.contact.cmsg": MimeType = MimeType{ .category = .application, .value = "application/vnd.contact.cmsg" };
    pub const @"application/vnd.coreos.ignition+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.coreos.ignition+json" };
    pub const @"application/vnd.cosmocaller": MimeType = MimeType{ .category = .application, .value = "application/vnd.cosmocaller" };
    pub const @"application/vnd.crick.clicker": MimeType = MimeType{ .category = .application, .value = "application/vnd.crick.clicker" };
    pub const @"application/vnd.crick.clicker.keyboard": MimeType = MimeType{ .category = .application, .value = "application/vnd.crick.clicker.keyboard" };
    pub const @"application/vnd.crick.clicker.palette": MimeType = MimeType{ .category = .application, .value = "application/vnd.crick.clicker.palette" };
    pub const @"application/vnd.crick.clicker.template": MimeType = MimeType{ .category = .application, .value = "application/vnd.crick.clicker.template" };
    pub const @"application/vnd.crick.clicker.wordbank": MimeType = MimeType{ .category = .application, .value = "application/vnd.crick.clicker.wordbank" };
    pub const @"application/vnd.criticaltools.wbs+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.criticaltools.wbs+xml" };
    pub const @"application/vnd.cryptii.pipe+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.cryptii.pipe+json" };
    pub const @"application/vnd.crypto-shade-file": MimeType = MimeType{ .category = .application, .value = "application/vnd.crypto-shade-file" };
    pub const @"application/vnd.cryptomator.encrypted": MimeType = MimeType{ .category = .application, .value = "application/vnd.cryptomator.encrypted" };
    pub const @"application/vnd.cryptomator.vault": MimeType = MimeType{ .category = .application, .value = "application/vnd.cryptomator.vault" };
    pub const @"application/vnd.ctc-posml": MimeType = MimeType{ .category = .application, .value = "application/vnd.ctc-posml" };
    pub const @"application/vnd.ctct.ws+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.ctct.ws+xml" };
    pub const @"application/vnd.cups-pdf": MimeType = MimeType{ .category = .application, .value = "application/vnd.cups-pdf" };
    pub const @"application/vnd.cups-postscript": MimeType = MimeType{ .category = .application, .value = "application/vnd.cups-postscript" };
    pub const @"application/vnd.cups-ppd": MimeType = MimeType{ .category = .application, .value = "application/vnd.cups-ppd" };
    pub const @"application/vnd.cups-raster": MimeType = MimeType{ .category = .application, .value = "application/vnd.cups-raster" };
    pub const @"application/vnd.cups-raw": MimeType = MimeType{ .category = .application, .value = "application/vnd.cups-raw" };
    pub const @"application/vnd.curl": MimeType = MimeType{ .category = .application, .value = "application/vnd.curl" };
    pub const @"application/vnd.curl.car": MimeType = MimeType{ .category = .application, .value = "application/vnd.curl.car" };
    pub const @"application/vnd.curl.pcurl": MimeType = MimeType{ .category = .application, .value = "application/vnd.curl.pcurl" };
    pub const @"application/vnd.cyan.dean.root+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.cyan.dean.root+xml" };
    pub const @"application/vnd.cybank": MimeType = MimeType{ .category = .application, .value = "application/vnd.cybank" };
    pub const @"application/vnd.cyclonedx+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.cyclonedx+json" };
    pub const @"application/vnd.cyclonedx+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.cyclonedx+xml" };
    pub const @"application/vnd.d2l.coursepackage1p0+zip": MimeType = MimeType{ .category = .application, .value = "application/vnd.d2l.coursepackage1p0+zip" };
    pub const @"application/vnd.d3m-dataset": MimeType = MimeType{ .category = .application, .value = "application/vnd.d3m-dataset" };
    pub const @"application/vnd.d3m-problem": MimeType = MimeType{ .category = .application, .value = "application/vnd.d3m-problem" };
    pub const @"application/vnd.dart": MimeType = MimeType{ .category = .application, .value = "application/vnd.dart" };
    pub const @"application/vnd.data-vision.rdz": MimeType = MimeType{ .category = .application, .value = "application/vnd.data-vision.rdz" };
    pub const @"application/vnd.datapackage+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.datapackage+json" };
    pub const @"application/vnd.dataresource+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.dataresource+json" };
    pub const @"application/vnd.dbf": MimeType = MimeType{ .category = .application, .value = "application/vnd.dbf" };
    pub const @"application/vnd.debian.binary-package": MimeType = MimeType{ .category = .application, .value = "application/vnd.debian.binary-package" };
    pub const @"application/vnd.dece.data": MimeType = MimeType{ .category = .application, .value = "application/vnd.dece.data" };
    pub const @"application/vnd.dece.ttml+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.dece.ttml+xml" };
    pub const @"application/vnd.dece.unspecified": MimeType = MimeType{ .category = .application, .value = "application/vnd.dece.unspecified" };
    pub const @"application/vnd.dece.zip": MimeType = MimeType{ .category = .application, .value = "application/vnd.dece.zip" };
    pub const @"application/vnd.denovo.fcselayout-link": MimeType = MimeType{ .category = .application, .value = "application/vnd.denovo.fcselayout-link" };
    pub const @"application/vnd.desmume.movie": MimeType = MimeType{ .category = .application, .value = "application/vnd.desmume.movie" };
    pub const @"application/vnd.dir-bi.plate-dl-nosuffix": MimeType = MimeType{ .category = .application, .value = "application/vnd.dir-bi.plate-dl-nosuffix" };
    pub const @"application/vnd.dm.delegation+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.dm.delegation+xml" };
    pub const @"application/vnd.dna": MimeType = MimeType{ .category = .application, .value = "application/vnd.dna" };
    pub const @"application/vnd.document+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.document+json" };
    pub const @"application/vnd.dolby.mlp": MimeType = MimeType{ .category = .application, .value = "application/vnd.dolby.mlp" };
    pub const @"application/vnd.dolby.mobile.1": MimeType = MimeType{ .category = .application, .value = "application/vnd.dolby.mobile.1" };
    pub const @"application/vnd.dolby.mobile.2": MimeType = MimeType{ .category = .application, .value = "application/vnd.dolby.mobile.2" };
    pub const @"application/vnd.doremir.scorecloud-binary-document": MimeType = MimeType{ .category = .application, .value = "application/vnd.doremir.scorecloud-binary-document" };
    pub const @"application/vnd.dpgraph": MimeType = MimeType{ .category = .application, .value = "application/vnd.dpgraph" };
    pub const @"application/vnd.dreamfactory": MimeType = MimeType{ .category = .application, .value = "application/vnd.dreamfactory" };
    pub const @"application/vnd.drive+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.drive+json" };
    pub const @"application/vnd.ds-keypoint": MimeType = MimeType{ .category = .application, .value = "application/vnd.ds-keypoint" };
    pub const @"application/vnd.dtg.local": MimeType = MimeType{ .category = .application, .value = "application/vnd.dtg.local" };
    pub const @"application/vnd.dtg.local.flash": MimeType = MimeType{ .category = .application, .value = "application/vnd.dtg.local.flash" };
    pub const @"application/vnd.dtg.local.html": MimeType = MimeType{ .category = .application, .value = "application/vnd.dtg.local.html" };
    pub const @"application/vnd.dvb.ait": MimeType = MimeType{ .category = .application, .value = "application/vnd.dvb.ait" };
    pub const @"application/vnd.dvb.dvbisl+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.dvb.dvbisl+xml" };
    pub const @"application/vnd.dvb.dvbj": MimeType = MimeType{ .category = .application, .value = "application/vnd.dvb.dvbj" };
    pub const @"application/vnd.dvb.esgcontainer": MimeType = MimeType{ .category = .application, .value = "application/vnd.dvb.esgcontainer" };
    pub const @"application/vnd.dvb.ipdcdftnotifaccess": MimeType = MimeType{ .category = .application, .value = "application/vnd.dvb.ipdcdftnotifaccess" };
    pub const @"application/vnd.dvb.ipdcesgaccess": MimeType = MimeType{ .category = .application, .value = "application/vnd.dvb.ipdcesgaccess" };
    pub const @"application/vnd.dvb.ipdcesgaccess2": MimeType = MimeType{ .category = .application, .value = "application/vnd.dvb.ipdcesgaccess2" };
    pub const @"application/vnd.dvb.ipdcesgpdd": MimeType = MimeType{ .category = .application, .value = "application/vnd.dvb.ipdcesgpdd" };
    pub const @"application/vnd.dvb.ipdcroaming": MimeType = MimeType{ .category = .application, .value = "application/vnd.dvb.ipdcroaming" };
    pub const @"application/vnd.dvb.iptv.alfec-base": MimeType = MimeType{ .category = .application, .value = "application/vnd.dvb.iptv.alfec-base" };
    pub const @"application/vnd.dvb.iptv.alfec-enhancement": MimeType = MimeType{ .category = .application, .value = "application/vnd.dvb.iptv.alfec-enhancement" };
    pub const @"application/vnd.dvb.notif-aggregate-root+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.dvb.notif-aggregate-root+xml" };
    pub const @"application/vnd.dvb.notif-container+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.dvb.notif-container+xml" };
    pub const @"application/vnd.dvb.notif-generic+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.dvb.notif-generic+xml" };
    pub const @"application/vnd.dvb.notif-ia-msglist+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.dvb.notif-ia-msglist+xml" };
    pub const @"application/vnd.dvb.notif-ia-registration-request+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.dvb.notif-ia-registration-request+xml" };
    pub const @"application/vnd.dvb.notif-ia-registration-response+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.dvb.notif-ia-registration-response+xml" };
    pub const @"application/vnd.dvb.notif-init+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.dvb.notif-init+xml" };
    pub const @"application/vnd.dvb.pfr": MimeType = MimeType{ .category = .application, .value = "application/vnd.dvb.pfr" };
    pub const @"application/vnd.dvb.service": MimeType = MimeType{ .category = .application, .value = "application/vnd.dvb.service" };
    pub const @"application/vnd.dxr": MimeType = MimeType{ .category = .application, .value = "application/vnd.dxr" };
    pub const @"application/vnd.dynageo": MimeType = MimeType{ .category = .application, .value = "application/vnd.dynageo" };
    pub const @"application/vnd.dzr": MimeType = MimeType{ .category = .application, .value = "application/vnd.dzr" };
    pub const @"application/vnd.easykaraoke.cdgdownload": MimeType = MimeType{ .category = .application, .value = "application/vnd.easykaraoke.cdgdownload" };
    pub const @"application/vnd.ecdis-update": MimeType = MimeType{ .category = .application, .value = "application/vnd.ecdis-update" };
    pub const @"application/vnd.ecip.rlp": MimeType = MimeType{ .category = .application, .value = "application/vnd.ecip.rlp" };
    pub const @"application/vnd.eclipse.ditto+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.eclipse.ditto+json" };
    pub const @"application/vnd.ecowin.chart": MimeType = MimeType{ .category = .application, .value = "application/vnd.ecowin.chart" };
    pub const @"application/vnd.ecowin.filerequest": MimeType = MimeType{ .category = .application, .value = "application/vnd.ecowin.filerequest" };
    pub const @"application/vnd.ecowin.fileupdate": MimeType = MimeType{ .category = .application, .value = "application/vnd.ecowin.fileupdate" };
    pub const @"application/vnd.ecowin.series": MimeType = MimeType{ .category = .application, .value = "application/vnd.ecowin.series" };
    pub const @"application/vnd.ecowin.seriesrequest": MimeType = MimeType{ .category = .application, .value = "application/vnd.ecowin.seriesrequest" };
    pub const @"application/vnd.ecowin.seriesupdate": MimeType = MimeType{ .category = .application, .value = "application/vnd.ecowin.seriesupdate" };
    pub const @"application/vnd.efi.img": MimeType = MimeType{ .category = .application, .value = "application/vnd.efi.img" };
    pub const @"application/vnd.efi.iso": MimeType = MimeType{ .category = .application, .value = "application/vnd.efi.iso" };
    pub const @"application/vnd.emclient.accessrequest+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.emclient.accessrequest+xml" };
    pub const @"application/vnd.enliven": MimeType = MimeType{ .category = .application, .value = "application/vnd.enliven" };
    pub const @"application/vnd.enphase.envoy": MimeType = MimeType{ .category = .application, .value = "application/vnd.enphase.envoy" };
    pub const @"application/vnd.eprints.data+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.eprints.data+xml" };
    pub const @"application/vnd.epson.esf": MimeType = MimeType{ .category = .application, .value = "application/vnd.epson.esf" };
    pub const @"application/vnd.epson.msf": MimeType = MimeType{ .category = .application, .value = "application/vnd.epson.msf" };
    pub const @"application/vnd.epson.quickanime": MimeType = MimeType{ .category = .application, .value = "application/vnd.epson.quickanime" };
    pub const @"application/vnd.epson.salt": MimeType = MimeType{ .category = .application, .value = "application/vnd.epson.salt" };
    pub const @"application/vnd.epson.ssf": MimeType = MimeType{ .category = .application, .value = "application/vnd.epson.ssf" };
    pub const @"application/vnd.ericsson.quickcall": MimeType = MimeType{ .category = .application, .value = "application/vnd.ericsson.quickcall" };
    pub const @"application/vnd.espass-espass+zip": MimeType = MimeType{ .category = .application, .value = "application/vnd.espass-espass+zip" };
    pub const @"application/vnd.eszigno3+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.eszigno3+xml" };
    pub const @"application/vnd.etsi.aoc+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.etsi.aoc+xml" };
    pub const @"application/vnd.etsi.asic-e+zip": MimeType = MimeType{ .category = .application, .value = "application/vnd.etsi.asic-e+zip" };
    pub const @"application/vnd.etsi.asic-s+zip": MimeType = MimeType{ .category = .application, .value = "application/vnd.etsi.asic-s+zip" };
    pub const @"application/vnd.etsi.cug+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.etsi.cug+xml" };
    pub const @"application/vnd.etsi.iptvcommand+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.etsi.iptvcommand+xml" };
    pub const @"application/vnd.etsi.iptvdiscovery+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.etsi.iptvdiscovery+xml" };
    pub const @"application/vnd.etsi.iptvprofile+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.etsi.iptvprofile+xml" };
    pub const @"application/vnd.etsi.iptvsad-bc+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.etsi.iptvsad-bc+xml" };
    pub const @"application/vnd.etsi.iptvsad-cod+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.etsi.iptvsad-cod+xml" };
    pub const @"application/vnd.etsi.iptvsad-npvr+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.etsi.iptvsad-npvr+xml" };
    pub const @"application/vnd.etsi.iptvservice+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.etsi.iptvservice+xml" };
    pub const @"application/vnd.etsi.iptvsync+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.etsi.iptvsync+xml" };
    pub const @"application/vnd.etsi.iptvueprofile+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.etsi.iptvueprofile+xml" };
    pub const @"application/vnd.etsi.mcid+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.etsi.mcid+xml" };
    pub const @"application/vnd.etsi.mheg5": MimeType = MimeType{ .category = .application, .value = "application/vnd.etsi.mheg5" };
    pub const @"application/vnd.etsi.overload-control-policy-dataset+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.etsi.overload-control-policy-dataset+xml" };
    pub const @"application/vnd.etsi.pstn+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.etsi.pstn+xml" };
    pub const @"application/vnd.etsi.sci+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.etsi.sci+xml" };
    pub const @"application/vnd.etsi.simservs+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.etsi.simservs+xml" };
    pub const @"application/vnd.etsi.timestamp-token": MimeType = MimeType{ .category = .application, .value = "application/vnd.etsi.timestamp-token" };
    pub const @"application/vnd.etsi.tsl+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.etsi.tsl+xml" };
    pub const @"application/vnd.etsi.tsl.der": MimeType = MimeType{ .category = .application, .value = "application/vnd.etsi.tsl.der" };
    pub const @"application/vnd.eu.kasparian.car+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.eu.kasparian.car+json" };
    pub const @"application/vnd.eudora.data": MimeType = MimeType{ .category = .application, .value = "application/vnd.eudora.data" };
    pub const @"application/vnd.evolv.ecig.profile": MimeType = MimeType{ .category = .application, .value = "application/vnd.evolv.ecig.profile" };
    pub const @"application/vnd.evolv.ecig.settings": MimeType = MimeType{ .category = .application, .value = "application/vnd.evolv.ecig.settings" };
    pub const @"application/vnd.evolv.ecig.theme": MimeType = MimeType{ .category = .application, .value = "application/vnd.evolv.ecig.theme" };
    pub const @"application/vnd.exstream-empower+zip": MimeType = MimeType{ .category = .application, .value = "application/vnd.exstream-empower+zip" };
    pub const @"application/vnd.exstream-package": MimeType = MimeType{ .category = .application, .value = "application/vnd.exstream-package" };
    pub const @"application/vnd.ezpix-album": MimeType = MimeType{ .category = .application, .value = "application/vnd.ezpix-album" };
    pub const @"application/vnd.ezpix-package": MimeType = MimeType{ .category = .application, .value = "application/vnd.ezpix-package" };
    pub const @"application/vnd.f-secure.mobile": MimeType = MimeType{ .category = .application, .value = "application/vnd.f-secure.mobile" };
    pub const @"application/vnd.familysearch.gedcom+zip": MimeType = MimeType{ .category = .application, .value = "application/vnd.familysearch.gedcom+zip" };
    pub const @"application/vnd.fastcopy-disk-image": MimeType = MimeType{ .category = .application, .value = "application/vnd.fastcopy-disk-image" };
    pub const @"application/vnd.fdf": MimeType = MimeType{ .category = .application, .value = "application/vnd.fdf" };
    pub const @"application/vnd.fdsn.mseed": MimeType = MimeType{ .category = .application, .value = "application/vnd.fdsn.mseed" };
    pub const @"application/vnd.fdsn.seed": MimeType = MimeType{ .category = .application, .value = "application/vnd.fdsn.seed" };
    pub const @"application/vnd.ffsns": MimeType = MimeType{ .category = .application, .value = "application/vnd.ffsns" };
    pub const @"application/vnd.ficlab.flb+zip": MimeType = MimeType{ .category = .application, .value = "application/vnd.ficlab.flb+zip" };
    pub const @"application/vnd.filmit.zfc": MimeType = MimeType{ .category = .application, .value = "application/vnd.filmit.zfc" };
    pub const @"application/vnd.fints": MimeType = MimeType{ .category = .application, .value = "application/vnd.fints" };
    pub const @"application/vnd.firemonkeys.cloudcell": MimeType = MimeType{ .category = .application, .value = "application/vnd.firemonkeys.cloudcell" };
    pub const @"application/vnd.flographit": MimeType = MimeType{ .category = .application, .value = "application/vnd.flographit" };
    pub const @"application/vnd.fluxtime.clip": MimeType = MimeType{ .category = .application, .value = "application/vnd.fluxtime.clip" };
    pub const @"application/vnd.font-fontforge-sfd": MimeType = MimeType{ .category = .application, .value = "application/vnd.font-fontforge-sfd" };
    pub const @"application/vnd.framemaker": MimeType = MimeType{ .category = .application, .value = "application/vnd.framemaker" };
    pub const @"application/vnd.frogans.fnc": MimeType = MimeType{ .category = .application, .value = "application/vnd.frogans.fnc" };
    pub const @"application/vnd.frogans.ltf": MimeType = MimeType{ .category = .application, .value = "application/vnd.frogans.ltf" };
    pub const @"application/vnd.fsc.weblaunch": MimeType = MimeType{ .category = .application, .value = "application/vnd.fsc.weblaunch" };
    pub const @"application/vnd.fujifilm.fb.docuworks": MimeType = MimeType{ .category = .application, .value = "application/vnd.fujifilm.fb.docuworks" };
    pub const @"application/vnd.fujifilm.fb.docuworks.binder": MimeType = MimeType{ .category = .application, .value = "application/vnd.fujifilm.fb.docuworks.binder" };
    pub const @"application/vnd.fujifilm.fb.docuworks.container": MimeType = MimeType{ .category = .application, .value = "application/vnd.fujifilm.fb.docuworks.container" };
    pub const @"application/vnd.fujifilm.fb.jfi+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.fujifilm.fb.jfi+xml" };
    pub const @"application/vnd.fujitsu.oasys": MimeType = MimeType{ .category = .application, .value = "application/vnd.fujitsu.oasys" };
    pub const @"application/vnd.fujitsu.oasys2": MimeType = MimeType{ .category = .application, .value = "application/vnd.fujitsu.oasys2" };
    pub const @"application/vnd.fujitsu.oasys3": MimeType = MimeType{ .category = .application, .value = "application/vnd.fujitsu.oasys3" };
    pub const @"application/vnd.fujitsu.oasysgp": MimeType = MimeType{ .category = .application, .value = "application/vnd.fujitsu.oasysgp" };
    pub const @"application/vnd.fujitsu.oasysprs": MimeType = MimeType{ .category = .application, .value = "application/vnd.fujitsu.oasysprs" };
    pub const @"application/vnd.fujixerox.art-ex": MimeType = MimeType{ .category = .application, .value = "application/vnd.fujixerox.art-ex" };
    pub const @"application/vnd.fujixerox.art4": MimeType = MimeType{ .category = .application, .value = "application/vnd.fujixerox.art4" };
    pub const @"application/vnd.fujixerox.ddd": MimeType = MimeType{ .category = .application, .value = "application/vnd.fujixerox.ddd" };
    pub const @"application/vnd.fujixerox.docuworks": MimeType = MimeType{ .category = .application, .value = "application/vnd.fujixerox.docuworks" };
    pub const @"application/vnd.fujixerox.docuworks.binder": MimeType = MimeType{ .category = .application, .value = "application/vnd.fujixerox.docuworks.binder" };
    pub const @"application/vnd.fujixerox.docuworks.container": MimeType = MimeType{ .category = .application, .value = "application/vnd.fujixerox.docuworks.container" };
    pub const @"application/vnd.fujixerox.hbpl": MimeType = MimeType{ .category = .application, .value = "application/vnd.fujixerox.hbpl" };
    pub const @"application/vnd.fut-misnet": MimeType = MimeType{ .category = .application, .value = "application/vnd.fut-misnet" };
    pub const @"application/vnd.futoin+cbor": MimeType = MimeType{ .category = .application, .value = "application/vnd.futoin+cbor" };
    pub const @"application/vnd.futoin+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.futoin+json" };
    pub const @"application/vnd.fuzzysheet": MimeType = MimeType{ .category = .application, .value = "application/vnd.fuzzysheet" };
    pub const @"application/vnd.genomatix.tuxedo": MimeType = MimeType{ .category = .application, .value = "application/vnd.genomatix.tuxedo" };
    pub const @"application/vnd.gentics.grd+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.gentics.grd+json" };
    pub const @"application/vnd.geo+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.geo+json" };
    pub const @"application/vnd.geocube+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.geocube+xml" };
    pub const @"application/vnd.geogebra.file": MimeType = MimeType{ .category = .application, .value = "application/vnd.geogebra.file" };
    pub const @"application/vnd.geogebra.slides": MimeType = MimeType{ .category = .application, .value = "application/vnd.geogebra.slides" };
    pub const @"application/vnd.geogebra.tool": MimeType = MimeType{ .category = .application, .value = "application/vnd.geogebra.tool" };
    pub const @"application/vnd.geometry-explorer": MimeType = MimeType{ .category = .application, .value = "application/vnd.geometry-explorer" };
    pub const @"application/vnd.geonext": MimeType = MimeType{ .category = .application, .value = "application/vnd.geonext" };
    pub const @"application/vnd.geoplan": MimeType = MimeType{ .category = .application, .value = "application/vnd.geoplan" };
    pub const @"application/vnd.geospace": MimeType = MimeType{ .category = .application, .value = "application/vnd.geospace" };
    pub const @"application/vnd.gerber": MimeType = MimeType{ .category = .application, .value = "application/vnd.gerber" };
    pub const @"application/vnd.globalplatform.card-content-mgt": MimeType = MimeType{ .category = .application, .value = "application/vnd.globalplatform.card-content-mgt" };
    pub const @"application/vnd.globalplatform.card-content-mgt-response": MimeType = MimeType{ .category = .application, .value = "application/vnd.globalplatform.card-content-mgt-response" };
    pub const @"application/vnd.gmx": MimeType = MimeType{ .category = .application, .value = "application/vnd.gmx" };
    pub const @"application/vnd.gnu.taler.exchange+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.gnu.taler.exchange+json" };
    pub const @"application/vnd.gnu.taler.merchant+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.gnu.taler.merchant+json" };
    pub const @"application/vnd.google-apps.document": MimeType = MimeType{ .category = .application, .value = "application/vnd.google-apps.document" };
    pub const @"application/vnd.google-apps.presentation": MimeType = MimeType{ .category = .application, .value = "application/vnd.google-apps.presentation" };
    pub const @"application/vnd.google-apps.spreadsheet": MimeType = MimeType{ .category = .application, .value = "application/vnd.google-apps.spreadsheet" };
    pub const @"application/vnd.google-earth.kml+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.google-earth.kml+xml" };
    pub const @"application/vnd.google-earth.kmz": MimeType = MimeType{ .category = .application, .value = "application/vnd.google-earth.kmz" };
    pub const @"application/vnd.gov.sk.e-form+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.gov.sk.e-form+xml" };
    pub const @"application/vnd.gov.sk.e-form+zip": MimeType = MimeType{ .category = .application, .value = "application/vnd.gov.sk.e-form+zip" };
    pub const @"application/vnd.gov.sk.xmldatacontainer+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.gov.sk.xmldatacontainer+xml" };
    pub const @"application/vnd.grafeq": MimeType = MimeType{ .category = .application, .value = "application/vnd.grafeq" };
    pub const @"application/vnd.gridmp": MimeType = MimeType{ .category = .application, .value = "application/vnd.gridmp" };
    pub const @"application/vnd.groove-account": MimeType = MimeType{ .category = .application, .value = "application/vnd.groove-account" };
    pub const @"application/vnd.groove-help": MimeType = MimeType{ .category = .application, .value = "application/vnd.groove-help" };
    pub const @"application/vnd.groove-identity-message": MimeType = MimeType{ .category = .application, .value = "application/vnd.groove-identity-message" };
    pub const @"application/vnd.groove-injector": MimeType = MimeType{ .category = .application, .value = "application/vnd.groove-injector" };
    pub const @"application/vnd.groove-tool-message": MimeType = MimeType{ .category = .application, .value = "application/vnd.groove-tool-message" };
    pub const @"application/vnd.groove-tool-template": MimeType = MimeType{ .category = .application, .value = "application/vnd.groove-tool-template" };
    pub const @"application/vnd.groove-vcard": MimeType = MimeType{ .category = .application, .value = "application/vnd.groove-vcard" };
    pub const @"application/vnd.hal+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.hal+json" };
    pub const @"application/vnd.hal+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.hal+xml" };
    pub const @"application/vnd.handheld-entertainment+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.handheld-entertainment+xml" };
    pub const @"application/vnd.hbci": MimeType = MimeType{ .category = .application, .value = "application/vnd.hbci" };
    pub const @"application/vnd.hc+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.hc+json" };
    pub const @"application/vnd.hcl-bireports": MimeType = MimeType{ .category = .application, .value = "application/vnd.hcl-bireports" };
    pub const @"application/vnd.hdt": MimeType = MimeType{ .category = .application, .value = "application/vnd.hdt" };
    pub const @"application/vnd.heroku+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.heroku+json" };
    pub const @"application/vnd.hhe.lesson-player": MimeType = MimeType{ .category = .application, .value = "application/vnd.hhe.lesson-player" };
    pub const @"application/vnd.hl7cda+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.hl7cda+xml" };
    pub const @"application/vnd.hl7v2+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.hl7v2+xml" };
    pub const @"application/vnd.hp-hpgl": MimeType = MimeType{ .category = .application, .value = "application/vnd.hp-hpgl" };
    pub const @"application/vnd.hp-hpid": MimeType = MimeType{ .category = .application, .value = "application/vnd.hp-hpid" };
    pub const @"application/vnd.hp-hps": MimeType = MimeType{ .category = .application, .value = "application/vnd.hp-hps" };
    pub const @"application/vnd.hp-jlyt": MimeType = MimeType{ .category = .application, .value = "application/vnd.hp-jlyt" };
    pub const @"application/vnd.hp-pcl": MimeType = MimeType{ .category = .application, .value = "application/vnd.hp-pcl" };
    pub const @"application/vnd.hp-pclxl": MimeType = MimeType{ .category = .application, .value = "application/vnd.hp-pclxl" };
    pub const @"application/vnd.httphone": MimeType = MimeType{ .category = .application, .value = "application/vnd.httphone" };
    pub const @"application/vnd.hydrostatix.sof-data": MimeType = MimeType{ .category = .application, .value = "application/vnd.hydrostatix.sof-data" };
    pub const @"application/vnd.hyper+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.hyper+json" };
    pub const @"application/vnd.hyper-item+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.hyper-item+json" };
    pub const @"application/vnd.hyperdrive+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.hyperdrive+json" };
    pub const @"application/vnd.hzn-3d-crossword": MimeType = MimeType{ .category = .application, .value = "application/vnd.hzn-3d-crossword" };
    pub const @"application/vnd.ibm.afplinedata": MimeType = MimeType{ .category = .application, .value = "application/vnd.ibm.afplinedata" };
    pub const @"application/vnd.ibm.electronic-media": MimeType = MimeType{ .category = .application, .value = "application/vnd.ibm.electronic-media" };
    pub const @"application/vnd.ibm.minipay": MimeType = MimeType{ .category = .application, .value = "application/vnd.ibm.minipay" };
    pub const @"application/vnd.ibm.modcap": MimeType = MimeType{ .category = .application, .value = "application/vnd.ibm.modcap" };
    pub const @"application/vnd.ibm.rights-management": MimeType = MimeType{ .category = .application, .value = "application/vnd.ibm.rights-management" };
    pub const @"application/vnd.ibm.secure-container": MimeType = MimeType{ .category = .application, .value = "application/vnd.ibm.secure-container" };
    pub const @"application/vnd.iccprofile": MimeType = MimeType{ .category = .application, .value = "application/vnd.iccprofile" };
    pub const @"application/vnd.ieee.1905": MimeType = MimeType{ .category = .application, .value = "application/vnd.ieee.1905" };
    pub const @"application/vnd.igloader": MimeType = MimeType{ .category = .application, .value = "application/vnd.igloader" };
    pub const @"application/vnd.imagemeter.folder+zip": MimeType = MimeType{ .category = .application, .value = "application/vnd.imagemeter.folder+zip" };
    pub const @"application/vnd.imagemeter.image+zip": MimeType = MimeType{ .category = .application, .value = "application/vnd.imagemeter.image+zip" };
    pub const @"application/vnd.immervision-ivp": MimeType = MimeType{ .category = .application, .value = "application/vnd.immervision-ivp" };
    pub const @"application/vnd.immervision-ivu": MimeType = MimeType{ .category = .application, .value = "application/vnd.immervision-ivu" };
    pub const @"application/vnd.ims.imsccv1p1": MimeType = MimeType{ .category = .application, .value = "application/vnd.ims.imsccv1p1" };
    pub const @"application/vnd.ims.imsccv1p2": MimeType = MimeType{ .category = .application, .value = "application/vnd.ims.imsccv1p2" };
    pub const @"application/vnd.ims.imsccv1p3": MimeType = MimeType{ .category = .application, .value = "application/vnd.ims.imsccv1p3" };
    pub const @"application/vnd.ims.lis.v2.result+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.ims.lis.v2.result+json" };
    pub const @"application/vnd.ims.lti.v2.toolconsumerprofile+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.ims.lti.v2.toolconsumerprofile+json" };
    pub const @"application/vnd.ims.lti.v2.toolproxy+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.ims.lti.v2.toolproxy+json" };
    pub const @"application/vnd.ims.lti.v2.toolproxy.id+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.ims.lti.v2.toolproxy.id+json" };
    pub const @"application/vnd.ims.lti.v2.toolsettings+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.ims.lti.v2.toolsettings+json" };
    pub const @"application/vnd.ims.lti.v2.toolsettings.simple+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.ims.lti.v2.toolsettings.simple+json" };
    pub const @"application/vnd.informedcontrol.rms+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.informedcontrol.rms+xml" };
    pub const @"application/vnd.informix-visionary": MimeType = MimeType{ .category = .application, .value = "application/vnd.informix-visionary" };
    pub const @"application/vnd.infotech.project": MimeType = MimeType{ .category = .application, .value = "application/vnd.infotech.project" };
    pub const @"application/vnd.infotech.project+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.infotech.project+xml" };
    pub const @"application/vnd.innopath.wamp.notification": MimeType = MimeType{ .category = .application, .value = "application/vnd.innopath.wamp.notification" };
    pub const @"application/vnd.insors.igm": MimeType = MimeType{ .category = .application, .value = "application/vnd.insors.igm" };
    pub const @"application/vnd.intercon.formnet": MimeType = MimeType{ .category = .application, .value = "application/vnd.intercon.formnet" };
    pub const @"application/vnd.intergeo": MimeType = MimeType{ .category = .application, .value = "application/vnd.intergeo" };
    pub const @"application/vnd.intertrust.digibox": MimeType = MimeType{ .category = .application, .value = "application/vnd.intertrust.digibox" };
    pub const @"application/vnd.intertrust.nncp": MimeType = MimeType{ .category = .application, .value = "application/vnd.intertrust.nncp" };
    pub const @"application/vnd.intu.qbo": MimeType = MimeType{ .category = .application, .value = "application/vnd.intu.qbo" };
    pub const @"application/vnd.intu.qfx": MimeType = MimeType{ .category = .application, .value = "application/vnd.intu.qfx" };
    pub const @"application/vnd.iptc.g2.catalogitem+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.iptc.g2.catalogitem+xml" };
    pub const @"application/vnd.iptc.g2.conceptitem+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.iptc.g2.conceptitem+xml" };
    pub const @"application/vnd.iptc.g2.knowledgeitem+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.iptc.g2.knowledgeitem+xml" };
    pub const @"application/vnd.iptc.g2.newsitem+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.iptc.g2.newsitem+xml" };
    pub const @"application/vnd.iptc.g2.newsmessage+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.iptc.g2.newsmessage+xml" };
    pub const @"application/vnd.iptc.g2.packageitem+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.iptc.g2.packageitem+xml" };
    pub const @"application/vnd.iptc.g2.planningitem+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.iptc.g2.planningitem+xml" };
    pub const @"application/vnd.ipunplugged.rcprofile": MimeType = MimeType{ .category = .application, .value = "application/vnd.ipunplugged.rcprofile" };
    pub const @"application/vnd.irepository.package+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.irepository.package+xml" };
    pub const @"application/vnd.is-xpr": MimeType = MimeType{ .category = .application, .value = "application/vnd.is-xpr" };
    pub const @"application/vnd.isac.fcs": MimeType = MimeType{ .category = .application, .value = "application/vnd.isac.fcs" };
    pub const @"application/vnd.iso11783-10+zip": MimeType = MimeType{ .category = .application, .value = "application/vnd.iso11783-10+zip" };
    pub const @"application/vnd.jam": MimeType = MimeType{ .category = .application, .value = "application/vnd.jam" };
    pub const @"application/vnd.japannet-directory-service": MimeType = MimeType{ .category = .application, .value = "application/vnd.japannet-directory-service" };
    pub const @"application/vnd.japannet-jpnstore-wakeup": MimeType = MimeType{ .category = .application, .value = "application/vnd.japannet-jpnstore-wakeup" };
    pub const @"application/vnd.japannet-payment-wakeup": MimeType = MimeType{ .category = .application, .value = "application/vnd.japannet-payment-wakeup" };
    pub const @"application/vnd.japannet-registration": MimeType = MimeType{ .category = .application, .value = "application/vnd.japannet-registration" };
    pub const @"application/vnd.japannet-registration-wakeup": MimeType = MimeType{ .category = .application, .value = "application/vnd.japannet-registration-wakeup" };
    pub const @"application/vnd.japannet-setstore-wakeup": MimeType = MimeType{ .category = .application, .value = "application/vnd.japannet-setstore-wakeup" };
    pub const @"application/vnd.japannet-verification": MimeType = MimeType{ .category = .application, .value = "application/vnd.japannet-verification" };
    pub const @"application/vnd.japannet-verification-wakeup": MimeType = MimeType{ .category = .application, .value = "application/vnd.japannet-verification-wakeup" };
    pub const @"application/vnd.jcp.javame.midlet-rms": MimeType = MimeType{ .category = .application, .value = "application/vnd.jcp.javame.midlet-rms" };
    pub const @"application/vnd.jisp": MimeType = MimeType{ .category = .application, .value = "application/vnd.jisp" };
    pub const @"application/vnd.joost.joda-archive": MimeType = MimeType{ .category = .application, .value = "application/vnd.joost.joda-archive" };
    pub const @"application/vnd.jsk.isdn-ngn": MimeType = MimeType{ .category = .application, .value = "application/vnd.jsk.isdn-ngn" };
    pub const @"application/vnd.kahootz": MimeType = MimeType{ .category = .application, .value = "application/vnd.kahootz" };
    pub const @"application/vnd.kde.karbon": MimeType = MimeType{ .category = .application, .value = "application/vnd.kde.karbon" };
    pub const @"application/vnd.kde.kchart": MimeType = MimeType{ .category = .application, .value = "application/vnd.kde.kchart" };
    pub const @"application/vnd.kde.kformula": MimeType = MimeType{ .category = .application, .value = "application/vnd.kde.kformula" };
    pub const @"application/vnd.kde.kivio": MimeType = MimeType{ .category = .application, .value = "application/vnd.kde.kivio" };
    pub const @"application/vnd.kde.kontour": MimeType = MimeType{ .category = .application, .value = "application/vnd.kde.kontour" };
    pub const @"application/vnd.kde.kpresenter": MimeType = MimeType{ .category = .application, .value = "application/vnd.kde.kpresenter" };
    pub const @"application/vnd.kde.kspread": MimeType = MimeType{ .category = .application, .value = "application/vnd.kde.kspread" };
    pub const @"application/vnd.kde.kword": MimeType = MimeType{ .category = .application, .value = "application/vnd.kde.kword" };
    pub const @"application/vnd.kenameaapp": MimeType = MimeType{ .category = .application, .value = "application/vnd.kenameaapp" };
    pub const @"application/vnd.kidspiration": MimeType = MimeType{ .category = .application, .value = "application/vnd.kidspiration" };
    pub const @"application/vnd.kinar": MimeType = MimeType{ .category = .application, .value = "application/vnd.kinar" };
    pub const @"application/vnd.koan": MimeType = MimeType{ .category = .application, .value = "application/vnd.koan" };
    pub const @"application/vnd.kodak-descriptor": MimeType = MimeType{ .category = .application, .value = "application/vnd.kodak-descriptor" };
    pub const @"application/vnd.las": MimeType = MimeType{ .category = .application, .value = "application/vnd.las" };
    pub const @"application/vnd.las.las+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.las.las+json" };
    pub const @"application/vnd.las.las+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.las.las+xml" };
    pub const @"application/vnd.laszip": MimeType = MimeType{ .category = .application, .value = "application/vnd.laszip" };
    pub const @"application/vnd.leap+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.leap+json" };
    pub const @"application/vnd.liberty-request+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.liberty-request+xml" };
    pub const @"application/vnd.llamagraphics.life-balance.desktop": MimeType = MimeType{ .category = .application, .value = "application/vnd.llamagraphics.life-balance.desktop" };
    pub const @"application/vnd.llamagraphics.life-balance.exchange+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.llamagraphics.life-balance.exchange+xml" };
    pub const @"application/vnd.logipipe.circuit+zip": MimeType = MimeType{ .category = .application, .value = "application/vnd.logipipe.circuit+zip" };
    pub const @"application/vnd.loom": MimeType = MimeType{ .category = .application, .value = "application/vnd.loom" };
    pub const @"application/vnd.lotus-1-2-3": MimeType = MimeType{ .category = .application, .value = "application/vnd.lotus-1-2-3" };
    pub const @"application/vnd.lotus-approach": MimeType = MimeType{ .category = .application, .value = "application/vnd.lotus-approach" };
    pub const @"application/vnd.lotus-freelance": MimeType = MimeType{ .category = .application, .value = "application/vnd.lotus-freelance" };
    pub const @"application/vnd.lotus-notes": MimeType = MimeType{ .category = .application, .value = "application/vnd.lotus-notes" };
    pub const @"application/vnd.lotus-organizer": MimeType = MimeType{ .category = .application, .value = "application/vnd.lotus-organizer" };
    pub const @"application/vnd.lotus-screencam": MimeType = MimeType{ .category = .application, .value = "application/vnd.lotus-screencam" };
    pub const @"application/vnd.lotus-wordpro": MimeType = MimeType{ .category = .application, .value = "application/vnd.lotus-wordpro" };
    pub const @"application/vnd.macports.portpkg": MimeType = MimeType{ .category = .application, .value = "application/vnd.macports.portpkg" };
    pub const @"application/vnd.mapbox-vector-tile": MimeType = MimeType{ .category = .application, .value = "application/vnd.mapbox-vector-tile" };
    pub const @"application/vnd.marlin.drm.actiontoken+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.marlin.drm.actiontoken+xml" };
    pub const @"application/vnd.marlin.drm.conftoken+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.marlin.drm.conftoken+xml" };
    pub const @"application/vnd.marlin.drm.license+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.marlin.drm.license+xml" };
    pub const @"application/vnd.marlin.drm.mdcf": MimeType = MimeType{ .category = .application, .value = "application/vnd.marlin.drm.mdcf" };
    pub const @"application/vnd.mason+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.mason+json" };
    pub const @"application/vnd.maxar.archive.3tz+zip": MimeType = MimeType{ .category = .application, .value = "application/vnd.maxar.archive.3tz+zip" };
    pub const @"application/vnd.maxmind.maxmind-db": MimeType = MimeType{ .category = .application, .value = "application/vnd.maxmind.maxmind-db" };
    pub const @"application/vnd.mcd": MimeType = MimeType{ .category = .application, .value = "application/vnd.mcd" };
    pub const @"application/vnd.medcalcdata": MimeType = MimeType{ .category = .application, .value = "application/vnd.medcalcdata" };
    pub const @"application/vnd.mediastation.cdkey": MimeType = MimeType{ .category = .application, .value = "application/vnd.mediastation.cdkey" };
    pub const @"application/vnd.meridian-slingshot": MimeType = MimeType{ .category = .application, .value = "application/vnd.meridian-slingshot" };
    pub const @"application/vnd.mfer": MimeType = MimeType{ .category = .application, .value = "application/vnd.mfer" };
    pub const @"application/vnd.mfmp": MimeType = MimeType{ .category = .application, .value = "application/vnd.mfmp" };
    pub const @"application/vnd.micro+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.micro+json" };
    pub const @"application/vnd.micrografx.flo": MimeType = MimeType{ .category = .application, .value = "application/vnd.micrografx.flo" };
    pub const @"application/vnd.micrografx.igx": MimeType = MimeType{ .category = .application, .value = "application/vnd.micrografx.igx" };
    pub const @"application/vnd.microsoft.portable-executable": MimeType = MimeType{ .category = .application, .value = "application/vnd.microsoft.portable-executable" };
    pub const @"application/vnd.microsoft.windows.thumbnail-cache": MimeType = MimeType{ .category = .application, .value = "application/vnd.microsoft.windows.thumbnail-cache" };
    pub const @"application/vnd.miele+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.miele+json" };
    pub const @"application/vnd.mif": MimeType = MimeType{ .category = .application, .value = "application/vnd.mif" };
    pub const @"application/vnd.minisoft-hp3000-save": MimeType = MimeType{ .category = .application, .value = "application/vnd.minisoft-hp3000-save" };
    pub const @"application/vnd.mitsubishi.misty-guard.trustweb": MimeType = MimeType{ .category = .application, .value = "application/vnd.mitsubishi.misty-guard.trustweb" };
    pub const @"application/vnd.mobius.daf": MimeType = MimeType{ .category = .application, .value = "application/vnd.mobius.daf" };
    pub const @"application/vnd.mobius.dis": MimeType = MimeType{ .category = .application, .value = "application/vnd.mobius.dis" };
    pub const @"application/vnd.mobius.mbk": MimeType = MimeType{ .category = .application, .value = "application/vnd.mobius.mbk" };
    pub const @"application/vnd.mobius.mqy": MimeType = MimeType{ .category = .application, .value = "application/vnd.mobius.mqy" };
    pub const @"application/vnd.mobius.msl": MimeType = MimeType{ .category = .application, .value = "application/vnd.mobius.msl" };
    pub const @"application/vnd.mobius.plc": MimeType = MimeType{ .category = .application, .value = "application/vnd.mobius.plc" };
    pub const @"application/vnd.mobius.txf": MimeType = MimeType{ .category = .application, .value = "application/vnd.mobius.txf" };
    pub const @"application/vnd.mophun.application": MimeType = MimeType{ .category = .application, .value = "application/vnd.mophun.application" };
    pub const @"application/vnd.mophun.certificate": MimeType = MimeType{ .category = .application, .value = "application/vnd.mophun.certificate" };
    pub const @"application/vnd.motorola.flexsuite": MimeType = MimeType{ .category = .application, .value = "application/vnd.motorola.flexsuite" };
    pub const @"application/vnd.motorola.flexsuite.adsi": MimeType = MimeType{ .category = .application, .value = "application/vnd.motorola.flexsuite.adsi" };
    pub const @"application/vnd.motorola.flexsuite.fis": MimeType = MimeType{ .category = .application, .value = "application/vnd.motorola.flexsuite.fis" };
    pub const @"application/vnd.motorola.flexsuite.gotap": MimeType = MimeType{ .category = .application, .value = "application/vnd.motorola.flexsuite.gotap" };
    pub const @"application/vnd.motorola.flexsuite.kmr": MimeType = MimeType{ .category = .application, .value = "application/vnd.motorola.flexsuite.kmr" };
    pub const @"application/vnd.motorola.flexsuite.ttc": MimeType = MimeType{ .category = .application, .value = "application/vnd.motorola.flexsuite.ttc" };
    pub const @"application/vnd.motorola.flexsuite.wem": MimeType = MimeType{ .category = .application, .value = "application/vnd.motorola.flexsuite.wem" };
    pub const @"application/vnd.motorola.iprm": MimeType = MimeType{ .category = .application, .value = "application/vnd.motorola.iprm" };
    pub const @"application/vnd.mozilla.xul+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.mozilla.xul+xml" };
    pub const @"application/vnd.ms-3mfdocument": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-3mfdocument" };
    pub const @"application/vnd.ms-artgalry": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-artgalry" };
    pub const @"application/vnd.ms-asf": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-asf" };
    pub const @"application/vnd.ms-cab-compressed": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-cab-compressed" };
    pub const @"application/vnd.ms-color.iccprofile": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-color.iccprofile" };
    pub const @"application/vnd.ms-excel": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-excel" };
    pub const @"application/vnd.ms-excel.addin.macroenabled.12": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-excel.addin.macroenabled.12" };
    pub const @"application/vnd.ms-excel.sheet.binary.macroenabled.12": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-excel.sheet.binary.macroenabled.12" };
    pub const @"application/vnd.ms-excel.sheet.macroenabled.12": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-excel.sheet.macroenabled.12" };
    pub const @"application/vnd.ms-excel.template.macroenabled.12": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-excel.template.macroenabled.12" };
    pub const @"application/vnd.ms-fontobject": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-fontobject" };
    pub const @"application/vnd.ms-htmlhelp": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-htmlhelp" };
    pub const @"application/vnd.ms-ims": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-ims" };
    pub const @"application/vnd.ms-lrm": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-lrm" };
    pub const @"application/vnd.ms-office.activex+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-office.activex+xml" };
    pub const @"application/vnd.ms-officetheme": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-officetheme" };
    pub const @"application/vnd.ms-opentype": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-opentype" };
    pub const @"application/vnd.ms-outlook": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-outlook" };
    pub const @"application/vnd.ms-package.obfuscated-opentype": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-package.obfuscated-opentype" };
    pub const @"application/vnd.ms-pki.seccat": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-pki.seccat" };
    pub const @"application/vnd.ms-pki.stl": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-pki.stl" };
    pub const @"application/vnd.ms-playready.initiator+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-playready.initiator+xml" };
    pub const @"application/vnd.ms-powerpoint": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-powerpoint" };
    pub const @"application/vnd.ms-powerpoint.addin.macroenabled.12": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-powerpoint.addin.macroenabled.12" };
    pub const @"application/vnd.ms-powerpoint.presentation.macroenabled.12": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-powerpoint.presentation.macroenabled.12" };
    pub const @"application/vnd.ms-powerpoint.slide.macroenabled.12": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-powerpoint.slide.macroenabled.12" };
    pub const @"application/vnd.ms-powerpoint.slideshow.macroenabled.12": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-powerpoint.slideshow.macroenabled.12" };
    pub const @"application/vnd.ms-powerpoint.template.macroenabled.12": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-powerpoint.template.macroenabled.12" };
    pub const @"application/vnd.ms-printdevicecapabilities+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-printdevicecapabilities+xml" };
    pub const @"application/vnd.ms-printing.printticket+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-printing.printticket+xml" };
    pub const @"application/vnd.ms-printschematicket+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-printschematicket+xml" };
    pub const @"application/vnd.ms-project": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-project" };
    pub const @"application/vnd.ms-tnef": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-tnef" };
    pub const @"application/vnd.ms-windows.devicepairing": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-windows.devicepairing" };
    pub const @"application/vnd.ms-windows.nwprinting.oob": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-windows.nwprinting.oob" };
    pub const @"application/vnd.ms-windows.printerpairing": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-windows.printerpairing" };
    pub const @"application/vnd.ms-windows.wsd.oob": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-windows.wsd.oob" };
    pub const @"application/vnd.ms-wmdrm.lic-chlg-req": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-wmdrm.lic-chlg-req" };
    pub const @"application/vnd.ms-wmdrm.lic-resp": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-wmdrm.lic-resp" };
    pub const @"application/vnd.ms-wmdrm.meter-chlg-req": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-wmdrm.meter-chlg-req" };
    pub const @"application/vnd.ms-wmdrm.meter-resp": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-wmdrm.meter-resp" };
    pub const @"application/vnd.ms-word.document.macroenabled.12": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-word.document.macroenabled.12" };
    pub const @"application/vnd.ms-word.template.macroenabled.12": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-word.template.macroenabled.12" };
    pub const @"application/vnd.ms-works": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-works" };
    pub const @"application/vnd.ms-wpl": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-wpl" };
    pub const @"application/vnd.ms-xpsdocument": MimeType = MimeType{ .category = .application, .value = "application/vnd.ms-xpsdocument" };
    pub const @"application/vnd.msa-disk-image": MimeType = MimeType{ .category = .application, .value = "application/vnd.msa-disk-image" };
    pub const @"application/vnd.mseq": MimeType = MimeType{ .category = .application, .value = "application/vnd.mseq" };
    pub const @"application/vnd.msign": MimeType = MimeType{ .category = .application, .value = "application/vnd.msign" };
    pub const @"application/vnd.multiad.creator": MimeType = MimeType{ .category = .application, .value = "application/vnd.multiad.creator" };
    pub const @"application/vnd.multiad.creator.cif": MimeType = MimeType{ .category = .application, .value = "application/vnd.multiad.creator.cif" };
    pub const @"application/vnd.music-niff": MimeType = MimeType{ .category = .application, .value = "application/vnd.music-niff" };
    pub const @"application/vnd.musician": MimeType = MimeType{ .category = .application, .value = "application/vnd.musician" };
    pub const @"application/vnd.muvee.style": MimeType = MimeType{ .category = .application, .value = "application/vnd.muvee.style" };
    pub const @"application/vnd.mynfc": MimeType = MimeType{ .category = .application, .value = "application/vnd.mynfc" };
    pub const @"application/vnd.nacamar.ybrid+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.nacamar.ybrid+json" };
    pub const @"application/vnd.ncd.control": MimeType = MimeType{ .category = .application, .value = "application/vnd.ncd.control" };
    pub const @"application/vnd.ncd.reference": MimeType = MimeType{ .category = .application, .value = "application/vnd.ncd.reference" };
    pub const @"application/vnd.nearst.inv+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.nearst.inv+json" };
    pub const @"application/vnd.nebumind.line": MimeType = MimeType{ .category = .application, .value = "application/vnd.nebumind.line" };
    pub const @"application/vnd.nervana": MimeType = MimeType{ .category = .application, .value = "application/vnd.nervana" };
    pub const @"application/vnd.netfpx": MimeType = MimeType{ .category = .application, .value = "application/vnd.netfpx" };
    pub const @"application/vnd.neurolanguage.nlu": MimeType = MimeType{ .category = .application, .value = "application/vnd.neurolanguage.nlu" };
    pub const @"application/vnd.nimn": MimeType = MimeType{ .category = .application, .value = "application/vnd.nimn" };
    pub const @"application/vnd.nintendo.nitro.rom": MimeType = MimeType{ .category = .application, .value = "application/vnd.nintendo.nitro.rom" };
    pub const @"application/vnd.nintendo.snes.rom": MimeType = MimeType{ .category = .application, .value = "application/vnd.nintendo.snes.rom" };
    pub const @"application/vnd.nitf": MimeType = MimeType{ .category = .application, .value = "application/vnd.nitf" };
    pub const @"application/vnd.noblenet-directory": MimeType = MimeType{ .category = .application, .value = "application/vnd.noblenet-directory" };
    pub const @"application/vnd.noblenet-sealer": MimeType = MimeType{ .category = .application, .value = "application/vnd.noblenet-sealer" };
    pub const @"application/vnd.noblenet-web": MimeType = MimeType{ .category = .application, .value = "application/vnd.noblenet-web" };
    pub const @"application/vnd.nokia.catalogs": MimeType = MimeType{ .category = .application, .value = "application/vnd.nokia.catalogs" };
    pub const @"application/vnd.nokia.conml+wbxml": MimeType = MimeType{ .category = .application, .value = "application/vnd.nokia.conml+wbxml" };
    pub const @"application/vnd.nokia.conml+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.nokia.conml+xml" };
    pub const @"application/vnd.nokia.iptv.config+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.nokia.iptv.config+xml" };
    pub const @"application/vnd.nokia.isds-radio-presets": MimeType = MimeType{ .category = .application, .value = "application/vnd.nokia.isds-radio-presets" };
    pub const @"application/vnd.nokia.landmark+wbxml": MimeType = MimeType{ .category = .application, .value = "application/vnd.nokia.landmark+wbxml" };
    pub const @"application/vnd.nokia.landmark+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.nokia.landmark+xml" };
    pub const @"application/vnd.nokia.landmarkcollection+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.nokia.landmarkcollection+xml" };
    pub const @"application/vnd.nokia.n-gage.ac+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.nokia.n-gage.ac+xml" };
    pub const @"application/vnd.nokia.n-gage.data": MimeType = MimeType{ .category = .application, .value = "application/vnd.nokia.n-gage.data" };
    pub const @"application/vnd.nokia.n-gage.symbian.install": MimeType = MimeType{ .category = .application, .value = "application/vnd.nokia.n-gage.symbian.install" };
    pub const @"application/vnd.nokia.ncd": MimeType = MimeType{ .category = .application, .value = "application/vnd.nokia.ncd" };
    pub const @"application/vnd.nokia.pcd+wbxml": MimeType = MimeType{ .category = .application, .value = "application/vnd.nokia.pcd+wbxml" };
    pub const @"application/vnd.nokia.pcd+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.nokia.pcd+xml" };
    pub const @"application/vnd.nokia.radio-preset": MimeType = MimeType{ .category = .application, .value = "application/vnd.nokia.radio-preset" };
    pub const @"application/vnd.nokia.radio-presets": MimeType = MimeType{ .category = .application, .value = "application/vnd.nokia.radio-presets" };
    pub const @"application/vnd.novadigm.edm": MimeType = MimeType{ .category = .application, .value = "application/vnd.novadigm.edm" };
    pub const @"application/vnd.novadigm.edx": MimeType = MimeType{ .category = .application, .value = "application/vnd.novadigm.edx" };
    pub const @"application/vnd.novadigm.ext": MimeType = MimeType{ .category = .application, .value = "application/vnd.novadigm.ext" };
    pub const @"application/vnd.ntt-local.content-share": MimeType = MimeType{ .category = .application, .value = "application/vnd.ntt-local.content-share" };
    pub const @"application/vnd.ntt-local.file-transfer": MimeType = MimeType{ .category = .application, .value = "application/vnd.ntt-local.file-transfer" };
    pub const @"application/vnd.ntt-local.ogw_remote-access": MimeType = MimeType{ .category = .application, .value = "application/vnd.ntt-local.ogw_remote-access" };
    pub const @"application/vnd.ntt-local.sip-ta_remote": MimeType = MimeType{ .category = .application, .value = "application/vnd.ntt-local.sip-ta_remote" };
    pub const @"application/vnd.ntt-local.sip-ta_tcp_stream": MimeType = MimeType{ .category = .application, .value = "application/vnd.ntt-local.sip-ta_tcp_stream" };
    pub const @"application/vnd.oasis.opendocument.chart": MimeType = MimeType{ .category = .application, .value = "application/vnd.oasis.opendocument.chart" };
    pub const @"application/vnd.oasis.opendocument.chart-template": MimeType = MimeType{ .category = .application, .value = "application/vnd.oasis.opendocument.chart-template" };
    pub const @"application/vnd.oasis.opendocument.database": MimeType = MimeType{ .category = .application, .value = "application/vnd.oasis.opendocument.database" };
    pub const @"application/vnd.oasis.opendocument.formula": MimeType = MimeType{ .category = .application, .value = "application/vnd.oasis.opendocument.formula" };
    pub const @"application/vnd.oasis.opendocument.formula-template": MimeType = MimeType{ .category = .application, .value = "application/vnd.oasis.opendocument.formula-template" };
    pub const @"application/vnd.oasis.opendocument.graphics": MimeType = MimeType{ .category = .application, .value = "application/vnd.oasis.opendocument.graphics" };
    pub const @"application/vnd.oasis.opendocument.graphics-template": MimeType = MimeType{ .category = .application, .value = "application/vnd.oasis.opendocument.graphics-template" };
    pub const @"application/vnd.oasis.opendocument.image": MimeType = MimeType{ .category = .application, .value = "application/vnd.oasis.opendocument.image" };
    pub const @"application/vnd.oasis.opendocument.image-template": MimeType = MimeType{ .category = .application, .value = "application/vnd.oasis.opendocument.image-template" };
    pub const @"application/vnd.oasis.opendocument.presentation": MimeType = MimeType{ .category = .application, .value = "application/vnd.oasis.opendocument.presentation" };
    pub const @"application/vnd.oasis.opendocument.presentation-template": MimeType = MimeType{ .category = .application, .value = "application/vnd.oasis.opendocument.presentation-template" };
    pub const @"application/vnd.oasis.opendocument.spreadsheet": MimeType = MimeType{ .category = .application, .value = "application/vnd.oasis.opendocument.spreadsheet" };
    pub const @"application/vnd.oasis.opendocument.spreadsheet-template": MimeType = MimeType{ .category = .application, .value = "application/vnd.oasis.opendocument.spreadsheet-template" };
    pub const @"application/vnd.oasis.opendocument.text": MimeType = MimeType{ .category = .application, .value = "application/vnd.oasis.opendocument.text" };
    pub const @"application/vnd.oasis.opendocument.text-master": MimeType = MimeType{ .category = .application, .value = "application/vnd.oasis.opendocument.text-master" };
    pub const @"application/vnd.oasis.opendocument.text-template": MimeType = MimeType{ .category = .application, .value = "application/vnd.oasis.opendocument.text-template" };
    pub const @"application/vnd.oasis.opendocument.text-web": MimeType = MimeType{ .category = .application, .value = "application/vnd.oasis.opendocument.text-web" };
    pub const @"application/vnd.obn": MimeType = MimeType{ .category = .application, .value = "application/vnd.obn" };
    pub const @"application/vnd.ocf+cbor": MimeType = MimeType{ .category = .application, .value = "application/vnd.ocf+cbor" };
    pub const @"application/vnd.oci.image.manifest.v1+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.oci.image.manifest.v1+json" };
    pub const @"application/vnd.oftn.l10n+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.oftn.l10n+json" };
    pub const @"application/vnd.oipf.contentaccessdownload+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oipf.contentaccessdownload+xml" };
    pub const @"application/vnd.oipf.contentaccessstreaming+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oipf.contentaccessstreaming+xml" };
    pub const @"application/vnd.oipf.cspg-hexbinary": MimeType = MimeType{ .category = .application, .value = "application/vnd.oipf.cspg-hexbinary" };
    pub const @"application/vnd.oipf.dae.svg+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oipf.dae.svg+xml" };
    pub const @"application/vnd.oipf.dae.xhtml+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oipf.dae.xhtml+xml" };
    pub const @"application/vnd.oipf.mippvcontrolmessage+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oipf.mippvcontrolmessage+xml" };
    pub const @"application/vnd.oipf.pae.gem": MimeType = MimeType{ .category = .application, .value = "application/vnd.oipf.pae.gem" };
    pub const @"application/vnd.oipf.spdiscovery+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oipf.spdiscovery+xml" };
    pub const @"application/vnd.oipf.spdlist+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oipf.spdlist+xml" };
    pub const @"application/vnd.oipf.ueprofile+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oipf.ueprofile+xml" };
    pub const @"application/vnd.oipf.userprofile+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oipf.userprofile+xml" };
    pub const @"application/vnd.olpc-sugar": MimeType = MimeType{ .category = .application, .value = "application/vnd.olpc-sugar" };
    pub const @"application/vnd.oma-scws-config": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma-scws-config" };
    pub const @"application/vnd.oma-scws-http-request": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma-scws-http-request" };
    pub const @"application/vnd.oma-scws-http-response": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma-scws-http-response" };
    pub const @"application/vnd.oma.bcast.associated-procedure-parameter+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.bcast.associated-procedure-parameter+xml" };
    pub const @"application/vnd.oma.bcast.drm-trigger+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.bcast.drm-trigger+xml" };
    pub const @"application/vnd.oma.bcast.imd+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.bcast.imd+xml" };
    pub const @"application/vnd.oma.bcast.ltkm": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.bcast.ltkm" };
    pub const @"application/vnd.oma.bcast.notification+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.bcast.notification+xml" };
    pub const @"application/vnd.oma.bcast.provisioningtrigger": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.bcast.provisioningtrigger" };
    pub const @"application/vnd.oma.bcast.sgboot": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.bcast.sgboot" };
    pub const @"application/vnd.oma.bcast.sgdd+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.bcast.sgdd+xml" };
    pub const @"application/vnd.oma.bcast.sgdu": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.bcast.sgdu" };
    pub const @"application/vnd.oma.bcast.simple-symbol-container": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.bcast.simple-symbol-container" };
    pub const @"application/vnd.oma.bcast.smartcard-trigger+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.bcast.smartcard-trigger+xml" };
    pub const @"application/vnd.oma.bcast.sprov+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.bcast.sprov+xml" };
    pub const @"application/vnd.oma.bcast.stkm": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.bcast.stkm" };
    pub const @"application/vnd.oma.cab-address-book+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.cab-address-book+xml" };
    pub const @"application/vnd.oma.cab-feature-handler+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.cab-feature-handler+xml" };
    pub const @"application/vnd.oma.cab-pcc+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.cab-pcc+xml" };
    pub const @"application/vnd.oma.cab-subs-invite+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.cab-subs-invite+xml" };
    pub const @"application/vnd.oma.cab-user-prefs+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.cab-user-prefs+xml" };
    pub const @"application/vnd.oma.dcd": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.dcd" };
    pub const @"application/vnd.oma.dcdc": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.dcdc" };
    pub const @"application/vnd.oma.dd2+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.dd2+xml" };
    pub const @"application/vnd.oma.drm.risd+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.drm.risd+xml" };
    pub const @"application/vnd.oma.group-usage-list+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.group-usage-list+xml" };
    pub const @"application/vnd.oma.lwm2m+cbor": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.lwm2m+cbor" };
    pub const @"application/vnd.oma.lwm2m+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.lwm2m+json" };
    pub const @"application/vnd.oma.lwm2m+tlv": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.lwm2m+tlv" };
    pub const @"application/vnd.oma.pal+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.pal+xml" };
    pub const @"application/vnd.oma.poc.detailed-progress-report+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.poc.detailed-progress-report+xml" };
    pub const @"application/vnd.oma.poc.final-report+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.poc.final-report+xml" };
    pub const @"application/vnd.oma.poc.groups+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.poc.groups+xml" };
    pub const @"application/vnd.oma.poc.invocation-descriptor+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.poc.invocation-descriptor+xml" };
    pub const @"application/vnd.oma.poc.optimized-progress-report+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.poc.optimized-progress-report+xml" };
    pub const @"application/vnd.oma.push": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.push" };
    pub const @"application/vnd.oma.scidm.messages+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.scidm.messages+xml" };
    pub const @"application/vnd.oma.xcap-directory+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.oma.xcap-directory+xml" };
    pub const @"application/vnd.omads-email+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.omads-email+xml" };
    pub const @"application/vnd.omads-file+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.omads-file+xml" };
    pub const @"application/vnd.omads-folder+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.omads-folder+xml" };
    pub const @"application/vnd.omaloc-supl-init": MimeType = MimeType{ .category = .application, .value = "application/vnd.omaloc-supl-init" };
    pub const @"application/vnd.onepager": MimeType = MimeType{ .category = .application, .value = "application/vnd.onepager" };
    pub const @"application/vnd.onepagertamp": MimeType = MimeType{ .category = .application, .value = "application/vnd.onepagertamp" };
    pub const @"application/vnd.onepagertamx": MimeType = MimeType{ .category = .application, .value = "application/vnd.onepagertamx" };
    pub const @"application/vnd.onepagertat": MimeType = MimeType{ .category = .application, .value = "application/vnd.onepagertat" };
    pub const @"application/vnd.onepagertatp": MimeType = MimeType{ .category = .application, .value = "application/vnd.onepagertatp" };
    pub const @"application/vnd.onepagertatx": MimeType = MimeType{ .category = .application, .value = "application/vnd.onepagertatx" };
    pub const @"application/vnd.openblox.game+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openblox.game+xml" };
    pub const @"application/vnd.openblox.game-binary": MimeType = MimeType{ .category = .application, .value = "application/vnd.openblox.game-binary" };
    pub const @"application/vnd.openeye.oeb": MimeType = MimeType{ .category = .application, .value = "application/vnd.openeye.oeb" };
    pub const @"application/vnd.openofficeorg.extension": MimeType = MimeType{ .category = .application, .value = "application/vnd.openofficeorg.extension" };
    pub const @"application/vnd.openstreetmap.data+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openstreetmap.data+xml" };
    pub const @"application/vnd.opentimestamps.ots": MimeType = MimeType{ .category = .application, .value = "application/vnd.opentimestamps.ots" };
    pub const @"application/vnd.openxmlformats-officedocument.custom-properties+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.custom-properties+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.customxmlproperties+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.customxmlproperties+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.drawing+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.drawing+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.drawingml.chart+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.drawingml.chartshapes+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.drawingml.chartshapes+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.drawingml.diagramcolors+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.drawingml.diagramcolors+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.drawingml.diagramdata+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.drawingml.diagramdata+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.drawingml.diagramlayout+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.drawingml.diagramlayout+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.drawingml.diagramstyle+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.drawingml.diagramstyle+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.extended-properties+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.extended-properties+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.presentationml.commentauthors+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.presentationml.commentauthors+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.presentationml.comments+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.presentationml.comments+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.presentationml.handoutmaster+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.presentationml.handoutmaster+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.presentationml.notesmaster+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.presentationml.notesmaster+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.presentationml.notesslide+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.presentationml.notesslide+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.presentationml.presentation": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.presentationml.presentation" };
    pub const @"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.presentationml.presprops+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.presentationml.presprops+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.presentationml.slide": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.presentationml.slide" };
    pub const @"application/vnd.openxmlformats-officedocument.presentationml.slide+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.presentationml.slidelayout+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.presentationml.slidelayout+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.presentationml.slidemaster+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.presentationml.slidemaster+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.presentationml.slideshow": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.presentationml.slideshow" };
    pub const @"application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.presentationml.slideupdateinfo+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.presentationml.slideupdateinfo+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.presentationml.tablestyles+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.presentationml.tablestyles+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.presentationml.tags+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.presentationml.tags+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.presentationml.template": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.presentationml.template" };
    pub const @"application/vnd.openxmlformats-officedocument.presentationml.template.main+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.presentationml.template.main+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.presentationml.viewprops+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.presentationml.viewprops+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.spreadsheetml.calcchain+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.spreadsheetml.calcchain+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.spreadsheetml.chartsheet+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.spreadsheetml.chartsheet+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.spreadsheetml.dialogsheet+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.spreadsheetml.dialogsheet+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.spreadsheetml.externallink+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.spreadsheetml.externallink+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.spreadsheetml.pivotcachedefinition+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotcachedefinition+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.spreadsheetml.pivotcacherecords+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotcacherecords+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.spreadsheetml.pivottable+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.spreadsheetml.pivottable+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.spreadsheetml.querytable+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.spreadsheetml.querytable+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.spreadsheetml.revisionheaders+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.spreadsheetml.revisionheaders+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.spreadsheetml.revisionlog+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.spreadsheetml.revisionlog+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.spreadsheetml.sharedstrings+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedstrings+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
    pub const @"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.spreadsheetml.sheetmetadata+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheetmetadata+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.spreadsheetml.tablesinglecells+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.spreadsheetml.tablesinglecells+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.spreadsheetml.template": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.spreadsheetml.template" };
    pub const @"application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.spreadsheetml.usernames+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.spreadsheetml.usernames+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.spreadsheetml.volatiledependencies+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.spreadsheetml.volatiledependencies+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.theme+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.theme+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.themeoverride+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.themeoverride+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.vmldrawing": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.vmldrawing" };
    pub const @"application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.wordprocessingml.document": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    pub const @"application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.wordprocessingml.fonttable+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.wordprocessingml.fonttable+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.wordprocessingml.template": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.wordprocessingml.template" };
    pub const @"application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml" };
    pub const @"application/vnd.openxmlformats-officedocument.wordprocessingml.websettings+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-officedocument.wordprocessingml.websettings+xml" };
    pub const @"application/vnd.openxmlformats-package.core-properties+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-package.core-properties+xml" };
    pub const @"application/vnd.openxmlformats-package.digital-signature-xmlsignature+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-package.digital-signature-xmlsignature+xml" };
    pub const @"application/vnd.openxmlformats-package.relationships+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.openxmlformats-package.relationships+xml" };
    pub const @"application/vnd.oracle.resource+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.oracle.resource+json" };
    pub const @"application/vnd.orange.indata": MimeType = MimeType{ .category = .application, .value = "application/vnd.orange.indata" };
    pub const @"application/vnd.osa.netdeploy": MimeType = MimeType{ .category = .application, .value = "application/vnd.osa.netdeploy" };
    pub const @"application/vnd.osgeo.mapguide.package": MimeType = MimeType{ .category = .application, .value = "application/vnd.osgeo.mapguide.package" };
    pub const @"application/vnd.osgi.bundle": MimeType = MimeType{ .category = .application, .value = "application/vnd.osgi.bundle" };
    pub const @"application/vnd.osgi.dp": MimeType = MimeType{ .category = .application, .value = "application/vnd.osgi.dp" };
    pub const @"application/vnd.osgi.subsystem": MimeType = MimeType{ .category = .application, .value = "application/vnd.osgi.subsystem" };
    pub const @"application/vnd.otps.ct-kip+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.otps.ct-kip+xml" };
    pub const @"application/vnd.oxli.countgraph": MimeType = MimeType{ .category = .application, .value = "application/vnd.oxli.countgraph" };
    pub const @"application/vnd.pagerduty+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.pagerduty+json" };
    pub const @"application/vnd.palm": MimeType = MimeType{ .category = .application, .value = "application/vnd.palm" };
    pub const @"application/vnd.panoply": MimeType = MimeType{ .category = .application, .value = "application/vnd.panoply" };
    pub const @"application/vnd.paos.xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.paos.xml" };
    pub const @"application/vnd.patentdive": MimeType = MimeType{ .category = .application, .value = "application/vnd.patentdive" };
    pub const @"application/vnd.patientecommsdoc": MimeType = MimeType{ .category = .application, .value = "application/vnd.patientecommsdoc" };
    pub const @"application/vnd.pawaafile": MimeType = MimeType{ .category = .application, .value = "application/vnd.pawaafile" };
    pub const @"application/vnd.pcos": MimeType = MimeType{ .category = .application, .value = "application/vnd.pcos" };
    pub const @"application/vnd.pg.format": MimeType = MimeType{ .category = .application, .value = "application/vnd.pg.format" };
    pub const @"application/vnd.pg.osasli": MimeType = MimeType{ .category = .application, .value = "application/vnd.pg.osasli" };
    pub const @"application/vnd.piaccess.application-licence": MimeType = MimeType{ .category = .application, .value = "application/vnd.piaccess.application-licence" };
    pub const @"application/vnd.picsel": MimeType = MimeType{ .category = .application, .value = "application/vnd.picsel" };
    pub const @"application/vnd.pmi.widget": MimeType = MimeType{ .category = .application, .value = "application/vnd.pmi.widget" };
    pub const @"application/vnd.poc.group-advertisement+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.poc.group-advertisement+xml" };
    pub const @"application/vnd.pocketlearn": MimeType = MimeType{ .category = .application, .value = "application/vnd.pocketlearn" };
    pub const @"application/vnd.powerbuilder6": MimeType = MimeType{ .category = .application, .value = "application/vnd.powerbuilder6" };
    pub const @"application/vnd.powerbuilder6-s": MimeType = MimeType{ .category = .application, .value = "application/vnd.powerbuilder6-s" };
    pub const @"application/vnd.powerbuilder7": MimeType = MimeType{ .category = .application, .value = "application/vnd.powerbuilder7" };
    pub const @"application/vnd.powerbuilder7-s": MimeType = MimeType{ .category = .application, .value = "application/vnd.powerbuilder7-s" };
    pub const @"application/vnd.powerbuilder75": MimeType = MimeType{ .category = .application, .value = "application/vnd.powerbuilder75" };
    pub const @"application/vnd.powerbuilder75-s": MimeType = MimeType{ .category = .application, .value = "application/vnd.powerbuilder75-s" };
    pub const @"application/vnd.preminet": MimeType = MimeType{ .category = .application, .value = "application/vnd.preminet" };
    pub const @"application/vnd.previewsystems.box": MimeType = MimeType{ .category = .application, .value = "application/vnd.previewsystems.box" };
    pub const @"application/vnd.proteus.magazine": MimeType = MimeType{ .category = .application, .value = "application/vnd.proteus.magazine" };
    pub const @"application/vnd.psfs": MimeType = MimeType{ .category = .application, .value = "application/vnd.psfs" };
    pub const @"application/vnd.publishare-delta-tree": MimeType = MimeType{ .category = .application, .value = "application/vnd.publishare-delta-tree" };
    pub const @"application/vnd.pvi.ptid1": MimeType = MimeType{ .category = .application, .value = "application/vnd.pvi.ptid1" };
    pub const @"application/vnd.pwg-multiplexed": MimeType = MimeType{ .category = .application, .value = "application/vnd.pwg-multiplexed" };
    pub const @"application/vnd.pwg-xhtml-print+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.pwg-xhtml-print+xml" };
    pub const @"application/vnd.qualcomm.brew-app-res": MimeType = MimeType{ .category = .application, .value = "application/vnd.qualcomm.brew-app-res" };
    pub const @"application/vnd.quarantainenet": MimeType = MimeType{ .category = .application, .value = "application/vnd.quarantainenet" };
    pub const @"application/vnd.quark.quarkxpress": MimeType = MimeType{ .category = .application, .value = "application/vnd.quark.quarkxpress" };
    pub const @"application/vnd.quobject-quoxdocument": MimeType = MimeType{ .category = .application, .value = "application/vnd.quobject-quoxdocument" };
    pub const @"application/vnd.radisys.moml+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.radisys.moml+xml" };
    pub const @"application/vnd.radisys.msml+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.radisys.msml+xml" };
    pub const @"application/vnd.radisys.msml-audit+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.radisys.msml-audit+xml" };
    pub const @"application/vnd.radisys.msml-audit-conf+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.radisys.msml-audit-conf+xml" };
    pub const @"application/vnd.radisys.msml-audit-conn+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.radisys.msml-audit-conn+xml" };
    pub const @"application/vnd.radisys.msml-audit-dialog+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.radisys.msml-audit-dialog+xml" };
    pub const @"application/vnd.radisys.msml-audit-stream+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.radisys.msml-audit-stream+xml" };
    pub const @"application/vnd.radisys.msml-conf+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.radisys.msml-conf+xml" };
    pub const @"application/vnd.radisys.msml-dialog+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.radisys.msml-dialog+xml" };
    pub const @"application/vnd.radisys.msml-dialog-base+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.radisys.msml-dialog-base+xml" };
    pub const @"application/vnd.radisys.msml-dialog-fax-detect+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.radisys.msml-dialog-fax-detect+xml" };
    pub const @"application/vnd.radisys.msml-dialog-fax-sendrecv+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.radisys.msml-dialog-fax-sendrecv+xml" };
    pub const @"application/vnd.radisys.msml-dialog-group+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.radisys.msml-dialog-group+xml" };
    pub const @"application/vnd.radisys.msml-dialog-speech+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.radisys.msml-dialog-speech+xml" };
    pub const @"application/vnd.radisys.msml-dialog-transform+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.radisys.msml-dialog-transform+xml" };
    pub const @"application/vnd.rainstor.data": MimeType = MimeType{ .category = .application, .value = "application/vnd.rainstor.data" };
    pub const @"application/vnd.rapid": MimeType = MimeType{ .category = .application, .value = "application/vnd.rapid" };
    pub const @"application/vnd.rar": MimeType = MimeType{ .category = .application, .value = "application/vnd.rar" };
    pub const @"application/vnd.realvnc.bed": MimeType = MimeType{ .category = .application, .value = "application/vnd.realvnc.bed" };
    pub const @"application/vnd.recordare.musicxml": MimeType = MimeType{ .category = .application, .value = "application/vnd.recordare.musicxml" };
    pub const @"application/vnd.recordare.musicxml+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.recordare.musicxml+xml" };
    pub const @"application/vnd.renlearn.rlprint": MimeType = MimeType{ .category = .application, .value = "application/vnd.renlearn.rlprint" };
    pub const @"application/vnd.resilient.logic": MimeType = MimeType{ .category = .application, .value = "application/vnd.resilient.logic" };
    pub const @"application/vnd.restful+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.restful+json" };
    pub const @"application/vnd.rig.cryptonote": MimeType = MimeType{ .category = .application, .value = "application/vnd.rig.cryptonote" };
    pub const @"application/vnd.rim.cod": MimeType = MimeType{ .category = .application, .value = "application/vnd.rim.cod" };
    pub const @"application/vnd.rn-realmedia": MimeType = MimeType{ .category = .application, .value = "application/vnd.rn-realmedia" };
    pub const @"application/vnd.rn-realmedia-vbr": MimeType = MimeType{ .category = .application, .value = "application/vnd.rn-realmedia-vbr" };
    pub const @"application/vnd.route66.link66+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.route66.link66+xml" };
    pub const @"application/vnd.rs-274x": MimeType = MimeType{ .category = .application, .value = "application/vnd.rs-274x" };
    pub const @"application/vnd.ruckus.download": MimeType = MimeType{ .category = .application, .value = "application/vnd.ruckus.download" };
    pub const @"application/vnd.s3sms": MimeType = MimeType{ .category = .application, .value = "application/vnd.s3sms" };
    pub const @"application/vnd.sailingtracker.track": MimeType = MimeType{ .category = .application, .value = "application/vnd.sailingtracker.track" };
    pub const @"application/vnd.sar": MimeType = MimeType{ .category = .application, .value = "application/vnd.sar" };
    pub const @"application/vnd.sbm.cid": MimeType = MimeType{ .category = .application, .value = "application/vnd.sbm.cid" };
    pub const @"application/vnd.sbm.mid2": MimeType = MimeType{ .category = .application, .value = "application/vnd.sbm.mid2" };
    pub const @"application/vnd.scribus": MimeType = MimeType{ .category = .application, .value = "application/vnd.scribus" };
    pub const @"application/vnd.sealed.3df": MimeType = MimeType{ .category = .application, .value = "application/vnd.sealed.3df" };
    pub const @"application/vnd.sealed.csf": MimeType = MimeType{ .category = .application, .value = "application/vnd.sealed.csf" };
    pub const @"application/vnd.sealed.doc": MimeType = MimeType{ .category = .application, .value = "application/vnd.sealed.doc" };
    pub const @"application/vnd.sealed.eml": MimeType = MimeType{ .category = .application, .value = "application/vnd.sealed.eml" };
    pub const @"application/vnd.sealed.mht": MimeType = MimeType{ .category = .application, .value = "application/vnd.sealed.mht" };
    pub const @"application/vnd.sealed.net": MimeType = MimeType{ .category = .application, .value = "application/vnd.sealed.net" };
    pub const @"application/vnd.sealed.ppt": MimeType = MimeType{ .category = .application, .value = "application/vnd.sealed.ppt" };
    pub const @"application/vnd.sealed.tiff": MimeType = MimeType{ .category = .application, .value = "application/vnd.sealed.tiff" };
    pub const @"application/vnd.sealed.xls": MimeType = MimeType{ .category = .application, .value = "application/vnd.sealed.xls" };
    pub const @"application/vnd.sealedmedia.softseal.html": MimeType = MimeType{ .category = .application, .value = "application/vnd.sealedmedia.softseal.html" };
    pub const @"application/vnd.sealedmedia.softseal.pdf": MimeType = MimeType{ .category = .application, .value = "application/vnd.sealedmedia.softseal.pdf" };
    pub const @"application/vnd.seemail": MimeType = MimeType{ .category = .application, .value = "application/vnd.seemail" };
    pub const @"application/vnd.seis+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.seis+json" };
    pub const @"application/vnd.sema": MimeType = MimeType{ .category = .application, .value = "application/vnd.sema" };
    pub const @"application/vnd.semd": MimeType = MimeType{ .category = .application, .value = "application/vnd.semd" };
    pub const @"application/vnd.semf": MimeType = MimeType{ .category = .application, .value = "application/vnd.semf" };
    pub const @"application/vnd.shade-save-file": MimeType = MimeType{ .category = .application, .value = "application/vnd.shade-save-file" };
    pub const @"application/vnd.shana.informed.formdata": MimeType = MimeType{ .category = .application, .value = "application/vnd.shana.informed.formdata" };
    pub const @"application/vnd.shana.informed.formtemplate": MimeType = MimeType{ .category = .application, .value = "application/vnd.shana.informed.formtemplate" };
    pub const @"application/vnd.shana.informed.interchange": MimeType = MimeType{ .category = .application, .value = "application/vnd.shana.informed.interchange" };
    pub const @"application/vnd.shana.informed.package": MimeType = MimeType{ .category = .application, .value = "application/vnd.shana.informed.package" };
    pub const @"application/vnd.shootproof+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.shootproof+json" };
    pub const @"application/vnd.shopkick+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.shopkick+json" };
    pub const @"application/vnd.shp": MimeType = MimeType{ .category = .application, .value = "application/vnd.shp" };
    pub const @"application/vnd.shx": MimeType = MimeType{ .category = .application, .value = "application/vnd.shx" };
    pub const @"application/vnd.sigrok.session": MimeType = MimeType{ .category = .application, .value = "application/vnd.sigrok.session" };
    pub const @"application/vnd.simtech-mindmapper": MimeType = MimeType{ .category = .application, .value = "application/vnd.simtech-mindmapper" };
    pub const @"application/vnd.siren+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.siren+json" };
    pub const @"application/vnd.smaf": MimeType = MimeType{ .category = .application, .value = "application/vnd.smaf" };
    pub const @"application/vnd.smart.notebook": MimeType = MimeType{ .category = .application, .value = "application/vnd.smart.notebook" };
    pub const @"application/vnd.smart.teacher": MimeType = MimeType{ .category = .application, .value = "application/vnd.smart.teacher" };
    pub const @"application/vnd.snesdev-page-table": MimeType = MimeType{ .category = .application, .value = "application/vnd.snesdev-page-table" };
    pub const @"application/vnd.software602.filler.form+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.software602.filler.form+xml" };
    pub const @"application/vnd.software602.filler.form-xml-zip": MimeType = MimeType{ .category = .application, .value = "application/vnd.software602.filler.form-xml-zip" };
    pub const @"application/vnd.solent.sdkm+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.solent.sdkm+xml" };
    pub const @"application/vnd.spotfire.dxp": MimeType = MimeType{ .category = .application, .value = "application/vnd.spotfire.dxp" };
    pub const @"application/vnd.spotfire.sfs": MimeType = MimeType{ .category = .application, .value = "application/vnd.spotfire.sfs" };
    pub const @"application/vnd.sqlite3": MimeType = MimeType{ .category = .application, .value = "application/vnd.sqlite3" };
    pub const @"application/vnd.sss-cod": MimeType = MimeType{ .category = .application, .value = "application/vnd.sss-cod" };
    pub const @"application/vnd.sss-dtf": MimeType = MimeType{ .category = .application, .value = "application/vnd.sss-dtf" };
    pub const @"application/vnd.sss-ntf": MimeType = MimeType{ .category = .application, .value = "application/vnd.sss-ntf" };
    pub const @"application/vnd.stardivision.calc": MimeType = MimeType{ .category = .application, .value = "application/vnd.stardivision.calc" };
    pub const @"application/vnd.stardivision.draw": MimeType = MimeType{ .category = .application, .value = "application/vnd.stardivision.draw" };
    pub const @"application/vnd.stardivision.impress": MimeType = MimeType{ .category = .application, .value = "application/vnd.stardivision.impress" };
    pub const @"application/vnd.stardivision.math": MimeType = MimeType{ .category = .application, .value = "application/vnd.stardivision.math" };
    pub const @"application/vnd.stardivision.writer": MimeType = MimeType{ .category = .application, .value = "application/vnd.stardivision.writer" };
    pub const @"application/vnd.stardivision.writer-global": MimeType = MimeType{ .category = .application, .value = "application/vnd.stardivision.writer-global" };
    pub const @"application/vnd.stepmania.package": MimeType = MimeType{ .category = .application, .value = "application/vnd.stepmania.package" };
    pub const @"application/vnd.stepmania.stepchart": MimeType = MimeType{ .category = .application, .value = "application/vnd.stepmania.stepchart" };
    pub const @"application/vnd.street-stream": MimeType = MimeType{ .category = .application, .value = "application/vnd.street-stream" };
    pub const @"application/vnd.sun.wadl+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.sun.wadl+xml" };
    pub const @"application/vnd.sun.xml.calc": MimeType = MimeType{ .category = .application, .value = "application/vnd.sun.xml.calc" };
    pub const @"application/vnd.sun.xml.calc.template": MimeType = MimeType{ .category = .application, .value = "application/vnd.sun.xml.calc.template" };
    pub const @"application/vnd.sun.xml.draw": MimeType = MimeType{ .category = .application, .value = "application/vnd.sun.xml.draw" };
    pub const @"application/vnd.sun.xml.draw.template": MimeType = MimeType{ .category = .application, .value = "application/vnd.sun.xml.draw.template" };
    pub const @"application/vnd.sun.xml.impress": MimeType = MimeType{ .category = .application, .value = "application/vnd.sun.xml.impress" };
    pub const @"application/vnd.sun.xml.impress.template": MimeType = MimeType{ .category = .application, .value = "application/vnd.sun.xml.impress.template" };
    pub const @"application/vnd.sun.xml.math": MimeType = MimeType{ .category = .application, .value = "application/vnd.sun.xml.math" };
    pub const @"application/vnd.sun.xml.writer": MimeType = MimeType{ .category = .application, .value = "application/vnd.sun.xml.writer" };
    pub const @"application/vnd.sun.xml.writer.global": MimeType = MimeType{ .category = .application, .value = "application/vnd.sun.xml.writer.global" };
    pub const @"application/vnd.sun.xml.writer.template": MimeType = MimeType{ .category = .application, .value = "application/vnd.sun.xml.writer.template" };
    pub const @"application/vnd.sus-calendar": MimeType = MimeType{ .category = .application, .value = "application/vnd.sus-calendar" };
    pub const @"application/vnd.svd": MimeType = MimeType{ .category = .application, .value = "application/vnd.svd" };
    pub const @"application/vnd.swiftview-ics": MimeType = MimeType{ .category = .application, .value = "application/vnd.swiftview-ics" };
    pub const @"application/vnd.sycle+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.sycle+xml" };
    pub const @"application/vnd.syft+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.syft+json" };
    pub const @"application/vnd.symbian.install": MimeType = MimeType{ .category = .application, .value = "application/vnd.symbian.install" };
    pub const @"application/vnd.syncml+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.syncml+xml" };
    pub const @"application/vnd.syncml.dm+wbxml": MimeType = MimeType{ .category = .application, .value = "application/vnd.syncml.dm+wbxml" };
    pub const @"application/vnd.syncml.dm+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.syncml.dm+xml" };
    pub const @"application/vnd.syncml.dm.notification": MimeType = MimeType{ .category = .application, .value = "application/vnd.syncml.dm.notification" };
    pub const @"application/vnd.syncml.dmddf+wbxml": MimeType = MimeType{ .category = .application, .value = "application/vnd.syncml.dmddf+wbxml" };
    pub const @"application/vnd.syncml.dmddf+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.syncml.dmddf+xml" };
    pub const @"application/vnd.syncml.dmtnds+wbxml": MimeType = MimeType{ .category = .application, .value = "application/vnd.syncml.dmtnds+wbxml" };
    pub const @"application/vnd.syncml.dmtnds+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.syncml.dmtnds+xml" };
    pub const @"application/vnd.syncml.ds.notification": MimeType = MimeType{ .category = .application, .value = "application/vnd.syncml.ds.notification" };
    pub const @"application/vnd.tableschema+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.tableschema+json" };
    pub const @"application/vnd.tao.intent-module-archive": MimeType = MimeType{ .category = .application, .value = "application/vnd.tao.intent-module-archive" };
    pub const @"application/vnd.tcpdump.pcap": MimeType = MimeType{ .category = .application, .value = "application/vnd.tcpdump.pcap" };
    pub const @"application/vnd.think-cell.ppttc+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.think-cell.ppttc+json" };
    pub const @"application/vnd.tmd.mediaflex.api+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.tmd.mediaflex.api+xml" };
    pub const @"application/vnd.tml": MimeType = MimeType{ .category = .application, .value = "application/vnd.tml" };
    pub const @"application/vnd.tmobile-livetv": MimeType = MimeType{ .category = .application, .value = "application/vnd.tmobile-livetv" };
    pub const @"application/vnd.tri.onesource": MimeType = MimeType{ .category = .application, .value = "application/vnd.tri.onesource" };
    pub const @"application/vnd.trid.tpt": MimeType = MimeType{ .category = .application, .value = "application/vnd.trid.tpt" };
    pub const @"application/vnd.triscape.mxs": MimeType = MimeType{ .category = .application, .value = "application/vnd.triscape.mxs" };
    pub const @"application/vnd.trueapp": MimeType = MimeType{ .category = .application, .value = "application/vnd.trueapp" };
    pub const @"application/vnd.truedoc": MimeType = MimeType{ .category = .application, .value = "application/vnd.truedoc" };
    pub const @"application/vnd.ubisoft.webplayer": MimeType = MimeType{ .category = .application, .value = "application/vnd.ubisoft.webplayer" };
    pub const @"application/vnd.ufdl": MimeType = MimeType{ .category = .application, .value = "application/vnd.ufdl" };
    pub const @"application/vnd.uiq.theme": MimeType = MimeType{ .category = .application, .value = "application/vnd.uiq.theme" };
    pub const @"application/vnd.umajin": MimeType = MimeType{ .category = .application, .value = "application/vnd.umajin" };
    pub const @"application/vnd.unity": MimeType = MimeType{ .category = .application, .value = "application/vnd.unity" };
    pub const @"application/vnd.uoml+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.uoml+xml" };
    pub const @"application/vnd.uplanet.alert": MimeType = MimeType{ .category = .application, .value = "application/vnd.uplanet.alert" };
    pub const @"application/vnd.uplanet.alert-wbxml": MimeType = MimeType{ .category = .application, .value = "application/vnd.uplanet.alert-wbxml" };
    pub const @"application/vnd.uplanet.bearer-choice": MimeType = MimeType{ .category = .application, .value = "application/vnd.uplanet.bearer-choice" };
    pub const @"application/vnd.uplanet.bearer-choice-wbxml": MimeType = MimeType{ .category = .application, .value = "application/vnd.uplanet.bearer-choice-wbxml" };
    pub const @"application/vnd.uplanet.cacheop": MimeType = MimeType{ .category = .application, .value = "application/vnd.uplanet.cacheop" };
    pub const @"application/vnd.uplanet.cacheop-wbxml": MimeType = MimeType{ .category = .application, .value = "application/vnd.uplanet.cacheop-wbxml" };
    pub const @"application/vnd.uplanet.channel": MimeType = MimeType{ .category = .application, .value = "application/vnd.uplanet.channel" };
    pub const @"application/vnd.uplanet.channel-wbxml": MimeType = MimeType{ .category = .application, .value = "application/vnd.uplanet.channel-wbxml" };
    pub const @"application/vnd.uplanet.list": MimeType = MimeType{ .category = .application, .value = "application/vnd.uplanet.list" };
    pub const @"application/vnd.uplanet.list-wbxml": MimeType = MimeType{ .category = .application, .value = "application/vnd.uplanet.list-wbxml" };
    pub const @"application/vnd.uplanet.listcmd": MimeType = MimeType{ .category = .application, .value = "application/vnd.uplanet.listcmd" };
    pub const @"application/vnd.uplanet.listcmd-wbxml": MimeType = MimeType{ .category = .application, .value = "application/vnd.uplanet.listcmd-wbxml" };
    pub const @"application/vnd.uplanet.signal": MimeType = MimeType{ .category = .application, .value = "application/vnd.uplanet.signal" };
    pub const @"application/vnd.uri-map": MimeType = MimeType{ .category = .application, .value = "application/vnd.uri-map" };
    pub const @"application/vnd.valve.source.material": MimeType = MimeType{ .category = .application, .value = "application/vnd.valve.source.material" };
    pub const @"application/vnd.vcx": MimeType = MimeType{ .category = .application, .value = "application/vnd.vcx" };
    pub const @"application/vnd.vd-study": MimeType = MimeType{ .category = .application, .value = "application/vnd.vd-study" };
    pub const @"application/vnd.vectorworks": MimeType = MimeType{ .category = .application, .value = "application/vnd.vectorworks" };
    pub const @"application/vnd.vel+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.vel+json" };
    pub const @"application/vnd.verimatrix.vcas": MimeType = MimeType{ .category = .application, .value = "application/vnd.verimatrix.vcas" };
    pub const @"application/vnd.veritone.aion+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.veritone.aion+json" };
    pub const @"application/vnd.veryant.thin": MimeType = MimeType{ .category = .application, .value = "application/vnd.veryant.thin" };
    pub const @"application/vnd.ves.encrypted": MimeType = MimeType{ .category = .application, .value = "application/vnd.ves.encrypted" };
    pub const @"application/vnd.vidsoft.vidconference": MimeType = MimeType{ .category = .application, .value = "application/vnd.vidsoft.vidconference" };
    pub const @"application/vnd.visio": MimeType = MimeType{ .category = .application, .value = "application/vnd.visio" };
    pub const @"application/vnd.visionary": MimeType = MimeType{ .category = .application, .value = "application/vnd.visionary" };
    pub const @"application/vnd.vividence.scriptfile": MimeType = MimeType{ .category = .application, .value = "application/vnd.vividence.scriptfile" };
    pub const @"application/vnd.vsf": MimeType = MimeType{ .category = .application, .value = "application/vnd.vsf" };
    pub const @"application/vnd.wap.sic": MimeType = MimeType{ .category = .application, .value = "application/vnd.wap.sic" };
    pub const @"application/vnd.wap.slc": MimeType = MimeType{ .category = .application, .value = "application/vnd.wap.slc" };
    pub const @"application/vnd.wap.wbxml": MimeType = MimeType{ .category = .application, .value = "application/vnd.wap.wbxml" };
    pub const @"application/vnd.wap.wmlc": MimeType = MimeType{ .category = .application, .value = "application/vnd.wap.wmlc" };
    pub const @"application/vnd.wap.wmlscriptc": MimeType = MimeType{ .category = .application, .value = "application/vnd.wap.wmlscriptc" };
    pub const @"application/vnd.webturbo": MimeType = MimeType{ .category = .application, .value = "application/vnd.webturbo" };
    pub const @"application/vnd.wfa.dpp": MimeType = MimeType{ .category = .application, .value = "application/vnd.wfa.dpp" };
    pub const @"application/vnd.wfa.p2p": MimeType = MimeType{ .category = .application, .value = "application/vnd.wfa.p2p" };
    pub const @"application/vnd.wfa.wsc": MimeType = MimeType{ .category = .application, .value = "application/vnd.wfa.wsc" };
    pub const @"application/vnd.windows.devicepairing": MimeType = MimeType{ .category = .application, .value = "application/vnd.windows.devicepairing" };
    pub const @"application/vnd.wmc": MimeType = MimeType{ .category = .application, .value = "application/vnd.wmc" };
    pub const @"application/vnd.wmf.bootstrap": MimeType = MimeType{ .category = .application, .value = "application/vnd.wmf.bootstrap" };
    pub const @"application/vnd.wolfram.mathematica": MimeType = MimeType{ .category = .application, .value = "application/vnd.wolfram.mathematica" };
    pub const @"application/vnd.wolfram.mathematica.package": MimeType = MimeType{ .category = .application, .value = "application/vnd.wolfram.mathematica.package" };
    pub const @"application/vnd.wolfram.player": MimeType = MimeType{ .category = .application, .value = "application/vnd.wolfram.player" };
    pub const @"application/vnd.wordperfect": MimeType = MimeType{ .category = .application, .value = "application/vnd.wordperfect" };
    pub const @"application/vnd.wqd": MimeType = MimeType{ .category = .application, .value = "application/vnd.wqd" };
    pub const @"application/vnd.wrq-hp3000-labelled": MimeType = MimeType{ .category = .application, .value = "application/vnd.wrq-hp3000-labelled" };
    pub const @"application/vnd.wt.stf": MimeType = MimeType{ .category = .application, .value = "application/vnd.wt.stf" };
    pub const @"application/vnd.wv.csp+wbxml": MimeType = MimeType{ .category = .application, .value = "application/vnd.wv.csp+wbxml" };
    pub const @"application/vnd.wv.csp+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.wv.csp+xml" };
    pub const @"application/vnd.wv.ssp+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.wv.ssp+xml" };
    pub const @"application/vnd.xacml+json": MimeType = MimeType{ .category = .application, .value = "application/vnd.xacml+json" };
    pub const @"application/vnd.xara": MimeType = MimeType{ .category = .application, .value = "application/vnd.xara" };
    pub const @"application/vnd.xfdl": MimeType = MimeType{ .category = .application, .value = "application/vnd.xfdl" };
    pub const @"application/vnd.xfdl.webform": MimeType = MimeType{ .category = .application, .value = "application/vnd.xfdl.webform" };
    pub const @"application/vnd.xmi+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.xmi+xml" };
    pub const @"application/vnd.xmpie.cpkg": MimeType = MimeType{ .category = .application, .value = "application/vnd.xmpie.cpkg" };
    pub const @"application/vnd.xmpie.dpkg": MimeType = MimeType{ .category = .application, .value = "application/vnd.xmpie.dpkg" };
    pub const @"application/vnd.xmpie.plan": MimeType = MimeType{ .category = .application, .value = "application/vnd.xmpie.plan" };
    pub const @"application/vnd.xmpie.ppkg": MimeType = MimeType{ .category = .application, .value = "application/vnd.xmpie.ppkg" };
    pub const @"application/vnd.xmpie.xlim": MimeType = MimeType{ .category = .application, .value = "application/vnd.xmpie.xlim" };
    pub const @"application/vnd.yamaha.hv-dic": MimeType = MimeType{ .category = .application, .value = "application/vnd.yamaha.hv-dic" };
    pub const @"application/vnd.yamaha.hv-script": MimeType = MimeType{ .category = .application, .value = "application/vnd.yamaha.hv-script" };
    pub const @"application/vnd.yamaha.hv-voice": MimeType = MimeType{ .category = .application, .value = "application/vnd.yamaha.hv-voice" };
    pub const @"application/vnd.yamaha.openscoreformat": MimeType = MimeType{ .category = .application, .value = "application/vnd.yamaha.openscoreformat" };
    pub const @"application/vnd.yamaha.openscoreformat.osfpvg+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.yamaha.openscoreformat.osfpvg+xml" };
    pub const @"application/vnd.yamaha.remote-setup": MimeType = MimeType{ .category = .application, .value = "application/vnd.yamaha.remote-setup" };
    pub const @"application/vnd.yamaha.smaf-audio": MimeType = MimeType{ .category = .application, .value = "application/vnd.yamaha.smaf-audio" };
    pub const @"application/vnd.yamaha.smaf-phrase": MimeType = MimeType{ .category = .application, .value = "application/vnd.yamaha.smaf-phrase" };
    pub const @"application/vnd.yamaha.through-ngn": MimeType = MimeType{ .category = .application, .value = "application/vnd.yamaha.through-ngn" };
    pub const @"application/vnd.yamaha.tunnel-udpencap": MimeType = MimeType{ .category = .application, .value = "application/vnd.yamaha.tunnel-udpencap" };
    pub const @"application/vnd.yaoweme": MimeType = MimeType{ .category = .application, .value = "application/vnd.yaoweme" };
    pub const @"application/vnd.yellowriver-custom-menu": MimeType = MimeType{ .category = .application, .value = "application/vnd.yellowriver-custom-menu" };
    pub const @"application/vnd.youtube.yt": MimeType = MimeType{ .category = .application, .value = "application/vnd.youtube.yt" };
    pub const @"application/vnd.zul": MimeType = MimeType{ .category = .application, .value = "application/vnd.zul" };
    pub const @"application/vnd.zzazz.deck+xml": MimeType = MimeType{ .category = .application, .value = "application/vnd.zzazz.deck+xml" };
    pub const @"application/voicexml+xml": MimeType = MimeType{ .category = .application, .value = "application/voicexml+xml" };
    pub const @"application/voucher-cms+json": MimeType = MimeType{ .category = .application, .value = "application/voucher-cms+json" };
    pub const @"application/vq-rtcpxr": MimeType = MimeType{ .category = .application, .value = "application/vq-rtcpxr" };
    pub const @"application/watcherinfo+xml": MimeType = MimeType{ .category = .application, .value = "application/watcherinfo+xml" };
    pub const @"application/webpush-options+json": MimeType = MimeType{ .category = .application, .value = "application/webpush-options+json" };
    pub const @"application/whoispp-query": MimeType = MimeType{ .category = .application, .value = "application/whoispp-query" };
    pub const @"application/whoispp-response": MimeType = MimeType{ .category = .application, .value = "application/whoispp-response" };
    pub const @"application/widget": MimeType = MimeType{ .category = .application, .value = "application/widget" };
    pub const @"application/winhlp": MimeType = MimeType{ .category = .application, .value = "application/winhlp" };
    pub const @"application/wita": MimeType = MimeType{ .category = .application, .value = "application/wita" };
    pub const @"application/wordperfect5.1": MimeType = MimeType{ .category = .application, .value = "application/wordperfect5.1" };
    pub const @"application/wsdl+xml": MimeType = MimeType{ .category = .application, .value = "application/wsdl+xml" };
    pub const @"application/wspolicy+xml": MimeType = MimeType{ .category = .application, .value = "application/wspolicy+xml" };
    pub const @"application/x-7z-compressed": MimeType = MimeType{ .category = .application, .value = "application/x-7z-compressed" };
    pub const @"application/x-abiword": MimeType = MimeType{ .category = .application, .value = "application/x-abiword" };
    pub const @"application/x-ace-compressed": MimeType = MimeType{ .category = .application, .value = "application/x-ace-compressed" };
    pub const @"application/x-amf": MimeType = MimeType{ .category = .application, .value = "application/x-amf" };
    pub const @"application/x-apple-diskimage": MimeType = MimeType{ .category = .application, .value = "application/x-apple-diskimage" };
    pub const @"application/x-arj": MimeType = MimeType{ .category = .application, .value = "application/x-arj" };
    pub const @"application/x-authorware-bin": MimeType = MimeType{ .category = .application, .value = "application/x-authorware-bin" };
    pub const @"application/x-authorware-map": MimeType = MimeType{ .category = .application, .value = "application/x-authorware-map" };
    pub const @"application/x-authorware-seg": MimeType = MimeType{ .category = .application, .value = "application/x-authorware-seg" };
    pub const @"application/x-bcpio": MimeType = MimeType{ .category = .application, .value = "application/x-bcpio" };
    pub const @"application/x-bdoc": MimeType = MimeType{ .category = .application, .value = "application/x-bdoc" };
    pub const @"application/x-bittorrent": MimeType = MimeType{ .category = .application, .value = "application/x-bittorrent" };
    pub const @"application/x-blorb": MimeType = MimeType{ .category = .application, .value = "application/x-blorb" };
    pub const @"application/x-bzip": MimeType = MimeType{ .category = .application, .value = "application/x-bzip" };
    pub const @"application/x-bzip2": MimeType = MimeType{ .category = .application, .value = "application/x-bzip2" };
    pub const @"application/x-cbr": MimeType = MimeType{ .category = .application, .value = "application/x-cbr" };
    pub const @"application/x-cdlink": MimeType = MimeType{ .category = .application, .value = "application/x-cdlink" };
    pub const @"application/x-cfs-compressed": MimeType = MimeType{ .category = .application, .value = "application/x-cfs-compressed" };
    pub const @"application/x-chat": MimeType = MimeType{ .category = .application, .value = "application/x-chat" };
    pub const @"application/x-chess-pgn": MimeType = MimeType{ .category = .application, .value = "application/x-chess-pgn" };
    pub const @"application/x-chrome-extension": MimeType = MimeType{ .category = .application, .value = "application/x-chrome-extension" };
    pub const @"application/x-cocoa": MimeType = MimeType{ .category = .application, .value = "application/x-cocoa" };
    pub const @"application/x-compress": MimeType = MimeType{ .category = .application, .value = "application/x-compress" };
    pub const @"application/x-conference": MimeType = MimeType{ .category = .application, .value = "application/x-conference" };
    pub const @"application/x-cpio": MimeType = MimeType{ .category = .application, .value = "application/x-cpio" };
    pub const @"application/x-csh": MimeType = MimeType{ .category = .application, .value = "application/x-csh" };
    pub const @"application/x-deb": MimeType = MimeType{ .category = .application, .value = "application/x-deb" };
    pub const @"application/x-debian-package": MimeType = MimeType{ .category = .application, .value = "application/x-debian-package" };
    pub const @"application/x-dgc-compressed": MimeType = MimeType{ .category = .application, .value = "application/x-dgc-compressed" };
    pub const @"application/x-director": MimeType = MimeType{ .category = .application, .value = "application/x-director" };
    pub const @"application/x-doom": MimeType = MimeType{ .category = .application, .value = "application/x-doom" };
    pub const @"application/x-dtbncx+xml": MimeType = MimeType{ .category = .application, .value = "application/x-dtbncx+xml" };
    pub const @"application/x-dtbook+xml": MimeType = MimeType{ .category = .application, .value = "application/x-dtbook+xml" };
    pub const @"application/x-dtbresource+xml": MimeType = MimeType{ .category = .application, .value = "application/x-dtbresource+xml" };
    pub const @"application/x-dvi": MimeType = MimeType{ .category = .application, .value = "application/x-dvi" };
    pub const @"application/x-envoy": MimeType = MimeType{ .category = .application, .value = "application/x-envoy" };
    pub const @"application/x-eva": MimeType = MimeType{ .category = .application, .value = "application/x-eva" };
    pub const @"application/x-font-bdf": MimeType = MimeType{ .category = .application, .value = "application/x-font-bdf" };
    pub const @"application/x-font-dos": MimeType = MimeType{ .category = .application, .value = "application/x-font-dos" };
    pub const @"application/x-font-framemaker": MimeType = MimeType{ .category = .application, .value = "application/x-font-framemaker" };
    pub const @"application/x-font-ghostscript": MimeType = MimeType{ .category = .application, .value = "application/x-font-ghostscript" };
    pub const @"application/x-font-libgrx": MimeType = MimeType{ .category = .application, .value = "application/x-font-libgrx" };
    pub const @"application/x-font-linux-psf": MimeType = MimeType{ .category = .application, .value = "application/x-font-linux-psf" };
    pub const @"application/x-font-pcf": MimeType = MimeType{ .category = .application, .value = "application/x-font-pcf" };
    pub const @"application/x-font-snf": MimeType = MimeType{ .category = .application, .value = "application/x-font-snf" };
    pub const @"application/x-font-speedo": MimeType = MimeType{ .category = .application, .value = "application/x-font-speedo" };
    pub const @"application/x-font-sunos-news": MimeType = MimeType{ .category = .application, .value = "application/x-font-sunos-news" };
    pub const @"application/x-font-type1": MimeType = MimeType{ .category = .application, .value = "application/x-font-type1" };
    pub const @"application/x-font-vfont": MimeType = MimeType{ .category = .application, .value = "application/x-font-vfont" };
    pub const @"application/x-freearc": MimeType = MimeType{ .category = .application, .value = "application/x-freearc" };
    pub const @"application/x-futuresplash": MimeType = MimeType{ .category = .application, .value = "application/x-futuresplash" };
    pub const @"application/x-gca-compressed": MimeType = MimeType{ .category = .application, .value = "application/x-gca-compressed" };
    pub const @"application/x-glulx": MimeType = MimeType{ .category = .application, .value = "application/x-glulx" };
    pub const @"application/x-gnumeric": MimeType = MimeType{ .category = .application, .value = "application/x-gnumeric" };
    pub const @"application/x-gramps-xml": MimeType = MimeType{ .category = .application, .value = "application/x-gramps-xml" };
    pub const @"application/x-gtar": MimeType = MimeType{ .category = .application, .value = "application/x-gtar" };
    pub const @"application/x-gzip": MimeType = MimeType{ .category = .application, .value = "application/x-gzip" };
    pub const @"application/x-hdf": MimeType = MimeType{ .category = .application, .value = "application/x-hdf" };
    pub const @"application/x-httpd-php": MimeType = MimeType{ .category = .application, .value = "application/x-httpd-php" };
    pub const @"application/x-install-instructions": MimeType = MimeType{ .category = .application, .value = "application/x-install-instructions" };
    pub const @"application/x-iso9660-image": MimeType = MimeType{ .category = .application, .value = "application/x-iso9660-image" };
    pub const @"application/x-iwork-keynote-sffkey": MimeType = MimeType{ .category = .application, .value = "application/x-iwork-keynote-sffkey" };
    pub const @"application/x-iwork-numbers-sffnumbers": MimeType = MimeType{ .category = .application, .value = "application/x-iwork-numbers-sffnumbers" };
    pub const @"application/x-iwork-pages-sffpages": MimeType = MimeType{ .category = .application, .value = "application/x-iwork-pages-sffpages" };
    pub const @"application/x-java-archive-diff": MimeType = MimeType{ .category = .application, .value = "application/x-java-archive-diff" };
    pub const @"application/x-java-jnlp-file": MimeType = MimeType{ .category = .application, .value = "application/x-java-jnlp-file" };
    pub const @"application/x-javascript": MimeType = MimeType{ .category = .application, .value = "application/x-javascript" };
    pub const @"application/x-keepass2": MimeType = MimeType{ .category = .application, .value = "application/x-keepass2" };
    pub const @"application/x-latex": MimeType = MimeType{ .category = .application, .value = "application/x-latex" };
    pub const @"application/x-lua-bytecode": MimeType = MimeType{ .category = .application, .value = "application/x-lua-bytecode" };
    pub const @"application/x-lzh-compressed": MimeType = MimeType{ .category = .application, .value = "application/x-lzh-compressed" };
    pub const @"application/x-makeself": MimeType = MimeType{ .category = .application, .value = "application/x-makeself" };
    pub const @"application/x-mie": MimeType = MimeType{ .category = .application, .value = "application/x-mie" };
    pub const @"application/x-mobipocket-ebook": MimeType = MimeType{ .category = .application, .value = "application/x-mobipocket-ebook" };
    pub const @"application/x-mpegurl": MimeType = MimeType{ .category = .application, .value = "application/x-mpegurl" };
    pub const @"application/x-ms-application": MimeType = MimeType{ .category = .application, .value = "application/x-ms-application" };
    pub const @"application/x-ms-shortcut": MimeType = MimeType{ .category = .application, .value = "application/x-ms-shortcut" };
    pub const @"application/x-ms-wmd": MimeType = MimeType{ .category = .application, .value = "application/x-ms-wmd" };
    pub const @"application/x-ms-wmz": MimeType = MimeType{ .category = .application, .value = "application/x-ms-wmz" };
    pub const @"application/x-ms-xbap": MimeType = MimeType{ .category = .application, .value = "application/x-ms-xbap" };
    pub const @"application/x-msaccess": MimeType = MimeType{ .category = .application, .value = "application/x-msaccess" };
    pub const @"application/x-msbinder": MimeType = MimeType{ .category = .application, .value = "application/x-msbinder" };
    pub const @"application/x-mscardfile": MimeType = MimeType{ .category = .application, .value = "application/x-mscardfile" };
    pub const @"application/x-msclip": MimeType = MimeType{ .category = .application, .value = "application/x-msclip" };
    pub const @"application/x-msdos-program": MimeType = MimeType{ .category = .application, .value = "application/x-msdos-program" };
    pub const @"application/x-msdownload": MimeType = MimeType{ .category = .application, .value = "application/x-msdownload" };
    pub const @"application/x-msmediaview": MimeType = MimeType{ .category = .application, .value = "application/x-msmediaview" };
    pub const @"application/x-msmetafile": MimeType = MimeType{ .category = .application, .value = "application/x-msmetafile" };
    pub const @"application/x-msmoney": MimeType = MimeType{ .category = .application, .value = "application/x-msmoney" };
    pub const @"application/x-mspublisher": MimeType = MimeType{ .category = .application, .value = "application/x-mspublisher" };
    pub const @"application/x-msschedule": MimeType = MimeType{ .category = .application, .value = "application/x-msschedule" };
    pub const @"application/x-msterminal": MimeType = MimeType{ .category = .application, .value = "application/x-msterminal" };
    pub const @"application/x-mswrite": MimeType = MimeType{ .category = .application, .value = "application/x-mswrite" };
    pub const @"application/x-netcdf": MimeType = MimeType{ .category = .application, .value = "application/x-netcdf" };
    pub const @"application/x-ns-proxy-autoconfig": MimeType = MimeType{ .category = .application, .value = "application/x-ns-proxy-autoconfig" };
    pub const @"application/x-nzb": MimeType = MimeType{ .category = .application, .value = "application/x-nzb" };
    pub const @"application/x-perl": MimeType = MimeType{ .category = .application, .value = "application/x-perl" };
    pub const @"application/x-pilot": MimeType = MimeType{ .category = .application, .value = "application/x-pilot" };
    pub const @"application/x-pkcs12": MimeType = MimeType{ .category = .application, .value = "application/x-pkcs12" };
    pub const @"application/x-pkcs7-certificates": MimeType = MimeType{ .category = .application, .value = "application/x-pkcs7-certificates" };
    pub const @"application/x-pkcs7-certreqresp": MimeType = MimeType{ .category = .application, .value = "application/x-pkcs7-certreqresp" };
    pub const @"application/x-pki-message": MimeType = MimeType{ .category = .application, .value = "application/x-pki-message" };
    pub const @"application/x-rar-compressed": MimeType = MimeType{ .category = .application, .value = "application/x-rar-compressed" };
    pub const @"application/x-redhat-package-manager": MimeType = MimeType{ .category = .application, .value = "application/x-redhat-package-manager" };
    pub const @"application/x-research-info-systems": MimeType = MimeType{ .category = .application, .value = "application/x-research-info-systems" };
    pub const @"application/x-sea": MimeType = MimeType{ .category = .application, .value = "application/x-sea" };
    pub const @"application/x-sh": MimeType = MimeType{ .category = .application, .value = "application/x-sh" };
    pub const @"application/x-shar": MimeType = MimeType{ .category = .application, .value = "application/x-shar" };
    pub const @"application/x-shockwave-flash": MimeType = MimeType{ .category = .application, .value = "application/x-shockwave-flash" };
    pub const @"application/x-silverlight-app": MimeType = MimeType{ .category = .application, .value = "application/x-silverlight-app" };
    pub const @"application/x-sql": MimeType = MimeType{ .category = .application, .value = "application/x-sql" };
    pub const @"application/x-stuffit": MimeType = MimeType{ .category = .application, .value = "application/x-stuffit" };
    pub const @"application/x-stuffitx": MimeType = MimeType{ .category = .application, .value = "application/x-stuffitx" };
    pub const @"application/x-subrip": MimeType = MimeType{ .category = .application, .value = "application/x-subrip" };
    pub const @"application/x-sv4cpio": MimeType = MimeType{ .category = .application, .value = "application/x-sv4cpio" };
    pub const @"application/x-sv4crc": MimeType = MimeType{ .category = .application, .value = "application/x-sv4crc" };
    pub const @"application/x-t3vm-image": MimeType = MimeType{ .category = .application, .value = "application/x-t3vm-image" };
    pub const @"application/x-tads": MimeType = MimeType{ .category = .application, .value = "application/x-tads" };
    pub const @"application/x-tar": MimeType = MimeType{ .category = .application, .value = "application/x-tar" };
    pub const @"application/x-tcl": MimeType = MimeType{ .category = .application, .value = "application/x-tcl" };
    pub const @"application/x-tex": MimeType = MimeType{ .category = .application, .value = "application/x-tex" };
    pub const @"application/x-tex-tfm": MimeType = MimeType{ .category = .application, .value = "application/x-tex-tfm" };
    pub const @"application/x-texinfo": MimeType = MimeType{ .category = .application, .value = "application/x-texinfo" };
    pub const @"application/x-tgif": MimeType = MimeType{ .category = .application, .value = "application/x-tgif" };
    pub const @"application/x-ustar": MimeType = MimeType{ .category = .application, .value = "application/x-ustar" };
    pub const @"application/x-virtualbox-hdd": MimeType = MimeType{ .category = .application, .value = "application/x-virtualbox-hdd" };
    pub const @"application/x-virtualbox-ova": MimeType = MimeType{ .category = .application, .value = "application/x-virtualbox-ova" };
    pub const @"application/x-virtualbox-ovf": MimeType = MimeType{ .category = .application, .value = "application/x-virtualbox-ovf" };
    pub const @"application/x-virtualbox-vbox": MimeType = MimeType{ .category = .application, .value = "application/x-virtualbox-vbox" };
    pub const @"application/x-virtualbox-vbox-extpack": MimeType = MimeType{ .category = .application, .value = "application/x-virtualbox-vbox-extpack" };
    pub const @"application/x-virtualbox-vdi": MimeType = MimeType{ .category = .application, .value = "application/x-virtualbox-vdi" };
    pub const @"application/x-virtualbox-vhd": MimeType = MimeType{ .category = .application, .value = "application/x-virtualbox-vhd" };
    pub const @"application/x-virtualbox-vmdk": MimeType = MimeType{ .category = .application, .value = "application/x-virtualbox-vmdk" };
    pub const @"application/x-wais-source": MimeType = MimeType{ .category = .application, .value = "application/x-wais-source" };
    pub const @"application/x-web-app-manifest+json": MimeType = MimeType{ .category = .application, .value = "application/x-web-app-manifest+json" };
    pub const @"application/x-www-form-urlencoded": MimeType = MimeType{ .category = .application, .value = "application/x-www-form-urlencoded;charset=UTF-8" };
    pub const @"application/x-x509-ca-cert": MimeType = MimeType{ .category = .application, .value = "application/x-x509-ca-cert" };
    pub const @"application/x-x509-ca-ra-cert": MimeType = MimeType{ .category = .application, .value = "application/x-x509-ca-ra-cert" };
    pub const @"application/x-x509-next-ca-cert": MimeType = MimeType{ .category = .application, .value = "application/x-x509-next-ca-cert" };
    pub const @"application/x-xfig": MimeType = MimeType{ .category = .application, .value = "application/x-xfig" };
    pub const @"application/x-xliff+xml": MimeType = MimeType{ .category = .application, .value = "application/x-xliff+xml" };
    pub const @"application/x-xpinstall": MimeType = MimeType{ .category = .application, .value = "application/x-xpinstall" };
    pub const @"application/x-xz": MimeType = MimeType{ .category = .application, .value = "application/x-xz" };
    pub const @"application/x-zmachine": MimeType = MimeType{ .category = .application, .value = "application/x-zmachine" };
    pub const @"application/x400-bp": MimeType = MimeType{ .category = .application, .value = "application/x400-bp" };
    pub const @"application/xacml+xml": MimeType = MimeType{ .category = .application, .value = "application/xacml+xml" };
    pub const @"application/xaml+xml": MimeType = MimeType{ .category = .application, .value = "application/xaml+xml" };
    pub const @"application/xcap-att+xml": MimeType = MimeType{ .category = .application, .value = "application/xcap-att+xml" };
    pub const @"application/xcap-caps+xml": MimeType = MimeType{ .category = .application, .value = "application/xcap-caps+xml" };
    pub const @"application/xcap-diff+xml": MimeType = MimeType{ .category = .application, .value = "application/xcap-diff+xml" };
    pub const @"application/xcap-el+xml": MimeType = MimeType{ .category = .application, .value = "application/xcap-el+xml" };
    pub const @"application/xcap-error+xml": MimeType = MimeType{ .category = .application, .value = "application/xcap-error+xml" };
    pub const @"application/xcap-ns+xml": MimeType = MimeType{ .category = .application, .value = "application/xcap-ns+xml" };
    pub const @"application/xcon-conference-info+xml": MimeType = MimeType{ .category = .application, .value = "application/xcon-conference-info+xml" };
    pub const @"application/xcon-conference-info-diff+xml": MimeType = MimeType{ .category = .application, .value = "application/xcon-conference-info-diff+xml" };
    pub const @"application/xenc+xml": MimeType = MimeType{ .category = .application, .value = "application/xenc+xml" };
    pub const @"application/xhtml+xml": MimeType = MimeType{ .category = .application, .value = "application/xhtml+xml" };
    pub const @"application/xhtml-voice+xml": MimeType = MimeType{ .category = .application, .value = "application/xhtml-voice+xml" };
    pub const @"application/xliff+xml": MimeType = MimeType{ .category = .application, .value = "application/xliff+xml" };
    pub const @"application/xml": MimeType = MimeType{ .category = .application, .value = "application/xml" };
    pub const @"application/xml-dtd": MimeType = MimeType{ .category = .application, .value = "application/xml-dtd" };
    pub const @"application/xml-external-parsed-entity": MimeType = MimeType{ .category = .application, .value = "application/xml-external-parsed-entity" };
    pub const @"application/xml-patch+xml": MimeType = MimeType{ .category = .application, .value = "application/xml-patch+xml" };
    pub const @"application/xmpp+xml": MimeType = MimeType{ .category = .application, .value = "application/xmpp+xml" };
    pub const @"application/xop+xml": MimeType = MimeType{ .category = .application, .value = "application/xop+xml" };
    pub const @"application/xproc+xml": MimeType = MimeType{ .category = .application, .value = "application/xproc+xml" };
    pub const @"application/xslt+xml": MimeType = MimeType{ .category = .application, .value = "application/xslt+xml" };
    pub const @"application/xspf+xml": MimeType = MimeType{ .category = .application, .value = "application/xspf+xml" };
    pub const @"application/xv+xml": MimeType = MimeType{ .category = .application, .value = "application/xv+xml" };
    pub const @"application/yang": MimeType = MimeType{ .category = .application, .value = "application/yang" };
    pub const @"application/yang-data+json": MimeType = MimeType{ .category = .application, .value = "application/yang-data+json" };
    pub const @"application/yang-data+xml": MimeType = MimeType{ .category = .application, .value = "application/yang-data+xml" };
    pub const @"application/yang-patch+json": MimeType = MimeType{ .category = .application, .value = "application/yang-patch+json" };
    pub const @"application/yang-patch+xml": MimeType = MimeType{ .category = .application, .value = "application/yang-patch+xml" };
    pub const @"application/yin+xml": MimeType = MimeType{ .category = .application, .value = "application/yin+xml" };
    pub const @"application/zip": MimeType = MimeType{ .category = .application, .value = "application/zip" };
    pub const @"application/zlib": MimeType = MimeType{ .category = .application, .value = "application/zlib" };
    pub const @"application/zstd": MimeType = MimeType{ .category = .application, .value = "application/zstd" };
    pub const @"audio/1d-interleaved-parityfec": MimeType = MimeType{ .category = .audio, .value = "audio/1d-interleaved-parityfec" };
    pub const @"audio/32kadpcm": MimeType = MimeType{ .category = .audio, .value = "audio/32kadpcm" };
    pub const @"audio/3gpp": MimeType = MimeType{ .category = .audio, .value = "audio/3gpp" };
    pub const @"audio/3gpp2": MimeType = MimeType{ .category = .audio, .value = "audio/3gpp2" };
    pub const @"audio/aac": MimeType = MimeType{ .category = .audio, .value = "audio/aac" };
    pub const @"audio/ac3": MimeType = MimeType{ .category = .audio, .value = "audio/ac3" };
    pub const @"audio/adpcm": MimeType = MimeType{ .category = .audio, .value = "audio/adpcm" };
    pub const @"audio/amr": MimeType = MimeType{ .category = .audio, .value = "audio/amr" };
    pub const @"audio/amr-wb": MimeType = MimeType{ .category = .audio, .value = "audio/amr-wb" };
    pub const @"audio/amr-wb+": MimeType = MimeType{ .category = .audio, .value = "audio/amr-wb+" };
    pub const @"audio/aptx": MimeType = MimeType{ .category = .audio, .value = "audio/aptx" };
    pub const @"audio/asc": MimeType = MimeType{ .category = .audio, .value = "audio/asc" };
    pub const @"audio/atrac-advanced-lossless": MimeType = MimeType{ .category = .audio, .value = "audio/atrac-advanced-lossless" };
    pub const @"audio/atrac-x": MimeType = MimeType{ .category = .audio, .value = "audio/atrac-x" };
    pub const @"audio/atrac3": MimeType = MimeType{ .category = .audio, .value = "audio/atrac3" };
    pub const @"audio/basic": MimeType = MimeType{ .category = .audio, .value = "audio/basic" };
    pub const @"audio/bv16": MimeType = MimeType{ .category = .audio, .value = "audio/bv16" };
    pub const @"audio/bv32": MimeType = MimeType{ .category = .audio, .value = "audio/bv32" };
    pub const @"audio/clearmode": MimeType = MimeType{ .category = .audio, .value = "audio/clearmode" };
    pub const @"audio/cn": MimeType = MimeType{ .category = .audio, .value = "audio/cn" };
    pub const @"audio/dat12": MimeType = MimeType{ .category = .audio, .value = "audio/dat12" };
    pub const @"audio/dls": MimeType = MimeType{ .category = .audio, .value = "audio/dls" };
    pub const @"audio/dsr-es201108": MimeType = MimeType{ .category = .audio, .value = "audio/dsr-es201108" };
    pub const @"audio/dsr-es202050": MimeType = MimeType{ .category = .audio, .value = "audio/dsr-es202050" };
    pub const @"audio/dsr-es202211": MimeType = MimeType{ .category = .audio, .value = "audio/dsr-es202211" };
    pub const @"audio/dsr-es202212": MimeType = MimeType{ .category = .audio, .value = "audio/dsr-es202212" };
    pub const @"audio/dv": MimeType = MimeType{ .category = .audio, .value = "audio/dv" };
    pub const @"audio/dvi4": MimeType = MimeType{ .category = .audio, .value = "audio/dvi4" };
    pub const @"audio/eac3": MimeType = MimeType{ .category = .audio, .value = "audio/eac3" };
    pub const @"audio/encaprtp": MimeType = MimeType{ .category = .audio, .value = "audio/encaprtp" };
    pub const @"audio/evrc": MimeType = MimeType{ .category = .audio, .value = "audio/evrc" };
    pub const @"audio/evrc-qcp": MimeType = MimeType{ .category = .audio, .value = "audio/evrc-qcp" };
    pub const @"audio/evrc0": MimeType = MimeType{ .category = .audio, .value = "audio/evrc0" };
    pub const @"audio/evrc1": MimeType = MimeType{ .category = .audio, .value = "audio/evrc1" };
    pub const @"audio/evrcb": MimeType = MimeType{ .category = .audio, .value = "audio/evrcb" };
    pub const @"audio/evrcb0": MimeType = MimeType{ .category = .audio, .value = "audio/evrcb0" };
    pub const @"audio/evrcb1": MimeType = MimeType{ .category = .audio, .value = "audio/evrcb1" };
    pub const @"audio/evrcnw": MimeType = MimeType{ .category = .audio, .value = "audio/evrcnw" };
    pub const @"audio/evrcnw0": MimeType = MimeType{ .category = .audio, .value = "audio/evrcnw0" };
    pub const @"audio/evrcnw1": MimeType = MimeType{ .category = .audio, .value = "audio/evrcnw1" };
    pub const @"audio/evrcwb": MimeType = MimeType{ .category = .audio, .value = "audio/evrcwb" };
    pub const @"audio/evrcwb0": MimeType = MimeType{ .category = .audio, .value = "audio/evrcwb0" };
    pub const @"audio/evrcwb1": MimeType = MimeType{ .category = .audio, .value = "audio/evrcwb1" };
    pub const @"audio/evs": MimeType = MimeType{ .category = .audio, .value = "audio/evs" };
    pub const @"audio/flexfec": MimeType = MimeType{ .category = .audio, .value = "audio/flexfec" };
    pub const @"audio/fwdred": MimeType = MimeType{ .category = .audio, .value = "audio/fwdred" };
    pub const @"audio/g711-0": MimeType = MimeType{ .category = .audio, .value = "audio/g711-0" };
    pub const @"audio/g719": MimeType = MimeType{ .category = .audio, .value = "audio/g719" };
    pub const @"audio/g722": MimeType = MimeType{ .category = .audio, .value = "audio/g722" };
    pub const @"audio/g7221": MimeType = MimeType{ .category = .audio, .value = "audio/g7221" };
    pub const @"audio/g723": MimeType = MimeType{ .category = .audio, .value = "audio/g723" };
    pub const @"audio/g726-16": MimeType = MimeType{ .category = .audio, .value = "audio/g726-16" };
    pub const @"audio/g726-24": MimeType = MimeType{ .category = .audio, .value = "audio/g726-24" };
    pub const @"audio/g726-32": MimeType = MimeType{ .category = .audio, .value = "audio/g726-32" };
    pub const @"audio/g726-40": MimeType = MimeType{ .category = .audio, .value = "audio/g726-40" };
    pub const @"audio/g728": MimeType = MimeType{ .category = .audio, .value = "audio/g728" };
    pub const @"audio/g729": MimeType = MimeType{ .category = .audio, .value = "audio/g729" };
    pub const @"audio/g7291": MimeType = MimeType{ .category = .audio, .value = "audio/g7291" };
    pub const @"audio/g729d": MimeType = MimeType{ .category = .audio, .value = "audio/g729d" };
    pub const @"audio/g729e": MimeType = MimeType{ .category = .audio, .value = "audio/g729e" };
    pub const @"audio/gsm": MimeType = MimeType{ .category = .audio, .value = "audio/gsm" };
    pub const @"audio/gsm-efr": MimeType = MimeType{ .category = .audio, .value = "audio/gsm-efr" };
    pub const @"audio/gsm-hr-08": MimeType = MimeType{ .category = .audio, .value = "audio/gsm-hr-08" };
    pub const @"audio/ilbc": MimeType = MimeType{ .category = .audio, .value = "audio/ilbc" };
    pub const @"audio/ip-mr_v2.5": MimeType = MimeType{ .category = .audio, .value = "audio/ip-mr_v2.5" };
    pub const @"audio/isac": MimeType = MimeType{ .category = .audio, .value = "audio/isac" };
    pub const @"audio/l16": MimeType = MimeType{ .category = .audio, .value = "audio/l16" };
    pub const @"audio/l20": MimeType = MimeType{ .category = .audio, .value = "audio/l20" };
    pub const @"audio/l24": MimeType = MimeType{ .category = .audio, .value = "audio/l24" };
    pub const @"audio/l8": MimeType = MimeType{ .category = .audio, .value = "audio/l8" };
    pub const @"audio/lpc": MimeType = MimeType{ .category = .audio, .value = "audio/lpc" };
    pub const @"audio/melp": MimeType = MimeType{ .category = .audio, .value = "audio/melp" };
    pub const @"audio/melp1200": MimeType = MimeType{ .category = .audio, .value = "audio/melp1200" };
    pub const @"audio/melp2400": MimeType = MimeType{ .category = .audio, .value = "audio/melp2400" };
    pub const @"audio/melp600": MimeType = MimeType{ .category = .audio, .value = "audio/melp600" };
    pub const @"audio/mhas": MimeType = MimeType{ .category = .audio, .value = "audio/mhas" };
    pub const @"audio/midi": MimeType = MimeType{ .category = .audio, .value = "audio/midi" };
    pub const @"audio/mobile-xmf": MimeType = MimeType{ .category = .audio, .value = "audio/mobile-xmf" };
    pub const @"audio/mp3": MimeType = MimeType{ .category = .audio, .value = "audio/mp3" };
    pub const @"audio/mp4": MimeType = MimeType{ .category = .audio, .value = "audio/mp4" };
    pub const @"audio/mp4a-latm": MimeType = MimeType{ .category = .audio, .value = "audio/mp4a-latm" };
    pub const @"audio/mpa": MimeType = MimeType{ .category = .audio, .value = "audio/mpa" };
    pub const @"audio/mpa-robust": MimeType = MimeType{ .category = .audio, .value = "audio/mpa-robust" };
    pub const @"audio/mpeg": MimeType = MimeType{ .category = .audio, .value = "audio/mpeg" };
    pub const @"audio/mpeg4-generic": MimeType = MimeType{ .category = .audio, .value = "audio/mpeg4-generic" };
    pub const @"audio/musepack": MimeType = MimeType{ .category = .audio, .value = "audio/musepack" };
    pub const @"audio/ogg": MimeType = MimeType{ .category = .audio, .value = "audio/ogg" };
    pub const @"audio/opus": MimeType = MimeType{ .category = .audio, .value = "audio/opus" };
    pub const @"audio/parityfec": MimeType = MimeType{ .category = .audio, .value = "audio/parityfec" };
    pub const @"audio/pcma": MimeType = MimeType{ .category = .audio, .value = "audio/pcma" };
    pub const @"audio/pcma-wb": MimeType = MimeType{ .category = .audio, .value = "audio/pcma-wb" };
    pub const @"audio/pcmu": MimeType = MimeType{ .category = .audio, .value = "audio/pcmu" };
    pub const @"audio/pcmu-wb": MimeType = MimeType{ .category = .audio, .value = "audio/pcmu-wb" };
    pub const @"audio/prs.sid": MimeType = MimeType{ .category = .audio, .value = "audio/prs.sid" };
    pub const @"audio/qcelp": MimeType = MimeType{ .category = .audio, .value = "audio/qcelp" };
    pub const @"audio/raptorfec": MimeType = MimeType{ .category = .audio, .value = "audio/raptorfec" };
    pub const @"audio/red": MimeType = MimeType{ .category = .audio, .value = "audio/red" };
    pub const @"audio/rtp-enc-aescm128": MimeType = MimeType{ .category = .audio, .value = "audio/rtp-enc-aescm128" };
    pub const @"audio/rtp-midi": MimeType = MimeType{ .category = .audio, .value = "audio/rtp-midi" };
    pub const @"audio/rtploopback": MimeType = MimeType{ .category = .audio, .value = "audio/rtploopback" };
    pub const @"audio/rtx": MimeType = MimeType{ .category = .audio, .value = "audio/rtx" };
    pub const @"audio/s3m": MimeType = MimeType{ .category = .audio, .value = "audio/s3m" };
    pub const @"audio/scip": MimeType = MimeType{ .category = .audio, .value = "audio/scip" };
    pub const @"audio/silk": MimeType = MimeType{ .category = .audio, .value = "audio/silk" };
    pub const @"audio/smv": MimeType = MimeType{ .category = .audio, .value = "audio/smv" };
    pub const @"audio/smv-qcp": MimeType = MimeType{ .category = .audio, .value = "audio/smv-qcp" };
    pub const @"audio/smv0": MimeType = MimeType{ .category = .audio, .value = "audio/smv0" };
    pub const @"audio/sofa": MimeType = MimeType{ .category = .audio, .value = "audio/sofa" };
    pub const @"audio/sp-midi": MimeType = MimeType{ .category = .audio, .value = "audio/sp-midi" };
    pub const @"audio/speex": MimeType = MimeType{ .category = .audio, .value = "audio/speex" };
    pub const @"audio/t140c": MimeType = MimeType{ .category = .audio, .value = "audio/t140c" };
    pub const @"audio/t38": MimeType = MimeType{ .category = .audio, .value = "audio/t38" };
    pub const @"audio/telephone-event": MimeType = MimeType{ .category = .audio, .value = "audio/telephone-event" };
    pub const @"audio/tetra_acelp": MimeType = MimeType{ .category = .audio, .value = "audio/tetra_acelp" };
    pub const @"audio/tetra_acelp_bb": MimeType = MimeType{ .category = .audio, .value = "audio/tetra_acelp_bb" };
    pub const @"audio/tone": MimeType = MimeType{ .category = .audio, .value = "audio/tone" };
    pub const @"audio/tsvcis": MimeType = MimeType{ .category = .audio, .value = "audio/tsvcis" };
    pub const @"audio/uemclip": MimeType = MimeType{ .category = .audio, .value = "audio/uemclip" };
    pub const @"audio/ulpfec": MimeType = MimeType{ .category = .audio, .value = "audio/ulpfec" };
    pub const @"audio/usac": MimeType = MimeType{ .category = .audio, .value = "audio/usac" };
    pub const @"audio/vdvi": MimeType = MimeType{ .category = .audio, .value = "audio/vdvi" };
    pub const @"audio/vmr-wb": MimeType = MimeType{ .category = .audio, .value = "audio/vmr-wb" };
    pub const @"audio/vnd.3gpp.iufp": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.3gpp.iufp" };
    pub const @"audio/vnd.4sb": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.4sb" };
    pub const @"audio/vnd.audiokoz": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.audiokoz" };
    pub const @"audio/vnd.celp": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.celp" };
    pub const @"audio/vnd.cisco.nse": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.cisco.nse" };
    pub const @"audio/vnd.cmles.radio-events": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.cmles.radio-events" };
    pub const @"audio/vnd.cns.anp1": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.cns.anp1" };
    pub const @"audio/vnd.cns.inf1": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.cns.inf1" };
    pub const @"audio/vnd.dece.audio": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.dece.audio" };
    pub const @"audio/vnd.digital-winds": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.digital-winds" };
    pub const @"audio/vnd.dlna.adts": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.dlna.adts" };
    pub const @"audio/vnd.dolby.heaac.1": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.dolby.heaac.1" };
    pub const @"audio/vnd.dolby.heaac.2": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.dolby.heaac.2" };
    pub const @"audio/vnd.dolby.mlp": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.dolby.mlp" };
    pub const @"audio/vnd.dolby.mps": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.dolby.mps" };
    pub const @"audio/vnd.dolby.pl2": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.dolby.pl2" };
    pub const @"audio/vnd.dolby.pl2x": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.dolby.pl2x" };
    pub const @"audio/vnd.dolby.pl2z": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.dolby.pl2z" };
    pub const @"audio/vnd.dolby.pulse.1": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.dolby.pulse.1" };
    pub const @"audio/vnd.dra": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.dra" };
    pub const @"audio/vnd.dts": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.dts" };
    pub const @"audio/vnd.dts.hd": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.dts.hd" };
    pub const @"audio/vnd.dts.uhd": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.dts.uhd" };
    pub const @"audio/vnd.dvb.file": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.dvb.file" };
    pub const @"audio/vnd.everad.plj": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.everad.plj" };
    pub const @"audio/vnd.hns.audio": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.hns.audio" };
    pub const @"audio/vnd.lucent.voice": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.lucent.voice" };
    pub const @"audio/vnd.ms-playready.media.pya": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.ms-playready.media.pya" };
    pub const @"audio/vnd.nokia.mobile-xmf": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.nokia.mobile-xmf" };
    pub const @"audio/vnd.nortel.vbk": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.nortel.vbk" };
    pub const @"audio/vnd.nuera.ecelp4800": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.nuera.ecelp4800" };
    pub const @"audio/vnd.nuera.ecelp7470": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.nuera.ecelp7470" };
    pub const @"audio/vnd.nuera.ecelp9600": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.nuera.ecelp9600" };
    pub const @"audio/vnd.octel.sbc": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.octel.sbc" };
    pub const @"audio/vnd.presonus.multitrack": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.presonus.multitrack" };
    pub const @"audio/vnd.qcelp": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.qcelp" };
    pub const @"audio/vnd.rhetorex.32kadpcm": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.rhetorex.32kadpcm" };
    pub const @"audio/vnd.rip": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.rip" };
    pub const @"audio/vnd.rn-realaudio": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.rn-realaudio" };
    pub const @"audio/vnd.sealedmedia.softseal.mpeg": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.sealedmedia.softseal.mpeg" };
    pub const @"audio/vnd.vmx.cvsd": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.vmx.cvsd" };
    pub const @"audio/vnd.wave": MimeType = MimeType{ .category = .audio, .value = "audio/vnd.wave" };
    pub const @"audio/vorbis": MimeType = MimeType{ .category = .audio, .value = "audio/vorbis" };
    pub const @"audio/vorbis-config": MimeType = MimeType{ .category = .audio, .value = "audio/vorbis-config" };
    pub const @"audio/wav": MimeType = MimeType{ .category = .audio, .value = "audio/wav" };
    pub const @"audio/wave": MimeType = MimeType{ .category = .audio, .value = "audio/wave" };
    pub const @"audio/webm": MimeType = MimeType{ .category = .audio, .value = "audio/webm" };
    pub const @"audio/x-aac": MimeType = MimeType{ .category = .audio, .value = "audio/x-aac" };
    pub const @"audio/x-aiff": MimeType = MimeType{ .category = .audio, .value = "audio/x-aiff" };
    pub const @"audio/x-caf": MimeType = MimeType{ .category = .audio, .value = "audio/x-caf" };
    pub const @"audio/x-flac": MimeType = MimeType{ .category = .audio, .value = "audio/x-flac" };
    pub const @"audio/x-m4a": MimeType = MimeType{ .category = .audio, .value = "audio/x-m4a" };
    pub const @"audio/x-matroska": MimeType = MimeType{ .category = .audio, .value = "audio/x-matroska" };
    pub const @"audio/x-mpegurl": MimeType = MimeType{ .category = .audio, .value = "audio/x-mpegurl" };
    pub const @"audio/x-ms-wax": MimeType = MimeType{ .category = .audio, .value = "audio/x-ms-wax" };
    pub const @"audio/x-ms-wma": MimeType = MimeType{ .category = .audio, .value = "audio/x-ms-wma" };
    pub const @"audio/x-pn-realaudio": MimeType = MimeType{ .category = .audio, .value = "audio/x-pn-realaudio" };
    pub const @"audio/x-pn-realaudio-plugin": MimeType = MimeType{ .category = .audio, .value = "audio/x-pn-realaudio-plugin" };
    pub const @"audio/x-realaudio": MimeType = MimeType{ .category = .audio, .value = "audio/x-realaudio" };
    pub const @"audio/x-tta": MimeType = MimeType{ .category = .audio, .value = "audio/x-tta" };
    pub const @"audio/x-wav": MimeType = MimeType{ .category = .audio, .value = "audio/x-wav" };
    pub const @"audio/xm": MimeType = MimeType{ .category = .audio, .value = "audio/xm" };
    pub const @"chemical/x-cdx": MimeType = MimeType{ .category = .chemical, .value = "chemical/x-cdx" };
    pub const @"chemical/x-cif": MimeType = MimeType{ .category = .chemical, .value = "chemical/x-cif" };
    pub const @"chemical/x-cmdf": MimeType = MimeType{ .category = .chemical, .value = "chemical/x-cmdf" };
    pub const @"chemical/x-cml": MimeType = MimeType{ .category = .chemical, .value = "chemical/x-cml" };
    pub const @"chemical/x-csml": MimeType = MimeType{ .category = .chemical, .value = "chemical/x-csml" };
    pub const @"chemical/x-pdb": MimeType = MimeType{ .category = .chemical, .value = "chemical/x-pdb" };
    pub const @"chemical/x-xyz": MimeType = MimeType{ .category = .chemical, .value = "chemical/x-xyz" };
    pub const @"font/collection": MimeType = MimeType{ .category = .font, .value = "font/collection" };
    pub const @"font/otf": MimeType = MimeType{ .category = .font, .value = "font/otf" };
    pub const @"font/sfnt": MimeType = MimeType{ .category = .font, .value = "font/sfnt" };
    pub const @"font/ttf": MimeType = MimeType{ .category = .font, .value = "font/ttf" };
    pub const @"font/woff": MimeType = MimeType{ .category = .font, .value = "font/woff" };
    pub const @"font/woff2": MimeType = MimeType{ .category = .font, .value = "font/woff2" };
    pub const @"image/aces": MimeType = MimeType{ .category = .image, .value = "image/aces" };
    pub const @"image/apng": MimeType = MimeType{ .category = .image, .value = "image/apng" };
    pub const @"image/avci": MimeType = MimeType{ .category = .image, .value = "image/avci" };
    pub const @"image/avcs": MimeType = MimeType{ .category = .image, .value = "image/avcs" };
    pub const @"image/avif": MimeType = MimeType{ .category = .image, .value = "image/avif" };
    pub const @"image/bmp": MimeType = MimeType{ .category = .image, .value = "image/bmp" };
    pub const @"image/cgm": MimeType = MimeType{ .category = .image, .value = "image/cgm" };
    pub const @"image/dicom-rle": MimeType = MimeType{ .category = .image, .value = "image/dicom-rle" };
    pub const @"image/emf": MimeType = MimeType{ .category = .image, .value = "image/emf" };
    pub const @"image/fits": MimeType = MimeType{ .category = .image, .value = "image/fits" };
    pub const @"image/g3fax": MimeType = MimeType{ .category = .image, .value = "image/g3fax" };
    pub const @"image/gif": MimeType = MimeType{ .category = .image, .value = "image/gif" };
    pub const @"image/heic": MimeType = MimeType{ .category = .image, .value = "image/heic" };
    pub const @"image/heic-sequence": MimeType = MimeType{ .category = .image, .value = "image/heic-sequence" };
    pub const @"image/heif": MimeType = MimeType{ .category = .image, .value = "image/heif" };
    pub const @"image/heif-sequence": MimeType = MimeType{ .category = .image, .value = "image/heif-sequence" };
    pub const @"image/hej2k": MimeType = MimeType{ .category = .image, .value = "image/hej2k" };
    pub const @"image/hsj2": MimeType = MimeType{ .category = .image, .value = "image/hsj2" };
    pub const @"image/ief": MimeType = MimeType{ .category = .image, .value = "image/ief" };
    pub const @"image/jls": MimeType = MimeType{ .category = .image, .value = "image/jls" };
    pub const @"image/jp2": MimeType = MimeType{ .category = .image, .value = "image/jp2" };
    pub const @"image/jpeg": MimeType = MimeType{ .category = .image, .value = "image/jpeg" };
    pub const @"image/jph": MimeType = MimeType{ .category = .image, .value = "image/jph" };
    pub const @"image/jphc": MimeType = MimeType{ .category = .image, .value = "image/jphc" };
    pub const @"image/jpm": MimeType = MimeType{ .category = .image, .value = "image/jpm" };
    pub const @"image/jpx": MimeType = MimeType{ .category = .image, .value = "image/jpx" };
    pub const @"image/jxr": MimeType = MimeType{ .category = .image, .value = "image/jxr" };
    pub const @"image/jxra": MimeType = MimeType{ .category = .image, .value = "image/jxra" };
    pub const @"image/jxrs": MimeType = MimeType{ .category = .image, .value = "image/jxrs" };
    pub const @"image/jxs": MimeType = MimeType{ .category = .image, .value = "image/jxs" };
    pub const @"image/jxsc": MimeType = MimeType{ .category = .image, .value = "image/jxsc" };
    pub const @"image/jxsi": MimeType = MimeType{ .category = .image, .value = "image/jxsi" };
    pub const @"image/jxss": MimeType = MimeType{ .category = .image, .value = "image/jxss" };
    pub const @"image/ktx": MimeType = MimeType{ .category = .image, .value = "image/ktx" };
    pub const @"image/ktx2": MimeType = MimeType{ .category = .image, .value = "image/ktx2" };
    pub const @"image/naplps": MimeType = MimeType{ .category = .image, .value = "image/naplps" };
    pub const @"image/pjpeg": MimeType = MimeType{ .category = .image, .value = "image/pjpeg" };
    pub const @"image/png": MimeType = MimeType{ .category = .image, .value = "image/png" };
    pub const @"image/prs.btif": MimeType = MimeType{ .category = .image, .value = "image/prs.btif" };
    pub const @"image/prs.pti": MimeType = MimeType{ .category = .image, .value = "image/prs.pti" };
    pub const @"image/pwg-raster": MimeType = MimeType{ .category = .image, .value = "image/pwg-raster" };
    pub const @"image/sgi": MimeType = MimeType{ .category = .image, .value = "image/sgi" };
    pub const @"image/svg+xml": MimeType = MimeType{ .category = .image, .value = "image/svg+xml" };
    pub const @"image/t38": MimeType = MimeType{ .category = .image, .value = "image/t38" };
    pub const @"image/tiff": MimeType = MimeType{ .category = .image, .value = "image/tiff" };
    pub const @"image/tiff-fx": MimeType = MimeType{ .category = .image, .value = "image/tiff-fx" };
    pub const @"image/vnd.adobe.photoshop": MimeType = MimeType{ .category = .image, .value = "image/vnd.adobe.photoshop" };
    pub const @"image/vnd.airzip.accelerator.azv": MimeType = MimeType{ .category = .image, .value = "image/vnd.airzip.accelerator.azv" };
    pub const @"image/vnd.cns.inf2": MimeType = MimeType{ .category = .image, .value = "image/vnd.cns.inf2" };
    pub const @"image/vnd.dece.graphic": MimeType = MimeType{ .category = .image, .value = "image/vnd.dece.graphic" };
    pub const @"image/vnd.djvu": MimeType = MimeType{ .category = .image, .value = "image/vnd.djvu" };
    pub const @"image/vnd.dvb.subtitle": MimeType = MimeType{ .category = .image, .value = "image/vnd.dvb.subtitle" };
    pub const @"image/vnd.dwg": MimeType = MimeType{ .category = .image, .value = "image/vnd.dwg" };
    pub const @"image/vnd.dxf": MimeType = MimeType{ .category = .image, .value = "image/vnd.dxf" };
    pub const @"image/vnd.fastbidsheet": MimeType = MimeType{ .category = .image, .value = "image/vnd.fastbidsheet" };
    pub const @"image/vnd.fpx": MimeType = MimeType{ .category = .image, .value = "image/vnd.fpx" };
    pub const @"image/vnd.fst": MimeType = MimeType{ .category = .image, .value = "image/vnd.fst" };
    pub const @"image/vnd.fujixerox.edmics-mmr": MimeType = MimeType{ .category = .image, .value = "image/vnd.fujixerox.edmics-mmr" };
    pub const @"image/vnd.fujixerox.edmics-rlc": MimeType = MimeType{ .category = .image, .value = "image/vnd.fujixerox.edmics-rlc" };
    pub const @"image/vnd.globalgraphics.pgb": MimeType = MimeType{ .category = .image, .value = "image/vnd.globalgraphics.pgb" };
    pub const @"image/vnd.microsoft.icon" = ico;
    pub const @"image/vnd.mix": MimeType = MimeType{ .category = .image, .value = "image/vnd.mix" };
    pub const @"image/vnd.mozilla.apng": MimeType = MimeType{ .category = .image, .value = "image/vnd.mozilla.apng" };
    pub const @"image/vnd.ms-dds": MimeType = MimeType{ .category = .image, .value = "image/vnd.ms-dds" };
    pub const @"image/vnd.ms-modi": MimeType = MimeType{ .category = .image, .value = "image/vnd.ms-modi" };
    pub const @"image/vnd.ms-photo": MimeType = MimeType{ .category = .image, .value = "image/vnd.ms-photo" };
    pub const @"image/vnd.net-fpx": MimeType = MimeType{ .category = .image, .value = "image/vnd.net-fpx" };
    pub const @"image/vnd.pco.b16": MimeType = MimeType{ .category = .image, .value = "image/vnd.pco.b16" };
    pub const @"image/vnd.radiance": MimeType = MimeType{ .category = .image, .value = "image/vnd.radiance" };
    pub const @"image/vnd.sealed.png": MimeType = MimeType{ .category = .image, .value = "image/vnd.sealed.png" };
    pub const @"image/vnd.sealedmedia.softseal.gif": MimeType = MimeType{ .category = .image, .value = "image/vnd.sealedmedia.softseal.gif" };
    pub const @"image/vnd.sealedmedia.softseal.jpg": MimeType = MimeType{ .category = .image, .value = "image/vnd.sealedmedia.softseal.jpg" };
    pub const @"image/vnd.svf": MimeType = MimeType{ .category = .image, .value = "image/vnd.svf" };
    pub const @"image/vnd.tencent.tap": MimeType = MimeType{ .category = .image, .value = "image/vnd.tencent.tap" };
    pub const @"image/vnd.valve.source.texture": MimeType = MimeType{ .category = .image, .value = "image/vnd.valve.source.texture" };
    pub const @"image/vnd.wap.wbmp": MimeType = MimeType{ .category = .image, .value = "image/vnd.wap.wbmp" };
    pub const @"image/vnd.xiff": MimeType = MimeType{ .category = .image, .value = "image/vnd.xiff" };
    pub const @"image/vnd.zbrush.pcx": MimeType = MimeType{ .category = .image, .value = "image/vnd.zbrush.pcx" };
    pub const @"image/webp": MimeType = MimeType{ .category = .image, .value = "image/webp" };
    pub const @"image/wmf": MimeType = MimeType{ .category = .image, .value = "image/wmf" };
    pub const @"image/x-3ds": MimeType = MimeType{ .category = .image, .value = "image/x-3ds" };
    pub const @"image/x-cmu-raster": MimeType = MimeType{ .category = .image, .value = "image/x-cmu-raster" };
    pub const @"image/x-cmx": MimeType = MimeType{ .category = .image, .value = "image/x-cmx" };
    pub const @"image/x-freehand": MimeType = MimeType{ .category = .image, .value = "image/x-freehand" };
    pub const @"image/x-icon": MimeType = MimeType{ .category = .image, .value = "image/x-icon" };
    pub const @"image/x-jng": MimeType = MimeType{ .category = .image, .value = "image/x-jng" };
    pub const @"image/x-mrsid-image": MimeType = MimeType{ .category = .image, .value = "image/x-mrsid-image" };
    pub const @"image/x-ms-bmp": MimeType = MimeType{ .category = .image, .value = "image/x-ms-bmp" };
    pub const @"image/x-pcx": MimeType = MimeType{ .category = .image, .value = "image/x-pcx" };
    pub const @"image/x-pict": MimeType = MimeType{ .category = .image, .value = "image/x-pict" };
    pub const @"image/x-portable-anymap": MimeType = MimeType{ .category = .image, .value = "image/x-portable-anymap" };
    pub const @"image/x-portable-bitmap": MimeType = MimeType{ .category = .image, .value = "image/x-portable-bitmap" };
    pub const @"image/x-portable-graymap": MimeType = MimeType{ .category = .image, .value = "image/x-portable-graymap" };
    pub const @"image/x-portable-pixmap": MimeType = MimeType{ .category = .image, .value = "image/x-portable-pixmap" };
    pub const @"image/x-rgb": MimeType = MimeType{ .category = .image, .value = "image/x-rgb" };
    pub const @"image/x-tga": MimeType = MimeType{ .category = .image, .value = "image/x-tga" };
    pub const @"image/x-xbitmap": MimeType = MimeType{ .category = .image, .value = "image/x-xbitmap" };
    pub const @"image/x-xcf": MimeType = MimeType{ .category = .image, .value = "image/x-xcf" };
    pub const @"image/x-xpixmap": MimeType = MimeType{ .category = .image, .value = "image/x-xpixmap" };
    pub const @"image/x-xwindowdump": MimeType = MimeType{ .category = .image, .value = "image/x-xwindowdump" };
    pub const @"message/cpim": MimeType = MimeType{ .category = .message, .value = "message/cpim" };
    pub const @"message/delivery-status": MimeType = MimeType{ .category = .message, .value = "message/delivery-status" };
    pub const @"message/disposition-notification": MimeType = MimeType{ .category = .message, .value = "message/disposition-notification" };
    pub const @"message/external-body": MimeType = MimeType{ .category = .message, .value = "message/external-body" };
    pub const @"message/feedback-report": MimeType = MimeType{ .category = .message, .value = "message/feedback-report" };
    pub const @"message/global": MimeType = MimeType{ .category = .message, .value = "message/global" };
    pub const @"message/global-delivery-status": MimeType = MimeType{ .category = .message, .value = "message/global-delivery-status" };
    pub const @"message/global-disposition-notification": MimeType = MimeType{ .category = .message, .value = "message/global-disposition-notification" };
    pub const @"message/global-headers": MimeType = MimeType{ .category = .message, .value = "message/global-headers" };
    pub const @"message/http": MimeType = MimeType{ .category = .message, .value = "message/http" };
    pub const @"message/imdn+xml": MimeType = MimeType{ .category = .message, .value = "message/imdn+xml" };
    pub const @"message/news": MimeType = MimeType{ .category = .message, .value = "message/news" };
    pub const @"message/partial": MimeType = MimeType{ .category = .message, .value = "message/partial" };
    pub const @"message/rfc822": MimeType = MimeType{ .category = .message, .value = "message/rfc822" };
    pub const @"message/s-http": MimeType = MimeType{ .category = .message, .value = "message/s-http" };
    pub const @"message/sip": MimeType = MimeType{ .category = .message, .value = "message/sip" };
    pub const @"message/sipfrag": MimeType = MimeType{ .category = .message, .value = "message/sipfrag" };
    pub const @"message/tracking-status": MimeType = MimeType{ .category = .message, .value = "message/tracking-status" };
    pub const @"message/vnd.si.simp": MimeType = MimeType{ .category = .message, .value = "message/vnd.si.simp" };
    pub const @"message/vnd.wfa.wsc": MimeType = MimeType{ .category = .message, .value = "message/vnd.wfa.wsc" };
    pub const @"model/3mf": MimeType = MimeType{ .category = .model, .value = "model/3mf" };
    pub const @"model/e57": MimeType = MimeType{ .category = .model, .value = "model/e57" };
    pub const @"model/gltf+json": MimeType = MimeType{ .category = .model, .value = "model/gltf+json" };
    pub const @"model/gltf-binary": MimeType = MimeType{ .category = .model, .value = "model/gltf-binary" };
    pub const @"model/iges": MimeType = MimeType{ .category = .model, .value = "model/iges" };
    pub const @"model/mesh": MimeType = MimeType{ .category = .model, .value = "model/mesh" };
    pub const @"model/mtl": MimeType = MimeType{ .category = .model, .value = "model/mtl" };
    pub const @"model/obj": MimeType = MimeType{ .category = .model, .value = "model/obj" };
    pub const @"model/prc": MimeType = MimeType{ .category = .model, .value = "model/prc" };
    pub const @"model/step": MimeType = MimeType{ .category = .model, .value = "model/step" };
    pub const @"model/step+xml": MimeType = MimeType{ .category = .model, .value = "model/step+xml" };
    pub const @"model/step+zip": MimeType = MimeType{ .category = .model, .value = "model/step+zip" };
    pub const @"model/step-xml+zip": MimeType = MimeType{ .category = .model, .value = "model/step-xml+zip" };
    pub const @"model/stl": MimeType = MimeType{ .category = .model, .value = "model/stl" };
    pub const @"model/u3d": MimeType = MimeType{ .category = .model, .value = "model/u3d" };
    pub const @"model/vnd.collada+xml": MimeType = MimeType{ .category = .model, .value = "model/vnd.collada+xml" };
    pub const @"model/vnd.dwf": MimeType = MimeType{ .category = .model, .value = "model/vnd.dwf" };
    pub const @"model/vnd.flatland.3dml": MimeType = MimeType{ .category = .model, .value = "model/vnd.flatland.3dml" };
    pub const @"model/vnd.gdl": MimeType = MimeType{ .category = .model, .value = "model/vnd.gdl" };
    pub const @"model/vnd.gs-gdl": MimeType = MimeType{ .category = .model, .value = "model/vnd.gs-gdl" };
    pub const @"model/vnd.gs.gdl": MimeType = MimeType{ .category = .model, .value = "model/vnd.gs.gdl" };
    pub const @"model/vnd.gtw": MimeType = MimeType{ .category = .model, .value = "model/vnd.gtw" };
    pub const @"model/vnd.moml+xml": MimeType = MimeType{ .category = .model, .value = "model/vnd.moml+xml" };
    pub const @"model/vnd.mts": MimeType = MimeType{ .category = .model, .value = "model/vnd.mts" };
    pub const @"model/vnd.opengex": MimeType = MimeType{ .category = .model, .value = "model/vnd.opengex" };
    pub const @"model/vnd.parasolid.transmit.binary": MimeType = MimeType{ .category = .model, .value = "model/vnd.parasolid.transmit.binary" };
    pub const @"model/vnd.parasolid.transmit.text": MimeType = MimeType{ .category = .model, .value = "model/vnd.parasolid.transmit.text" };
    pub const @"model/vnd.pytha.pyox": MimeType = MimeType{ .category = .model, .value = "model/vnd.pytha.pyox" };
    pub const @"model/vnd.rosette.annotated-data-model": MimeType = MimeType{ .category = .model, .value = "model/vnd.rosette.annotated-data-model" };
    pub const @"model/vnd.sap.vds": MimeType = MimeType{ .category = .model, .value = "model/vnd.sap.vds" };
    pub const @"model/vnd.usdz+zip": MimeType = MimeType{ .category = .model, .value = "model/vnd.usdz+zip" };
    pub const @"model/vnd.valve.source.compiled-map": MimeType = MimeType{ .category = .model, .value = "model/vnd.valve.source.compiled-map" };
    pub const @"model/vnd.vtu": MimeType = MimeType{ .category = .model, .value = "model/vnd.vtu" };
    pub const @"model/vrml": MimeType = MimeType{ .category = .model, .value = "model/vrml" };
    pub const @"model/x3d+binary": MimeType = MimeType{ .category = .model, .value = "model/x3d+binary" };
    pub const @"model/x3d+fastinfoset": MimeType = MimeType{ .category = .model, .value = "model/x3d+fastinfoset" };
    pub const @"model/x3d+vrml": MimeType = MimeType{ .category = .model, .value = "model/x3d+vrml" };
    pub const @"model/x3d+xml": MimeType = MimeType{ .category = .model, .value = "model/x3d+xml" };
    pub const @"model/x3d-vrml": MimeType = MimeType{ .category = .model, .value = "model/x3d-vrml" };
    pub const @"multipart/alternative": MimeType = MimeType{ .category = .multipart, .value = "multipart/alternative" };
    pub const @"multipart/appledouble": MimeType = MimeType{ .category = .multipart, .value = "multipart/appledouble" };
    pub const @"multipart/byteranges": MimeType = MimeType{ .category = .multipart, .value = "multipart/byteranges" };
    pub const @"multipart/digest": MimeType = MimeType{ .category = .multipart, .value = "multipart/digest" };
    pub const @"multipart/encrypted": MimeType = MimeType{ .category = .multipart, .value = "multipart/encrypted" };
    pub const @"multipart/form-data": MimeType = MimeType{ .category = .multipart, .value = "multipart/form-data" };
    pub const @"multipart/header-set": MimeType = MimeType{ .category = .multipart, .value = "multipart/header-set" };
    pub const @"multipart/mixed": MimeType = MimeType{ .category = .multipart, .value = "multipart/mixed" };
    pub const @"multipart/multilingual": MimeType = MimeType{ .category = .multipart, .value = "multipart/multilingual" };
    pub const @"multipart/parallel": MimeType = MimeType{ .category = .multipart, .value = "multipart/parallel" };
    pub const @"multipart/related": MimeType = MimeType{ .category = .multipart, .value = "multipart/related" };
    pub const @"multipart/report": MimeType = MimeType{ .category = .multipart, .value = "multipart/report" };
    pub const @"multipart/signed": MimeType = MimeType{ .category = .multipart, .value = "multipart/signed" };
    pub const @"multipart/vnd.bint.med-plus": MimeType = MimeType{ .category = .multipart, .value = "multipart/vnd.bint.med-plus" };
    pub const @"multipart/voice-message": MimeType = MimeType{ .category = .multipart, .value = "multipart/voice-message" };
    pub const @"multipart/x-mixed-replace": MimeType = MimeType{ .category = .multipart, .value = "multipart/x-mixed-replace" };
    pub const @"text/1d-interleaved-parityfec": MimeType = MimeType{ .category = .text, .value = "text/1d-interleaved-parityfec" };
    pub const @"text/cache-manifest": MimeType = MimeType{ .category = .text, .value = "text/cache-manifest" };
    pub const @"text/calendar": MimeType = MimeType{ .category = .text, .value = "text/calendar" };
    pub const @"text/calender": MimeType = MimeType{ .category = .text, .value = "text/calender" };
    pub const @"text/cmd": MimeType = MimeType{ .category = .text, .value = "text/cmd" };
    pub const @"text/coffeescript": MimeType = MimeType{ .category = .text, .value = "text/coffeescript" };
    pub const @"text/cql": MimeType = MimeType{ .category = .text, .value = "text/cql" };
    pub const @"text/cql-expression": MimeType = MimeType{ .category = .text, .value = "text/cql-expression" };
    pub const @"text/cql-identifier": MimeType = MimeType{ .category = .text, .value = "text/cql-identifier" };
    pub const @"text/css" = css;
    pub const @"text/csv": MimeType = MimeType{ .category = .text, .value = "text/csv" };
    pub const @"text/csv-schema": MimeType = MimeType{ .category = .text, .value = "text/csv-schema" };
    pub const @"text/directory": MimeType = MimeType{ .category = .text, .value = "text/directory" };
    pub const @"text/dns": MimeType = MimeType{ .category = .text, .value = "text/dns" };
    pub const @"text/ecmascript": MimeType = MimeType{ .category = .text, .value = "text/ecmascript" };
    pub const @"text/encaprtp": MimeType = MimeType{ .category = .text, .value = "text/encaprtp" };
    pub const @"text/enriched": MimeType = MimeType{ .category = .text, .value = "text/enriched" };
    pub const @"text/fhirpath": MimeType = MimeType{ .category = .text, .value = "text/fhirpath" };
    pub const @"text/flexfec": MimeType = MimeType{ .category = .text, .value = "text/flexfec" };
    pub const @"text/fwdred": MimeType = MimeType{ .category = .text, .value = "text/fwdred" };
    pub const @"text/gff3": MimeType = MimeType{ .category = .text, .value = "text/gff3" };
    pub const @"text/grammar-ref-list": MimeType = MimeType{ .category = .text, .value = "text/grammar-ref-list" };
    pub const @"text/html": MimeType = html;
    pub const @"text/jade": MimeType = MimeType{ .category = .text, .value = "text/jade" };
    pub const @"text/javascript": MimeType = javascript;
    pub const @"text/jcr-cnd": MimeType = MimeType{ .category = .text, .value = "text/jcr-cnd" };
    pub const @"text/jsx": MimeType = javascript;
    pub const @"text/less": MimeType = MimeType{ .category = .text, .value = "text/less" };
    pub const @"text/markdown": MimeType = MimeType{ .category = .text, .value = "text/markdown" };
    pub const @"text/mathml": MimeType = MimeType{ .category = .text, .value = "text/mathml" };
    pub const @"text/mdx": MimeType = MimeType{ .category = .text, .value = "text/mdx" };
    pub const @"text/mizar": MimeType = MimeType{ .category = .text, .value = "text/mizar" };
    pub const @"text/n3": MimeType = MimeType{ .category = .text, .value = "text/n3" };
    pub const @"text/parameters": MimeType = MimeType{ .category = .text, .value = "text/parameters" };
    pub const @"text/parityfec": MimeType = MimeType{ .category = .text, .value = "text/parityfec" };
    pub const @"text/plain" = text;
    pub const @"text/provenance-notation": MimeType = MimeType{ .category = .text, .value = "text/provenance-notation" };
    pub const @"text/prs.fallenstein.rst": MimeType = MimeType{ .category = .text, .value = "text/prs.fallenstein.rst" };
    pub const @"text/prs.lines.tag": MimeType = MimeType{ .category = .text, .value = "text/prs.lines.tag" };
    pub const @"text/prs.prop.logic": MimeType = MimeType{ .category = .text, .value = "text/prs.prop.logic" };
    pub const @"text/raptorfec": MimeType = MimeType{ .category = .text, .value = "text/raptorfec" };
    pub const @"text/red": MimeType = MimeType{ .category = .text, .value = "text/red" };
    pub const @"text/rfc822-headers": MimeType = MimeType{ .category = .text, .value = "text/rfc822-headers" };
    pub const @"text/richtext": MimeType = MimeType{ .category = .text, .value = "text/richtext" };
    pub const @"text/rtf": MimeType = MimeType{ .category = .text, .value = "text/rtf" };
    pub const @"text/rtp-enc-aescm128": MimeType = MimeType{ .category = .text, .value = "text/rtp-enc-aescm128" };
    pub const @"text/rtploopback": MimeType = MimeType{ .category = .text, .value = "text/rtploopback" };
    pub const @"text/rtx": MimeType = MimeType{ .category = .text, .value = "text/rtx" };
    pub const @"text/sgml": MimeType = MimeType{ .category = .text, .value = "text/sgml" };
    pub const @"text/shaclc": MimeType = MimeType{ .category = .text, .value = "text/shaclc" };
    pub const @"text/shex": MimeType = MimeType{ .category = .text, .value = "text/shex" };
    pub const @"text/slim": MimeType = MimeType{ .category = .text, .value = "text/slim" };
    pub const @"text/spdx": MimeType = MimeType{ .category = .text, .value = "text/spdx" };
    pub const @"text/strings": MimeType = MimeType{ .category = .text, .value = "text/strings" };
    pub const @"text/stylus": MimeType = MimeType{ .category = .text, .value = "text/stylus" };
    pub const @"text/t140": MimeType = MimeType{ .category = .text, .value = "text/t140" };
    pub const @"text/tab-separated-values": MimeType = MimeType{ .category = .text, .value = "text/tab-separated-values" };
    pub const @"text/troff": MimeType = MimeType{ .category = .text, .value = "text/troff" };
    pub const @"text/turtle": MimeType = MimeType{ .category = .text, .value = "text/turtle" };
    pub const @"text/ulpfec": MimeType = MimeType{ .category = .text, .value = "text/ulpfec" };
    pub const @"text/uri-list": MimeType = MimeType{ .category = .text, .value = "text/uri-list" };
    pub const @"text/vcard": MimeType = MimeType{ .category = .text, .value = "text/vcard" };
    pub const @"text/vnd.a": MimeType = MimeType{ .category = .text, .value = "text/vnd.a" };
    pub const @"text/vnd.abc": MimeType = MimeType{ .category = .text, .value = "text/vnd.abc" };
    pub const @"text/vnd.ascii-art": MimeType = MimeType{ .category = .text, .value = "text/vnd.ascii-art" };
    pub const @"text/vnd.curl": MimeType = MimeType{ .category = .text, .value = "text/vnd.curl" };
    pub const @"text/vnd.curl.dcurl": MimeType = MimeType{ .category = .text, .value = "text/vnd.curl.dcurl" };
    pub const @"text/vnd.curl.mcurl": MimeType = MimeType{ .category = .text, .value = "text/vnd.curl.mcurl" };
    pub const @"text/vnd.curl.scurl": MimeType = MimeType{ .category = .text, .value = "text/vnd.curl.scurl" };
    pub const @"text/vnd.debian.copyright": MimeType = MimeType{ .category = .text, .value = "text/vnd.debian.copyright" };
    pub const @"text/vnd.dmclientscript": MimeType = MimeType{ .category = .text, .value = "text/vnd.dmclientscript" };
    pub const @"text/vnd.dvb.subtitle": MimeType = MimeType{ .category = .text, .value = "text/vnd.dvb.subtitle" };
    pub const @"text/vnd.esmertec.theme-descriptor": MimeType = MimeType{ .category = .text, .value = "text/vnd.esmertec.theme-descriptor" };
    pub const @"text/vnd.familysearch.gedcom": MimeType = MimeType{ .category = .text, .value = "text/vnd.familysearch.gedcom" };
    pub const @"text/vnd.ficlab.flt": MimeType = MimeType{ .category = .text, .value = "text/vnd.ficlab.flt" };
    pub const @"text/vnd.fly": MimeType = MimeType{ .category = .text, .value = "text/vnd.fly" };
    pub const @"text/vnd.fmi.flexstor": MimeType = MimeType{ .category = .text, .value = "text/vnd.fmi.flexstor" };
    pub const @"text/vnd.gml": MimeType = MimeType{ .category = .text, .value = "text/vnd.gml" };
    pub const @"text/vnd.graphviz": MimeType = MimeType{ .category = .text, .value = "text/vnd.graphviz" };
    pub const @"text/vnd.hans": MimeType = MimeType{ .category = .text, .value = "text/vnd.hans" };
    pub const @"text/vnd.hgl": MimeType = MimeType{ .category = .text, .value = "text/vnd.hgl" };
    pub const @"text/vnd.in3d.3dml": MimeType = MimeType{ .category = .text, .value = "text/vnd.in3d.3dml" };
    pub const @"text/vnd.in3d.spot": MimeType = MimeType{ .category = .text, .value = "text/vnd.in3d.spot" };
    pub const @"text/vnd.iptc.newsml": MimeType = MimeType{ .category = .text, .value = "text/vnd.iptc.newsml" };
    pub const @"text/vnd.iptc.nitf": MimeType = MimeType{ .category = .text, .value = "text/vnd.iptc.nitf" };
    pub const @"text/vnd.latex-z": MimeType = MimeType{ .category = .text, .value = "text/vnd.latex-z" };
    pub const @"text/vnd.motorola.reflex": MimeType = MimeType{ .category = .text, .value = "text/vnd.motorola.reflex" };
    pub const @"text/vnd.ms-mediapackage": MimeType = MimeType{ .category = .text, .value = "text/vnd.ms-mediapackage" };
    pub const @"text/vnd.net2phone.commcenter.command": MimeType = MimeType{ .category = .text, .value = "text/vnd.net2phone.commcenter.command" };
    pub const @"text/vnd.radisys.msml-basic-layout": MimeType = MimeType{ .category = .text, .value = "text/vnd.radisys.msml-basic-layout" };
    pub const @"text/vnd.senx.warpscript": MimeType = MimeType{ .category = .text, .value = "text/vnd.senx.warpscript" };
    pub const @"text/vnd.si.uricatalogue": MimeType = MimeType{ .category = .text, .value = "text/vnd.si.uricatalogue" };
    pub const @"text/vnd.sosi": MimeType = MimeType{ .category = .text, .value = "text/vnd.sosi" };
    pub const @"text/vnd.sun.j2me.app-descriptor": MimeType = MimeType{ .category = .text, .value = "text/vnd.sun.j2me.app-descriptor" };
    pub const @"text/vnd.trolltech.linguist": MimeType = MimeType{ .category = .text, .value = "text/vnd.trolltech.linguist" };
    pub const @"text/vnd.wap.si": MimeType = MimeType{ .category = .text, .value = "text/vnd.wap.si" };
    pub const @"text/vnd.wap.sl": MimeType = MimeType{ .category = .text, .value = "text/vnd.wap.sl" };
    pub const @"text/vnd.wap.wml": MimeType = MimeType{ .category = .text, .value = "text/vnd.wap.wml" };
    pub const @"text/vnd.wap.wmlscript": MimeType = MimeType{ .category = .text, .value = "text/vnd.wap.wmlscript" };
    pub const @"text/vtt": MimeType = MimeType{ .category = .text, .value = "text/vtt" };
    pub const @"text/x-asm": MimeType = MimeType{ .category = .text, .value = "text/x-asm" };
    pub const @"text/x-c": MimeType = MimeType{ .category = .text, .value = "text/x-c" };
    pub const @"text/x-component": MimeType = MimeType{ .category = .text, .value = "text/x-component" };
    pub const @"text/x-fortran": MimeType = MimeType{ .category = .text, .value = "text/x-fortran" };
    pub const @"text/x-gwt-rpc": MimeType = MimeType{ .category = .text, .value = "text/x-gwt-rpc" };
    pub const @"text/x-handlebars-template": MimeType = MimeType{ .category = .text, .value = "text/x-handlebars-template" };
    pub const @"text/x-java-source": MimeType = MimeType{ .category = .text, .value = "text/x-java-source" };
    pub const @"text/x-jquery-tmpl": MimeType = MimeType{ .category = .text, .value = "text/x-jquery-tmpl" };
    pub const @"text/x-lua": MimeType = MimeType{ .category = .text, .value = "text/x-lua" };
    pub const @"text/x-markdown": MimeType = MimeType{ .category = .text, .value = "text/x-markdown" };
    pub const @"text/x-nfo": MimeType = MimeType{ .category = .text, .value = "text/x-nfo" };
    pub const @"text/x-opml": MimeType = MimeType{ .category = .text, .value = "text/x-opml" };
    pub const @"text/x-org": MimeType = MimeType{ .category = .text, .value = "text/x-org" };
    pub const @"text/x-pascal": MimeType = MimeType{ .category = .text, .value = "text/x-pascal" };
    pub const @"text/x-processing": MimeType = MimeType{ .category = .text, .value = "text/x-processing" };
    pub const @"text/x-sass": MimeType = MimeType{ .category = .text, .value = "text/x-sass" };
    pub const @"text/x-scss": MimeType = MimeType{ .category = .text, .value = "text/x-scss" };
    pub const @"text/x-setext": MimeType = MimeType{ .category = .text, .value = "text/x-setext" };
    pub const @"text/x-sfv": MimeType = MimeType{ .category = .text, .value = "text/x-sfv" };
    pub const @"text/x-suse-ymp": MimeType = MimeType{ .category = .text, .value = "text/x-suse-ymp" };
    pub const @"text/x-uuencode": MimeType = MimeType{ .category = .text, .value = "text/x-uuencode" };
    pub const @"text/x-vcalendar": MimeType = MimeType{ .category = .text, .value = "text/x-vcalendar" };
    pub const @"text/x-vcard": MimeType = MimeType{ .category = .text, .value = "text/x-vcard" };
    pub const @"text/xml": MimeType = MimeType{ .category = .text, .value = "text/xml" };
    pub const @"text/xml-external-parsed-entity": MimeType = MimeType{ .category = .text, .value = "text/xml-external-parsed-entity" };
    pub const @"text/yaml": MimeType = MimeType{ .category = .text, .value = "text/yaml" };
    pub const @"video/1d-interleaved-parityfec": MimeType = MimeType{ .category = .video, .value = "video/1d-interleaved-parityfec" };
    pub const @"video/3gpp": MimeType = MimeType{ .category = .video, .value = "video/3gpp" };
    pub const @"video/3gpp-tt": MimeType = MimeType{ .category = .video, .value = "video/3gpp-tt" };
    pub const @"video/3gpp2": MimeType = MimeType{ .category = .video, .value = "video/3gpp2" };
    pub const @"video/av1": MimeType = MimeType{ .category = .video, .value = "video/av1" };
    pub const @"video/bmpeg": MimeType = MimeType{ .category = .video, .value = "video/bmpeg" };
    pub const @"video/bt656": MimeType = MimeType{ .category = .video, .value = "video/bt656" };
    pub const @"video/celb": MimeType = MimeType{ .category = .video, .value = "video/celb" };
    pub const @"video/dv": MimeType = MimeType{ .category = .video, .value = "video/dv" };
    pub const @"video/encaprtp": MimeType = MimeType{ .category = .video, .value = "video/encaprtp" };
    pub const @"video/ffv1": MimeType = MimeType{ .category = .video, .value = "video/ffv1" };
    pub const @"video/flexfec": MimeType = MimeType{ .category = .video, .value = "video/flexfec" };
    pub const @"video/h261": MimeType = MimeType{ .category = .video, .value = "video/h261" };
    pub const @"video/h263": MimeType = MimeType{ .category = .video, .value = "video/h263" };
    pub const @"video/h263-1998": MimeType = MimeType{ .category = .video, .value = "video/h263-1998" };
    pub const @"video/h263-2000": MimeType = MimeType{ .category = .video, .value = "video/h263-2000" };
    pub const @"video/h264": MimeType = MimeType{ .category = .video, .value = "video/h264" };
    pub const @"video/h264-rcdo": MimeType = MimeType{ .category = .video, .value = "video/h264-rcdo" };
    pub const @"video/h264-svc": MimeType = MimeType{ .category = .video, .value = "video/h264-svc" };
    pub const @"video/h265": MimeType = MimeType{ .category = .video, .value = "video/h265" };
    pub const @"video/iso.segment": MimeType = MimeType{ .category = .video, .value = "video/iso.segment" };
    pub const @"video/jpeg": MimeType = MimeType{ .category = .video, .value = "video/jpeg" };
    pub const @"video/jpeg2000": MimeType = MimeType{ .category = .video, .value = "video/jpeg2000" };
    pub const @"video/jpm": MimeType = MimeType{ .category = .video, .value = "video/jpm" };
    pub const @"video/jxsv": MimeType = MimeType{ .category = .video, .value = "video/jxsv" };
    pub const @"video/mj2": MimeType = MimeType{ .category = .video, .value = "video/mj2" };
    pub const @"video/mp1s": MimeType = MimeType{ .category = .video, .value = "video/mp1s" };
    pub const @"video/mp2p": MimeType = MimeType{ .category = .video, .value = "video/mp2p" };
    pub const @"video/mp2t": MimeType = MimeType{ .category = .video, .value = "video/mp2t" };
    pub const @"video/mp4": MimeType = MimeType{ .category = .video, .value = "video/mp4" };
    pub const @"video/mp4v-es": MimeType = MimeType{ .category = .video, .value = "video/mp4v-es" };
    pub const @"video/mpeg": MimeType = MimeType{ .category = .video, .value = "video/mpeg" };
    pub const @"video/mpeg4-generic": MimeType = MimeType{ .category = .video, .value = "video/mpeg4-generic" };
    pub const @"video/mpv": MimeType = MimeType{ .category = .video, .value = "video/mpv" };
    pub const @"video/nv": MimeType = MimeType{ .category = .video, .value = "video/nv" };
    pub const @"video/ogg": MimeType = MimeType{ .category = .video, .value = "video/ogg" };
    pub const @"video/parityfec": MimeType = MimeType{ .category = .video, .value = "video/parityfec" };
    pub const @"video/pointer": MimeType = MimeType{ .category = .video, .value = "video/pointer" };
    pub const @"video/quicktime": MimeType = MimeType{ .category = .video, .value = "video/quicktime" };
    pub const @"video/raptorfec": MimeType = MimeType{ .category = .video, .value = "video/raptorfec" };
    pub const @"video/raw": MimeType = MimeType{ .category = .video, .value = "video/raw" };
    pub const @"video/rtp-enc-aescm128": MimeType = MimeType{ .category = .video, .value = "video/rtp-enc-aescm128" };
    pub const @"video/rtploopback": MimeType = MimeType{ .category = .video, .value = "video/rtploopback" };
    pub const @"video/rtx": MimeType = MimeType{ .category = .video, .value = "video/rtx" };
    pub const @"video/scip": MimeType = MimeType{ .category = .video, .value = "video/scip" };
    pub const @"video/smpte291": MimeType = MimeType{ .category = .video, .value = "video/smpte291" };
    pub const @"video/smpte292m": MimeType = MimeType{ .category = .video, .value = "video/smpte292m" };
    pub const @"video/ulpfec": MimeType = MimeType{ .category = .video, .value = "video/ulpfec" };
    pub const @"video/vc1": MimeType = MimeType{ .category = .video, .value = "video/vc1" };
    pub const @"video/vc2": MimeType = MimeType{ .category = .video, .value = "video/vc2" };
    pub const @"video/vnd.cctv": MimeType = MimeType{ .category = .video, .value = "video/vnd.cctv" };
    pub const @"video/vnd.dece.hd": MimeType = MimeType{ .category = .video, .value = "video/vnd.dece.hd" };
    pub const @"video/vnd.dece.mobile": MimeType = MimeType{ .category = .video, .value = "video/vnd.dece.mobile" };
    pub const @"video/vnd.dece.mp4": MimeType = MimeType{ .category = .video, .value = "video/vnd.dece.mp4" };
    pub const @"video/vnd.dece.pd": MimeType = MimeType{ .category = .video, .value = "video/vnd.dece.pd" };
    pub const @"video/vnd.dece.sd": MimeType = MimeType{ .category = .video, .value = "video/vnd.dece.sd" };
    pub const @"video/vnd.dece.video": MimeType = MimeType{ .category = .video, .value = "video/vnd.dece.video" };
    pub const @"video/vnd.directv.mpeg": MimeType = MimeType{ .category = .video, .value = "video/vnd.directv.mpeg" };
    pub const @"video/vnd.directv.mpeg-tts": MimeType = MimeType{ .category = .video, .value = "video/vnd.directv.mpeg-tts" };
    pub const @"video/vnd.dlna.mpeg-tts": MimeType = MimeType{ .category = .video, .value = "video/vnd.dlna.mpeg-tts" };
    pub const @"video/vnd.dvb.file": MimeType = MimeType{ .category = .video, .value = "video/vnd.dvb.file" };
    pub const @"video/vnd.fvt": MimeType = MimeType{ .category = .video, .value = "video/vnd.fvt" };
    pub const @"video/vnd.hns.video": MimeType = MimeType{ .category = .video, .value = "video/vnd.hns.video" };
    pub const @"video/vnd.iptvforum.1dparityfec-1010": MimeType = MimeType{ .category = .video, .value = "video/vnd.iptvforum.1dparityfec-1010" };
    pub const @"video/vnd.iptvforum.1dparityfec-2005": MimeType = MimeType{ .category = .video, .value = "video/vnd.iptvforum.1dparityfec-2005" };
    pub const @"video/vnd.iptvforum.2dparityfec-1010": MimeType = MimeType{ .category = .video, .value = "video/vnd.iptvforum.2dparityfec-1010" };
    pub const @"video/vnd.iptvforum.2dparityfec-2005": MimeType = MimeType{ .category = .video, .value = "video/vnd.iptvforum.2dparityfec-2005" };
    pub const @"video/vnd.iptvforum.ttsavc": MimeType = MimeType{ .category = .video, .value = "video/vnd.iptvforum.ttsavc" };
    pub const @"video/vnd.iptvforum.ttsmpeg2": MimeType = MimeType{ .category = .video, .value = "video/vnd.iptvforum.ttsmpeg2" };
    pub const @"video/vnd.motorola.video": MimeType = MimeType{ .category = .video, .value = "video/vnd.motorola.video" };
    pub const @"video/vnd.motorola.videop": MimeType = MimeType{ .category = .video, .value = "video/vnd.motorola.videop" };
    pub const @"video/vnd.mpegurl": MimeType = MimeType{ .category = .video, .value = "video/vnd.mpegurl" };
    pub const @"video/vnd.ms-playready.media.pyv": MimeType = MimeType{ .category = .video, .value = "video/vnd.ms-playready.media.pyv" };
    pub const @"video/vnd.nokia.interleaved-multimedia": MimeType = MimeType{ .category = .video, .value = "video/vnd.nokia.interleaved-multimedia" };
    pub const @"video/vnd.nokia.mp4vr": MimeType = MimeType{ .category = .video, .value = "video/vnd.nokia.mp4vr" };
    pub const @"video/vnd.nokia.videovoip": MimeType = MimeType{ .category = .video, .value = "video/vnd.nokia.videovoip" };
    pub const @"video/vnd.objectvideo": MimeType = MimeType{ .category = .video, .value = "video/vnd.objectvideo" };
    pub const @"video/vnd.radgamettools.bink": MimeType = MimeType{ .category = .video, .value = "video/vnd.radgamettools.bink" };
    pub const @"video/vnd.radgamettools.smacker": MimeType = MimeType{ .category = .video, .value = "video/vnd.radgamettools.smacker" };
    pub const @"video/vnd.sealed.mpeg1": MimeType = MimeType{ .category = .video, .value = "video/vnd.sealed.mpeg1" };
    pub const @"video/vnd.sealed.mpeg4": MimeType = MimeType{ .category = .video, .value = "video/vnd.sealed.mpeg4" };
    pub const @"video/vnd.sealed.swf": MimeType = MimeType{ .category = .video, .value = "video/vnd.sealed.swf" };
    pub const @"video/vnd.sealedmedia.softseal.mov": MimeType = MimeType{ .category = .video, .value = "video/vnd.sealedmedia.softseal.mov" };
    pub const @"video/vnd.uvvu.mp4": MimeType = MimeType{ .category = .video, .value = "video/vnd.uvvu.mp4" };
    pub const @"video/vnd.vivo": MimeType = MimeType{ .category = .video, .value = "video/vnd.vivo" };
    pub const @"video/vnd.youtube.yt": MimeType = MimeType{ .category = .video, .value = "video/vnd.youtube.yt" };
    pub const @"video/vp8": MimeType = MimeType{ .category = .video, .value = "video/vp8" };
    pub const @"video/vp9": MimeType = MimeType{ .category = .video, .value = "video/vp9" };
    pub const @"video/webm": MimeType = MimeType{ .category = .video, .value = "video/webm" };
    pub const @"video/x-f4v": MimeType = MimeType{ .category = .video, .value = "video/x-f4v" };
    pub const @"video/x-fli": MimeType = MimeType{ .category = .video, .value = "video/x-fli" };
    pub const @"video/x-flv": MimeType = MimeType{ .category = .video, .value = "video/x-flv" };
    pub const @"video/x-m4v": MimeType = MimeType{ .category = .video, .value = "video/x-m4v" };
    pub const @"video/x-matroska": MimeType = MimeType{ .category = .video, .value = "video/x-matroska" };
    pub const @"video/x-mng": MimeType = MimeType{ .category = .video, .value = "video/x-mng" };
    pub const @"video/x-ms-asf": MimeType = MimeType{ .category = .video, .value = "video/x-ms-asf" };
    pub const @"video/x-ms-vob": MimeType = MimeType{ .category = .video, .value = "video/x-ms-vob" };
    pub const @"video/x-ms-wm": MimeType = MimeType{ .category = .video, .value = "video/x-ms-wm" };
    pub const @"video/x-ms-wmv": MimeType = MimeType{ .category = .video, .value = "video/x-ms-wmv" };
    pub const @"video/x-ms-wmx": MimeType = MimeType{ .category = .video, .value = "video/x-ms-wmx" };
    pub const @"video/x-ms-wvx": MimeType = MimeType{ .category = .video, .value = "video/x-ms-wvx" };
    pub const @"video/x-msvideo": MimeType = MimeType{ .category = .video, .value = "video/x-msvideo" };
    pub const @"video/x-sgi-movie": MimeType = MimeType{ .category = .video, .value = "video/x-sgi-movie" };
    pub const @"video/x-smv": MimeType = MimeType{ .category = .video, .value = "video/x-smv" };
    pub const @"x-conference/x-cooltalk": MimeType = MimeType{ .category = .@"x-conference", .value = "x-conference/x-cooltalk" };
    pub const @"x-shader/x-fragment": MimeType = MimeType{ .category = .@"x-shader", .value = "x-shader/x-fragment" };
    pub const @"x-shader/x-vertex": MimeType = MimeType{ .category = .@"x-shader", .value = "x-shader/x-vertex" };
};

// TODO: do a comptime static hash map for this
// its too many branches to use ComptimeStringMap
pub fn byName(name: []const u8) MimeType {
    return MimeType.init(name, null, null);
}
pub fn deinit(mimeType: MimeType, allocator: std.mem.Allocator) void {
    allocator.free(mimeType.value);
}
pub const extensions = ComptimeStringMap(MimeType, .{
    .{ "123", all.@"application/vnd.lotus-1-2-3" },
    .{ "1km", all.@"application/vnd.1000minds.decision-model+xml" },
    .{ "3dml", all.@"text/vnd.in3d.3dml" },
    .{ "3ds", all.@"image/x-3ds" },
    .{ "3g2", all.@"video/3gpp2" },
    .{ "3gp", all.@"video/3gpp" },
    .{ "3gpp", all.@"video/3gpp" },
    .{ "3mf", all.@"model/3mf" },
    .{ "7z", all.@"application/x-7z-compressed" },
    .{ "aab", all.@"application/x-authorware-bin" },
    .{ "aac", all.@"audio/x-aac" },
    .{ "aam", all.@"application/x-authorware-map" },
    .{ "aas", all.@"application/x-authorware-seg" },
    .{ "abw", all.@"application/x-abiword" },
    .{ "ac", all.@"application/vnd.nokia.n-gage.ac+xml" },
    .{ "acc", all.@"application/vnd.americandynamics.acc" },
    .{ "ace", all.@"application/x-ace-compressed" },
    .{ "acu", all.@"application/vnd.acucobol" },
    .{ "acutc", all.@"application/vnd.acucorp" },
    .{ "adp", all.@"audio/adpcm" },
    .{ "aep", all.@"application/vnd.audiograph" },
    .{ "afm", all.@"application/x-font-type1" },
    .{ "afp", all.@"application/vnd.ibm.modcap" },
    .{ "age", all.@"application/vnd.age" },
    .{ "ahead", all.@"application/vnd.ahead.space" },
    .{ "ai", all.@"application/postscript" },
    .{ "aif", all.@"audio/x-aiff" },
    .{ "aifc", all.@"audio/x-aiff" },
    .{ "aiff", all.@"audio/x-aiff" },
    .{ "air", all.@"application/vnd.adobe.air-application-installer-package+zip" },
    .{ "ait", all.@"application/vnd.dvb.ait" },
    .{ "ami", all.@"application/vnd.amiga.ami" },
    .{ "amr", all.@"audio/amr" },
    .{ "apk", all.@"application/vnd.android.package-archive" },
    .{ "apng", all.@"image/apng" },
    .{ "appcache", all.@"text/cache-manifest" },
    .{ "application", all.@"application/x-ms-application" },
    .{ "apr", all.@"application/vnd.lotus-approach" },
    .{ "arc", all.@"application/x-freearc" },
    .{ "arj", all.@"application/x-arj" },
    .{ "asc", all.@"application/pgp-signature" },
    .{ "asf", all.@"video/x-ms-asf" },
    .{ "asm", all.@"text/x-asm" },
    .{ "aso", all.@"application/vnd.accpac.simply.aso" },
    .{ "asx", all.@"video/x-ms-asf" },
    .{ "atc", all.@"application/vnd.acucorp" },
    .{ "atom", all.@"application/atom+xml" },
    .{ "atomcat", all.@"application/atomcat+xml" },
    .{ "atomdeleted", all.@"application/atomdeleted+xml" },
    .{ "atomsvc", all.@"application/atomsvc+xml" },
    .{ "atx", all.@"application/vnd.antix.game-component" },
    .{ "au", all.@"audio/basic" },
    .{ "avci", all.@"image/avci" },
    .{ "avcs", all.@"image/avcs" },
    .{ "avi", all.@"video/x-msvideo" },
    .{ "avif", all.@"image/avif" },
    .{ "aw", all.@"application/applixware" },
    .{ "azf", all.@"application/vnd.airzip.filesecure.azf" },
    .{ "azs", all.@"application/vnd.airzip.filesecure.azs" },
    .{ "azv", all.@"image/vnd.airzip.accelerator.azv" },
    .{ "azw", all.@"application/vnd.amazon.ebook" },
    .{ "b16", all.@"image/vnd.pco.b16" },
    .{ "bat", all.@"application/x-msdownload" },
    .{ "bcpio", all.@"application/x-bcpio" },
    .{ "bdf", all.@"application/x-font-bdf" },
    .{ "bdm", all.@"application/vnd.syncml.dm+wbxml" },
    .{ "bdoc", all.@"application/x-bdoc" },
    .{ "bed", all.@"application/vnd.realvnc.bed" },
    .{ "bh2", all.@"application/vnd.fujitsu.oasysprs" },
    .{ "bin", all.@"application/octet-stream" },
    .{ "blb", all.@"application/x-blorb" },
    .{ "blorb", all.@"application/x-blorb" },
    .{ "bmi", all.@"application/vnd.bmi" },
    .{ "bmml", all.@"application/vnd.balsamiq.bmml+xml" },
    .{ "bmp", all.@"image/x-ms-bmp" },
    .{ "book", all.@"application/vnd.framemaker" },
    .{ "box", all.@"application/vnd.previewsystems.box" },
    .{ "boz", all.@"application/x-bzip2" },
    .{ "bpk", all.@"application/octet-stream" },
    .{ "bsp", all.@"model/vnd.valve.source.compiled-map" },
    .{ "btif", all.@"image/prs.btif" },
    .{ "buffer", all.@"application/octet-stream" },
    .{ "bz", all.@"application/x-bzip" },
    .{ "bz2", all.@"application/x-bzip2" },
    .{ "c", all.@"text/x-c" },
    .{ "c11amc", all.@"application/vnd.cluetrust.cartomobile-config" },
    .{ "c11amz", all.@"application/vnd.cluetrust.cartomobile-config-pkg" },
    .{ "c4d", all.@"application/vnd.clonk.c4group" },
    .{ "c4f", all.@"application/vnd.clonk.c4group" },
    .{ "c4g", all.@"application/vnd.clonk.c4group" },
    .{ "c4p", all.@"application/vnd.clonk.c4group" },
    .{ "c4u", all.@"application/vnd.clonk.c4group" },
    .{ "cab", all.@"application/vnd.ms-cab-compressed" },
    .{ "caf", all.@"audio/x-caf" },
    .{ "cap", all.@"application/vnd.tcpdump.pcap" },
    .{ "car", all.@"application/vnd.curl.car" },
    .{ "cat", all.@"application/vnd.ms-pki.seccat" },
    .{ "cb7", all.@"application/x-cbr" },
    .{ "cba", all.@"application/x-cbr" },
    .{ "cbr", all.@"application/x-cbr" },
    .{ "cbt", all.@"application/x-cbr" },
    .{ "cbz", all.@"application/x-cbr" },
    .{ "cc", all.@"text/x-c" },
    .{ "cco", all.@"application/x-cocoa" },
    .{ "cct", all.@"application/x-director" },
    .{ "ccxml", all.@"application/ccxml+xml" },
    .{ "cdbcmsg", all.@"application/vnd.contact.cmsg" },
    .{ "cdf", all.@"application/x-netcdf" },
    .{ "cdfx", all.@"application/cdfx+xml" },
    .{ "cdkey", all.@"application/vnd.mediastation.cdkey" },
    .{ "cdmia", all.@"application/cdmi-capability" },
    .{ "cdmic", all.@"application/cdmi-container" },
    .{ "cdmid", all.@"application/cdmi-domain" },
    .{ "cdmio", all.@"application/cdmi-object" },
    .{ "cdmiq", all.@"application/cdmi-queue" },
    .{ "cdx", all.@"chemical/x-cdx" },
    .{ "cdxml", all.@"application/vnd.chemdraw+xml" },
    .{ "cdy", all.@"application/vnd.cinderella" },
    .{ "cer", all.@"application/pkix-cert" },
    .{ "cfs", all.@"application/x-cfs-compressed" },
    .{ "cgm", all.@"image/cgm" },
    .{ "chat", all.@"application/x-chat" },
    .{ "chm", all.@"application/vnd.ms-htmlhelp" },
    .{ "chrt", all.@"application/vnd.kde.kchart" },
    .{ "cif", all.@"chemical/x-cif" },
    .{ "cii", all.@"application/vnd.anser-web-certificate-issue-initiation" },
    .{ "cil", all.@"application/vnd.ms-artgalry" },
    .{ "cjs", all.@"application/javascript" },
    .{ "cla", all.@"application/vnd.claymore" },
    .{ "class", all.@"application/java-vm" },
    .{ "clkk", all.@"application/vnd.crick.clicker.keyboard" },
    .{ "clkp", all.@"application/vnd.crick.clicker.palette" },
    .{ "clkt", all.@"application/vnd.crick.clicker.template" },
    .{ "clkw", all.@"application/vnd.crick.clicker.wordbank" },
    .{ "clkx", all.@"application/vnd.crick.clicker" },
    .{ "clp", all.@"application/x-msclip" },
    .{ "cmc", all.@"application/vnd.cosmocaller" },
    .{ "cmdf", all.@"chemical/x-cmdf" },
    .{ "cml", all.@"chemical/x-cml" },
    .{ "cmp", all.@"application/vnd.yellowriver-custom-menu" },
    .{ "cmx", all.@"image/x-cmx" },
    .{ "cod", all.@"application/vnd.rim.cod" },
    .{ "coffee", all.@"text/coffeescript" },
    .{ "com", all.@"application/x-msdownload" },
    .{ "conf", all.@"text/plain" },
    .{ "cpio", all.@"application/x-cpio" },
    .{ "cpl", all.@"application/cpl+xml" },
    .{ "cpp", all.@"text/x-c" },
    .{ "cpt", all.@"application/mac-compactpro" },
    .{ "crd", all.@"application/x-mscardfile" },
    .{ "crl", all.@"application/pkix-crl" },
    .{ "crt", all.@"application/x-x509-ca-cert" },
    .{ "crx", all.@"application/x-chrome-extension" },
    .{ "cryptonote", all.@"application/vnd.rig.cryptonote" },
    .{ "csh", all.@"application/x-csh" },
    .{ "csl", all.@"application/vnd.citationstyles.style+xml" },
    .{ "csml", all.@"chemical/x-csml" },
    .{ "csp", all.@"application/vnd.commonspace" },
    .{ "css", all.@"text/css" },
    .{ "cst", all.@"application/x-director" },
    .{ "csv", all.@"text/csv" },
    .{ "cts", all.@"application/javascript" },
    .{ "cu", all.@"application/cu-seeme" },
    .{ "curl", all.@"text/vnd.curl" },
    .{ "cww", all.@"application/prs.cww" },
    .{ "cxt", all.@"application/x-director" },
    .{ "cxx", all.@"text/x-c" },
    .{ "dae", all.@"model/vnd.collada+xml" },
    .{ "daf", all.@"application/vnd.mobius.daf" },
    .{ "dart", all.@"application/vnd.dart" },
    .{ "dataless", all.@"application/vnd.fdsn.seed" },
    .{ "davmount", all.@"application/davmount+xml" },
    .{ "dbf", all.@"application/vnd.dbf" },
    .{ "dbk", all.@"application/docbook+xml" },
    .{ "dcr", all.@"application/x-director" },
    .{ "dcurl", all.@"text/vnd.curl.dcurl" },
    .{ "dd2", all.@"application/vnd.oma.dd2+xml" },
    .{ "ddd", all.@"application/vnd.fujixerox.ddd" },
    .{ "ddf", all.@"application/vnd.syncml.dmddf+xml" },
    .{ "dds", all.@"image/vnd.ms-dds" },
    .{ "deb", all.@"application/x-debian-package" },
    .{ "def", all.@"text/plain" },
    .{ "deploy", all.@"application/octet-stream" },
    .{ "der", all.@"application/x-x509-ca-cert" },
    .{ "dfac", all.@"application/vnd.dreamfactory" },
    .{ "dgc", all.@"application/x-dgc-compressed" },
    .{ "dic", all.@"text/x-c" },
    .{ "dir", all.@"application/x-director" },
    .{ "dis", all.@"application/vnd.mobius.dis" },
    .{ "disposition-n", all.@"message/disposition-notification" },
    .{ "dist", all.@"application/octet-stream" },
    .{ "distz", all.@"application/octet-stream" },
    .{ "djv", all.@"image/vnd.djvu" },
    .{ "djvu", all.@"image/vnd.djvu" },
    .{ "dll", all.@"application/x-msdownload" },
    .{ "dmg", all.@"application/x-apple-diskimage" },
    .{ "dmp", all.@"application/vnd.tcpdump.pcap" },
    .{ "dms", all.@"application/octet-stream" },
    .{ "dna", all.@"application/vnd.dna" },
    .{ "doc", all.@"application/msword" },
    .{ "docm", all.@"application/vnd.ms-word.document.macroenabled.12" },
    .{ "docx", all.@"application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    .{ "dot", all.@"application/msword" },
    .{ "dotm", all.@"application/vnd.ms-word.template.macroenabled.12" },
    .{ "dotx", all.@"application/vnd.openxmlformats-officedocument.wordprocessingml.template" },
    .{ "dp", all.@"application/vnd.osgi.dp" },
    .{ "dpg", all.@"application/vnd.dpgraph" },
    .{ "dra", all.@"audio/vnd.dra" },
    .{ "drle", all.@"image/dicom-rle" },
    .{ "dsc", all.@"text/prs.lines.tag" },
    .{ "dssc", all.@"application/dssc+der" },
    .{ "dtb", all.@"application/x-dtbook+xml" },
    .{ "dtd", all.@"application/xml-dtd" },
    .{ "dts", all.@"audio/vnd.dts" },
    .{ "dtshd", all.@"audio/vnd.dts.hd" },
    .{ "dump", all.@"application/octet-stream" },
    .{ "dvb", all.@"video/vnd.dvb.file" },
    .{ "dvi", all.@"application/x-dvi" },
    .{ "dwd", all.@"application/atsc-dwd+xml" },
    .{ "dwf", all.@"model/vnd.dwf" },
    .{ "dwg", all.@"image/vnd.dwg" },
    .{ "dxf", all.@"image/vnd.dxf" },
    .{ "dxp", all.@"application/vnd.spotfire.dxp" },
    .{ "dxr", all.@"application/x-director" },
    .{ "ear", all.@"application/java-archive" },
    .{ "ecelp4800", all.@"audio/vnd.nuera.ecelp4800" },
    .{ "ecelp7470", all.@"audio/vnd.nuera.ecelp7470" },
    .{ "ecelp9600", all.@"audio/vnd.nuera.ecelp9600" },
    .{ "ecma", all.@"application/ecmascript" },
    .{ "edm", all.@"application/vnd.novadigm.edm" },
    .{ "edx", all.@"application/vnd.novadigm.edx" },
    .{ "efif", all.@"application/vnd.picsel" },
    .{ "ei6", all.@"application/vnd.pg.osasli" },
    .{ "elc", all.@"application/octet-stream" },
    .{ "emf", all.@"image/emf" },
    .{ "eml", all.@"message/rfc822" },
    .{ "emma", all.@"application/emma+xml" },
    .{ "emotionml", all.@"application/emotionml+xml" },
    .{ "emz", all.@"application/x-msmetafile" },
    .{ "eol", all.@"audio/vnd.digital-winds" },
    .{ "eot", all.@"application/vnd.ms-fontobject" },
    .{ "eps", all.@"application/postscript" },
    .{ "epub", all.@"application/epub+zip" },
    .{ "es", all.@"application/ecmascript" },
    .{ "es3", all.@"application/vnd.eszigno3+xml" },
    .{ "esa", all.@"application/vnd.osgi.subsystem" },
    .{ "esf", all.@"application/vnd.epson.esf" },
    .{ "et3", all.@"application/vnd.eszigno3+xml" },
    .{ "etx", all.@"text/x-setext" },
    .{ "eva", all.@"application/x-eva" },
    .{ "evy", all.@"application/x-envoy" },
    .{ "exe", all.@"application/x-msdownload" },
    .{ "exi", all.@"application/exi" },
    .{ "exp", all.@"application/express" },
    .{ "exr", all.@"image/aces" },
    .{ "ext", all.@"application/vnd.novadigm.ext" },
    .{ "ez", all.@"application/andrew-inset" },
    .{ "ez2", all.@"application/vnd.ezpix-album" },
    .{ "ez3", all.@"application/vnd.ezpix-package" },
    .{ "f", all.@"text/x-fortran" },
    .{ "f4v", all.@"video/x-f4v" },
    .{ "f77", all.@"text/x-fortran" },
    .{ "f90", all.@"text/x-fortran" },
    .{ "fbs", all.@"image/vnd.fastbidsheet" },
    .{ "fcdt", all.@"application/vnd.adobe.formscentral.fcdt" },
    .{ "fcs", all.@"application/vnd.isac.fcs" },
    .{ "fdf", all.@"application/vnd.fdf" },
    .{ "fdt", all.@"application/fdt+xml" },
    .{ "fe_launch", all.@"application/vnd.denovo.fcselayout-link" },
    .{ "fg5", all.@"application/vnd.fujitsu.oasysgp" },
    .{ "fgd", all.@"application/x-director" },
    .{ "fh", all.@"image/x-freehand" },
    .{ "fh4", all.@"image/x-freehand" },
    .{ "fh5", all.@"image/x-freehand" },
    .{ "fh7", all.@"image/x-freehand" },
    .{ "fhc", all.@"image/x-freehand" },
    .{ "fig", all.@"application/x-xfig" },
    .{ "fits", all.@"image/fits" },
    .{ "flac", all.@"audio/x-flac" },
    .{ "fli", all.@"video/x-fli" },
    .{ "flo", all.@"application/vnd.micrografx.flo" },
    .{ "flv", all.@"video/x-flv" },
    .{ "flw", all.@"application/vnd.kde.kivio" },
    .{ "flx", all.@"text/vnd.fmi.flexstor" },
    .{ "fly", all.@"text/vnd.fly" },
    .{ "fm", all.@"application/vnd.framemaker" },
    .{ "fnc", all.@"application/vnd.frogans.fnc" },
    .{ "fo", all.@"application/vnd.software602.filler.form+xml" },
    .{ "for", all.@"text/x-fortran" },
    .{ "fpx", all.@"image/vnd.fpx" },
    .{ "frame", all.@"application/vnd.framemaker" },
    .{ "fsc", all.@"application/vnd.fsc.weblaunch" },
    .{ "fst", all.@"image/vnd.fst" },
    .{ "ftc", all.@"application/vnd.fluxtime.clip" },
    .{ "fti", all.@"application/vnd.anser-web-funds-transfer-initiation" },
    .{ "fvt", all.@"video/vnd.fvt" },
    .{ "fxp", all.@"application/vnd.adobe.fxp" },
    .{ "fxpl", all.@"application/vnd.adobe.fxp" },
    .{ "fzs", all.@"application/vnd.fuzzysheet" },
    .{ "g2w", all.@"application/vnd.geoplan" },
    .{ "g3", all.@"image/g3fax" },
    .{ "g3w", all.@"application/vnd.geospace" },
    .{ "gac", all.@"application/vnd.groove-account" },
    .{ "gam", all.@"application/x-tads" },
    .{ "gbr", all.@"application/rpki-ghostbusters" },
    .{ "gca", all.@"application/x-gca-compressed" },
    .{ "gdl", all.@"model/vnd.gdl" },
    .{ "gdoc", all.@"application/vnd.google-apps.document" },
    .{ "ged", all.@"text/vnd.familysearch.gedcom" },
    .{ "geo", all.@"application/vnd.dynageo" },
    .{ "geojson", all.@"application/geo+json" },
    .{ "gex", all.@"application/vnd.geometry-explorer" },
    .{ "ggb", all.@"application/vnd.geogebra.file" },
    .{ "ggt", all.@"application/vnd.geogebra.tool" },
    .{ "ghf", all.@"application/vnd.groove-help" },
    .{ "gif", all.@"image/gif" },
    .{ "gim", all.@"application/vnd.groove-identity-message" },
    .{ "glb", all.@"model/gltf-binary" },
    .{ "gltf", all.@"model/gltf+json" },
    .{ "gml", all.@"application/gml+xml" },
    .{ "gmx", all.@"application/vnd.gmx" },
    .{ "gnumeric", all.@"application/x-gnumeric" },
    .{ "gph", all.@"application/vnd.flographit" },
    .{ "gpx", all.@"application/gpx+xml" },
    .{ "gqf", all.@"application/vnd.grafeq" },
    .{ "gqs", all.@"application/vnd.grafeq" },
    .{ "gram", all.@"application/srgs" },
    .{ "gramps", all.@"application/x-gramps-xml" },
    .{ "gre", all.@"application/vnd.geometry-explorer" },
    .{ "grv", all.@"application/vnd.groove-injector" },
    .{ "grxml", all.@"application/srgs+xml" },
    .{ "gsf", all.@"application/x-font-ghostscript" },
    .{ "gsheet", all.@"application/vnd.google-apps.spreadsheet" },
    .{ "gslides", all.@"application/vnd.google-apps.presentation" },
    .{ "gtar", all.@"application/x-gtar" },
    .{ "gtm", all.@"application/vnd.groove-tool-message" },
    .{ "gtw", all.@"model/vnd.gtw" },
    .{ "gv", all.@"text/vnd.graphviz" },
    .{ "gxf", all.@"application/gxf" },
    .{ "gxt", all.@"application/vnd.geonext" },
    .{ "gz", all.@"application/gzip" },
    .{ "h", all.@"text/x-c" },
    .{ "h261", all.@"video/h261" },
    .{ "h263", all.@"video/h263" },
    .{ "h264", all.@"video/h264" },
    .{ "hal", all.@"application/vnd.hal+xml" },
    .{ "hbci", all.@"application/vnd.hbci" },
    .{ "hbs", all.@"text/x-handlebars-template" },
    .{ "hdd", all.@"application/x-virtualbox-hdd" },
    .{ "hdf", all.@"application/x-hdf" },
    .{ "heic", all.@"image/heic" },
    .{ "heics", all.@"image/heic-sequence" },
    .{ "heif", all.@"image/heif" },
    .{ "heifs", all.@"image/heif-sequence" },
    .{ "hej2", all.@"image/hej2k" },
    .{ "held", all.@"application/atsc-held+xml" },
    .{ "hh", all.@"text/x-c" },
    .{ "hjson", all.@"application/hjson" },
    .{ "hlp", all.@"application/winhlp" },
    .{ "hpgl", all.@"application/vnd.hp-hpgl" },
    .{ "hpid", all.@"application/vnd.hp-hpid" },
    .{ "hps", all.@"application/vnd.hp-hps" },
    .{ "hqx", all.@"application/mac-binhex40" },
    .{ "hsj2", all.@"image/hsj2" },
    .{ "htc", all.@"text/x-component" },
    .{ "htke", all.@"application/vnd.kenameaapp" },
    .{ "htm", all.@"text/html" },
    .{ "html", all.@"text/html" },
    .{ "hvd", all.@"application/vnd.yamaha.hv-dic" },
    .{ "hvp", all.@"application/vnd.yamaha.hv-voice" },
    .{ "hvs", all.@"application/vnd.yamaha.hv-script" },
    .{ "i2g", all.@"application/vnd.intergeo" },
    .{ "icc", all.@"application/vnd.iccprofile" },
    .{ "ice", all.@"x-conference/x-cooltalk" },
    .{ "icm", all.@"application/vnd.iccprofile" },
    .{ "ico", all.@"image/x-icon" },
    .{ "ics", all.@"text/calendar" },
    .{ "ief", all.@"image/ief" },
    .{ "ifb", all.@"text/calendar" },
    .{ "ifm", all.@"application/vnd.shana.informed.formdata" },
    .{ "iges", all.@"model/iges" },
    .{ "igl", all.@"application/vnd.igloader" },
    .{ "igm", all.@"application/vnd.insors.igm" },
    .{ "igs", all.@"model/iges" },
    .{ "igx", all.@"application/vnd.micrografx.igx" },
    .{ "iif", all.@"application/vnd.shana.informed.interchange" },
    .{ "img", all.@"application/octet-stream" },
    .{ "imp", all.@"application/vnd.accpac.simply.imp" },
    .{ "ims", all.@"application/vnd.ms-ims" },
    .{ "in", all.@"text/plain" },
    .{ "ini", all.@"text/plain" },
    .{ "ink", all.@"application/inkml+xml" },
    .{ "inkml", all.@"application/inkml+xml" },
    .{ "install", all.@"application/x-install-instructions" },
    .{ "iota", all.@"application/vnd.astraea-software.iota" },
    .{ "ipfix", all.@"application/ipfix" },
    .{ "ipk", all.@"application/vnd.shana.informed.package" },
    .{ "irm", all.@"application/vnd.ibm.rights-management" },
    .{ "irp", all.@"application/vnd.irepository.package+xml" },
    .{ "iso", all.@"application/x-iso9660-image" },
    .{ "itp", all.@"application/vnd.shana.informed.formtemplate" },
    .{ "its", all.@"application/its+xml" },
    .{ "ivp", all.@"application/vnd.immervision-ivp" },
    .{ "ivu", all.@"application/vnd.immervision-ivu" },
    .{ "jad", all.@"text/vnd.sun.j2me.app-descriptor" },
    .{ "jade", all.@"text/jade" },
    .{ "jam", all.@"application/vnd.jam" },
    .{ "jar", all.@"application/java-archive" },
    .{ "jardiff", all.@"application/x-java-archive-diff" },
    .{ "java", all.@"text/x-java-source" },
    .{ "jhc", all.@"image/jphc" },
    .{ "jisp", all.@"application/vnd.jisp" },
    .{ "jls", all.@"image/jls" },
    .{ "jlt", all.@"application/vnd.hp-jlyt" },
    .{ "jng", all.@"image/x-jng" },
    .{ "jnlp", all.@"application/x-java-jnlp-file" },
    .{ "joda", all.@"application/vnd.joost.joda-archive" },
    .{ "jp2", all.@"image/jp2" },
    .{ "jpe", all.@"image/jpeg" },
    .{ "jpeg", all.@"image/jpeg" },
    .{ "jpf", all.@"image/jpx" },
    .{ "jpg", all.@"image/jpeg" },
    .{ "jpg2", all.@"image/jp2" },
    .{ "jpgm", all.@"video/jpm" },
    .{ "jpgv", all.@"video/jpeg" },
    .{ "jph", all.@"image/jph" },
    .{ "jpm", all.@"video/jpm" },
    .{ "jpx", all.@"image/jpx" },
    .{ "js", all.@"application/javascript" },
    .{ "json", all.@"application/json" },
    .{ "json5", all.@"application/json5" },
    .{ "jsonld", all.@"application/ld+json" },
    .{ "jsonml", all.@"application/jsonml+json" },
    .{ "jsx", all.@"text/jsx" },
    .{ "jxr", all.@"image/jxr" },
    .{ "jxra", all.@"image/jxra" },
    .{ "jxrs", all.@"image/jxrs" },
    .{ "jxs", all.@"image/jxs" },
    .{ "jxsc", all.@"image/jxsc" },
    .{ "jxsi", all.@"image/jxsi" },
    .{ "jxss", all.@"image/jxss" },
    .{ "kar", all.@"audio/midi" },
    .{ "karbon", all.@"application/vnd.kde.karbon" },
    .{ "kdbx", all.@"application/x-keepass2" },
    .{ "key", all.@"application/x-iwork-keynote-sffkey" },
    .{ "kfo", all.@"application/vnd.kde.kformula" },
    .{ "kia", all.@"application/vnd.kidspiration" },
    .{ "kml", all.@"application/vnd.google-earth.kml+xml" },
    .{ "kmz", all.@"application/vnd.google-earth.kmz" },
    .{ "kne", all.@"application/vnd.kinar" },
    .{ "knp", all.@"application/vnd.kinar" },
    .{ "kon", all.@"application/vnd.kde.kontour" },
    .{ "kpr", all.@"application/vnd.kde.kpresenter" },
    .{ "kpt", all.@"application/vnd.kde.kpresenter" },
    .{ "kpxx", all.@"application/vnd.ds-keypoint" },
    .{ "ksp", all.@"application/vnd.kde.kspread" },
    .{ "ktr", all.@"application/vnd.kahootz" },
    .{ "ktx", all.@"image/ktx" },
    .{ "ktx2", all.@"image/ktx2" },
    .{ "ktz", all.@"application/vnd.kahootz" },
    .{ "kwd", all.@"application/vnd.kde.kword" },
    .{ "kwt", all.@"application/vnd.kde.kword" },
    .{ "lasxml", all.@"application/vnd.las.las+xml" },
    .{ "latex", all.@"application/x-latex" },
    .{ "lbd", all.@"application/vnd.llamagraphics.life-balance.desktop" },
    .{ "lbe", all.@"application/vnd.llamagraphics.life-balance.exchange+xml" },
    .{ "les", all.@"application/vnd.hhe.lesson-player" },
    .{ "less", all.@"text/less" },
    .{ "lgr", all.@"application/lgr+xml" },
    .{ "lha", all.@"application/x-lzh-compressed" },
    .{ "link66", all.@"application/vnd.route66.link66+xml" },
    .{ "list", all.@"text/plain" },
    .{ "list3820", all.@"application/vnd.ibm.modcap" },
    .{ "listafp", all.@"application/vnd.ibm.modcap" },
    .{ "litcoffee", all.@"text/coffeescript" },
    .{ "lnk", all.@"application/x-ms-shortcut" },
    .{ "log", all.@"text/plain" },
    .{ "lostxml", all.@"application/lost+xml" },
    .{ "lrf", all.@"application/octet-stream" },
    .{ "lrm", all.@"application/vnd.ms-lrm" },
    .{ "ltf", all.@"application/vnd.frogans.ltf" },
    .{ "lua", all.@"text/x-lua" },
    .{ "luac", all.@"application/x-lua-bytecode" },
    .{ "lvp", all.@"audio/vnd.lucent.voice" },
    .{ "lwp", all.@"application/vnd.lotus-wordpro" },
    .{ "lzh", all.@"application/x-lzh-compressed" },
    .{ "m13", all.@"application/x-msmediaview" },
    .{ "m14", all.@"application/x-msmediaview" },
    .{ "m1v", all.@"video/mpeg" },
    .{ "m21", all.@"application/mp21" },
    .{ "m2a", all.@"audio/mpeg" },
    .{ "m2v", all.@"video/mpeg" },
    .{ "m3a", all.@"audio/mpeg" },
    .{ "m3u", all.@"audio/x-mpegurl" },
    .{ "m3u8", all.@"application/vnd.apple.mpegurl" },
    .{ "m4a", all.@"audio/x-m4a" },
    .{ "m4p", all.@"application/mp4" },
    .{ "m4s", all.@"video/iso.segment" },
    .{ "m4u", all.@"video/vnd.mpegurl" },
    .{ "m4v", all.@"video/x-m4v" },
    .{ "ma", all.@"application/mathematica" },
    .{ "mads", all.@"application/mads+xml" },
    .{ "maei", all.@"application/mmt-aei+xml" },
    .{ "mag", all.@"application/vnd.ecowin.chart" },
    .{ "maker", all.@"application/vnd.framemaker" },
    .{ "man", all.@"text/troff" },
    .{ "manifest", all.@"text/cache-manifest" },
    .{ "map", all.@"application/json" },
    .{ "mar", all.@"application/octet-stream" },
    .{ "markdown", all.@"text/markdown" },
    .{ "mathml", all.@"application/mathml+xml" },
    .{ "mb", all.@"application/mathematica" },
    .{ "mbk", all.@"application/vnd.mobius.mbk" },
    .{ "mbox", all.@"application/mbox" },
    .{ "mc1", all.@"application/vnd.medcalcdata" },
    .{ "mcd", all.@"application/vnd.mcd" },
    .{ "mcurl", all.@"text/vnd.curl.mcurl" },
    .{ "md", all.@"text/markdown" },
    .{ "mdb", all.@"application/x-msaccess" },
    .{ "mdi", all.@"image/vnd.ms-modi" },
    .{ "mdx", all.@"text/mdx" },
    .{ "me", all.@"text/troff" },
    .{ "mesh", all.@"model/mesh" },
    .{ "meta4", all.@"application/metalink4+xml" },
    .{ "metalink", all.@"application/metalink+xml" },
    .{ "mets", all.@"application/mets+xml" },
    .{ "mfm", all.@"application/vnd.mfmp" },
    .{ "mft", all.@"application/rpki-manifest" },
    .{ "mgp", all.@"application/vnd.osgeo.mapguide.package" },
    .{ "mgz", all.@"application/vnd.proteus.magazine" },
    .{ "mid", all.@"audio/midi" },
    .{ "midi", all.@"audio/midi" },
    .{ "mie", all.@"application/x-mie" },
    .{ "mif", all.@"application/vnd.mif" },
    .{ "mime", all.@"message/rfc822" },
    .{ "mj2", all.@"video/mj2" },
    .{ "mjp2", all.@"video/mj2" },
    .{ "mjs", all.@"application/javascript" },
    .{ "mk3d", all.@"video/x-matroska" },
    .{ "mka", all.@"audio/x-matroska" },
    .{ "mkd", all.@"text/x-markdown" },
    .{ "mks", all.@"video/x-matroska" },
    .{ "mkv", all.@"video/x-matroska" },
    .{ "mlp", all.@"application/vnd.dolby.mlp" },
    .{ "mmd", all.@"application/vnd.chipnuts.karaoke-mmd" },
    .{ "mmf", all.@"application/vnd.smaf" },
    .{ "mml", all.@"text/mathml" },
    .{ "mmr", all.@"image/vnd.fujixerox.edmics-mmr" },
    .{ "mng", all.@"video/x-mng" },
    .{ "mny", all.@"application/x-msmoney" },
    .{ "mobi", all.@"application/x-mobipocket-ebook" },
    .{ "mods", all.@"application/mods+xml" },
    .{ "mov", all.@"video/quicktime" },
    .{ "movie", all.@"video/x-sgi-movie" },
    .{ "mp2", all.@"audio/mpeg" },
    .{ "mp21", all.@"application/mp21" },
    .{ "mp2a", all.@"audio/mpeg" },
    .{ "mp3", all.@"audio/mpeg" },
    .{ "mp4", all.@"video/mp4" },
    .{ "mp4a", all.@"audio/mp4" },
    .{ "mp4s", all.@"application/mp4" },
    .{ "mp4v", all.@"video/mp4" },
    .{ "mpc", all.@"application/vnd.mophun.certificate" },
    .{ "mpd", all.@"application/dash+xml" },
    .{ "mpe", all.@"video/mpeg" },
    .{ "mpeg", all.@"video/mpeg" },
    .{ "mpf", all.@"application/media-policy-dataset+xml" },
    .{ "mpg", all.@"video/mpeg" },
    .{ "mpg4", all.@"video/mp4" },
    .{ "mpga", all.@"audio/mpeg" },
    .{ "mpkg", all.@"application/vnd.apple.installer+xml" },
    .{ "mpm", all.@"application/vnd.blueice.multipass" },
    .{ "mpn", all.@"application/vnd.mophun.application" },
    .{ "mpp", all.@"application/vnd.ms-project" },
    .{ "mpt", all.@"application/vnd.ms-project" },
    .{ "mpy", all.@"application/vnd.ibm.minipay" },
    .{ "mqy", all.@"application/vnd.mobius.mqy" },
    .{ "mrc", all.@"application/marc" },
    .{ "mrcx", all.@"application/marcxml+xml" },
    .{ "ms", all.@"text/troff" },
    .{ "mscml", all.@"application/mediaservercontrol+xml" },
    .{ "mseed", all.@"application/vnd.fdsn.mseed" },
    .{ "mseq", all.@"application/vnd.mseq" },
    .{ "msf", all.@"application/vnd.epson.msf" },
    .{ "msg", all.@"application/vnd.ms-outlook" },
    .{ "msh", all.@"model/mesh" },
    .{ "msi", all.@"application/x-msdownload" },
    .{ "msl", all.@"application/vnd.mobius.msl" },
    .{ "msm", all.@"application/octet-stream" },
    .{ "msp", all.@"application/octet-stream" },
    .{ "msty", all.@"application/vnd.muvee.style" },
    .{ "mtl", all.@"model/mtl" },
    .{ "mts", all.@"application/javascript" },
    .{ "mtsx", all.@"application/javascript" },
    .{ "mus", all.@"application/vnd.musician" },
    .{ "musd", all.@"application/mmt-usd+xml" },
    .{ "musicxml", all.@"application/vnd.recordare.musicxml+xml" },
    .{ "mvb", all.@"application/x-msmediaview" },
    .{ "mvt", all.@"application/vnd.mapbox-vector-tile" },
    .{ "mwf", all.@"application/vnd.mfer" },
    .{ "mxf", all.@"application/mxf" },
    .{ "mxl", all.@"application/vnd.recordare.musicxml" },
    .{ "mxmf", all.@"audio/mobile-xmf" },
    .{ "mxml", all.@"application/xv+xml" },
    .{ "mxs", all.@"application/vnd.triscape.mxs" },
    .{ "mxu", all.@"video/vnd.mpegurl" },
    .{ "n-g", all.@"application/vnd.nokia.n-gage.symbian.install" },
    .{ "n3", all.@"text/n3" },
    .{ "nb", all.@"application/mathematica" },
    .{ "nbp", all.@"application/vnd.wolfram.player" },
    .{ "nc", all.@"application/x-netcdf" },
    .{ "ncx", all.@"application/x-dtbncx+xml" },
    .{ "nfo", all.@"text/x-nfo" },
    .{ "ngdat", all.@"application/vnd.nokia.n-gage.data" },
    .{ "nitf", all.@"application/vnd.nitf" },
    .{ "nlu", all.@"application/vnd.neurolanguage.nlu" },
    .{ "nml", all.@"application/vnd.enliven" },
    .{ "nnd", all.@"application/vnd.noblenet-directory" },
    .{ "nns", all.@"application/vnd.noblenet-sealer" },
    .{ "nnw", all.@"application/vnd.noblenet-web" },
    .{ "npx", all.@"image/vnd.net-fpx" },
    .{ "nq", all.@"application/n-quads" },
    .{ "nsc", all.@"application/x-conference" },
    .{ "nsf", all.@"application/vnd.lotus-notes" },
    .{ "nt", all.@"application/n-triples" },
    .{ "ntf", all.@"application/vnd.nitf" },
    .{ "numbers", all.@"application/x-iwork-numbers-sffnumbers" },
    .{ "nzb", all.@"application/x-nzb" },
    .{ "oa2", all.@"application/vnd.fujitsu.oasys2" },
    .{ "oa3", all.@"application/vnd.fujitsu.oasys3" },
    .{ "oas", all.@"application/vnd.fujitsu.oasys" },
    .{ "obd", all.@"application/x-msbinder" },
    .{ "obgx", all.@"application/vnd.openblox.game+xml" },
    .{ "obj", all.@"model/obj" },
    .{ "oda", all.@"application/oda" },
    .{ "odb", all.@"application/vnd.oasis.opendocument.database" },
    .{ "odc", all.@"application/vnd.oasis.opendocument.chart" },
    .{ "odf", all.@"application/vnd.oasis.opendocument.formula" },
    .{ "odft", all.@"application/vnd.oasis.opendocument.formula-template" },
    .{ "odg", all.@"application/vnd.oasis.opendocument.graphics" },
    .{ "odi", all.@"application/vnd.oasis.opendocument.image" },
    .{ "odm", all.@"application/vnd.oasis.opendocument.text-master" },
    .{ "odp", all.@"application/vnd.oasis.opendocument.presentation" },
    .{ "ods", all.@"application/vnd.oasis.opendocument.spreadsheet" },
    .{ "odt", all.@"application/vnd.oasis.opendocument.text" },
    .{ "oga", all.@"audio/ogg" },
    .{ "ogex", all.@"model/vnd.opengex" },
    .{ "ogg", all.@"audio/ogg" },
    .{ "ogv", all.@"video/ogg" },
    .{ "ogx", all.@"application/ogg" },
    .{ "omdoc", all.@"application/omdoc+xml" },
    .{ "onepkg", all.@"application/onenote" },
    .{ "onetmp", all.@"application/onenote" },
    .{ "onetoc", all.@"application/onenote" },
    .{ "onetoc2", all.@"application/onenote" },
    .{ "opf", all.@"application/oebps-package+xml" },
    .{ "opml", all.@"text/x-opml" },
    .{ "oprc", all.@"application/vnd.palm" },
    .{ "opus", all.@"audio/ogg" },
    .{ "org", all.@"text/x-org" },
    .{ "osf", all.@"application/vnd.yamaha.openscoreformat" },
    .{ "osfpvg", all.@"application/vnd.yamaha.openscoreformat.osfpvg+xml" },
    .{ "osm", all.@"application/vnd.openstreetmap.data+xml" },
    .{ "otc", all.@"application/vnd.oasis.opendocument.chart-template" },
    .{ "otf", all.@"font/otf" },
    .{ "otg", all.@"application/vnd.oasis.opendocument.graphics-template" },
    .{ "oth", all.@"application/vnd.oasis.opendocument.text-web" },
    .{ "oti", all.@"application/vnd.oasis.opendocument.image-template" },
    .{ "otp", all.@"application/vnd.oasis.opendocument.presentation-template" },
    .{ "ots", all.@"application/vnd.oasis.opendocument.spreadsheet-template" },
    .{ "ott", all.@"application/vnd.oasis.opendocument.text-template" },
    .{ "ova", all.@"application/x-virtualbox-ova" },
    .{ "ovf", all.@"application/x-virtualbox-ovf" },
    .{ "owl", all.@"application/rdf+xml" },
    .{ "oxps", all.@"application/oxps" },
    .{ "oxt", all.@"application/vnd.openofficeorg.extension" },
    .{ "p", all.@"text/x-pascal" },
    .{ "p10", all.@"application/pkcs10" },
    .{ "p12", all.@"application/x-pkcs12" },
    .{ "p7b", all.@"application/x-pkcs7-certificates" },
    .{ "p7c", all.@"application/pkcs7-mime" },
    .{ "p7m", all.@"application/pkcs7-mime" },
    .{ "p7r", all.@"application/x-pkcs7-certreqresp" },
    .{ "p7s", all.@"application/pkcs7-signature" },
    .{ "p8", all.@"application/pkcs8" },
    .{ "pac", all.@"application/x-ns-proxy-autoconfig" },
    .{ "pages", all.@"application/x-iwork-pages-sffpages" },
    .{ "pas", all.@"text/x-pascal" },
    .{ "paw", all.@"application/vnd.pawaafile" },
    .{ "pbd", all.@"application/vnd.powerbuilder6" },
    .{ "pbm", all.@"image/x-portable-bitmap" },
    .{ "pcap", all.@"application/vnd.tcpdump.pcap" },
    .{ "pcf", all.@"application/x-font-pcf" },
    .{ "pcl", all.@"application/vnd.hp-pcl" },
    .{ "pclxl", all.@"application/vnd.hp-pclxl" },
    .{ "pct", all.@"image/x-pict" },
    .{ "pcurl", all.@"application/vnd.curl.pcurl" },
    .{ "pcx", all.@"image/x-pcx" },
    .{ "pdb", all.@"application/x-pilot" },
    .{ "pde", all.@"text/x-processing" },
    .{ "pdf", all.@"application/pdf" },
    .{ "pem", all.@"application/x-x509-ca-cert" },
    .{ "pfa", all.@"application/x-font-type1" },
    .{ "pfb", all.@"application/x-font-type1" },
    .{ "pfm", all.@"application/x-font-type1" },
    .{ "pfr", all.@"application/font-tdpfr" },
    .{ "pfx", all.@"application/x-pkcs12" },
    .{ "pgm", all.@"image/x-portable-graymap" },
    .{ "pgn", all.@"application/x-chess-pgn" },
    .{ "pgp", all.@"application/pgp-encrypted" },
    .{ "php", all.@"application/x-httpd-php" },
    .{ "pic", all.@"image/x-pict" },
    .{ "pkg", all.@"application/octet-stream" },
    .{ "pki", all.@"application/pkixcmp" },
    .{ "pkipath", all.@"application/pkix-pkipath" },
    .{ "pkpass", all.@"application/vnd.apple.pkpass" },
    .{ "pl", all.@"application/x-perl" },
    .{ "plb", all.@"application/vnd.3gpp.pic-bw-large" },
    .{ "plc", all.@"application/vnd.mobius.plc" },
    .{ "plf", all.@"application/vnd.pocketlearn" },
    .{ "pls", all.@"application/pls+xml" },
    .{ "pm", all.@"application/x-perl" },
    .{ "pml", all.@"application/vnd.ctc-posml" },
    .{ "png", all.@"image/png" },
    .{ "pnm", all.@"image/x-portable-anymap" },
    .{ "portpkg", all.@"application/vnd.macports.portpkg" },
    .{ "pot", all.@"application/vnd.ms-powerpoint" },
    .{ "potm", all.@"application/vnd.ms-powerpoint.template.macroenabled.12" },
    .{ "potx", all.@"application/vnd.openxmlformats-officedocument.presentationml.template" },
    .{ "ppam", all.@"application/vnd.ms-powerpoint.addin.macroenabled.12" },
    .{ "ppd", all.@"application/vnd.cups-ppd" },
    .{ "ppm", all.@"image/x-portable-pixmap" },
    .{ "pps", all.@"application/vnd.ms-powerpoint" },
    .{ "ppsm", all.@"application/vnd.ms-powerpoint.slideshow.macroenabled.12" },
    .{
        "ppsx",
        all.@"application/vnd.openxmlformats-officedocument.presentationml.slideshow",
    },
    .{ "ppt", all.@"application/vnd.ms-powerpoint" },
    .{ "pptm", all.@"application/vnd.ms-powerpoint.presentation.macroenabled.12" },
    .{
        "pptx",
        all.@"application/vnd.openxmlformats-officedocument.presentationml.presentation",
    },
    .{ "pqa", all.@"application/vnd.palm" },
    .{ "prc", all.@"model/prc" },
    .{ "pre", all.@"application/vnd.lotus-freelance" },
    .{ "prf", all.@"application/pics-rules" },
    .{ "provx", all.@"application/provenance+xml" },
    .{ "ps", all.@"application/postscript" },
    .{ "psb", all.@"application/vnd.3gpp.pic-bw-small" },
    .{ "psd", all.@"image/vnd.adobe.photoshop" },
    .{ "psf", all.@"application/x-font-linux-psf" },
    .{ "pskcxml", all.@"application/pskc+xml" },
    .{ "pti", all.@"image/prs.pti" },
    .{ "ptid", all.@"application/vnd.pvi.ptid1" },
    .{ "pub", all.@"application/x-mspublisher" },
    .{ "pvb", all.@"application/vnd.3gpp.pic-bw-var" },
    .{ "pwn", all.@"application/vnd.3m.post-it-notes" },
    .{ "pya", all.@"audio/vnd.ms-playready.media.pya" },
    .{ "pyv", all.@"video/vnd.ms-playready.media.pyv" },
    .{ "qam", all.@"application/vnd.epson.quickanime" },
    .{ "qbo", all.@"application/vnd.intu.qbo" },
    .{ "qfx", all.@"application/vnd.intu.qfx" },
    .{ "qps", all.@"application/vnd.publishare-delta-tree" },
    .{ "qt", all.@"video/quicktime" },
    .{ "qwd", all.@"application/vnd.quark.quarkxpress" },
    .{ "qwt", all.@"application/vnd.quark.quarkxpress" },
    .{ "qxb", all.@"application/vnd.quark.quarkxpress" },
    .{ "qxd", all.@"application/vnd.quark.quarkxpress" },
    .{ "qxl", all.@"application/vnd.quark.quarkxpress" },
    .{ "qxt", all.@"application/vnd.quark.quarkxpress" },
    .{ "ra", all.@"audio/x-realaudio" },
    .{ "ram", all.@"audio/x-pn-realaudio" },
    .{ "raml", all.@"application/raml+yaml" },
    .{ "rapd", all.@"application/route-apd+xml" },
    .{ "rar", all.@"application/x-rar-compressed" },
    .{ "ras", all.@"image/x-cmu-raster" },
    .{ "rcprofile", all.@"application/vnd.ipunplugged.rcprofile" },
    .{ "rdf", all.@"application/rdf+xml" },
    .{ "rdz", all.@"application/vnd.data-vision.rdz" },
    .{ "relo", all.@"application/p2p-overlay+xml" },
    .{ "rep", all.@"application/vnd.businessobjects" },
    .{ "res", all.@"application/x-dtbresource+xml" },
    .{ "rgb", all.@"image/x-rgb" },
    .{ "rif", all.@"application/reginfo+xml" },
    .{ "rip", all.@"audio/vnd.rip" },
    .{ "ris", all.@"application/x-research-info-systems" },
    .{ "rl", all.@"application/resource-lists+xml" },
    .{ "rlc", all.@"image/vnd.fujixerox.edmics-rlc" },
    .{ "rld", all.@"application/resource-lists-diff+xml" },
    .{ "rm", all.@"application/vnd.rn-realmedia" },
    .{ "rmi", all.@"audio/midi" },
    .{ "rmp", all.@"audio/x-pn-realaudio-plugin" },
    .{ "rms", all.@"application/vnd.jcp.javame.midlet-rms" },
    .{ "rmvb", all.@"application/vnd.rn-realmedia-vbr" },
    .{ "rnc", all.@"application/relax-ng-compact-syntax" },
    .{ "rng", all.@"application/xml" },
    .{ "roa", all.@"application/rpki-roa" },
    .{ "roff", all.@"text/troff" },
    .{ "rp9", all.@"application/vnd.cloanto.rp9" },
    .{ "rpm", all.@"application/x-redhat-package-manager" },
    .{ "rpss", all.@"application/vnd.nokia.radio-presets" },
    .{ "rpst", all.@"application/vnd.nokia.radio-preset" },
    .{ "rq", all.@"application/sparql-query" },
    .{ "rs", all.@"application/rls-services+xml" },
    .{ "rsat", all.@"application/atsc-rsat+xml" },
    .{ "rsd", all.@"application/rsd+xml" },
    .{ "rsheet", all.@"application/urc-ressheet+xml" },
    .{ "rss", all.@"application/rss+xml" },
    .{ "rtf", all.@"text/rtf" },
    .{ "rtx", all.@"text/richtext" },
    .{ "run", all.@"application/x-makeself" },
    .{ "rusd", all.@"application/route-usd+xml" },
    .{ "s", all.@"text/x-asm" },
    .{ "s3m", all.@"audio/s3m" },
    .{ "saf", all.@"application/vnd.yamaha.smaf-audio" },
    .{ "sass", all.@"text/x-sass" },
    .{ "sbml", all.@"application/sbml+xml" },
    .{ "sc", all.@"application/vnd.ibm.secure-container" },
    .{ "scd", all.@"application/x-msschedule" },
    .{ "scm", all.@"application/vnd.lotus-screencam" },
    .{ "scq", all.@"application/scvp-cv-request" },
    .{ "scs", all.@"application/scvp-cv-response" },
    .{ "scss", all.@"text/x-scss" },
    .{ "scurl", all.@"text/vnd.curl.scurl" },
    .{ "sda", all.@"application/vnd.stardivision.draw" },
    .{ "sdc", all.@"application/vnd.stardivision.calc" },
    .{ "sdd", all.@"application/vnd.stardivision.impress" },
    .{ "sdkd", all.@"application/vnd.solent.sdkm+xml" },
    .{ "sdkm", all.@"application/vnd.solent.sdkm+xml" },
    .{ "sdp", all.@"application/sdp" },
    .{ "sdw", all.@"application/vnd.stardivision.writer" },
    .{ "sea", all.@"application/x-sea" },
    .{ "see", all.@"application/vnd.seemail" },
    .{ "seed", all.@"application/vnd.fdsn.seed" },
    .{ "sema", all.@"application/vnd.sema" },
    .{ "semd", all.@"application/vnd.semd" },
    .{ "semf", all.@"application/vnd.semf" },
    .{ "senmlx", all.@"application/senml+xml" },
    .{ "sensmlx", all.@"application/sensml+xml" },
    .{ "ser", all.@"application/java-serialized-object" },
    .{ "setpay", all.@"application/set-payment-initiation" },
    .{ "setreg", all.@"application/set-registration-initiation" },
    .{ "sfd-h", all.@"application/vnd.hydrostatix.sof-data" },
    .{ "sfs", all.@"application/vnd.spotfire.sfs" },
    .{ "sfv", all.@"text/x-sfv" },
    .{ "sgi", all.@"image/sgi" },
    .{ "sgl", all.@"application/vnd.stardivision.writer-global" },
    .{ "sgm", all.@"text/sgml" },
    .{ "sgml", all.@"text/sgml" },
    .{ "sh", all.@"application/x-sh" },
    .{ "shar", all.@"application/x-shar" },
    .{ "shex", all.@"text/shex" },
    .{ "shf", all.@"application/shf+xml" },
    .{ "shtml", all.@"text/html" },
    .{ "sid", all.@"image/x-mrsid-image" },
    .{ "sieve", all.@"application/sieve" },
    .{ "sig", all.@"application/pgp-signature" },
    .{ "sil", all.@"audio/silk" },
    .{ "silo", all.@"model/mesh" },
    .{ "sis", all.@"application/vnd.symbian.install" },
    .{ "sisx", all.@"application/vnd.symbian.install" },
    .{ "sit", all.@"application/x-stuffit" },
    .{ "sitx", all.@"application/x-stuffitx" },
    .{ "siv", all.@"application/sieve" },
    .{ "skd", all.@"application/vnd.koan" },
    .{ "skm", all.@"application/vnd.koan" },
    .{ "skp", all.@"application/vnd.koan" },
    .{ "skt", all.@"application/vnd.koan" },
    .{ "sldm", all.@"application/vnd.ms-powerpoint.slide.macroenabled.12" },
    .{ "sldx", all.@"application/vnd.openxmlformats-officedocument.presentationml.slide" },
    .{ "slim", all.@"text/slim" },
    .{ "slm", all.@"text/slim" },
    .{ "sls", all.@"application/route-s-tsid+xml" },
    .{ "slt", all.@"application/vnd.epson.salt" },
    .{ "sm", all.@"application/vnd.stepmania.stepchart" },
    .{ "smf", all.@"application/vnd.stardivision.math" },
    .{ "smi", all.@"application/smil+xml" },
    .{ "smil", all.@"application/smil+xml" },
    .{ "smv", all.@"video/x-smv" },
    .{ "smzip", all.@"application/vnd.stepmania.package" },
    .{ "snd", all.@"audio/basic" },
    .{ "snf", all.@"application/x-font-snf" },
    .{ "so", all.@"application/octet-stream" },
    .{ "spc", all.@"application/x-pkcs7-certificates" },
    .{ "spdx", all.@"text/spdx" },
    .{ "spf", all.@"application/vnd.yamaha.smaf-phrase" },
    .{ "spl", all.@"application/x-futuresplash" },
    .{ "spot", all.@"text/vnd.in3d.spot" },
    .{ "spp", all.@"application/scvp-vp-response" },
    .{ "spq", all.@"application/scvp-vp-request" },
    .{ "spx", all.@"audio/ogg" },
    .{ "sql", all.@"application/x-sql" },
    .{ "src", all.@"application/x-wais-source" },
    .{ "srt", all.@"application/x-subrip" },
    .{ "sru", all.@"application/sru+xml" },
    .{ "srx", all.@"application/sparql-results+xml" },
    .{ "ssdl", all.@"application/ssdl+xml" },
    .{ "sse", all.@"application/vnd.kodak-descriptor" },
    .{ "ssf", all.@"application/vnd.epson.ssf" },
    .{ "ssml", all.@"application/ssml+xml" },
    .{ "st", all.@"application/vnd.sailingtracker.track" },
    .{ "stc", all.@"application/vnd.sun.xml.calc.template" },
    .{ "std", all.@"application/vnd.sun.xml.draw.template" },
    .{ "stf", all.@"application/vnd.wt.stf" },
    .{ "sti", all.@"application/vnd.sun.xml.impress.template" },
    .{ "stk", all.@"application/hyperstudio" },
    .{ "stl", all.@"model/stl" },
    .{ "stpx", all.@"model/step+xml" },
    .{ "stpxz", all.@"model/step-xml+zip" },
    .{ "stpz", all.@"model/step+zip" },
    .{ "str", all.@"application/vnd.pg.format" },
    .{ "stw", all.@"application/vnd.sun.xml.writer.template" },
    .{ "styl", all.@"text/stylus" },
    .{ "stylus", all.@"text/stylus" },
    .{ "sub", all.@"text/vnd.dvb.subtitle" },
    .{ "sus", all.@"application/vnd.sus-calendar" },
    .{ "susp", all.@"application/vnd.sus-calendar" },
    .{ "sv4cpio", all.@"application/x-sv4cpio" },
    .{ "sv4crc", all.@"application/x-sv4crc" },
    .{ "svc", all.@"application/vnd.dvb.service" },
    .{ "svd", all.@"application/vnd.svd" },
    .{ "svg", all.@"image/svg+xml" },
    .{ "svgz", all.@"image/svg+xml" },
    .{ "swa", all.@"application/x-director" },
    .{ "swf", all.@"application/x-shockwave-flash" },
    .{ "swi", all.@"application/vnd.aristanetworks.swi" },
    .{ "swidtag", all.@"application/swid+xml" },
    .{ "sxc", all.@"application/vnd.sun.xml.calc" },
    .{ "sxd", all.@"application/vnd.sun.xml.draw" },
    .{ "sxg", all.@"application/vnd.sun.xml.writer.global" },
    .{ "sxi", all.@"application/vnd.sun.xml.impress" },
    .{ "sxm", all.@"application/vnd.sun.xml.math" },
    .{ "sxw", all.@"application/vnd.sun.xml.writer" },
    .{ "t", all.@"text/troff" },
    .{ "t3", all.@"application/x-t3vm-image" },
    .{ "t38", all.@"image/t38" },
    .{ "taglet", all.@"application/vnd.mynfc" },
    .{ "tao", all.@"application/vnd.tao.intent-module-archive" },
    .{ "tap", all.@"image/vnd.tencent.tap" },
    .{ "tar", all.@"application/x-tar" },
    .{ "tcap", all.@"application/vnd.3gpp2.tcap" },
    .{ "tcl", all.@"application/x-tcl" },
    .{ "td", all.@"application/urc-targetdesc+xml" },
    .{ "teacher", all.@"application/vnd.smart.teacher" },
    .{ "tei", all.@"application/tei+xml" },
    .{ "teicorpus", all.@"application/tei+xml" },
    .{ "tex", all.@"application/x-tex" },
    .{ "texi", all.@"application/x-texinfo" },
    .{ "texinfo", all.@"application/x-texinfo" },
    .{ "text", all.@"text/plain" },
    .{ "tfi", all.@"application/thraud+xml" },
    .{ "tfm", all.@"application/x-tex-tfm" },
    .{ "tfx", all.@"image/tiff-fx" },
    .{ "tga", all.@"image/x-tga" },
    .{ "thmx", all.@"application/vnd.ms-officetheme" },
    .{ "tif", all.@"image/tiff" },
    .{ "tiff", all.@"image/tiff" },
    .{ "tk", all.@"application/x-tcl" },
    .{ "tmo", all.@"application/vnd.tmobile-livetv" },
    .{ "toml", all.@"application/toml" },
    .{ "torrent", all.@"application/x-bittorrent" },
    .{ "tpl", all.@"application/vnd.groove-tool-template" },
    .{ "tpt", all.@"application/vnd.trid.tpt" },
    .{ "tr", all.@"text/troff" },
    .{ "tra", all.@"application/vnd.trueapp" },
    .{ "trig", all.@"application/trig" },
    .{ "trm", all.@"application/x-msterminal" },
    .{ "ts", javascript },
    .{ "tsx", javascript },
    .{ "tsd", all.@"application/timestamped-data" },
    .{ "tsv", all.@"text/tab-separated-values" },
    .{ "tsx", all.@"application/javascript" },
    .{ "ttc", all.@"font/collection" },
    .{ "ttf", all.@"font/ttf" },
    .{ "ttl", all.@"text/turtle" },
    .{ "ttml", all.@"application/ttml+xml" },
    .{ "twd", all.@"application/vnd.simtech-mindmapper" },
    .{ "twds", all.@"application/vnd.simtech-mindmapper" },
    .{ "txd", all.@"application/vnd.genomatix.tuxedo" },
    .{ "txf", all.@"application/vnd.mobius.txf" },
    .{ "txt", all.@"text/plain" },
    .{ "u32", all.@"application/x-authorware-bin" },
    .{ "u3d", all.@"model/u3d" },
    .{ "u8dsn", all.@"message/global-delivery-status" },
    .{ "u8hdr", all.@"message/global-headers" },
    .{ "u8mdn", all.@"message/global-disposition-notification" },
    .{ "u8msg", all.@"message/global" },
    .{ "ubj", all.@"application/ubjson" },
    .{ "udeb", all.@"application/x-debian-package" },
    .{ "ufd", all.@"application/vnd.ufdl" },
    .{ "ufdl", all.@"application/vnd.ufdl" },
    .{ "ulx", all.@"application/x-glulx" },
    .{ "umj", all.@"application/vnd.umajin" },
    .{ "unityweb", all.@"application/vnd.unity" },
    .{ "uoml", all.@"application/vnd.uoml+xml" },
    .{ "uri", all.@"text/uri-list" },
    .{ "uris", all.@"text/uri-list" },
    .{ "urls", all.@"text/uri-list" },
    .{ "usdz", all.@"model/vnd.usdz+zip" },
    .{ "ustar", all.@"application/x-ustar" },
    .{ "utz", all.@"application/vnd.uiq.theme" },
    .{ "uu", all.@"text/x-uuencode" },
    .{ "uva", all.@"audio/vnd.dece.audio" },
    .{ "uvd", all.@"application/vnd.dece.data" },
    .{ "uvf", all.@"application/vnd.dece.data" },
    .{ "uvg", all.@"image/vnd.dece.graphic" },
    .{ "uvh", all.@"video/vnd.dece.hd" },
    .{ "uvi", all.@"image/vnd.dece.graphic" },
    .{ "uvm", all.@"video/vnd.dece.mobile" },
    .{ "uvp", all.@"video/vnd.dece.pd" },
    .{ "uvs", all.@"video/vnd.dece.sd" },
    .{ "uvt", all.@"application/vnd.dece.ttml+xml" },
    .{ "uvu", all.@"video/vnd.uvvu.mp4" },
    .{ "uvv", all.@"video/vnd.dece.video" },
    .{ "uvva", all.@"audio/vnd.dece.audio" },
    .{ "uvvd", all.@"application/vnd.dece.data" },
    .{ "uvvf", all.@"application/vnd.dece.data" },
    .{ "uvvg", all.@"image/vnd.dece.graphic" },
    .{ "uvvh", all.@"video/vnd.dece.hd" },
    .{ "uvvi", all.@"image/vnd.dece.graphic" },
    .{ "uvvm", all.@"video/vnd.dece.mobile" },
    .{ "uvvp", all.@"video/vnd.dece.pd" },
    .{ "uvvs", all.@"video/vnd.dece.sd" },
    .{ "uvvt", all.@"application/vnd.dece.ttml+xml" },
    .{ "uvvu", all.@"video/vnd.uvvu.mp4" },
    .{ "uvvv", all.@"video/vnd.dece.video" },
    .{ "uvvx", all.@"application/vnd.dece.unspecified" },
    .{ "uvvz", all.@"application/vnd.dece.zip" },
    .{ "uvx", all.@"application/vnd.dece.unspecified" },
    .{ "uvz", all.@"application/vnd.dece.zip" },
    .{ "vbox-e", all.@"application/x-virtualbox-vbox-extpack" },
    .{ "vbox", all.@"application/x-virtualbox-vbox" },
    .{ "vcard", all.@"text/vcard" },
    .{ "vcd", all.@"application/x-cdlink" },
    .{ "vcf", all.@"text/x-vcard" },
    .{ "vcg", all.@"application/vnd.groove-vcard" },
    .{ "vcs", all.@"text/x-vcalendar" },
    .{ "vcx", all.@"application/vnd.vcx" },
    .{ "vdi", all.@"application/x-virtualbox-vdi" },
    .{ "vds", all.@"model/vnd.sap.vds" },
    .{ "vhd", all.@"application/x-virtualbox-vhd" },
    .{ "vis", all.@"application/vnd.visionary" },
    .{ "viv", all.@"video/vnd.vivo" },
    .{ "vmdk", all.@"application/x-virtualbox-vmdk" },
    .{ "vob", all.@"video/x-ms-vob" },
    .{ "vor", all.@"application/vnd.stardivision.writer" },
    .{ "vox", all.@"application/x-authorware-bin" },
    .{ "vrml", all.@"model/vrml" },
    .{ "vsd", all.@"application/vnd.visio" },
    .{ "vsf", all.@"application/vnd.vsf" },
    .{ "vss", all.@"application/vnd.visio" },
    .{ "vst", all.@"application/vnd.visio" },
    .{ "vsw", all.@"application/vnd.visio" },
    .{ "vtf", all.@"image/vnd.valve.source.texture" },
    .{ "vtt", all.@"text/vtt" },
    .{ "vtu", all.@"model/vnd.vtu" },
    .{ "vxml", all.@"application/voicexml+xml" },
    .{ "w3d", all.@"application/x-director" },
    .{ "wad", all.@"application/x-doom" },
    .{ "wadl", all.@"application/vnd.sun.wadl+xml" },
    .{ "war", all.@"application/java-archive" },
    .{ "wasm", all.@"application/webassembly" },
    .{ "wav", all.@"audio/x-wav" },
    .{ "wax", all.@"audio/x-ms-wax" },
    .{ "wbmp", all.@"image/vnd.wap.wbmp" },
    .{ "wbs", all.@"application/vnd.criticaltools.wbs+xml" },
    .{ "wbxml", all.@"application/vnd.wap.wbxml" },
    .{ "wcm", all.@"application/vnd.ms-works" },
    .{ "wdb", all.@"application/vnd.ms-works" },
    .{ "wdp", all.@"image/vnd.ms-photo" },
    .{ "weba", all.@"audio/webm" },
    .{ "webapp", all.@"application/x-web-app-manifest+json" },
    .{ "webm", all.@"video/webm" },
    .{ "webmanifest", all.@"application/manifest+json" },
    .{ "webp", all.@"image/webp" },
    .{ "wg", all.@"application/vnd.pmi.widget" },
    .{ "wgt", all.@"application/widget" },
    .{ "wif", all.@"application/watcherinfo+xml" },
    .{ "wks", all.@"application/vnd.ms-works" },
    .{ "wm", all.@"video/x-ms-wm" },
    .{ "wma", all.@"audio/x-ms-wma" },
    .{ "wmd", all.@"application/x-ms-wmd" },
    .{ "wmf", all.@"image/wmf" },
    .{ "wml", all.@"text/vnd.wap.wml" },
    .{ "wmlc", all.@"application/vnd.wap.wmlc" },
    .{ "wmls", all.@"text/vnd.wap.wmlscript" },
    .{ "wmlsc", all.@"application/vnd.wap.wmlscriptc" },
    .{ "wmv", all.@"video/x-ms-wmv" },
    .{ "wmx", all.@"video/x-ms-wmx" },
    .{ "wmz", all.@"application/x-msmetafile" },
    .{ "woff", all.@"font/woff" },
    .{ "woff2", all.@"font/woff2" },
    .{ "wpd", all.@"application/vnd.wordperfect" },
    .{ "wpl", all.@"application/vnd.ms-wpl" },
    .{ "wps", all.@"application/vnd.ms-works" },
    .{ "wqd", all.@"application/vnd.wqd" },
    .{ "wri", all.@"application/x-mswrite" },
    .{ "wrl", all.@"model/vrml" },
    .{ "wsc", all.@"message/vnd.wfa.wsc" },
    .{ "wsdl", all.@"application/wsdl+xml" },
    .{ "wspolicy", all.@"application/wspolicy+xml" },
    .{ "wtb", all.@"application/vnd.webturbo" },
    .{ "wvx", all.@"video/x-ms-wvx" },
    .{ "x_b", all.@"model/vnd.parasolid.transmit.binary" },
    .{ "x_t", all.@"model/vnd.parasolid.transmit.text" },
    .{ "x32", all.@"application/x-authorware-bin" },
    .{ "x3d", all.@"model/x3d+xml" },
    .{ "x3db", all.@"model/x3d+fastinfoset" },
    .{ "x3dbz", all.@"model/x3d+binary" },
    .{ "x3dv", all.@"model/x3d+vrml" },
    .{ "x3dvz", all.@"model/x3d+vrml" },
    .{ "x3dz", all.@"model/x3d+xml" },
    .{ "xaml", all.@"application/xaml+xml" },
    .{ "xap", all.@"application/x-silverlight-app" },
    .{ "xar", all.@"application/vnd.xara" },
    .{ "xav", all.@"application/xcap-att+xml" },
    .{ "xbap", all.@"application/x-ms-xbap" },
    .{ "xbd", all.@"application/vnd.fujixerox.docuworks.binder" },
    .{ "xbm", all.@"image/x-xbitmap" },
    .{ "xca", all.@"application/xcap-caps+xml" },
    .{ "xcs", all.@"application/calendar+xml" },
    .{ "xdf", all.@"application/xcap-diff+xml" },
    .{ "xdm", all.@"application/vnd.syncml.dm+xml" },
    .{ "xdp", all.@"application/vnd.adobe.xdp+xml" },
    .{ "xdssc", all.@"application/dssc+xml" },
    .{ "xdw", all.@"application/vnd.fujixerox.docuworks" },
    .{ "xel", all.@"application/xcap-el+xml" },
    .{ "xenc", all.@"application/xenc+xml" },
    .{ "xer", all.@"application/patch-ops-error+xml" },
    .{ "xfdf", all.@"application/vnd.adobe.xfdf" },
    .{ "xfdl", all.@"application/vnd.xfdl" },
    .{ "xht", all.@"application/xhtml+xml" },
    .{ "xhtml", all.@"application/xhtml+xml" },
    .{ "xhvml", all.@"application/xv+xml" },
    .{ "xif", all.@"image/vnd.xiff" },
    .{ "xla", all.@"application/vnd.ms-excel" },
    .{ "xlam", all.@"application/vnd.ms-excel.addin.macroenabled.12" },
    .{ "xlc", all.@"application/vnd.ms-excel" },
    .{ "xlf", all.@"application/xliff+xml" },
    .{ "xlm", all.@"application/vnd.ms-excel" },
    .{ "xls", all.@"application/vnd.ms-excel" },
    .{ "xlsb", all.@"application/vnd.ms-excel.sheet.binary.macroenabled.12" },
    .{ "xlsm", all.@"application/vnd.ms-excel.sheet.macroenabled.12" },
    .{ "xlsx", all.@"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    .{ "xlt", all.@"application/vnd.ms-excel" },
    .{ "xltm", all.@"application/vnd.ms-excel.template.macroenabled.12" },
    .{
        "xltx",
        all.@"application/vnd.openxmlformats-officedocument.spreadsheetml.template",
    },
    .{ "xlw", all.@"application/vnd.ms-excel" },
    .{ "xm", all.@"audio/xm" },
    .{ "xml", all.@"application/xml" },
    .{ "xns", all.@"application/xcap-ns+xml" },
    .{ "xo", all.@"application/vnd.olpc-sugar" },
    .{ "xop", all.@"application/xop+xml" },
    .{ "xpi", all.@"application/x-xpinstall" },
    .{ "xpl", all.@"application/xproc+xml" },
    .{ "xpm", all.@"image/x-xpixmap" },
    .{ "xpr", all.@"application/vnd.is-xpr" },
    .{ "xps", all.@"application/vnd.ms-xpsdocument" },
    .{ "xpw", all.@"application/vnd.intercon.formnet" },
    .{ "xpx", all.@"application/vnd.intercon.formnet" },
    .{ "xsd", all.@"application/xml" },
    .{ "xsl", all.@"application/xslt+xml" },
    .{ "xslt", all.@"application/xslt+xml" },
    .{ "xsm", all.@"application/vnd.syncml+xml" },
    .{ "xspf", all.@"application/xspf+xml" },
    .{ "xul", all.@"application/vnd.mozilla.xul+xml" },
    .{ "xvm", all.@"application/xv+xml" },
    .{ "xvml", all.@"application/xv+xml" },
    .{ "xwd", all.@"image/x-xwindowdump" },
    .{ "xyz", all.@"chemical/x-xyz" },
    .{ "xz", all.@"application/x-xz" },
    .{ "yaml", all.@"text/yaml" },
    .{ "yang", all.@"application/yang" },
    .{ "yin", all.@"application/yin+xml" },
    .{ "yml", all.@"text/yaml" },
    .{ "ymp", all.@"text/x-suse-ymp" },
    .{ "z1", all.@"application/x-zmachine" },
    .{ "z2", all.@"application/x-zmachine" },
    .{ "z3", all.@"application/x-zmachine" },
    .{ "z4", all.@"application/x-zmachine" },
    .{ "z5", all.@"application/x-zmachine" },
    .{ "z6", all.@"application/x-zmachine" },
    .{ "z7", all.@"application/x-zmachine" },
    .{ "z8", all.@"application/x-zmachine" },
    .{ "zaz", all.@"application/vnd.zzazz.deck+xml" },
    .{ "zip", all.@"application/zip" },
    .{ "zir", all.@"application/vnd.zul" },
    .{ "zirz", all.@"application/vnd.zul" },
    .{ "zmm", all.@"application/vnd.handheld-entertainment+xml" },
});

const IMAGES_HEADERS = .{
    .{ [_]u8{ 0x42, 0x4d }, all.@"image/bmp" },
    .{ [_]u8{ 0xff, 0xd8, 0xff }, all.@"image/jpeg" },
    .{ [_]u8{ 0x49, 0x49, 0x2a, 0x00 }, all.@"image/tiff" },
    .{ [_]u8{ 0x4d, 0x4d, 0x00, 0x2a }, all.@"image/tiff" },
    .{ [_]u8{ 0x47, 0x49, 0x46, 0x38, 0x39, 0x61 }, all.@"image/gif" },
    .{ [_]u8{ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a }, all.@"image/png" },
};
pub fn sniff(bytes: []const u8) ?MimeType {
    if (bytes.len < 2) return null;

    inline for (IMAGES_HEADERS) |header| {
        if (bytes.len >= header[0].len) {
            if (strings.eqlComptime(bytes[0..header[0].len], header[0])) {
                return header[1];
            }
        }
    }

    return null;
}
