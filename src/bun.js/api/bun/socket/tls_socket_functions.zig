const This = JSC.API.TLSSocket;

pub fn getServername(this: *This, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    const ssl_ptr = this.socket.ssl();

    const servername = BoringSSL.SSL_get_servername(ssl_ptr, BoringSSL.TLSEXT_NAMETYPE_host_name);
    if (servername == null) {
        return .js_undefined;
    }
    return ZigString.fromUTF8(servername[0..bun.len(servername)]).toJS(globalObject);
}

pub fn setServername(this: *This, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    if (this.handlers.is_server) {
        return globalObject.throw("Cannot issue SNI from a TLS server-side socket", .{});
    }

    const args = callframe.arguments_old(1);
    if (args.len < 1) {
        return globalObject.throw("Expected 1 argument", .{});
    }

    const server_name = args.ptr[0];
    if (!server_name.isString()) {
        return globalObject.throw("Expected \"serverName\" to be a string", .{});
    }

    const slice = try (try server_name.getZigString(globalObject)).toOwnedSlice(bun.default_allocator);
    if (this.server_name) |old| {
        this.server_name = slice;
        default_allocator.free(old);
    } else {
        this.server_name = slice;
    }

    const host = slice;
    if (host.len > 0) {
        var ssl_ptr = this.socket.ssl() orelse return .js_undefined;

        if (ssl_ptr.isInitFinished()) {
            // match node.js exceptions
            return globalObject.throw("Already started.", .{});
        }
        const host__ = default_allocator.dupeZ(u8, host) catch bun.outOfMemory();
        defer default_allocator.free(host__);
        ssl_ptr.setHostname(host__);
    }

    return .js_undefined;
}

pub fn getPeerX509Certificate(this: *This, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    const ssl_ptr = this.socket.ssl() orelse return .js_undefined;
    const cert = BoringSSL.SSL_get_peer_certificate(ssl_ptr);
    if (cert) |x509| {
        return X509.toJSObject(x509, globalObject);
    }
    return .js_undefined;
}

pub fn getX509Certificate(this: *This, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    const ssl_ptr = this.socket.ssl() orelse return .js_undefined;
    const cert = BoringSSL.SSL_get_certificate(ssl_ptr);
    if (cert) |x509| {
        return X509.toJSObject(x509.ref(), globalObject);
    }
    return .js_undefined;
}

pub fn getTLSVersion(this: *This, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    JSC.markBinding(@src());

    const ssl_ptr = this.socket.ssl() orelse return JSValue.jsNull();
    const version = BoringSSL.SSL_get_version(ssl_ptr);
    if (version == null) return JSValue.jsNull();
    const version_len = bun.len(version);
    if (version_len == 0) return JSValue.jsNull();
    const slice = version[0..version_len];
    return ZigString.fromUTF8(slice).toJS(globalObject);
}

pub fn setMaxSendFragment(this: *This, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    JSC.markBinding(@src());

    const args = callframe.arguments_old(1);

    if (args.len < 1) {
        return globalObject.throw("Expected size to be a number", .{});
    }

    const arg = args.ptr[0];
    if (!arg.isNumber()) {
        return globalObject.throw("Expected size to be a number", .{});
    }
    const size = args.ptr[0].coerceToInt64(globalObject);
    if (size < 1) {
        return globalObject.throw("Expected size to be greater than 1", .{});
    }
    if (size > 16384) {
        return globalObject.throw("Expected size to be less than 16385", .{});
    }

    const ssl_ptr = this.socket.ssl() orelse return JSValue.jsBoolean(false);
    return JSValue.jsBoolean(BoringSSL.SSL_set_max_send_fragment(ssl_ptr, @as(usize, @intCast(size))) == 1);
}

