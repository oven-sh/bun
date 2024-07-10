const BoringSSL = bun.BoringSSL;
const bun = @import("root").bun;
const ZigString = JSC.ZigString;
const std = @import("std");
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;

fn x509GetNameObject(globalObject: *JSGlobalObject, name: ?*BoringSSL.X509_NAME) JSValue {
    const cnt = BoringSSL.X509_NAME_entry_count(name);
    if (cnt <= 0) {
        return JSValue.jsUndefined();
    }
    var result = JSValue.createEmptyObject(globalObject, 1);

    for (0..@as(usize, @intCast(cnt))) |i| {
        const entry = BoringSSL.X509_NAME_get_entry(name, @as(c_int, @intCast(i))) orelse continue;
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
            name_slice = type_str[0..bun.len(type_str)];
        } else {
            const length = BoringSSL.OBJ_obj2txt(&type_buf, @sizeOf(@TypeOf(type_buf)), type_, 1);
            if (length <= 0) {
                continue;
            }
            name_slice = type_buf[0..@as(usize, @intCast(length))];
        }

        const value_data = BoringSSL.X509_NAME_ENTRY_get_data(entry);

        var value_str: [*c]u8 = undefined;
        const value_str_len = BoringSSL.ASN1_STRING_to_UTF8(&value_str, value_data);
        if (value_str_len < 0) {
            continue;
        }
        const value_slice = value_str[0..@as(usize, @intCast(value_str_len))];
        defer BoringSSL.OPENSSL_free(value_str);
        // For backward compatibility, we only create arrays if multiple values
        // exist for the same key. That is not great but there is not much we can
        // change here without breaking things. Note that this creates nested data
        // structures, yet still does not allow representing Distinguished Names
        // accurately.
        if (result.getTruthy(globalObject, name_slice)) |value| {
            if (value.jsType().isArray()) {
                value.push(globalObject, JSC.ZigString.fromUTF8(value_slice).toJS(globalObject));
            } else {
                const prop_name = JSC.ZigString.fromUTF8(name_slice);
                const array = JSValue.createEmptyArray(globalObject, 2);
                array.putIndex(globalObject, 0, value);
                array.putIndex(globalObject, 1, JSC.ZigString.fromUTF8(value_slice).toJS(globalObject));
                result.put(globalObject, &prop_name, array);
            }
        } else {
            const prop_name = JSC.ZigString.fromUTF8(name_slice);
            result.put(globalObject, &prop_name, JSC.ZigString.fromUTF8(value_slice).toJS(globalObject));
        }
    }
    return result;
}

pub inline fn isSafeAltName(name: []const u8, utf8: bool) bool {
    for (name) |c| {
        switch (c) {
            '"',
            '\\',
            // These mess with encoding rules.
            // Fall through.
            ',',
            // Commas make it impossible to split the list of subject alternative
            // names unambiguously, which is why we have to escape.
            // Fall through.
            '\'',
            => {
                // Single quotes are unlikely to appear in any legitimate values, but they
                // could be used to make a value look like it was escaped (i.e., enclosed
                // in single/double quotes).
                return false;
            },
            else => {
                if (utf8) {
                    // In UTF8 strings, we require escaping for any ASCII control character,
                    // but NOT for non-ASCII characters. Note that all bytes of any code
                    // point that consists of more than a single byte have their MSB set.
                    if (c < ' ' or c == '\x7f') {
                        return false;
                    }
                } else {
                    // Check if the char is a control character or non-ASCII character. Note
                    // that char may or may not be a signed type. Regardless, non-ASCII
                    // values will always be outside of this range.
                    if (c < ' ' or c > '~') {
                        return false;
                    }
                }
            },
        }
    }
    return true;
}

