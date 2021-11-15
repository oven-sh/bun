pub usingnamespace @import("std").zig.c_builtins;
const std = @import("std");

const Output = @import("./global.zig").Output;

const alpn_protocols = "http/1.1";

pub inline fn s2nassert(value: c_int) void {
    std.debug.assert(value == 0);
}

var booted_any: bool = false;
pub fn boot(allcoator: *std.mem.Allocator) void {
    if (!booted_any) {
        s2nassert(s2n_disable_atexit());
        s2nassert(s2n_init());
        Allocator.allocator = allcoator;
        CacheStore.instance = CacheStore{ .allocator = allcoator, .map = @TypeOf(CacheStore.instance.map).init(allcoator) };
    }
    booted_any = true;
    if (booted) return;
    booted = true;

    // Important for any website using Cloudflare.
    // Do to our modifications in the library, this must be called _first_
    // Before we initialize s2n.
    // It can never be changed after initialization or we risk undefined memory bugs.
    if (s2n_get_highest_fully_supported_tls_version() == S2N_TLS13) {
        // This conditional should always return true since we statically compile libCrypto.
        // _ = s2n_enable_tls13();

        // Sadly, this TLS 1.3 implementation is slower than TLS 1.2.
        // ❯ hyperfine "./fetch https://example.com" "./fetchtls13 https://example.com"
        // Benchmark #1: ./fetch https://example.com
        //   Time (mean ± σ):      83.6 ms ±   5.4 ms    [User: 15.1 ms, System: 4.7 ms]
        //   Range (min … max):    73.5 ms …  97.5 ms    35 runs

        // Benchmark #2: ./fetchtls13 https://example.com
        //   Time (mean ± σ):      94.9 ms ±   3.2 ms    [User: 15.8 ms, System: 4.8 ms]
        //   Range (min … max):    90.7 ms … 104.6 ms    29 runs

        // Summary
        //   './fetch https://example.com' ran
        //     1.14 ± 0.08 times faster than './fetchtls13 https://example.com'

    }

    // We don't actually need the memory allocator, it will automatically use mimalloc...I don't know how!
    // Also, the implementation
    // s2nassert(s2n_mem_set_callbacks(Allocator.initCallback, Allocator.deinitCallback, Allocator.mallocCallback, Allocator.freeCallback));

    global_s2n_config = s2n_fetch_default_config();
    // s2nassert(s2n_config_set_verify_host_callback(global_s2n_config, verify_host_callback, null));
    // s2nassert(s2n_config_set_check_stapled_ocsp_response(global_s2n_config, 0));
    // s2nassert(s2n_config_set_cipher_preferences(global_s2n_config, "default"));
    // s2nassert(s2n_config_disable_x509_verification(global_s2n_config));
    var protocol: [*c]const u8 = "http/1.1";
    var protocols = &protocol;
    s2nassert(s2n_config_set_protocol_preferences(global_s2n_config, protocols, 1));
    s2nassert(s2n_config_send_max_fragment_length(global_s2n_config, S2N_TLS_MAX_FRAG_LEN_4096));
    // s2nassert(s2n_config_set_cipher_preferences(global_s2n_config, "default_tls13"));
    // s2n_config_set_ticket_decrypt_key_lifetime(global_s2n_config, 9999999);

    s2nassert(
        s2n_config_set_cache_store_callback(global_s2n_config, CacheStore.store, &CacheStore.instance),
    );
    s2nassert(
        s2n_config_set_cache_retrieve_callback(global_s2n_config, CacheStore.retrieve, &CacheStore.instance),
    );
    s2nassert(
        s2n_config_set_cache_delete_callback(global_s2n_config, CacheStore.delete, &CacheStore.instance),
    );
    s2nassert(
        s2n_config_set_session_cache_onoff(global_s2n_config, 1),
    );

    // s2nassert(s2n_config_init_session_ticket_keys());
    // s2nassert(s2n_config_set_client_auth_type(global_s2n_config, S2N_STATUS_REQUEST_NONE));
}

pub const CacheStore = struct {
    const CacheEntry = struct {
        key: []u8,
        value: []u8,
        seconds: u64,

        pub fn init(
            allocator: *std.mem.Allocator,
            key: *const c_void,
            size: u64,
            value: *const c_void,
            value_size: u64,
            seconds: u64,
        ) CacheEntry {
            const key_bytes = keyBytes(key, size);
            const value_bytes = keyBytes(key, value_size);

            var total_bytes = allocator.alloc(u8, key_bytes.len + value_bytes.len) catch unreachable;
            @memcpy(total_bytes.ptr, key_bytes.ptr, key_bytes.len);
            @memcpy(total_bytes[key_bytes.len..].ptr, value_bytes.ptr, value_bytes.len);

            return CacheEntry{ .key = total_bytes[0..key_bytes.len], .value = total_bytes[key_bytes.len..], .seconds = seconds };
        }
    };

    const Context = struct {
        pub fn hash(this: @This(), key: u64) u64 {
            return key;
        }

        pub fn eql(this: @This(), a: u64, b: u64) bool {
            return a == b;
        }
    };

    allocator: *std.mem.Allocator,
    map: std.HashMap(u64, CacheEntry, Context, 80),

    pub inline fn keyBytes(key: *const c_void, size: u64) []u8 {
        const ptr = @intToPtr([*]u8, @ptrToInt(key));

        return ptr[0..size];
    }

    inline fn hashKey(key: *const c_void, size: u64) u64 {
        const bytes = keyBytes(key, size);
        return std.hash.Wyhash.hash(0, bytes);
    }

    pub fn retrieve(
        conn: *s2n_connection,
        ctx: ?*c_void,
        key: *const c_void,
        key_size: u64,
        value: *c_void,
        value_size: *u64,
    ) callconv(.C) c_int {
        const hash = hashKey(key, key_size);

        if (instance.map.getAdapted(hash, Context{})) |entry| {
            const now = @intCast(usize, std.time.timestamp());
            if (now > entry.seconds) {
                _ = instance.map.removeAdapted(hash, Context{});
                return 0;
            }

            var value_bytes = keyBytes(value, value_size.*);
            if (value_bytes.len < entry.value.len) return -1;
            std.mem.copy(u8, value_bytes, entry.value);
            value_size.* = entry.value.len;
            return 0;
        }

        return 0;
    }

    pub fn store(
        conn: *s2n_connection,
        ctx: ?*c_void,
        seconds: u64,
        key: *const c_void,
        key_size: u64,
        value: *const c_void,
        value_size: u64,
    ) callconv(.C) c_int {
        var map_entry = instance.map.getOrPutAdapted(hashKey(key, key_size), Context{}) catch unreachable;

        if (!map_entry.found_existing) {
            map_entry.value_ptr.* = CacheEntry.init(instance.allocator, key, key_size, value, value_size, @intCast(usize, std.time.timestamp()) + seconds);
        }

        return S2N_SUCCESS;
    }

    pub fn delete(
        conn: *s2n_connection,
        ctx: ?*c_void,
        key: *const c_void,
        key_size: u64,
    ) callconv(.C) c_int {
        _ = instance.map.remove(hashKey(key, key_size));
        return 0;
    }

    pub var instance: CacheStore = undefined;
};