pub fn getPeerCertificate(this: *This, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    JSC.markBinding(@src());

    const args = callframe.arguments_old(1);
    var abbreviated: bool = true;
    if (args.len > 0) {
        const arg = args.ptr[0];
        if (!arg.isBoolean()) {
            return globalObject.throw("Expected abbreviated to be a boolean", .{});
        }
        abbreviated = arg.toBoolean();
    }

    const ssl_ptr = this.socket.ssl() orelse return .js_undefined;

    if (abbreviated) {
        if (this.handlers.is_server) {
            const cert = BoringSSL.SSL_get_peer_certificate(ssl_ptr);
            if (cert) |x509| {
                return X509.toJS(x509, globalObject);
            }
        }

        const cert_chain = BoringSSL.SSL_get_peer_cert_chain(ssl_ptr) orelse return .js_undefined;
        const cert = BoringSSL.sk_X509_value(cert_chain, 0) orelse return .js_undefined;
        return X509.toJS(cert, globalObject);
    }
    var cert: ?*BoringSSL.X509 = null;
    if (this.handlers.is_server) {
        cert = BoringSSL.SSL_get_peer_certificate(ssl_ptr);
    }

    const cert_chain = BoringSSL.SSL_get_peer_cert_chain(ssl_ptr);
    const first_cert = if (cert) |c| c else if (cert_chain) |cc| BoringSSL.sk_X509_value(cc, 0) else null;

    if (first_cert == null) {
        return .js_undefined;
    }

    // TODO: we need to support the non abbreviated version of this
    return .js_undefined;
}

pub fn getCertificate(this: *This, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    const ssl_ptr = this.socket.ssl() orelse return .js_undefined;
    const cert = BoringSSL.SSL_get_certificate(ssl_ptr);

    if (cert) |x509| {
        return X509.toJS(x509, globalObject);
    }
    return .js_undefined;
}

pub fn getTLSFinishedMessage(this: *This, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    const ssl_ptr = this.socket.ssl() orelse return .js_undefined;
    // We cannot just pass nullptr to SSL_get_finished()
    // because it would further be propagated to memcpy(),
    // where the standard requirements as described in ISO/IEC 9899:2011
    // sections 7.21.2.1, 7.21.1.2, and 7.1.4, would be violated.
    // Thus, we use a dummy byte.
    var dummy: [1]u8 = undefined;
    const size = BoringSSL.SSL_get_finished(ssl_ptr, @as(*anyopaque, @ptrCast(&dummy)), @sizeOf(@TypeOf(dummy)));
    if (size == 0) return .js_undefined;

    const buffer_size = @as(usize, @intCast(size));
    var buffer = JSValue.createBufferFromLength(globalObject, buffer_size);
    const buffer_ptr = @as(*anyopaque, @ptrCast(buffer.asArrayBuffer(globalObject).?.ptr));

    const result_size = BoringSSL.SSL_get_finished(ssl_ptr, buffer_ptr, buffer_size);
    bun.assert(result_size == size);
    return buffer;
}

pub fn getSharedSigalgs(this: *This, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    JSC.markBinding(@src());

    const ssl_ptr = this.socket.ssl() orelse return JSValue.jsNull();

    const nsig = BoringSSL.SSL_get_shared_sigalgs(ssl_ptr, 0, null, null, null, null, null);

    const array = try JSC.JSValue.createEmptyArray(globalObject, @as(usize, @intCast(nsig)));

    for (0..@as(usize, @intCast(nsig))) |i| {
        var hash_nid: c_int = 0;
        var sign_nid: c_int = 0;
        var sig_with_md: []const u8 = "";

        _ = BoringSSL.SSL_get_shared_sigalgs(ssl_ptr, @as(c_int, @intCast(i)), &sign_nid, &hash_nid, null, null, null);
        switch (sign_nid) {
            BoringSSL.EVP_PKEY_RSA => {
                sig_with_md = "RSA";
            },
            BoringSSL.EVP_PKEY_RSA_PSS => {
                sig_with_md = "RSA-PSS";
            },

            BoringSSL.EVP_PKEY_DSA => {
                sig_with_md = "DSA";
            },

            BoringSSL.EVP_PKEY_EC => {
                sig_with_md = "ECDSA";
            },

            BoringSSL.NID_ED25519 => {
                sig_with_md = "Ed25519";
            },

            BoringSSL.NID_ED448 => {
                sig_with_md = "Ed448";
            },
            BoringSSL.NID_id_GostR3410_2001 => {
                sig_with_md = "gost2001";
            },

            BoringSSL.NID_id_GostR3410_2012_256 => {
                sig_with_md = "gost2012_256";
            },
            BoringSSL.NID_id_GostR3410_2012_512 => {
                sig_with_md = "gost2012_512";
            },
            else => {
                const sn_str = BoringSSL.OBJ_nid2sn(sign_nid);
                if (sn_str != null) {
                    sig_with_md = sn_str[0..bun.len(sn_str)];
                } else {
                    sig_with_md = "UNDEF";
                }
            },
        }

        const hash_str = BoringSSL.OBJ_nid2sn(hash_nid);
        if (hash_str != null) {
            const hash_str_len = bun.len(hash_str);
            const hash_slice = hash_str[0..hash_str_len];
            const buffer = bun.default_allocator.alloc(u8, sig_with_md.len + hash_str_len + 1) catch bun.outOfMemory();
            defer bun.default_allocator.free(buffer);

            bun.copy(u8, buffer, sig_with_md);
            buffer[sig_with_md.len] = '+';
            bun.copy(u8, buffer[sig_with_md.len + 1 ..], hash_slice);
            array.putIndex(globalObject, @as(u32, @intCast(i)), JSC.ZigString.fromUTF8(buffer).toJS(globalObject));
        } else {
            const buffer = bun.default_allocator.alloc(u8, sig_with_md.len + 6) catch bun.outOfMemory();
            defer bun.default_allocator.free(buffer);

            bun.copy(u8, buffer, sig_with_md);
            bun.copy(u8, buffer[sig_with_md.len..], "+UNDEF");
            array.putIndex(globalObject, @as(u32, @intCast(i)), JSC.ZigString.fromUTF8(buffer).toJS(globalObject));
        }
    }
    return array;
}