inline fn printAltName(out: *BoringSSL.BIO, name: []const u8, utf8: bool, safe_prefix: ?[*]const u8) void {
    if (isSafeAltName(name, utf8)) {
        // For backward-compatibility, append "safe" names without any
        // modifications.
        if (safe_prefix) |prefix| {
            _ = BoringSSL.BIO_printf(out, "%s:", prefix);
        }
        _ = BoringSSL.BIO_write(out, @as([*]const u8, @ptrCast(name.ptr)), @as(c_int, @intCast(name.len)));
    } else {
        // If a name is not "safe", we cannot embed it without special
        // encoding. This does not usually happen, but we don't want to hide
        // it from the user either. We use JSON compatible escaping here.
        _ = BoringSSL.BIO_write(out, "\"", 1);
        if (safe_prefix) |prefix| {
            _ = BoringSSL.BIO_printf(out, "%s:", prefix);
        }
        for (name) |c| {
            if (c == '\\') {
                _ = BoringSSL.BIO_write(out, "\\\\", 2);
            } else if (c == '"') {
                _ = BoringSSL.BIO_write(out, "\\\"", 2);
            } else if ((c >= ' ' and c != ',' and c <= '~') or (utf8 and (c & 0x80) != 0)) {
                // Note that the above condition explicitly excludes commas, which means
                // that those are encoded as Unicode escape sequences in the "else"
                // block. That is not strictly necessary, and Node.js itself would parse
                // it correctly either way. We only do this to account for third-party
                // code that might be splitting the string at commas (as Node.js itself
                // used to do).
                _ = BoringSSL.BIO_write(out, bun.cast([*]const u8, &c), 1);
            } else {
                // Control character or non-ASCII character. We treat everything as
                // Latin-1, which corresponds to the first 255 Unicode code points.
                const hex = "0123456789abcdef";
                const u = [_]u8{ '\\', 'u', '0', '0', hex[(c & 0xf0) >> 4], hex[c & 0x0f] };
                _ = BoringSSL.BIO_write(out, &u, @sizeOf(@TypeOf(u)));
            }
        }
        _ = BoringSSL.BIO_write(out, "\"", 1);
    }
}

inline fn printLatin1AltName(out: *BoringSSL.BIO, name: *BoringSSL.ASN1_IA5STRING, safe_prefix: ?[*]const u8) void {
    printAltName(out, name.data[0..@as(usize, @intCast(name.length))], false, safe_prefix);
}

inline fn printUTF8AltName(out: *BoringSSL.BIO, name: *BoringSSL.ASN1_UTF8STRING, safe_prefix: ?[*]const u8) void {
    printAltName(out, name.data[0..@as(usize, @intCast(name.length))], true, safe_prefix);
}

pub const kX509NameFlagsRFC2253WithinUtf8JSON = BoringSSL.XN_FLAG_RFC2253 & ~BoringSSL.ASN1_STRFLGS_ESC_MSB & ~BoringSSL.ASN1_STRFLGS_ESC_CTRL;