pub fn verify_host_callback(ptr: [*c]const u8, len: usize, ctx: ?*c_void) callconv(.C) u8 {
    return 1;
}

pub extern fn s2n_enable_tls13() c_int;
pub extern fn s2n_fetch_default_config() *s2n_config;
pub extern fn s2n_get_highest_fully_supported_tls_version() c_int;
pub extern fn s2n_errno_location() [*c]c_int;
pub const S2N_ERR_T_OK: c_int = 0;
pub const S2N_ERR_T_IO: c_int = 1;
pub const S2N_ERR_T_CLOSED: c_int = 2;
pub const S2N_ERR_T_BLOCKED: c_int = 3;
pub const S2N_ERR_T_ALERT: c_int = 4;
pub const S2N_ERR_T_PROTO: c_int = 5;
pub const S2N_ERR_T_INTERNAL: c_int = 6;
pub const S2N_ERR_T_USAGE: c_int = 7;
pub const s2n_error_type = c_uint;
pub extern fn s2n_error_get_type(@"error": c_int) c_int;
pub const struct_s2n_config = opaque {};
pub const struct_s2n_connection = opaque {};
pub extern fn s2n_crypto_disable_init() c_int;
pub extern fn s2n_disable_atexit() c_int;
pub extern fn s2n_get_openssl_version() c_ulong;
pub extern fn s2n_init() c_int;
pub extern fn s2n_cleanup() c_int;
pub extern fn s2n_config_new() *struct_s2n_config;
pub extern fn s2n_config_free(config: *struct_s2n_config) c_int;
pub extern fn s2n_config_free_dhparams(config: *struct_s2n_config) c_int;
pub extern fn s2n_config_free_cert_chain_and_key(config: *struct_s2n_config) c_int;
pub const s2n_clock_time_nanoseconds = ?fn (?*c_void, [*c]u64) callconv(.C) c_int;
pub const s2n_cache_retrieve_callback = ?fn (*struct_s2n_connection, ?*c_void, *const c_void, u64, *c_void, *u64) callconv(.C) c_int;
pub const s2n_cache_store_callback = ?fn (*struct_s2n_connection, ?*c_void, u64, *const c_void, u64, *const c_void, u64) callconv(.C) c_int;
pub const s2n_cache_delete_callback = ?fn (*struct_s2n_connection, ?*c_void, *const c_void, u64) callconv(.C) c_int;
pub extern fn s2n_config_set_wall_clock(config: *struct_s2n_config, clock_fn: s2n_clock_time_nanoseconds, ctx: ?*c_void) c_int;
pub extern fn s2n_config_set_monotonic_clock(config: *struct_s2n_config, clock_fn: s2n_clock_time_nanoseconds, ctx: ?*c_void) c_int;
pub extern fn s2n_strerror(@"error": c_int, lang: [*c]const u8) [*c]const u8;
pub extern fn s2n_strerror_debug(@"error": c_int, lang: [*c]const u8) [*c]const u8;
pub extern fn s2n_strerror_name(@"error": c_int) [*c]const u8;
pub const struct_s2n_stacktrace = opaque {};
pub extern fn s2n_stack_traces_enabled() bool;
pub extern fn s2n_stack_traces_enabled_set(newval: bool) c_int;
pub extern fn s2n_calculate_stacktrace() c_int;
// pub extern fn s2n_print_stacktrace(fptr: [*c]FILE) c_int;
pub extern fn s2n_free_stacktrace() c_int;
pub extern fn s2n_get_stacktrace(trace: *struct_s2n_stacktrace) c_int;
pub extern fn s2n_config_set_cache_store_callback(config: *struct_s2n_config, cache_store_callback: s2n_cache_store_callback, data: ?*c_void) c_int;
pub extern fn s2n_config_set_cache_retrieve_callback(config: *struct_s2n_config, cache_retrieve_callback: s2n_cache_retrieve_callback, data: ?*c_void) c_int;
pub extern fn s2n_config_set_cache_delete_callback(config: *struct_s2n_config, cache_delete_callback: s2n_cache_delete_callback, data: ?*c_void) c_int;
pub const s2n_mem_init_callback = ?fn () callconv(.C) c_int;
pub const s2n_mem_cleanup_callback = ?fn () callconv(.C) c_int;
pub const s2n_mem_malloc_callback = ?fn (**c_void, u32, *u32) callconv(.C) c_int;
pub const s2n_mem_free_callback = ?fn (?*c_void, u32) callconv(.C) c_int;
pub extern fn s2n_mem_set_callbacks(mem_init_callback: s2n_mem_init_callback, mem_cleanup_callback: s2n_mem_cleanup_callback, mem_malloc_callback: s2n_mem_malloc_callback, mem_free_callback: s2n_mem_free_callback) c_int;
pub const s2n_rand_init_callback = ?fn () callconv(.C) c_int;
pub const s2n_rand_cleanup_callback = ?fn () callconv(.C) c_int;
pub const s2n_rand_seed_callback = ?fn (?*c_void, u32) callconv(.C) c_int;
pub const s2n_rand_mix_callback = ?fn (?*c_void, u32) callconv(.C) c_int;
pub extern fn s2n_rand_set_callbacks(rand_init_callback: s2n_rand_init_callback, rand_cleanup_callback: s2n_rand_cleanup_callback, rand_seed_callback: s2n_rand_seed_callback, rand_mix_callback: s2n_rand_mix_callback) c_int;
pub const S2N_EXTENSION_SERVER_NAME: c_int = 0;
pub const S2N_EXTENSION_MAX_FRAG_LEN: c_int = 1;
pub const S2N_EXTENSION_OCSP_STAPLING: c_int = 5;
pub const S2N_EXTENSION_SUPPORTED_GROUPS: c_int = 10;
pub const S2N_EXTENSION_EC_POINT_FORMATS: c_int = 11;
pub const S2N_EXTENSION_SIGNATURE_ALGORITHMS: c_int = 13;
pub const S2N_EXTENSION_ALPN: c_int = 16;
pub const S2N_EXTENSION_CERTIFICATE_TRANSPARENCY: c_int = 18;
pub const S2N_EXTENSION_RENEGOTIATION_INFO: c_int = 65281;
pub const s2n_tls_extension_type = c_uint;
pub const S2N_TLS_MAX_FRAG_LEN_512: c_int = 1;
pub const S2N_TLS_MAX_FRAG_LEN_1024: c_int = 2;
pub const S2N_TLS_MAX_FRAG_LEN_2048: c_int = 3;
pub const S2N_TLS_MAX_FRAG_LEN_4096: c_int = 4;
pub const s2n_max_frag_len = c_uint;
pub const struct_s2n_cert = opaque {};
pub const struct_s2n_cert_chain_and_key = opaque {};
pub const struct_s2n_pkey = opaque {};
pub const s2n_cert_public_key = struct_s2n_pkey;
pub const s2n_cert_private_key = struct_s2n_pkey;
pub extern fn s2n_cert_chain_and_key_new() *struct_s2n_cert_chain_and_key;
pub extern fn s2n_cert_chain_and_key_load_pem(chain_and_key: *struct_s2n_cert_chain_and_key, chain_pem: [*c]const u8, private_key_pem: [*c]const u8) c_int;
pub extern fn s2n_cert_chain_and_key_load_pem_bytes(chain_and_key: *struct_s2n_cert_chain_and_key, chain_pem: [*c]u8, chain_pem_len: u32, private_key_pem: [*c]u8, private_key_pem_len: u32) c_int;
pub extern fn s2n_cert_chain_and_key_load_public_pem_bytes(chain_and_key: *struct_s2n_cert_chain_and_key, chain_pem: [*c]u8, chain_pem_len: u32) c_int;
pub extern fn s2n_cert_chain_and_key_free(cert_and_key: *struct_s2n_cert_chain_and_key) c_int;
pub extern fn s2n_cert_chain_and_key_set_ctx(cert_and_key: *struct_s2n_cert_chain_and_key, ctx: ?*c_void) c_int;
pub extern fn s2n_cert_chain_and_key_get_ctx(cert_and_key: *struct_s2n_cert_chain_and_key) ?*c_void;
pub extern fn s2n_cert_chain_and_key_get_private_key(cert_and_key: *struct_s2n_cert_chain_and_key) ?*s2n_cert_private_key;
pub const s2n_cert_tiebreak_callback = ?fn (*struct_s2n_cert_chain_and_key, *struct_s2n_cert_chain_and_key, [*c]u8, u32) callconv(.C) *struct_s2n_cert_chain_and_key;
pub extern fn s2n_config_set_cert_tiebreak_callback(config: *struct_s2n_config, cert_tiebreak_cb: s2n_cert_tiebreak_callback) c_int;
pub extern fn s2n_config_add_cert_chain_and_key(config: *struct_s2n_config, cert_chain_pem: [*c]const u8, private_key_pem: [*c]const u8) c_int;
pub extern fn s2n_config_add_cert_chain_and_key_to_store(config: *struct_s2n_config, cert_key_pair: *struct_s2n_cert_chain_and_key) c_int;
pub extern fn s2n_config_set_cert_chain_and_key_defaults(config: *struct_s2n_config, cert_key_pairs: [*c]*struct_s2n_cert_chain_and_key, num_cert_key_pairs: u32) c_int;
pub extern fn s2n_config_set_verification_ca_location(config: *struct_s2n_config, ca_pem_filename: [*c]const u8, ca_dir: [*c]const u8) c_int;
pub extern fn s2n_config_add_pem_to_trust_store(config: *struct_s2n_config, pem: [*c]const u8) c_int;
pub extern fn s2n_config_wipe_trust_store(config: *struct_s2n_config) c_int;
pub const s2n_verify_host_fn = ?fn ([*c]const u8, usize, ?*c_void) callconv(.C) u8;
pub extern fn s2n_config_set_verify_host_callback(config: *struct_s2n_config, s2n_verify_host_fn, data: ?*c_void) c_int;
pub extern fn s2n_config_set_check_stapled_ocsp_response(config: *struct_s2n_config, check_ocsp: u8) c_int;
pub extern fn s2n_config_disable_x509_verification(config: *struct_s2n_config) c_int;
pub extern fn s2n_config_set_max_cert_chain_depth(config: *struct_s2n_config, max_depth: u16) c_int;
pub extern fn s2n_config_add_dhparams(config: *struct_s2n_config, dhparams_pem: [*c]const u8) c_int;
pub extern fn s2n_config_set_cipher_preferences(config: *struct_s2n_config, version: [*c]const u8) c_int;
pub extern fn s2n_config_append_protocol_preference(config: *struct_s2n_config, protocol: [*c]const u8, protocol_len: u8) c_int;
pub extern fn s2n_config_set_protocol_preferences(config: *struct_s2n_config, protocols: [*c]const [*c]const u8, protocol_count: c_int) c_int;
pub const S2N_STATUS_REQUEST_NONE: c_int = 0;
pub const S2N_STATUS_REQUEST_OCSP: c_int = 1;
pub const s2n_status_request_type = c_uint;
pub extern fn s2n_config_set_status_request_type(config: *struct_s2n_config, @"type": s2n_status_request_type) c_int;
pub const S2N_CT_SUPPORT_NONE: c_int = 0;
pub const S2N_CT_SUPPORT_REQUEST: c_int = 1;
pub const s2n_ct_support_level = c_uint;
pub extern fn s2n_config_set_ct_support_level(config: *struct_s2n_config, level: s2n_ct_support_level) c_int;
pub const S2N_ALERT_FAIL_ON_WARNINGS: c_int = 0;
pub const S2N_ALERT_IGNORE_WARNINGS: c_int = 1;
pub const s2n_alert_behavior = c_uint;
pub extern fn s2n_config_set_alert_behavior(config: *struct_s2n_config, alert_behavior: s2n_alert_behavior) c_int;
pub extern fn s2n_config_set_extension_data(config: *struct_s2n_config, @"type": s2n_tls_extension_type, data: [*c]const u8, length: u32) c_int;
pub extern fn s2n_config_send_max_fragment_length(config: *struct_s2n_config, mfl_code: s2n_max_frag_len) c_int;
pub extern fn s2n_config_accept_max_fragment_length(config: *struct_s2n_config) c_int;
pub extern fn s2n_config_set_session_state_lifetime(config: *struct_s2n_config, lifetime_in_secs: u64) c_int;
pub extern fn s2n_config_set_session_tickets_onoff(config: *struct_s2n_config, enabled: u8) c_int;
pub extern fn s2n_config_set_session_cache_onoff(config: *struct_s2n_config, enabled: u8) c_int;
pub extern fn s2n_config_set_ticket_encrypt_decrypt_key_lifetime(config: *struct_s2n_config, lifetime_in_secs: u64) c_int;
pub extern fn s2n_config_set_ticket_decrypt_key_lifetime(config: *struct_s2n_config, lifetime_in_secs: u64) c_int;
pub extern fn s2n_config_add_ticket_crypto_key(config: *struct_s2n_config, name: [*c]const u8, name_len: u32, key: [*c]u8, key_len: u32, intro_time_in_seconds_from_epoch: u64) c_int;
pub const S2N_SERVER: c_int = 0;
pub const S2N_CLIENT: c_int = 1;
pub const s2n_mode = c_uint;
pub extern fn s2n_connection_new(mode: s2n_mode) *struct_s2n_connection;
pub extern fn s2n_connection_set_config(conn: *struct_s2n_connection, config: *struct_s2n_config) c_int;
pub extern fn s2n_connection_set_ctx(conn: *struct_s2n_connection, ctx: ?*c_void) c_int;
pub extern fn s2n_connection_get_ctx(conn: *struct_s2n_connection) ?*c_void;
pub const s2n_client_hello_fn = fn (*struct_s2n_connection, ?*c_void) callconv(.C) c_int;
pub const S2N_CLIENT_HELLO_CB_BLOCKING: c_int = 0;
pub const S2N_CLIENT_HELLO_CB_NONBLOCKING: c_int = 1;
pub const s2n_client_hello_cb_mode = c_uint;
pub extern fn s2n_config_set_client_hello_cb(config: *struct_s2n_config, client_hello_callback: ?s2n_client_hello_fn, ctx: ?*c_void) c_int;
pub extern fn s2n_config_set_client_hello_cb_mode(config: *struct_s2n_config, cb_mode: s2n_client_hello_cb_mode) c_int;
pub extern fn s2n_client_hello_cb_done(conn: *struct_s2n_connection) c_int;
pub extern fn s2n_connection_server_name_extension_used(conn: *struct_s2n_connection) c_int;
pub const struct_s2n_client_hello = opaque {};
pub extern fn s2n_connection_get_client_hello(conn: *struct_s2n_connection) *struct_s2n_client_hello;
pub extern fn s2n_client_hello_get_raw_message_length(ch: *struct_s2n_client_hello) isize;
pub extern fn s2n_client_hello_get_raw_message(ch: *struct_s2n_client_hello, out: [*c]u8, max_length: u32) isize;
pub extern fn s2n_client_hello_get_cipher_suites_length(ch: *struct_s2n_client_hello) isize;
pub extern fn s2n_client_hello_get_cipher_suites(ch: *struct_s2n_client_hello, out: [*c]u8, max_length: u32) isize;
pub extern fn s2n_client_hello_get_extensions_length(ch: *struct_s2n_client_hello) isize;
pub extern fn s2n_client_hello_get_extensions(ch: *struct_s2n_client_hello, out: [*c]u8, max_length: u32) isize;
pub extern fn s2n_client_hello_get_extension_length(ch: *struct_s2n_client_hello, extension_type: s2n_tls_extension_type) isize;
pub extern fn s2n_client_hello_get_extension_by_id(ch: *struct_s2n_client_hello, extension_type: s2n_tls_extension_type, out: [*c]u8, max_length: u32) isize;
pub extern fn s2n_client_hello_get_session_id_length(ch: *struct_s2n_client_hello, out_length: [*c]u32) c_int;
pub extern fn s2n_client_hello_get_session_id(ch: *struct_s2n_client_hello, out: [*c]u8, out_length: [*c]u32, max_length: u32) c_int;
pub extern fn s2n_connection_set_fd(conn: *struct_s2n_connection, fd: c_int) c_int;
pub extern fn s2n_connection_set_read_fd(conn: *struct_s2n_connection, readfd: c_int) c_int;
pub extern fn s2n_connection_set_write_fd(conn: *struct_s2n_connection, writefd: c_int) c_int;
pub extern fn s2n_connection_get_read_fd(conn: *struct_s2n_connection, readfd: [*c]c_int) c_int;
pub extern fn s2n_connection_get_write_fd(conn: *struct_s2n_connection, writefd: [*c]c_int) c_int;
pub extern fn s2n_connection_use_corked_io(conn: *struct_s2n_connection) c_int;
pub const s2n_recv_fn = fn (*s2n_connection, [*c]u8, u32) callconv(.C) c_int;
pub const s2n_send_fn = fn (*s2n_connection, [*c]const u8, u32) callconv(.C) c_int;
pub extern fn s2n_connection_set_recv_ctx(conn: *struct_s2n_connection, ctx: ?*c_void) c_int;
pub extern fn s2n_connection_set_send_ctx(conn: *struct_s2n_connection, ctx: ?*c_void) c_int;
pub extern fn s2n_connection_set_recv_cb(conn: *struct_s2n_connection, recv: ?s2n_recv_fn) c_int;
pub extern fn s2n_connection_set_send_cb(conn: *struct_s2n_connection, send: ?s2n_send_fn) c_int;
pub extern fn s2n_connection_prefer_throughput(conn: *struct_s2n_connection) c_int;
pub extern fn s2n_connection_prefer_low_latency(conn: *struct_s2n_connection) c_int;
pub extern fn s2n_connection_set_dynamic_record_threshold(conn: *struct_s2n_connection, resize_threshold: u32, timeout_threshold: u16) c_int;
pub extern fn s2n_connection_set_verify_host_callback(config: *struct_s2n_connection, host_fn: s2n_verify_host_fn, data: ?*c_void) c_int;
pub const S2N_BUILT_IN_BLINDING: c_int = 0;
pub const S2N_SELF_SERVICE_BLINDING: c_int = 1;
pub const s2n_blinding = c_uint;
pub extern fn s2n_connection_set_blinding(conn: *struct_s2n_connection, blinding: s2n_blinding) c_int;
pub extern fn s2n_connection_get_delay(conn: *struct_s2n_connection) u64;
pub extern fn s2n_connection_set_cipher_preferences(conn: *struct_s2n_connection, version: [*c]const u8) c_int;
pub extern fn s2n_connection_append_protocol_preference(conn: *struct_s2n_connection, protocol: [*c]const u8, protocol_len: u8) c_int;
pub extern fn s2n_connection_set_protocol_preferences(conn: *struct_s2n_connection, protocols: [*c]const [*c]const u8, protocol_count: c_int) c_int;
pub extern fn s2n_set_server_name(conn: *struct_s2n_connection, server_name: [*c]const u8) c_int;
pub extern fn s2n_get_server_name(conn: *struct_s2n_connection) [*c]const u8;
pub extern fn s2n_get_application_protocol(conn: *struct_s2n_connection) [*c]const u8;
pub extern fn s2n_connection_get_ocsp_response(conn: *struct_s2n_connection, length: [*c]u32) [*c]const u8;
pub extern fn s2n_connection_get_sct_list(conn: *struct_s2n_connection, length: [*c]u32) [*c]const u8;
pub const S2N_NOT_BLOCKED: c_int = 0;
pub const S2N_BLOCKED_ON_READ: c_int = 1;
pub const S2N_BLOCKED_ON_WRITE: c_int = 2;
pub const S2N_BLOCKED_ON_APPLICATION_INPUT: c_int = 3;
pub const S2N_BLOCKED_ON_EARLY_DATA: c_int = 4;
pub const s2n_blocked_status = c_uint;
pub extern fn s2n_negotiate(conn: *struct_s2n_connection, blocked: [*c]s2n_blocked_status) c_int;
pub extern fn s2n_send(conn: *struct_s2n_connection, buf: *const c_void, size: isize, blocked: [*c]s2n_blocked_status) isize;
// pub extern fn s2n_sendv(conn: *struct_s2n_connection, bufs: [*c]const struct_iovec, count: isize, blocked: [*c]s2n_blocked_status) isize;
// pub extern fn s2n_sendv_with_offset(conn: *struct_s2n_connection, bufs: [*c]const struct_iovec, count: isize, offs: isize, blocked: [*c]s2n_blocked_status) isize;
pub extern fn s2n_recv(conn: *struct_s2n_connection, buf: *c_void, size: isize, blocked: [*c]s2n_blocked_status) isize;
pub extern fn s2n_peek(conn: *struct_s2n_connection) u32;
pub extern fn s2n_connection_free_handshake(conn: *struct_s2n_connection) c_int;
pub extern fn s2n_connection_release_buffers(conn: *struct_s2n_connection) c_int;
pub extern fn s2n_connection_wipe(conn: *struct_s2n_connection) c_int;
pub extern fn s2n_connection_free(conn: *struct_s2n_connection) c_int;
pub extern fn s2n_shutdown(conn: *struct_s2n_connection, blocked: [*c]s2n_blocked_status) c_int;
pub const S2N_CERT_AUTH_NONE: c_int = 0;
pub const S2N_CERT_AUTH_REQUIRED: c_int = 1;
pub const S2N_CERT_AUTH_OPTIONAL: c_int = 2;
pub const s2n_cert_auth_type = c_uint;
pub extern fn s2n_config_get_client_auth_type(config: *struct_s2n_config, client_auth_type: [*c]s2n_cert_auth_type) c_int;
pub extern fn s2n_config_set_client_auth_type(config: *struct_s2n_config, client_auth_type: s2n_cert_auth_type) c_int;
pub extern fn s2n_connection_get_client_auth_type(conn: *struct_s2n_connection, client_auth_type: [*c]s2n_cert_auth_type) c_int;
pub extern fn s2n_connection_set_client_auth_type(conn: *struct_s2n_connection, client_auth_type: s2n_cert_auth_type) c_int;
pub extern fn s2n_connection_get_client_cert_chain(conn: *struct_s2n_connection, der_cert_chain_out: [*c][*c]u8, cert_chain_len: [*c]u32) c_int;
pub extern fn s2n_config_set_initial_ticket_count(config: *struct_s2n_config, num: u8) c_int;
pub extern fn s2n_connection_add_new_tickets_to_send(conn: *struct_s2n_connection, num: u8) c_int;
pub extern fn s2n_connection_get_tickets_sent(conn: *struct_s2n_connection, num: [*c]u16) c_int;
pub extern fn s2n_connection_set_server_keying_material_lifetime(conn: *struct_s2n_connection, lifetime_in_secs: u32) c_int;
pub const struct_s2n_session_ticket = opaque {};
pub const s2n_session_ticket_fn = ?fn (*struct_s2n_connection, ?*c_void, *struct_s2n_session_ticket) callconv(.C) c_int;
pub extern fn s2n_config_set_session_ticket_cb(config: *struct_s2n_config, callback: s2n_session_ticket_fn, ctx: ?*c_void) c_int;
pub extern fn s2n_session_ticket_get_data_len(ticket: *struct_s2n_session_ticket, data_len: [*c]usize) c_int;
pub extern fn s2n_session_ticket_get_data(ticket: *struct_s2n_session_ticket, max_data_len: usize, data: [*c]u8) c_int;
pub extern fn s2n_session_ticket_get_lifetime(ticket: *struct_s2n_session_ticket, session_lifetime: [*c]u32) c_int;
pub extern fn s2n_connection_set_session(conn: *struct_s2n_connection, session: [*c]const u8, length: usize) c_int;
pub extern fn s2n_connection_get_session(conn: *struct_s2n_connection, session: [*c]u8, max_length: usize) c_int;
pub extern fn s2n_connection_get_session_ticket_lifetime_hint(conn: *struct_s2n_connection) c_int;
pub extern fn s2n_connection_get_session_length(conn: *struct_s2n_connection) c_int;
pub extern fn s2n_connection_get_session_id_length(conn: *struct_s2n_connection) c_int;
pub extern fn s2n_connection_get_session_id(conn: *struct_s2n_connection, session_id: [*c]u8, max_length: usize) c_int;
pub extern fn s2n_connection_is_session_resumed(conn: *struct_s2n_connection) c_int;
pub extern fn s2n_connection_is_ocsp_stapled(conn: *struct_s2n_connection) c_int;
pub const S2N_TLS_SIGNATURE_ANONYMOUS: c_int = 0;
pub const S2N_TLS_SIGNATURE_RSA: c_int = 1;
pub const S2N_TLS_SIGNATURE_ECDSA: c_int = 3;
pub const S2N_TLS_SIGNATURE_RSA_PSS_RSAE: c_int = 224;
pub const S2N_TLS_SIGNATURE_RSA_PSS_PSS: c_int = 225;
pub const s2n_tls_signature_algorithm = c_uint;
pub const S2N_TLS_HASH_NONE: c_int = 0;
pub const S2N_TLS_HASH_MD5: c_int = 1;
pub const S2N_TLS_HASH_SHA1: c_int = 2;
pub const S2N_TLS_HASH_SHA224: c_int = 3;
pub const S2N_TLS_HASH_SHA256: c_int = 4;
pub const S2N_TLS_HASH_SHA384: c_int = 5;
pub const S2N_TLS_HASH_SHA512: c_int = 6;
pub const S2N_TLS_HASH_MD5_SHA1: c_int = 224;
pub const s2n_tls_hash_algorithm = c_uint;
pub extern fn s2n_connection_get_selected_signature_algorithm(conn: *struct_s2n_connection, chosen_alg: [*c]s2n_tls_signature_algorithm) c_int;
pub extern fn s2n_connection_get_selected_digest_algorithm(conn: *struct_s2n_connection, chosen_alg: [*c]s2n_tls_hash_algorithm) c_int;
pub extern fn s2n_connection_get_selected_client_cert_signature_algorithm(conn: *struct_s2n_connection, chosen_alg: [*c]s2n_tls_signature_algorithm) c_int;
pub extern fn s2n_connection_get_selected_client_cert_digest_algorithm(conn: *struct_s2n_connection, chosen_alg: [*c]s2n_tls_hash_algorithm) c_int;
pub extern fn s2n_connection_get_selected_cert(conn: *struct_s2n_connection) *struct_s2n_cert_chain_and_key;
pub extern fn s2n_cert_chain_get_length(chain_and_key: ?*const struct_s2n_cert_chain_and_key, cert_length: [*c]u32) c_int;
pub extern fn s2n_cert_chain_get_cert(chain_and_key: ?*const struct_s2n_cert_chain_and_key, out_cert: [*c]*struct_s2n_cert, cert_idx: u32) c_int;
pub extern fn s2n_cert_get_der(cert: ?*const struct_s2n_cert, out_cert_der: [*c][*c]const u8, cert_length: [*c]u32) c_int;
pub extern fn s2n_connection_get_peer_cert_chain(conn: *const struct_s2n_connection, cert_chain: *struct_s2n_cert_chain_and_key) c_int;
pub extern fn s2n_cert_get_x509_extension_value_length(cert: *struct_s2n_cert, oid: [*c]const u8, ext_value_len: [*c]u32) c_int;
pub extern fn s2n_cert_get_x509_extension_value(cert: *struct_s2n_cert, oid: [*c]const u8, ext_value: [*c]u8, ext_value_len: [*c]u32, critical: [*c]bool) c_int;
pub extern fn s2n_cert_get_utf8_string_from_extension_data_length(extension_data: [*c]const u8, extension_len: u32, utf8_str_len: [*c]u32) c_int;
pub extern fn s2n_cert_get_utf8_string_from_extension_data(extension_data: [*c]const u8, extension_len: u32, out_data: [*c]u8, out_len: [*c]u32) c_int;
pub const S2N_PSK_HMAC_SHA256: c_int = 0;
pub const S2N_PSK_HMAC_SHA384: c_int = 1;
pub const s2n_psk_hmac = c_uint;
pub const struct_s2n_psk = opaque {};
pub extern fn s2n_external_psk_new() *struct_s2n_psk;
pub extern fn s2n_psk_free(psk: [*c]*struct_s2n_psk) c_int;
pub extern fn s2n_psk_set_identity(psk: *struct_s2n_psk, identity: [*c]const u8, identity_size: u16) c_int;
pub extern fn s2n_psk_set_secret(psk: *struct_s2n_psk, secret: [*c]const u8, secret_size: u16) c_int;
pub extern fn s2n_psk_set_hmac(psk: *struct_s2n_psk, hmac: s2n_psk_hmac) c_int;
pub extern fn s2n_connection_append_psk(conn: *struct_s2n_connection, psk: *struct_s2n_psk) c_int;
pub const S2N_PSK_MODE_RESUMPTION: c_int = 0;
pub const S2N_PSK_MODE_EXTERNAL: c_int = 1;
pub const s2n_psk_mode = c_uint;
pub extern fn s2n_config_set_psk_mode(config: *struct_s2n_config, mode: s2n_psk_mode) c_int;
pub extern fn s2n_connection_set_psk_mode(conn: *struct_s2n_connection, mode: s2n_psk_mode) c_int;
pub extern fn s2n_connection_get_negotiated_psk_identity_length(conn: *struct_s2n_connection, identity_length: [*c]u16) c_int;
pub extern fn s2n_connection_get_negotiated_psk_identity(conn: *struct_s2n_connection, identity: [*c]u8, max_identity_length: u16) c_int;
pub const struct_s2n_offered_psk = opaque {};
pub extern fn s2n_offered_psk_new() *struct_s2n_offered_psk;
pub extern fn s2n_offered_psk_free(psk: [*c]*struct_s2n_offered_psk) c_int;
pub extern fn s2n_offered_psk_get_identity(psk: *struct_s2n_offered_psk, identity: [*c][*c]u8, size: [*c]u16) c_int;
pub const struct_s2n_offered_psk_list = opaque {};
pub extern fn s2n_offered_psk_list_has_next(psk_list: *struct_s2n_offered_psk_list) bool;
pub extern fn s2n_offered_psk_list_next(psk_list: *struct_s2n_offered_psk_list, psk: *struct_s2n_offered_psk) c_int;
pub extern fn s2n_offered_psk_list_reread(psk_list: *struct_s2n_offered_psk_list) c_int;
pub extern fn s2n_offered_psk_list_choose_psk(psk_list: *struct_s2n_offered_psk_list, psk: *struct_s2n_offered_psk) c_int;
pub const s2n_psk_selection_callback = ?fn (*struct_s2n_connection, ?*c_void, *struct_s2n_offered_psk_list) callconv(.C) c_int;
pub extern fn s2n_config_set_psk_selection_callback(config: *struct_s2n_config, cb: s2n_psk_selection_callback, context: ?*c_void) c_int;
pub extern fn s2n_connection_get_wire_bytes_in(conn: *struct_s2n_connection) u64;
pub extern fn s2n_connection_get_wire_bytes_out(conn: *struct_s2n_connection) u64;
pub extern fn s2n_connection_get_client_protocol_version(conn: *struct_s2n_connection) c_int;
pub extern fn s2n_connection_get_server_protocol_version(conn: *struct_s2n_connection) c_int;
pub extern fn s2n_connection_get_actual_protocol_version(conn: *struct_s2n_connection) c_int;
pub extern fn s2n_connection_get_client_hello_version(conn: *struct_s2n_connection) c_int;
pub extern fn s2n_connection_client_cert_used(conn: *struct_s2n_connection) c_int;
pub extern fn s2n_connection_get_cipher(conn: *struct_s2n_connection) [*c]const u8;
pub extern fn s2n_connection_get_cipher_iana_value(conn: *struct_s2n_connection, first: [*c]u8, second: [*c]u8) c_int;
pub extern fn s2n_connection_is_valid_for_cipher_preferences(conn: *struct_s2n_connection, version: [*c]const u8) c_int;
pub extern fn s2n_connection_get_curve(conn: *struct_s2n_connection) [*c]const u8;
pub extern fn s2n_connection_get_kem_name(conn: *struct_s2n_connection) [*c]const u8;
pub extern fn s2n_connection_get_kem_group_name(conn: *struct_s2n_connection) [*c]const u8;
pub extern fn s2n_connection_get_alert(conn: *struct_s2n_connection) c_int;
pub extern fn s2n_connection_get_handshake_type_name(conn: *struct_s2n_connection) [*c]const u8;
pub extern fn s2n_connection_get_last_message_name(conn: *struct_s2n_connection) [*c]const u8;
pub const struct_s2n_async_pkey_op = opaque {};
pub const S2N_ASYNC_PKEY_VALIDATION_FAST: c_int = 0;
pub const S2N_ASYNC_PKEY_VALIDATION_STRICT: c_int = 1;
pub const s2n_async_pkey_validation_mode = c_uint;
pub const S2N_ASYNC_DECRYPT: c_int = 0;
pub const S2N_ASYNC_SIGN: c_int = 1;
pub const s2n_async_pkey_op_type = c_uint;
pub const s2n_async_pkey_fn = ?fn (*struct_s2n_connection, *struct_s2n_async_pkey_op) callconv(.C) c_int;
pub extern fn s2n_config_set_async_pkey_callback(config: *struct_s2n_config, @"fn": s2n_async_pkey_fn) c_int;
pub extern fn s2n_async_pkey_op_perform(op: *struct_s2n_async_pkey_op, key: ?*s2n_cert_private_key) c_int;
pub extern fn s2n_async_pkey_op_apply(op: *struct_s2n_async_pkey_op, conn: *struct_s2n_connection) c_int;
pub extern fn s2n_async_pkey_op_free(op: *struct_s2n_async_pkey_op) c_int;
pub extern fn s2n_config_set_async_pkey_validation_mode(config: *struct_s2n_config, mode: s2n_async_pkey_validation_mode) c_int;
pub extern fn s2n_async_pkey_op_get_op_type(op: *struct_s2n_async_pkey_op, @"type": [*c]s2n_async_pkey_op_type) c_int;
pub extern fn s2n_async_pkey_op_get_input_size(op: *struct_s2n_async_pkey_op, data_len: [*c]u32) c_int;
pub extern fn s2n_async_pkey_op_get_input(op: *struct_s2n_async_pkey_op, data: [*c]u8, data_len: u32) c_int;
pub extern fn s2n_async_pkey_op_set_output(op: *struct_s2n_async_pkey_op, data: [*c]const u8, data_len: u32) c_int;
pub const s2n_key_log_fn = ?fn (?*c_void, *struct_s2n_connection, [*c]u8, usize) callconv(.C) c_int;
pub extern fn s2n_config_set_key_log_cb(config: *struct_s2n_config, callback: s2n_key_log_fn, ctx: ?*c_void) c_int;
pub extern fn s2n_config_enable_cert_req_dss_legacy_compat(config: *struct_s2n_config) c_int;
pub extern fn s2n_config_set_server_max_early_data_size(config: *struct_s2n_config, max_early_data_size: u32) c_int;
pub extern fn s2n_connection_set_server_max_early_data_size(conn: *struct_s2n_connection, max_early_data_size: u32) c_int;
pub extern fn s2n_connection_set_server_early_data_context(conn: *struct_s2n_connection, context: [*c]const u8, context_size: u16) c_int;
pub extern fn s2n_psk_configure_early_data(psk: *struct_s2n_psk, max_early_data_size: u32, cipher_suite_first_byte: u8, cipher_suite_second_byte: u8) c_int;
pub extern fn s2n_psk_set_application_protocol(psk: *struct_s2n_psk, application_protocol: [*c]const u8, size: u8) c_int;
pub extern fn s2n_psk_set_early_data_context(psk: *struct_s2n_psk, context: [*c]const u8, size: u16) c_int;
pub const S2N_EARLY_DATA_STATUS_OK: c_int = 0;
pub const S2N_EARLY_DATA_STATUS_NOT_REQUESTED: c_int = 1;
pub const S2N_EARLY_DATA_STATUS_REJECTED: c_int = 2;
pub const S2N_EARLY_DATA_STATUS_END: c_int = 3;
pub const s2n_early_data_status_t = c_uint;
pub extern fn s2n_connection_get_early_data_status(conn: *struct_s2n_connection, status: [*c]s2n_early_data_status_t) c_int;
pub extern fn s2n_connection_get_remaining_early_data_size(conn: *struct_s2n_connection, allowed_early_data_size: [*c]u32) c_int;
pub extern fn s2n_connection_get_max_early_data_size(conn: *struct_s2n_connection, max_early_data_size: [*c]u32) c_int;
pub extern fn s2n_send_early_data(conn: *struct_s2n_connection, data: [*c]const u8, data_len: isize, data_sent: [*c]isize, blocked: [*c]s2n_blocked_status) c_int;
pub extern fn s2n_recv_early_data(conn: *struct_s2n_connection, data: [*c]u8, max_data_len: isize, data_received: [*c]isize, blocked: [*c]s2n_blocked_status) c_int;
pub const struct_s2n_offered_early_data = opaque {};
pub const s2n_early_data_cb = ?fn (*struct_s2n_connection, *struct_s2n_offered_early_data) callconv(.C) c_int;
pub extern fn s2n_config_set_early_data_cb(config: *struct_s2n_config, cb: s2n_early_data_cb) c_int;
pub extern fn s2n_offered_early_data_get_context_length(early_data: *struct_s2n_offered_early_data, context_len: [*c]u16) c_int;
pub extern fn s2n_offered_early_data_get_context(early_data: *struct_s2n_offered_early_data, context: [*c]u8, max_len: u16) c_int;
pub extern fn s2n_offered_early_data_reject(early_data: *struct_s2n_offered_early_data) c_int;
pub extern fn s2n_offered_early_data_accept(early_data: *struct_s2n_offered_early_data) c_int;
pub const S2N_SUCCESS = @as(c_int, 0);
pub const S2N_FAILURE = -@as(c_int, 1);
pub const S2N_CALLBACK_BLOCKED = -@as(c_int, 2);
pub const S2N_MINIMUM_SUPPORTED_TLS_RECORD_MAJOR_VERSION = @as(c_int, 2);
pub const S2N_MAXIMUM_SUPPORTED_TLS_RECORD_MAJOR_VERSION = @as(c_int, 3);
pub const S2N_SSLv2 = @as(c_int, 20);
pub const S2N_SSLv3 = @as(c_int, 30);
pub const S2N_TLS10 = @as(c_int, 31);
pub const S2N_TLS11 = @as(c_int, 32);
pub const S2N_TLS12 = @as(c_int, 33);
pub const S2N_TLS13 = @as(c_int, 34);
pub const S2N_UNKNOWN_PROTOCOL_VERSION = @as(c_int, 0);
pub const s2n_config = struct_s2n_config;
pub const s2n_connection = struct_s2n_connection;
pub const s2n_stacktrace = struct_s2n_stacktrace;
pub const s2n_cert = struct_s2n_cert;
pub const s2n_cert_chain_and_key = struct_s2n_cert_chain_and_key;
pub const s2n_pkey = struct_s2n_pkey;
pub const s2n_client_hello = struct_s2n_client_hello;
pub const s2n_session_ticket = struct_s2n_session_ticket;
pub const s2n_psk = struct_s2n_psk;
pub const s2n_offered_psk = struct_s2n_offered_psk;
pub const s2n_offered_psk_list = struct_s2n_offered_psk_list;
pub const s2n_async_pkey_op = struct_s2n_async_pkey_op;
pub const s2n_offered_early_data = struct_s2n_offered_early_data;