pub fn getCipher(this: *This, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    const ssl_ptr = this.socket.ssl() orelse return .js_undefined;
    const cipher = BoringSSL.SSL_get_current_cipher(ssl_ptr);
    var result = JSValue.createEmptyObject(globalObject, 3);

    if (cipher == null) {
        result.put(globalObject, ZigString.static("name"), JSValue.jsNull());
        result.put(globalObject, ZigString.static("standardName"), JSValue.jsNull());
        result.put(globalObject, ZigString.static("version"), JSValue.jsNull());
        return result;
    }

    const name = BoringSSL.SSL_CIPHER_get_name(cipher);
    if (name == null) {
        result.put(globalObject, ZigString.static("name"), JSValue.jsNull());
    } else {
        result.put(globalObject, ZigString.static("name"), ZigString.fromUTF8(name[0..bun.len(name)]).toJS(globalObject));
    }

    const standard_name = BoringSSL.SSL_CIPHER_standard_name(cipher);
    if (standard_name == null) {
        result.put(globalObject, ZigString.static("standardName"), JSValue.jsNull());
    } else {
        result.put(globalObject, ZigString.static("standardName"), ZigString.fromUTF8(standard_name[0..bun.len(standard_name)]).toJS(globalObject));
    }

    const version = BoringSSL.SSL_CIPHER_get_version(cipher);
    if (version == null) {
        result.put(globalObject, ZigString.static("version"), JSValue.jsNull());
    } else {
        result.put(globalObject, ZigString.static("version"), ZigString.fromUTF8(version[0..bun.len(version)]).toJS(globalObject));
    }

    return result;
}

pub fn getTLSPeerFinishedMessage(this: *This, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    const ssl_ptr = this.socket.ssl() orelse return .js_undefined;
    // We cannot just pass nullptr to SSL_get_peer_finished()
    // because it would further be propagated to memcpy(),
    // where the standard requirements as described in ISO/IEC 9899:2011
    // sections 7.21.2.1, 7.21.1.2, and 7.1.4, would be violated.
    // Thus, we use a dummy byte.
    var dummy: [1]u8 = undefined;
    const size = BoringSSL.SSL_get_peer_finished(ssl_ptr, @as(*anyopaque, @ptrCast(&dummy)), @sizeOf(@TypeOf(dummy)));
    if (size == 0) return .js_undefined;

    const buffer_size = @as(usize, @intCast(size));
    var buffer = JSValue.createBufferFromLength(globalObject, buffer_size);
    const buffer_ptr = @as(*anyopaque, @ptrCast(buffer.asArrayBuffer(globalObject).?.ptr));

    const result_size = BoringSSL.SSL_get_peer_finished(ssl_ptr, buffer_ptr, buffer_size);
    bun.assert(result_size == size);
    return buffer;
}

