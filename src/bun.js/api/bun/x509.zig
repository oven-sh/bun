
const BoringSSL = bun.BoringSSL;
const bun = @import("root").bun;
const ZigString = JSC.ZigString;
const std = @import("std");
const JSC = @import("root").bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;

fn x509GetNameObject(globalObject: *JSGlobalObject, name: ?*BoringSSL.X509_NAME) JSValue {
    const cnt = BoringSSL.X509_NAME_entry_count(name);
    if (cnt <= 0) {
        return JSValue.jsUndefined();
    }
    var result = JSValue.createEmptyObject(globalObject, 1);

    for (0..cnt) |i| {
        const entry = BoringSSL.X509_NAME_get_entry(name, i) orelse continue;
        // We intentionally ignore the value of X509_NAME_ENTRY_set because the
        // representation as an object does not allow grouping entries into sets
        // anyway, and multi-value RDNs are rare, i.e., the vast majority of
        // Relative Distinguished Names contains a single type-value pair only.
        const type_ = BoringSSL.X509_NAME_ENTRY_get_object(entry);

        // If BoringSSL knows the type, use the short name of the type as the key, and
        // the numeric representation of the type's OID otherwise.
        const type_nid = BoringSSL.OBJ_obj2nid(type_);
        var type_buf: [80]u8 = undefined;
        var name_slice: []const u8 = undefined;
        if (type_nid != BoringSSL.NID_undef) {
            const type_str = BoringSSL.OBJ_nid2sn(type_nid);
            if (type_str == null) {
                continue;
            }
            name_slice = type_str.ptr[0..bun.len(type_str)];
        } else {
            const length = BoringSSL.OBJ_obj2txt(type_buf, @sizeOf(type_buf), type_, true);
            if (length <= 0) {
                continue;
            }
            name_slice = type_buf.ptr[0..length];
        }

        const value_data = BoringSSL.X509_NAME_ENTRY_get_data(entry);

        var value_str: []const u8 = undefined;
        const value_str_len = BoringSSL.ASN1_STRING_to_UTF8(&value_str, value_data);
        if (value_str_len < 0) {
            continue;
        }
        const value_slice = value_str.ptr[0..value_str_len];
        // For backward compatibility, we only create arrays if multiple values
        // exist for the same key. That is not great but there is not much we can
        // change here without breaking things. Note that this creates nested data
        // structures, yet still does not allow representing Distinguished Names
        // accurately.
        if (result.getTruthy(globalObject, name_slice)) |value| {
            if (value.jsType().isArray()) {
                value.push(globalObject, JSC.ZigString.fromUTF8(value_slice).toValueGC(globalObject));
            } else {
                const prop_name = JSC.ZigString.fromUTF8(name_slice);
                const array = JSValue.createEmptyArray(globalObject, 2);
                array.putIndex(globalObject, 0, value);
                array.putIndex(globalObject, 1, JSC.ZigString.fromUTF8(value_slice).toValueGC(globalObject));
                result.put(globalObject, &prop_name, array);
            }
        } else {
            const prop_name = JSC.ZigString.fromUTF8(name_slice);
            result.put(globalObject, &prop_name, JSC.ZigString.fromUTF8(value_slice).toValueGC(globalObject));
        }
    }
    return result;
}

fn x509PrintGeneralName(out: *BoringSSL.BIO, name: *BoringSSL.GENERAL_NAME) bool {
    _ = out;
    _ = name;
    return false;
}
fn x509SubjectAltNamePrint(out: *BoringSSL.BIO, ext: *BoringSSL.X509_EXTENSION) bool {
    const method = BoringSSL.X509V3_EXT_get(ext);
    if (method != BoringSSL.X509V3_EXT_get_nid(BoringSSL.NID_subject_alt_name)) {
        return false;
    }

    if (BoringSSL.X509V3_EXT_d2i(ext)) |names_| {
        const names: *BoringSSL.struct_stack_st_GENERAL_NAME = bun.cast(*BoringSSL.struct_stack_st_GENERAL_NAME, names_);
        defer BoringSSL.sk_GENERAL_NAME_pop_free(names, BoringSSL.sk_GENERAL_NAME_free);
        for (0..BoringSSL.sk_GENERAL_NAME_num(names)) |i| {
            const gen = BoringSSL.sk_GENERAL_NAME_value(names, i);

            if (i != 0) {
                _ = BoringSSL.BIO_write(out, ", ", 2);
            }

            if (x509PrintGeneralName(out, gen)) {
                return false;
            }
        }

        return true;
    }
    return false;
}

fn x509GetSubjectAltNameString(globalObject: *JSGlobalObject, bio: *BoringSSL.BIO, cert: *BoringSSL.X509) JSValue {
    const index = BoringSSL.X509_get_ext_by_NID(cert, BoringSSL.NID_subject_alt_name, -1);
    if (index < 0)
        return JSValue.jsUndefined();

    const ext = BoringSSL.X509_get_ext(cert, index) orelse return JSValue.jsUndefined();

    if (!x509SubjectAltNamePrint(bio, ext)) {
        _ = BoringSSL.BIO_reset(bio);
        return JSValue.jsNull();
    }

    return JSC.ZigString.fromUTF8(bio.slice()).toValueGC(globalObject);
}

pub fn toJS(cert: *BoringSSL.X509, globalObject: *JSGlobalObject) JSValue {
    const bio = BoringSSL.BIO_new(BoringSSL.BIO_s_mem()) orelse {
        globalObject.throw("Failed to create BIO", .{});
        return .zero;
    };
    defer BoringSSL.BIO_free(bio);
    var result = JSValue.createEmptyObject(globalObject, 1);

    // const result = JSC.JSObject.create(globalObject, .{});
    if (BoringSSL.X509_check_ca(cert) == 1) {
        // subject
        const subject = BoringSSL.X509_get_subject_name(cert);
        result.put(globalObject, ZigString.static("subject"), x509GetNameObject(globalObject, subject));
        const issuer = BoringSSL.X509_get_issuer_name(cert);
        result.put(globalObject, ZigString.static("issuer"), x509GetNameObject(globalObject, issuer));
        result.put(globalObject, ZigString.static("subjectAltName", x509GetSubjectAltNameString(globalObject, bio, cert)));
    }

    return result;
}