threadlocal var booted = false;
pub threadlocal var global_s2n_config: *s2n_config = undefined;
const unexpectedErrno = std.os.unexpectedErrno;
const S2NError = error{ Closed, WouldBlock, Alert, Protocol, Internal, Usage };
pub inline fn s2nErrorNo(rc: c_int) S2NError!std.os.system.E {
    switch (s2n_error_get_type(rc)) {
        -1 => return error.Internal,
        S2N_ERR_T_OK => return .SUCCESS,
        S2N_ERR_T_IO => return std.os.errno(rc),
        S2N_ERR_T_CLOSED => return error.Closed,
        S2N_ERR_T_BLOCKED => return error.WouldBlock,
        S2N_ERR_T_ALERT => return error.Alert,
        S2N_ERR_T_PROTO => return error.Protocol,
        S2N_ERR_T_INTERNAL => return error.Internal,
        S2N_ERR_T_USAGE => return error.Usage,
        else => return std.os.errno(rc),
    }
}

pub const Connection = struct {
    conn: *s2n_connection = undefined,
    fd: std.os.socket_t,
    node: *Pool.List.Node,
    disable_shutdown: bool = false,

    pub const Pool = struct {
        pub const List = std.SinglyLinkedList(*s2n_connection);
        pub var list = List{};

        pub fn get() *Pool.List.Node {
            if (list.first) |first| {
                return first;
            } else {
                var node = Allocator.allocator.create(Pool.List.Node) catch unreachable;
                node.* = Pool.List.Node{ .data = s2n_connection_new(S2N_CLIENT) };
                return node;
            }
        }

        pub fn put(conn: *Pool.List.Node) void {
            _ = s2n_connection_wipe(conn.data);
            list.prepend(conn);
        }
    };

    // var pool = std.SinglyLinkedList();
    // var pool_used: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0);

    pub fn init(fd: std.os.socket_t) Connection {
        return Connection{
            .fd = fd,
            .conn = undefined,
            .node = undefined,
        };
    }

    const errno = s2nErrorNo;

    // pub fn s2n_recv_function(conn: *s2n_connection, buf: [*c]u8, len: u32) callconv(.C) c_int {
    //     if (buf == null) return 0;
    //     var fd: c_int = 0;
    //     _ = s2n_connection_get_read_fd(conn, &fd);
    //     return @intCast(c_int, std.os.system.recvfrom(fd, buf, len, std.os.SOCK_CLOEXEC, null, null));
    // }
    // pub fn s2n_send_function(conn: *s2n_connection, buf: [*c]const u8, len: u32) callconv(.C) c_int {
    //     if (buf == null) return 0;
    //     var fd: c_int = 0;
    //     _ = s2n_connection_get_write_fd(conn, &fd);

    //     return @intCast(c_int, std.os.system.sendto(fd, buf.?, len, std.os.SOCK_CLOEXEC, null, 0));
    // }

    pub fn start(this: *Connection, server_name: [:0]const u8) !void {
        this.node = Pool.get();
        this.conn = this.node.data;
        s2nassert(s2n_connection_set_ctx(this.conn, this));
        s2nassert(s2n_connection_set_config(this.conn, global_s2n_config));
        s2nassert(s2n_connection_set_read_fd(this.conn, @intCast(c_int, this.fd)));
        s2nassert(s2n_connection_set_fd(this.conn, @intCast(c_int, this.fd)));
        s2nassert(s2n_connection_set_write_fd(this.conn, @intCast(c_int, this.fd)));
        s2nassert(s2n_connection_set_blinding(this.conn, S2N_SELF_SERVICE_BLINDING));
        // s2nassert(s2n_connection_set_dynamic_record(this.conn));
        s2nassert(s2n_set_server_name(this.conn, server_name.ptr));

        // _ = s2n_connection_set_recv_cb(this.conn, s2n_recv_function);
        // _ = s2n_connection_set_send_cb(this.conn, s2n_send_function);
        const rc = s2n_negotiate(this.conn, &blocked_status);
        if (rc < 0) {
            Output.printErrorln("Alert: {d}", .{s2n_connection_get_alert(this.conn)});
            Output.prettyErrorln("ERROR: {s}", .{s2n_strerror_debug(rc, "EN")});
        }

        defer s2nassert(s2n_connection_free_handshake(this.conn));

        switch (try s2nErrorNo(rc)) {
            .SUCCESS => return,
            .BADF => unreachable, // always a race condition
            .FAULT => unreachable,
            .INVAL => unreachable,
            .NOTCONN => unreachable,
            .NOTSOCK => unreachable,
            .INTR => return error.Interrupted,
            .AGAIN => return error.WouldBlock,
            .NOMEM => return error.SystemResources,
            .CONNREFUSED => return error.ConnectionRefused,
            .CONNRESET => return error.ConnectionResetByPeer,
            else => |err| return unexpectedErrno(err),
        }
    }

    pub fn close(this: *Connection) !void {
        if (!this.disable_shutdown) {
            _ = s2n_shutdown(this.conn, &blocked_status);
        }
        std.os.closeSocket(this.fd);
        Pool.put(this.node);
    }

    pub const Writer = std.io.Writer(*Connection, WriteError, write);
    pub const Reader = std.io.Reader(*Connection, ReadError, read);

    pub fn writer(this: *Connection) Writer {
        return Writer{ .context = this };
    }

    pub fn reader(this: *Connection) Reader {
        return Reader{ .context = this };
    }

    pub const ReadError = error{
        WouldBlock,
        SystemResources,
        ConnectionRefused,
        ConnectionResetByPeer,
        Unexpected,
        Interrupted,
    } || S2NError;

    pub fn read(this: *Connection, buf: []u8) ReadError!usize {
        const rc = s2n_recv(this.conn, buf.ptr, @intCast(isize, buf.len), &blocked_status);

        switch (try errno(@intCast(c_int, rc))) {
            .SUCCESS => return @intCast(usize, rc),
            .BADF => unreachable, // always a race condition
            .FAULT => unreachable,
            .INVAL => unreachable,
            .NOTCONN => unreachable,
            .NOTSOCK => unreachable,
            .INTR => return error.Interrupted,
            .AGAIN => return error.WouldBlock,
            .NOMEM => return error.SystemResources,
            .CONNREFUSED => return error.ConnectionRefused,
            .CONNRESET => return error.ConnectionResetByPeer,
            else => |err| return unexpectedErrno(err),
        }
    }

    pub fn peek(this: *Connection) u32 {
        return s2n_peek(this.conn);
    }

    var blocked_status: s2n_blocked_status = 0;
    pub const WriteError = error{
        AccessDenied,
        AddressFamilyNotSupported,
        BrokenPipe,
        ConnectionResetByPeer,
        FastOpenAlreadyInProgress,
        FileNotFound,
        MessageTooBig,
        NameTooLong,
        NetworkSubsystemFailed,
        NetworkUnreachable,
        NotDir,
        SocketNotConnected,
        SymLinkLoop,
        SystemResources,
        WouldBlock,
        Unexpected,
    } || S2NError;
    pub fn write(this: *Connection, buf: []const u8) WriteError!usize {
        const rc = s2n_send(this.conn, buf.ptr, @intCast(isize, buf.len), &blocked_status);
        // std.os.sendto(
        switch (try errno(@intCast(c_int, rc))) {
            .SUCCESS => return buf.len,
            .ACCES => return error.AccessDenied,
            .AGAIN => return error.WouldBlock,
            .ALREADY => return error.FastOpenAlreadyInProgress,
            .BADF => unreachable, // always a race condition
            .CONNRESET => return error.ConnectionResetByPeer,
            .DESTADDRREQ => unreachable, // The socket is not connection-mode, and no peer address is set.
            .FAULT => unreachable, // An invalid user space address was specified for an argument.
            .INTR => unreachable,
            .INVAL => unreachable, // Invalid argument passed.
            .ISCONN => unreachable, // connection-mode socket was connected already but a recipient was specified
            .MSGSIZE => return error.MessageTooBig,
            .NOBUFS => return error.SystemResources,
            .NOMEM => return error.SystemResources,
            .NOTSOCK => unreachable, // The file descriptor sockfd does not refer to a socket.
            .OPNOTSUPP => unreachable, // Some bit in the flags argument is inappropriate for the socket type.
            .PIPE => return error.BrokenPipe,
            .AFNOSUPPORT => return error.AddressFamilyNotSupported,
            .LOOP => return error.SymLinkLoop,
            .NAMETOOLONG => return error.NameTooLong,
            .NOENT => return error.FileNotFound,
            .NOTDIR => return error.NotDir,
            .HOSTUNREACH => return error.NetworkUnreachable,
            .NETUNREACH => return error.NetworkUnreachable,
            .NOTCONN => return error.SocketNotConnected,
            .NETDOWN => return error.NetworkSubsystemFailed,
            else => |err| return std.os.unexpectedErrno(err),
        }
    }
};

pub const Allocator = struct {
    pub var allocator: *std.mem.Allocator = undefined;

    pub fn initCallback() callconv(.C) c_int {
        return S2N_SUCCESS;
    }

    pub fn deinitCallback() callconv(.C) c_int {
        return S2N_SUCCESS;
    }

    pub fn mallocCallback(ptr: **c_void, requested: u32, allocated: *u32) callconv(.C) c_int {
        const bytes = allocator.allocAdvanced(u8, null, requested, .at_least) catch return S2N_FAILURE;
        @memset(bytes.ptr, 0, bytes.len);
        allocated.* = @intCast(u32, bytes.len);
        ptr.* = bytes.ptr;
        return S2N_SUCCESS;
    }

    pub fn freeCallback(ptr_: ?*c_void, size: u32) callconv(.C) c_int {
        var ptr = ptr_ orelse return S2N_SUCCESS;
        if (size == 0)
            return S2N_SUCCESS;

        var slice_ptr = @ptrCast([*]u8, ptr);
        var slice = slice_ptr[0..size];
        allocator.free(slice);
        return S2N_SUCCESS;
    }
};