// This function emulates the behavior of i2v_GENERAL_NAME in a safer and less
// ambiguous way. "othername:" entries use the GENERAL_NAME_print format.
fn x509PrintGeneralName(out: *BoringSSL.BIO, name: *BoringSSL.GENERAL_NAME) bool {
    if (name.name_type == .GEN_DNS) {
        _ = BoringSSL.BIO_write(out, "DNS:", 4);
        // Note that the preferred name syntax (see RFCs 5280 and 1034) with
        // wildcards is a subset of what we consider "safe", so spec-compliant DNS
        // names will never need to be escaped.
        printLatin1AltName(out, name.d.dNSName, null);
    } else if (name.name_type == .GEN_EMAIL) {
        _ = BoringSSL.BIO_write(out, "email:", 6);
        printLatin1AltName(out, name.d.rfc822Name, null);
    } else if (name.name_type == .GEN_URI) {
        _ = BoringSSL.BIO_write(out, "URI:", 4);
        // The set of "safe" names was designed to include just about any URI,
        // with a few exceptions, most notably URIs that contains commas (see
        // RFC 2396). In other words, most legitimate URIs will not require
        // escaping.
        printLatin1AltName(out, name.d.uniformResourceIdentifier, null);
    } else if (name.name_type == .GEN_DIRNAME) {
        // Earlier versions of Node.js used X509_NAME_oneline to print the X509_NAME
        // object. The format was non standard and should be avoided. The use of
        // X509_NAME_oneline is discouraged by OpenSSL but was required for backward
        // compatibility. Conveniently, X509_NAME_oneline produced ASCII and the
        // output was unlikely to contains commas or other characters that would
        // require escaping. However, it SHOULD NOT produce ASCII output since an
        // RFC5280 AttributeValue may be a UTF8String.
        // Newer versions of Node.js have since switched to X509_NAME_print_ex to
        // produce a better format at the cost of backward compatibility. The new
        // format may contain Unicode characters and it is likely to contain commas,
        // which require escaping. Fortunately, the recently safeguarded function
        // printAltName handles all of that safely.
        _ = BoringSSL.BIO_printf(out, "DirName:");

        const tmp = BoringSSL.BIO_new(BoringSSL.BIO_s_mem()) orelse return false;

        if (BoringSSL.X509_NAME_print_ex(tmp, name.d.dirn, 0, kX509NameFlagsRFC2253WithinUtf8JSON) < 0) {
            return false;
        }
        var oline: [*]const u8 = undefined;
        const n_bytes = BoringSSL.BIO_get_mem_data(tmp, @as([*c][*c]u8, @ptrCast(&oline)));
        if (n_bytes <= 0) return false;
        printAltName(out, oline[0..@as(usize, @intCast(n_bytes))], true, null);
    } else if (name.name_type == .GEN_OTHERNAME) {
        // The format that is used here is based on OpenSSL's implementation of
        // GENERAL_NAME_print (as of OpenSSL 3.0.1). Earlier versions of Node.js
        // instead produced the same format as i2v_GENERAL_NAME, which was somewhat
        // awkward, especially when passed to translatePeerCertificate.
        var unicode: bool = true;
        var prefix: ?[*]const u8 = null;

        const nid = BoringSSL.OBJ_obj2nid(name.d.otherName.type_id);
        switch (nid) {
            BoringSSL.NID_id_on_SmtpUTF8Mailbox => {
                prefix = "SmtpUTF8Mailbox";
            },
            BoringSSL.NID_XmppAddr => {
                prefix = "XmppAddr";
            },
            BoringSSL.NID_SRVName => {
                prefix = "SRVName";
                unicode = false;
            },
            BoringSSL.NID_ms_upn => {
                prefix = "UPN";
            },
            BoringSSL.NID_NAIRealm => {
                prefix = "NAIRealm";
            },
            else => {
                prefix = null;
            },
        }
        if (name.d.otherName.value) |v| {
            const val_type = v.type;
            if (prefix == null or
                (unicode and val_type != BoringSSL.V_ASN1_UTF8STRING) or
                (!unicode and val_type != BoringSSL.V_ASN1_IA5STRING))
            {
                _ = BoringSSL.BIO_printf(out, "othername:<unsupported>");
            } else {
                _ = BoringSSL.BIO_printf(out, "othername:");
                if (unicode) {
                    printUTF8AltName(out, v.value.utf8string, prefix);
                } else {
                    printLatin1AltName(out, v.value.ia5string, prefix);
                }
            }
        } else {
            _ = BoringSSL.BIO_printf(out, "othername:<unsupported>");
        }
    } else if (name.name_type == .GEN_IPADD) {
        _ = BoringSSL.BIO_printf(out, "IP Address:");
        const ip = name.d.ip;
        const b = ip.data;
        if (ip.length == 4) {
            _ = BoringSSL.BIO_printf(out, "%d.%d.%d.%d", b[0], b[1], b[2], b[3]);
        } else if (ip.length == 16) {
            for (0..8) |j| {
                const pair: u16 = (@as(u16, @intCast(b[2 * j])) << 8) | @as(u16, @intCast(b[2 * j + 1]));
                _ = BoringSSL.BIO_printf(out, if (j == 0) "%X" else ":%X", pair);
            }
        } else {
            _ = BoringSSL.BIO_printf(out, "<invalid length=%d>", ip.length);
        }
    } else if (name.name_type == .GEN_RID) {
        // Unlike OpenSSL's default implementation, never print the OID as text and
        // instead always print its numeric representation.
        var oline: [256]u8 = undefined;
        _ = BoringSSL.OBJ_obj2txt(&oline, @sizeOf(@TypeOf(oline)), name.d.rid, 1);
        // Workaround for https://github.com/ziglang/zig/issues/16197
        _ = BoringSSL.BIO_printf(out, "Registered ID:%s", @as([*]const u8, &oline));
    } else if (name.name_type == .GEN_X400) {
        _ = BoringSSL.BIO_printf(out, "X400Name:<unsupported>");
    } else if (name.name_type == .GEN_EDIPARTY) {
        _ = BoringSSL.BIO_printf(out, "EdiPartyName:<unsupported>");
    } else {
        return false;
    }
    return true;
}