pub fn exportKeyingMaterial(this: *This, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    if (this.socket.isDetached()) {
        return .js_undefined;
    }

    const args = callframe.arguments_old(3);
    if (args.len < 2) {
        return globalObject.throw("Expected length and label to be provided", .{});
    }
    const length_arg = args.ptr[0];
    if (!length_arg.isNumber()) {
        return globalObject.throw("Expected length to be a number", .{});
    }

    const length = length_arg.coerceToInt64(globalObject);
    if (length < 0) {
        return globalObject.throw("Expected length to be a positive number", .{});
    }

    const label_arg = args.ptr[1];
    if (!label_arg.isString()) {
        return globalObject.throw("Expected label to be a string", .{});
    }

    var label = try label_arg.toSliceOrNull(globalObject);

    defer label.deinit();
    const label_slice = label.slice();
    const ssl_ptr = this.socket.ssl() orelse return .js_undefined;

    if (args.len > 2) {
        const context_arg = args.ptr[2];

        var arena: bun.ArenaAllocator = bun.ArenaAllocator.init(bun.default_allocator);
        defer arena.deinit();

        if (try JSC.Node.StringOrBuffer.fromJS(globalObject, arena.allocator(), context_arg)) |sb| {
            defer sb.deinit();
            const context_slice = sb.slice();

            const buffer_size = @as(usize, @intCast(length));
            var buffer = JSValue.createBufferFromLength(globalObject, buffer_size);
            const buffer_ptr = @as([*c]u8, @ptrCast(buffer.asArrayBuffer(globalObject).?.ptr));

            const result = BoringSSL.SSL_export_keying_material(ssl_ptr, buffer_ptr, buffer_size, @as([*c]const u8, @ptrCast(label_slice.ptr)), label_slice.len, @as([*c]const u8, @ptrCast(context_slice.ptr)), context_slice.len, 1);
            if (result != 1) {
                return globalObject.throwValue(getSSLException(globalObject, "Failed to export keying material"));
            }
            return buffer;
        } else {
            return globalObject.throw("Expected context to be a string, Buffer or TypedArray", .{});
        }
    } else {
        const buffer_size = @as(usize, @intCast(length));
        var buffer = JSValue.createBufferFromLength(globalObject, buffer_size);
        const buffer_ptr = @as([*c]u8, @ptrCast(buffer.asArrayBuffer(globalObject).?.ptr));

        const result = BoringSSL.SSL_export_keying_material(ssl_ptr, buffer_ptr, buffer_size, @as([*c]const u8, @ptrCast(label_slice.ptr)), label_slice.len, null, 0, 0);
        if (result != 1) {
            return globalObject.throwValue(getSSLException(globalObject, "Failed to export keying material"));
        }
        return buffer;
    }
}

pub fn getEphemeralKeyInfo(this: *This, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {

    // only available for clients
    if (this.handlers.is_server) {
        return JSValue.jsNull();
    }
    var result = JSValue.createEmptyObject(globalObject, 3);

    const ssl_ptr = this.socket.ssl() orelse return JSValue.jsNull();

    // TODO: investigate better option or compatible way to get the key
    // this implementation follows nodejs but for BoringSSL SSL_get_server_tmp_key will always return 0
    // wich will result in a empty object
    // var raw_key: [*c]BoringSSL.EVP_PKEY = undefined;
    // if (BoringSSL.SSL_get_server_tmp_key(ssl_ptr, @ptrCast([*c][*c]BoringSSL.EVP_PKEY, &raw_key)) == 0) {
    //     return result;
    // }
    const raw_key: [*c]BoringSSL.EVP_PKEY = BoringSSL.SSL_get_privatekey(ssl_ptr);
    if (raw_key == null) {
        return result;
    }

    const kid = BoringSSL.EVP_PKEY_id(raw_key);
    const bits = BoringSSL.EVP_PKEY_bits(raw_key);

    switch (kid) {
        BoringSSL.EVP_PKEY_DH => {
            result.put(globalObject, ZigString.static("type"), bun.String.static("DH").toJS(globalObject));
            result.put(globalObject, ZigString.static("size"), JSValue.jsNumber(bits));
        },

        BoringSSL.EVP_PKEY_EC, BoringSSL.EVP_PKEY_X25519, BoringSSL.EVP_PKEY_X448 => {
            var curve_name: []const u8 = undefined;
            if (kid == BoringSSL.EVP_PKEY_EC) {
                const ec = BoringSSL.EVP_PKEY_get1_EC_KEY(raw_key);
                const nid = BoringSSL.EC_GROUP_get_curve_name(BoringSSL.EC_KEY_get0_group(ec));
                const nid_str = BoringSSL.OBJ_nid2sn(nid);
                if (nid_str != null) {
                    curve_name = nid_str[0..bun.len(nid_str)];
                } else {
                    curve_name = "";
                }
            } else {
                const kid_str = BoringSSL.OBJ_nid2sn(kid);
                if (kid_str != null) {
                    curve_name = kid_str[0..bun.len(kid_str)];
                } else {
                    curve_name = "";
                }
            }
            result.put(globalObject, ZigString.static("type"), bun.String.static("ECDH").toJS(globalObject));
            result.put(globalObject, ZigString.static("name"), ZigString.fromUTF8(curve_name).toJS(globalObject));
            result.put(globalObject, ZigString.static("size"), JSValue.jsNumber(bits));
        },
        else => {},
    }
    return result;
}

pub fn getALPNProtocol(this: *This, globalObject: *JSC.JSGlobalObject) bun.JSError!JSValue {
    var alpn_proto: [*c]const u8 = null;
    var alpn_proto_len: u32 = 0;

    const ssl_ptr = this.socket.ssl() orelse return JSValue.jsBoolean(false);

    BoringSSL.SSL_get0_alpn_selected(ssl_ptr, &alpn_proto, &alpn_proto_len);
    if (alpn_proto == null or alpn_proto_len == 0) {
        return JSValue.jsBoolean(false);
    }

    const slice = alpn_proto[0..alpn_proto_len];
    if (strings.eql(slice, "h2")) {
        return bun.String.static("h2").toJS(globalObject);
    }
    if (strings.eql(slice, "http/1.1")) {
        return bun.String.static("http/1.1").toJS(globalObject);
    }
    return ZigString.fromUTF8(slice).toJS(globalObject);
}

pub fn getSession(this: *This, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    const ssl_ptr = this.socket.ssl() orelse return .js_undefined;
    const session = BoringSSL.SSL_get_session(ssl_ptr) orelse return .js_undefined;
    const size = BoringSSL.i2d_SSL_SESSION(session, null);
    if (size <= 0) {
        return .js_undefined;
    }

    const buffer_size = @as(usize, @intCast(size));
    var buffer = JSValue.createBufferFromLength(globalObject, buffer_size);
    var buffer_ptr = @as([*c]u8, @ptrCast(buffer.asArrayBuffer(globalObject).?.ptr));

    const result_size = BoringSSL.i2d_SSL_SESSION(session, &buffer_ptr);
    bun.assert(result_size == size);
    return buffer;
}

pub fn setSession(this: *This, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    if (this.socket.isDetached()) {
        return .js_undefined;
    }

    const args = callframe.arguments_old(1);

    if (args.len < 1) {
        return globalObject.throw("Expected session to be a string, Buffer or TypedArray", .{});
    }

    const session_arg = args.ptr[0];
    var arena: bun.ArenaAllocator = bun.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();

    if (try JSC.Node.StringOrBuffer.fromJS(globalObject, arena.allocator(), session_arg)) |sb| {
        defer sb.deinit();
        const session_slice = sb.slice();
        const ssl_ptr = this.socket.ssl();
        var tmp = @as([*c]const u8, @ptrCast(session_slice.ptr));
        const session = BoringSSL.d2i_SSL_SESSION(null, &tmp, @as(c_long, @intCast(session_slice.len))) orelse return .js_undefined;
        if (BoringSSL.SSL_set_session(ssl_ptr, session) != 1) {
            return globalObject.throwValue(getSSLException(globalObject, "SSL_set_session error"));
        }
        return .js_undefined;
    } else {
        return globalObject.throw("Expected session to be a string, Buffer or TypedArray", .{});
    }
}

pub fn getTLSTicket(this: *This, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    const ssl_ptr = this.socket.ssl() orelse return .js_undefined;
    const session = BoringSSL.SSL_get_session(ssl_ptr) orelse return .js_undefined;
    var ticket: [*c]const u8 = undefined;
    var length: usize = 0;
    //The pointer is only valid while the connection is in use so we need to copy it
    BoringSSL.SSL_SESSION_get0_ticket(session, @as([*c][*c]const u8, @ptrCast(&ticket)), &length);

    if (ticket == null or length == 0) {
        return .js_undefined;
    }

    return JSC.ArrayBuffer.createBuffer(globalObject, ticket[0..length]);
}

pub fn renegotiate(this: *This, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    const ssl_ptr = this.socket.ssl() orelse return .js_undefined;
    BoringSSL.ERR_clear_error();
    if (BoringSSL.SSL_renegotiate(ssl_ptr) != 1) {
        return globalObject.throwValue(getSSLException(globalObject, "SSL_renegotiate error"));
    }
    return .js_undefined;
}

pub fn disableRenegotiation(this: *This, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    const ssl_ptr = this.socket.ssl() orelse return .js_undefined;
    BoringSSL.SSL_set_renegotiate_mode(ssl_ptr, BoringSSL.ssl_renegotiate_never);
    return .js_undefined;
}

pub fn setVerifyMode(this: *This, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    if (this.socket.isDetached()) {
        return .js_undefined;
    }

    const args = callframe.arguments_old(2);

    if (args.len < 2) {
        return globalObject.throw("Expected requestCert and rejectUnauthorized arguments", .{});
    }
    const request_cert_js = args.ptr[0];
    const reject_unauthorized_js = args.ptr[1];
    if (!request_cert_js.isBoolean() or !reject_unauthorized_js.isBoolean()) {
        return globalObject.throw("Expected requestCert and rejectUnauthorized arguments to be boolean", .{});
    }

    const request_cert = request_cert_js.toBoolean();
    const reject_unauthorized = request_cert_js.toBoolean();
    var verify_mode: c_int = BoringSSL.SSL_VERIFY_NONE;
    if (this.handlers.is_server) {
        if (request_cert) {
            verify_mode = BoringSSL.SSL_VERIFY_PEER;
            if (reject_unauthorized)
                verify_mode |= BoringSSL.SSL_VERIFY_FAIL_IF_NO_PEER_CERT;
        }
    }
    const ssl_ptr = this.socket.ssl();
    // we always allow and check the SSL certificate after the handshake or renegotiation
    BoringSSL.SSL_set_verify(ssl_ptr, verify_mode, alwaysAllowSSLVerifyCallback);
    return .js_undefined;
}

fn alwaysAllowSSLVerifyCallback(_: c_int, _: ?*BoringSSL.X509_STORE_CTX) callconv(.C) c_int {
    return 1;
}

noinline fn getSSLException(globalThis: *JSC.JSGlobalObject, defaultMessage: []const u8) JSValue {
    var zig_str: ZigString = ZigString.init("");
    var output_buf: [4096]u8 = undefined;

    output_buf[0] = 0;
    var written: usize = 0;
    var ssl_error = BoringSSL.ERR_get_error();
    while (ssl_error != 0 and written < output_buf.len) : (ssl_error = BoringSSL.ERR_get_error()) {
        if (written > 0) {
            output_buf[written] = '\n';
            written += 1;
        }

        if (BoringSSL.ERR_reason_error_string(
            ssl_error,
        )) |reason_ptr| {
            const reason = std.mem.span(reason_ptr);
            if (reason.len == 0) {
                break;
            }
            @memcpy(output_buf[written..][0..reason.len], reason);
            written += reason.len;
        }

        if (BoringSSL.ERR_func_error_string(
            ssl_error,
        )) |reason_ptr| {
            const reason = std.mem.span(reason_ptr);
            if (reason.len > 0) {
                output_buf[written..][0.." via ".len].* = " via ".*;
                written += " via ".len;
                @memcpy(output_buf[written..][0..reason.len], reason);
                written += reason.len;
            }
        }

        if (BoringSSL.ERR_lib_error_string(
            ssl_error,
        )) |reason_ptr| {
            const reason = std.mem.span(reason_ptr);
            if (reason.len > 0) {
                output_buf[written..][0] = ' ';
                written += 1;
                @memcpy(output_buf[written..][0..reason.len], reason);
                written += reason.len;
            }
        }
    }

    if (written > 0) {
        const message = output_buf[0..written];
        zig_str = ZigString.init(std.fmt.allocPrint(bun.default_allocator, "OpenSSL {s}", .{message}) catch bun.outOfMemory());
        var encoded_str = zig_str.withEncoding();
        encoded_str.mark();

        // We shouldn't *need* to do this but it's not entirely clear.
        BoringSSL.ERR_clear_error();
    }

    if (zig_str.len == 0) {
        zig_str = ZigString.init(defaultMessage);
    }

    // store the exception in here
    // toErrorInstance clones the string
    const exception = zig_str.toErrorInstance(globalThis);

    // reference it in stack memory
    exception.ensureStillAlive();

    return exception;
}

const default_allocator = bun.default_allocator;
const bun = @import("bun");
const strings = bun.strings;
const string = bun.string;
const std = @import("std");
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const ZigString = JSC.ZigString;
const BoringSSL = bun.BoringSSL.c;
const X509 = @import("../x509.zig");