fn x509InfoAccessPrint(out: *BoringSSL.BIO, ext: *BoringSSL.X509_EXTENSION) bool {
    const method = BoringSSL.X509V3_EXT_get(ext);
    if (method != BoringSSL.X509V3_EXT_get_nid(BoringSSL.NID_info_access)) {
        return false;
    }

    if (BoringSSL.X509V3_EXT_d2i(ext)) |descs_| {
        const descs: *BoringSSL.AUTHORITY_INFO_ACCESS = bun.cast(*BoringSSL.AUTHORITY_INFO_ACCESS, descs_);
        defer BoringSSL.sk_ACCESS_DESCRIPTION_pop_free(descs, BoringSSL.sk_ACCESS_DESCRIPTION_free);
        for (0..BoringSSL.sk_ACCESS_DESCRIPTION_num(descs)) |i| {
            const gen = BoringSSL.sk_ACCESS_DESCRIPTION_value(descs, i);
            if (gen) |desc| {
                if (i != 0) {
                    _ = BoringSSL.BIO_write(out, "\n", 1);
                }
                var tmp: [80]u8 = undefined;
                _ = BoringSSL.i2t_ASN1_OBJECT(&tmp, @sizeOf(@TypeOf(tmp)), desc.method);
                // Workaround for https://github.com/ziglang/zig/issues/16197
                _ = BoringSSL.BIO_printf(out, "%s - ", @as([*]const u8, &tmp));

                if (!x509PrintGeneralName(out, desc.location)) {
                    return false;
                }
            }
        }
        return true;
    }
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
            if (gen) |gen_name| {
                if (i != 0) {
                    _ = BoringSSL.BIO_write(out, ", ", 2);
                }

                if (!x509PrintGeneralName(out, gen_name)) {
                    return false;
                }
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

    defer _ = BoringSSL.BIO_reset(bio);

    const ext = BoringSSL.X509_get_ext(cert, index) orelse return JSValue.jsUndefined();

    if (!x509SubjectAltNamePrint(bio, ext)) {
        return JSValue.jsNull();
    }

    return JSC.ZigString.fromUTF8(bio.slice()).toJS(globalObject);
}

fn x509GetInfoAccessString(globalObject: *JSGlobalObject, bio: *BoringSSL.BIO, cert: *BoringSSL.X509) JSValue {
    const index = BoringSSL.X509_get_ext_by_NID(cert, BoringSSL.NID_info_access, -1);
    if (index < 0)
        return JSValue.jsUndefined();
    defer _ = BoringSSL.BIO_reset(bio);
    const ext = BoringSSL.X509_get_ext(cert, index) orelse return JSValue.jsUndefined();

    if (!x509InfoAccessPrint(bio, ext)) {
        return JSValue.jsNull();
    }

    return JSC.ZigString.fromUTF8(bio.slice()).toJS(globalObject);
}

fn addFingerprintDigest(md: []const u8, mdSize: c_uint, fingerprint: []u8) usize {
    const hex: []const u8 = "0123456789ABCDEF";
    var idx: usize = 0;

    const slice = md[0..@as(usize, @intCast(mdSize))];
    for (slice) |byte| {
        fingerprint[idx] = hex[(byte & 0xF0) >> 4];
        fingerprint[idx + 1] = hex[byte & 0x0F];
        fingerprint[idx + 2] = ':';
        idx += 3;
    }
    const length = if (idx > 0) (idx - 1) else 0;
    fingerprint[length] = 0;
    return length;
}

fn getFingerprintDigest(cert: *BoringSSL.X509, method: *const BoringSSL.EVP_MD, globalObject: *JSGlobalObject) JSValue {
    var md: [BoringSSL.EVP_MAX_MD_SIZE]u8 = undefined;
    var md_size: c_uint = 0;
    var fingerprint: [BoringSSL.EVP_MAX_MD_SIZE * 3]u8 = undefined;

    if (BoringSSL.X509_digest(cert, method, @as([*c]u8, @ptrCast(&md)), &md_size) != 0) {
        const length = addFingerprintDigest(&md, md_size, &fingerprint);
        return JSC.ZigString.fromUTF8(fingerprint[0..length]).toJS(globalObject);
    }
    return JSValue.jsUndefined();
}

fn getSerialNumber(cert: *BoringSSL.X509, globalObject: *JSGlobalObject) JSValue {
    const serial_number = BoringSSL.X509_get_serialNumber(cert);
    if (serial_number != null) {
        const bignum = BoringSSL.ASN1_INTEGER_to_BN(serial_number, null);
        if (bignum != null) {
            const data = BoringSSL.BN_bn2hex(bignum);
            if (data != null) {
                const slice = data[0..bun.len(data)];
                // BoringSSL prints the hex value of the serialNumber in lower case, but we need upper case
                toUpper(slice);
                return JSC.ZigString.fromUTF8(slice).toJS(globalObject);
            }
        }
    }
    return JSValue.jsUndefined();
}

fn getRawDERCertificate(cert: *BoringSSL.X509, globalObject: *JSGlobalObject) JSValue {
    const size = BoringSSL.i2d_X509(cert, null);
    var buffer = JSValue.createBufferFromLength(globalObject, @as(usize, @intCast(size)));
    var buffer_ptr = buffer.asArrayBuffer(globalObject).?.ptr;
    const result_size = BoringSSL.i2d_X509(cert, &buffer_ptr);
    bun.assert(result_size == size);
    return buffer;
}

fn toUpper(slice: []u8) void {
    for (0..slice.len) |i| {
        const c = slice[i];
        if (c >= 'a' and c <= 'z') {
            slice[i] &= 223;
        }
    }
}

pub fn toJS(cert: *BoringSSL.X509, globalObject: *JSGlobalObject) JSValue {
    const bio = BoringSSL.BIO_new(BoringSSL.BIO_s_mem()) orelse {
        globalObject.throw("Failed to create BIO", .{});
        return .zero;
    };
    defer _ = BoringSSL.BIO_free(bio);
    var result = JSValue.createEmptyObject(globalObject, 8);
    // X509_check_ca() returns a range of values. Only 1 means "is a CA"
    const is_ca = BoringSSL.X509_check_ca(cert) == 1;
    const subject = BoringSSL.X509_get_subject_name(cert);
    result.put(globalObject, ZigString.static("subject"), x509GetNameObject(globalObject, subject));
    const issuer = BoringSSL.X509_get_issuer_name(cert);
    result.put(globalObject, ZigString.static("issuer"), x509GetNameObject(globalObject, issuer));
    result.put(globalObject, ZigString.static("subjectaltname"), x509GetSubjectAltNameString(globalObject, bio, cert));
    result.put(globalObject, ZigString.static("infoAccess"), x509GetInfoAccessString(globalObject, bio, cert));
    result.put(globalObject, ZigString.static("ca"), JSValue.jsBoolean(is_ca));

    const pkey = BoringSSL.X509_get_pubkey(cert);

    switch (BoringSSL.EVP_PKEY_id(pkey)) {
        BoringSSL.EVP_PKEY_RSA => {
            const rsa_key = BoringSSL.EVP_PKEY_get1_RSA(pkey);
            if (rsa_key) |rsa| {
                var n: [*c]const BoringSSL.BIGNUM = undefined;
                var e: [*c]const BoringSSL.BIGNUM = undefined;
                BoringSSL.RSA_get0_key(rsa, @as([*c][*c]const BoringSSL.BIGNUM, @ptrCast(&n)), @as([*c][*c]const BoringSSL.BIGNUM, @ptrCast(&e)), null);
                _ = BoringSSL.BN_print(bio, n);

                var bits = JSValue.jsUndefined();

                const bits_value = BoringSSL.BN_num_bits(n);
                if (bits_value > 0) {
                    bits = JSValue.jsNumber(bits_value);
                }

                result.put(globalObject, ZigString.static("bits"), bits);
                const slice = bio.slice();
                // BoringSSL prints the hex value of the modulus in lower case, but we need upper case
                toUpper(slice);
                const modulus = JSC.ZigString.fromUTF8(slice).toJS(globalObject);
                _ = BoringSSL.BIO_reset(bio);
                result.put(globalObject, ZigString.static("modulus"), modulus);

                const exponent_word = BoringSSL.BN_get_word(e);
                _ = BoringSSL.BIO_printf(bio, "0x" ++ BoringSSL.BN_HEX_FMT1, exponent_word);
                const exponent = JSC.ZigString.fromUTF8(bio.slice()).toJS(globalObject);
                _ = BoringSSL.BIO_reset(bio);
                result.put(globalObject, ZigString.static("exponent"), exponent);

                const size = BoringSSL.i2d_RSA_PUBKEY(rsa, null);
                if (size <= 0) {
                    globalObject.throw("Failed to get public key length", .{});
                    return .zero;
                }

                var buffer = JSValue.createBufferFromLength(globalObject, @as(usize, @intCast(size)));
                var buffer_ptr = @as([*c]u8, @ptrCast(buffer.asArrayBuffer(globalObject).?.ptr));

                _ = BoringSSL.i2d_RSA_PUBKEY(rsa, &buffer_ptr);

                result.put(globalObject, ZigString.static("pubkey"), buffer);
            }
        },
        BoringSSL.EVP_PKEY_EC => {
            const ec_key = BoringSSL.EVP_PKEY_get1_EC_KEY(pkey);
            if (ec_key) |ec| {
                const group = BoringSSL.EC_KEY_get0_group(ec);
                var bits = JSValue.jsUndefined();
                if (group) |g| {
                    const bits_value = BoringSSL.EC_GROUP_order_bits(g);
                    if (bits_value > 0) {
                        bits = JSValue.jsNumber(bits_value);
                    }
                }
                result.put(globalObject, ZigString.static("bits"), bits);

                const ec_pubkey = BoringSSL.EC_KEY_get0_public_key(ec);
                if (ec_pubkey) |point| {
                    const form = BoringSSL.EC_KEY_get_conv_form(ec);
                    const size = BoringSSL.EC_POINT_point2oct(group, point, form, null, 0, null);
                    if (size <= 0) {
                        globalObject.throw("Failed to get public key length", .{});
                        return .zero;
                    }

                    var buffer = JSValue.createBufferFromLength(globalObject, @as(usize, @intCast(size)));
                    const buffer_ptr = @as([*c]u8, @ptrCast(buffer.asArrayBuffer(globalObject).?.ptr));

                    const result_size = BoringSSL.EC_POINT_point2oct(group, point, form, buffer_ptr, size, null);
                    bun.assert(result_size == size);
                    result.put(globalObject, ZigString.static("pubkey"), buffer);
                } else {
                    result.put(globalObject, ZigString.static("pubkey"), JSValue.jsUndefined());
                }
                const nid = BoringSSL.EC_GROUP_get_curve_name(group);

                if (nid != 0) {
                    // Curve is well-known, get its OID and NIST nick-name (if it has one).
                    const asn1Curve_str = BoringSSL.OBJ_nid2sn(nid);
                    if (asn1Curve_str != null) {
                        result.put(globalObject, ZigString.static("asn1Curve"), JSC.ZigString.fromUTF8(asn1Curve_str[0..bun.len(asn1Curve_str)]).toJS(globalObject));
                    }
                    const nistCurve_str = BoringSSL.EC_curve_nid2nist(nid);
                    if (nistCurve_str != null) {
                        result.put(globalObject, ZigString.static("nistCurve"), JSC.ZigString.fromUTF8(nistCurve_str[0..bun.len(nistCurve_str)]).toJS(globalObject));
                    }
                }
            }
        },
        else => {},
    }
    _ = BoringSSL.ASN1_TIME_print(bio, BoringSSL.X509_get0_notBefore(cert));
    result.put(globalObject, ZigString.static("valid_from"), JSC.ZigString.fromUTF8(bio.slice()).toJS(globalObject));
    _ = BoringSSL.BIO_reset(bio);

    _ = BoringSSL.ASN1_TIME_print(bio, BoringSSL.X509_get0_notAfter(cert));
    result.put(globalObject, ZigString.static("valid_to"), JSC.ZigString.fromUTF8(bio.slice()).toJS(globalObject));
    _ = BoringSSL.BIO_reset(bio);

    result.put(globalObject, ZigString.static("fingerprint"), getFingerprintDigest(cert, BoringSSL.EVP_sha1(), globalObject));
    result.put(globalObject, ZigString.static("fingerprint256"), getFingerprintDigest(cert, BoringSSL.EVP_sha256(), globalObject));
    result.put(globalObject, ZigString.static("fingerprint512"), getFingerprintDigest(cert, BoringSSL.EVP_sha512(), globalObject));
    result.put(globalObject, ZigString.static("serialNumber"), getSerialNumber(cert, globalObject));
    result.put(globalObject, ZigString.static("raw"), getRawDERCertificate(cert, globalObject));
    return result;
}
