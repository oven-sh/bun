const std = @import("std");
const bun = @import("root").bun;
const C = @import("std").zig.c_builtins;
const pthread_rwlock_t = if (bun.Environment.isPosix) @import("../sync.zig").RwLock.pthread_rwlock_t else *anyopaque;
const time_t = C.time_t;
const va_list = C.va_list;
const struct_timeval = C.struct_timeval;
const __attribute__ = C.__attribute__;
const ERR_LIB_DSO = C.ERR_LIB_DSO;
const ERR_LIB_STORE = C.ERR_LIB_STORE;
const ERR_LIB_FIPS = C.ERR_LIB_FIPS;
const ERR_LIB_CMS = C.ERR_LIB_CMS;
const ERR_LIB_TS = C.ERR_LIB_TS;
const ERR_LIB_JPAKE = C.ERR_LIB_JPAKE;
const DEFINE_NAMED_STACK_OF = C.DEFINE_NAMED_STACK_OF;
const __FILE__ = C.__FILE__;
const struct_timespec = C.struct_timespec;
const _CLOCK_REALTIME = C._CLOCK_REALTIME;
const _CLOCK_MONOTONIC = C._CLOCK_MONOTONIC;
const _CLOCK_MONOTONIC_RAW = C._CLOCK_MONOTONIC_RAW;
const _CLOCK_MONOTONIC_RAW_APPROX = C._CLOCK_MONOTONIC_RAW_APPROX;
const _CLOCK_UPTIME_RAW = C._CLOCK_UPTIME_RAW;
const _CLOCK_UPTIME_RAW_APPROX = C._CLOCK_UPTIME_RAW_APPROX;
const _CLOCK_PROCESS_CPUTIME_ID = C._CLOCK_PROCESS_CPUTIME_ID;
const _CLOCK_THREAD_CPUTIME_ID = C._CLOCK_THREAD_CPUTIME_ID;
const NULL = C.NULL;
const DECLARE_ASN1_FUNCTIONS_name = C.DECLARE_ASN1_FUNCTIONS_name;
const DECLARE_ASN1_ALLOC_FUNCTIONS_name = C.DECLARE_ASN1_ALLOC_FUNCTIONS_name;
const timercmp = C.timercmp;
const doesnt_exist = C.doesnt_exist;
const struct_tm = C.struct_tm;
const enum_ssl_verify_result_t = C.enum_ssl_verify_result_t;
/// `isize` alias. Kept for clarity.
///
/// Docs from OpenSSL:
/// > ossl_ssize_t is a signed type which is large enough to fit the size of any
/// > valid memory allocation. We prefer using |size_t|, but sometimes we need a
/// > signed type for OpenSSL API compatibility. This type can be used in such
/// > cases to avoid overflow.
/// >
/// > Not all |size_t| values fit in |ossl_ssize_t|, but all |size_t| values that
/// > are sizes of or indices into C objects, can be converted without overflow.
const ossl_ssize_t = isize;

pub const CRYPTO_THREADID = c_int;
pub const struct_asn1_null_st = opaque {};
pub const ASN1_NULL = struct_asn1_null_st;
pub const ASN1_BOOLEAN = c_int;
pub const struct_ASN1_ITEM_st = opaque {};
pub const ASN1_ITEM = struct_ASN1_ITEM_st;
pub const struct_asn1_object_st = opaque {};
pub const ASN1_OBJECT = struct_asn1_object_st;
pub const struct_asn1_pctx_st = opaque {};
pub const ASN1_PCTX = struct_asn1_pctx_st;
pub const struct_asn1_string_st = extern struct {
    length: c_int,
    type: c_int,
    data: [*c]u8,
    flags: c_long,
};
pub const ASN1_BIT_STRING = struct_asn1_string_st;
pub const ASN1_BMPSTRING = struct_asn1_string_st;
pub const ASN1_ENUMERATED = struct_asn1_string_st;
pub const ASN1_GENERALIZEDTIME = struct_asn1_string_st;
pub const ASN1_GENERALSTRING = struct_asn1_string_st;
pub const ASN1_IA5STRING = struct_asn1_string_st;
pub const ASN1_INTEGER = struct_asn1_string_st;
pub const ASN1_OCTET_STRING = struct_asn1_string_st;
pub const ASN1_PRINTABLESTRING = struct_asn1_string_st;
pub const ASN1_STRING = struct_asn1_string_st;
pub const ASN1_T61STRING = struct_asn1_string_st;
pub const ASN1_TIME = struct_asn1_string_st;
pub const ASN1_UNIVERSALSTRING = struct_asn1_string_st;
pub const ASN1_UTCTIME = struct_asn1_string_st;
pub const ASN1_UTF8STRING = struct_asn1_string_st;
pub const ASN1_VISIBLESTRING = struct_asn1_string_st;
pub const struct_ASN1_VALUE_st = opaque {};
pub const ASN1_VALUE = struct_ASN1_VALUE_st;
const union_unnamed_1 = extern union {
    ptr: [*c]u8,
    boolean: ASN1_BOOLEAN,
    asn1_string: [*c]ASN1_STRING,
    object: ?*ASN1_OBJECT,
    integer: [*c]ASN1_INTEGER,
    enumerated: [*c]ASN1_ENUMERATED,
    bit_string: [*c]ASN1_BIT_STRING,
    octet_string: [*c]ASN1_OCTET_STRING,
    printablestring: [*c]ASN1_PRINTABLESTRING,
    t61string: [*c]ASN1_T61STRING,
    ia5string: [*c]ASN1_IA5STRING,
    generalstring: [*c]ASN1_GENERALSTRING,
    bmpstring: [*c]ASN1_BMPSTRING,
    universalstring: [*c]ASN1_UNIVERSALSTRING,
    utctime: [*c]ASN1_UTCTIME,
    generalizedtime: [*c]ASN1_GENERALIZEDTIME,
    visiblestring: [*c]ASN1_VISIBLESTRING,
    utf8string: [*c]ASN1_UTF8STRING,
    set: [*c]ASN1_STRING,
    sequence: [*c]ASN1_STRING,
    asn1_value: ?*ASN1_VALUE,
};
pub const struct_asn1_type_st = extern struct {
    type: c_int,
    value: union_unnamed_1,
};
pub const ASN1_TYPE = struct_asn1_type_st;
pub const struct_AUTHORITY_KEYID_st = opaque {};
pub const AUTHORITY_KEYID = struct_AUTHORITY_KEYID_st;
pub const struct_BASIC_CONSTRAINTS_st = opaque {};
pub const BASIC_CONSTRAINTS = struct_BASIC_CONSTRAINTS_st;
pub const struct_DIST_POINT_st = opaque {};
pub const DIST_POINT = struct_DIST_POINT_st;
pub const BN_ULONG = u64;
pub const struct_bignum_st = extern struct {
    d: [*c]BN_ULONG,
    width: c_int,
    dmax: c_int,
    neg: c_int,
    flags: c_int,
};
pub const BIGNUM = struct_bignum_st;
pub const struct_DSA_SIG_st = extern struct {
    r: [*c]BIGNUM,
    s: [*c]BIGNUM,
};
pub const DSA_SIG = struct_DSA_SIG_st;
pub const struct_ISSUING_DIST_POINT_st = opaque {};
pub const ISSUING_DIST_POINT = struct_ISSUING_DIST_POINT_st;
pub const struct_NAME_CONSTRAINTS_st = opaque {};
pub const NAME_CONSTRAINTS = struct_NAME_CONSTRAINTS_st;
pub const struct_X509_pubkey_st = opaque {};
pub const X509_PUBKEY = struct_X509_pubkey_st;
pub const struct_Netscape_spkac_st = extern struct {
    pubkey: ?*X509_PUBKEY,
    challenge: [*c]ASN1_IA5STRING,
};
pub const NETSCAPE_SPKAC = struct_Netscape_spkac_st;
pub const struct_X509_algor_st = extern struct {
    algorithm: ?*ASN1_OBJECT,
    parameter: [*c]ASN1_TYPE,
};
pub const X509_ALGOR = struct_X509_algor_st;
pub const struct_Netscape_spki_st = extern struct {
    spkac: [*c]NETSCAPE_SPKAC,
    sig_algor: [*c]X509_ALGOR,
    signature: [*c]ASN1_BIT_STRING,
};
pub const NETSCAPE_SPKI = struct_Netscape_spki_st;
pub const struct_RIPEMD160state_st = opaque {};
pub const RIPEMD160_CTX = struct_RIPEMD160state_st;
pub const struct_X509_VERIFY_PARAM_st = opaque {};
pub const X509_VERIFY_PARAM = struct_X509_VERIFY_PARAM_st;
pub const struct_X509_crl_st = opaque {};
pub const X509_CRL = struct_X509_crl_st;
pub const struct_X509_extension_st = opaque {};
pub const X509_EXTENSION = struct_X509_extension_st;
pub const struct_x509_st = opaque {
    pub fn dup(this: *X509) ?*X509 {
        return X509_dup(this);
    }

    pub fn ref(this: *X509) *X509 {
        _ = X509_up_ref(this);
        return this;
    }

    pub fn free(this: *X509) void {
        X509_free(this);
    }
};
pub const X509 = struct_x509_st;
pub const CRYPTO_refcount_t = u32;
pub const struct_openssl_method_common_st = extern struct {
    references: c_int,
    is_static: u8,
};
pub const struct_rsa_meth_st = extern struct {
    common: struct_openssl_method_common_st,
    app_data: ?*anyopaque,
    init: ?*const fn (?*RSA) callconv(.C) c_int,
    finish: ?*const fn (?*RSA) callconv(.C) c_int,
    size: ?*const fn (?*const RSA) callconv(.C) usize,
    sign: ?*const fn (c_int, [*c]const u8, c_uint, [*c]u8, [*c]c_uint, ?*const RSA) callconv(.C) c_int,
    sign_raw: ?*const fn (?*RSA, [*c]usize, [*c]u8, usize, [*c]const u8, usize, c_int) callconv(.C) c_int,
    decrypt: ?*const fn (?*RSA, [*c]usize, [*c]u8, usize, [*c]const u8, usize, c_int) callconv(.C) c_int,
    private_transform: ?*const fn (?*RSA, [*c]u8, [*c]const u8, usize) callconv(.C) c_int,
    flags: c_int,
};
pub const RSA_METHOD = struct_rsa_meth_st;
pub const struct_stack_st_void = opaque {};
pub const struct_crypto_ex_data_st = extern struct {
    sk: ?*struct_stack_st_void,
};
pub const CRYPTO_EX_DATA = struct_crypto_ex_data_st;
pub const CRYPTO_MUTEX = pthread_rwlock_t;
pub const struct_bn_mont_ctx_st = extern struct {
    RR: BIGNUM,
    N: BIGNUM,
    n0: [2]BN_ULONG,
};
pub const BN_MONT_CTX = struct_bn_mont_ctx_st;
pub const struct_bn_blinding_st = opaque {};
pub const BN_BLINDING = struct_bn_blinding_st; // boringssl/include/openssl/rsa.h:788:12: warning: struct demoted to opaque type - has bitfield
pub const struct_rsa_st = opaque {};
pub const RSA = struct_rsa_st;
pub const struct_dsa_st = extern struct {
    version: c_long,
    p: [*c]BIGNUM,
    q: [*c]BIGNUM,
    g: [*c]BIGNUM,
    pub_key: [*c]BIGNUM,
    priv_key: [*c]BIGNUM,
    flags: c_int,
    method_mont_lock: CRYPTO_MUTEX,
    method_mont_p: [*c]BN_MONT_CTX,
    method_mont_q: [*c]BN_MONT_CTX,
    references: CRYPTO_refcount_t,
    ex_data: CRYPTO_EX_DATA,
};
pub const DSA = struct_dsa_st;
pub const struct_dh_st = opaque {};
pub const DH = struct_dh_st;
pub const struct_ec_key_st = opaque {};
pub const EC_KEY = struct_ec_key_st;
const union_unnamed_2 = extern union {
    ptr: ?*anyopaque,
    rsa: ?*RSA,
    dsa: [*c]DSA,
    dh: ?*DH,
    ec: ?*EC_KEY,
};
pub const struct_evp_pkey_asn1_method_st = opaque {};
pub const EVP_PKEY_ASN1_METHOD = struct_evp_pkey_asn1_method_st;
pub const struct_evp_pkey_st = extern struct {
    references: CRYPTO_refcount_t,
    type: c_int,
    pkey: union_unnamed_2,
    ameth: ?*const EVP_PKEY_ASN1_METHOD,
};
pub const EVP_PKEY = struct_evp_pkey_st;
pub const struct_evp_cipher_st = opaque {};
pub const EVP_CIPHER = struct_evp_cipher_st;
pub const struct_evp_cipher_info_st = extern struct {
    cipher: ?*const EVP_CIPHER,
    iv: [16]u8,
};
pub const EVP_CIPHER_INFO = struct_evp_cipher_info_st;
pub const struct_private_key_st = extern struct {
    version: c_int,
    enc_algor: [*c]X509_ALGOR,
    enc_pkey: [*c]ASN1_OCTET_STRING,
    dec_pkey: [*c]EVP_PKEY,
    key_length: c_int,
    key_data: [*c]u8,
    key_free: c_int,
    cipher: EVP_CIPHER_INFO,
};
pub const X509_PKEY = struct_private_key_st;
pub const struct_X509_info_st = extern struct {
    x509: ?*X509,
    crl: ?*X509_CRL,
    x_pkey: [*c]X509_PKEY,
    enc_cipher: EVP_CIPHER_INFO,
    enc_len: c_int,
    enc_data: [*c]u8,
};
pub const X509_INFO = struct_X509_info_st;
pub const struct_X509_name_entry_st = opaque {};
pub const X509_NAME_ENTRY = struct_X509_name_entry_st;
pub const struct_X509_name_st = opaque {};
pub const X509_NAME = struct_X509_name_st;
pub const struct_X509_req_st = opaque {};
pub const X509_REQ = struct_X509_req_st;
pub const struct_X509_sig_st = opaque {};
pub const X509_SIG = struct_X509_sig_st;
pub const struct_bignum_ctx = opaque {};
pub const BN_CTX = struct_bignum_ctx;
pub const BIO_METHOD = struct_bio_method_st;
// pub const struct_bio_st = extern struct {
//     method: [*c]const BIO_METHOD,
//     init: c_int,
//     shutdown: c_int,
//     flags: c_int,
//     retry_reason: c_int,
//     num: c_int,
//     references: CRYPTO_refcount_t,
//     ptr: ?*anyopaque,
//     next_bio: [*c]BIO,
//     num_read: usize,
//     num_write: usize,
// };
pub const BIO = struct_bio_st;
pub const bio_info_cb = ?*const fn ([*c]BIO, c_int, [*c]const u8, c_int, c_long, c_long) callconv(.C) c_long;
pub const struct_bio_method_st = extern struct {
    type: c_int,
    name: [*c]const u8,
    bwrite: ?*const fn ([*c]BIO, [*c]const u8, c_int) callconv(.C) c_int,
    bread: ?*const fn ([*c]BIO, [*c]u8, c_int) callconv(.C) c_int,
    bputs: ?*const fn ([*c]BIO, [*c]const u8) callconv(.C) c_int,
    bgets: ?*const fn ([*c]BIO, [*c]u8, c_int) callconv(.C) c_int,
    ctrl: ?*const fn ([*c]BIO, c_int, c_long, ?*anyopaque) callconv(.C) c_long,
    create: ?*const fn ([*c]BIO) callconv(.C) c_int,
    destroy: ?*const fn ([*c]BIO) callconv(.C) c_int,
    callback_ctrl: ?*const fn ([*c]BIO, c_int, bio_info_cb) callconv(.C) c_long,
};
pub const struct_blake2b_state_st = opaque {};
pub const BLAKE2B_CTX = struct_blake2b_state_st;
pub const struct_bn_gencb_st = extern struct {
    arg: ?*anyopaque,
    callback: ?*const fn (c_int, c_int, [*c]struct_bn_gencb_st) callconv(.C) c_int,
};
pub const BN_GENCB = struct_bn_gencb_st;
pub const struct_buf_mem_st = extern struct {
    length: usize,
    data: [*c]u8,
    max: usize,
};
pub const BUF_MEM = struct_buf_mem_st;
pub const CBB = struct_cbb_st; // boringssl/include/openssl/bytestring.h:403:12: warning: struct demoted to opaque type - has bitfield
pub const struct_cbb_buffer_st = opaque {}; // boringssl/include/openssl/bytestring.h:418:12: warning: struct demoted to opaque type - has bitfield
pub const struct_cbb_child_st = opaque {};
const union_unnamed_3 = extern union {
    base: struct_cbb_buffer_st,
    child: struct_cbb_child_st,
};
pub const struct_cbb_st = extern struct {
    child: [*c]CBB,
    is_child: u8,
    u: union_unnamed_3,
};
pub const struct_cbs_st = extern struct {
    data: [*c]const u8,
    len: usize,
};
pub const CBS = struct_cbs_st;
pub const struct_cmac_ctx_st = opaque {};
pub const CMAC_CTX = struct_cmac_ctx_st;
pub const struct_conf_st = opaque {};
pub const CONF = struct_conf_st;
pub const struct_conf_value_st = opaque {};
pub const CONF_VALUE = struct_conf_value_st;
pub const struct_crypto_buffer_pool_st = opaque {};
pub const CRYPTO_BUFFER_POOL = struct_crypto_buffer_pool_st;
pub const struct_crypto_buffer_st = opaque {};
pub const CRYPTO_BUFFER = struct_crypto_buffer_st;
pub const struct_ctr_drbg_state_st = opaque {};
pub const CTR_DRBG_STATE = struct_ctr_drbg_state_st;
pub const struct_ec_group_st = opaque {};
pub const EC_GROUP = struct_ec_group_st;
pub const struct_ec_point_st = opaque {};
pub const EC_POINT = struct_ec_point_st;
pub const struct_ecdsa_method_st = extern struct {
    common: struct_openssl_method_common_st,
    app_data: ?*anyopaque,
    init: ?*const fn (?*EC_KEY) callconv(.C) c_int,
    finish: ?*const fn (?*EC_KEY) callconv(.C) c_int,
    group_order_size: ?*const fn (?*const EC_KEY) callconv(.C) usize,
    sign: ?*const fn ([*c]const u8, usize, [*c]u8, [*c]c_uint, ?*EC_KEY) callconv(.C) c_int,
    flags: c_int,
};
pub const ECDSA_METHOD = struct_ecdsa_method_st;
pub const struct_ecdsa_sig_st = extern struct {
    r: [*c]BIGNUM,
    s: [*c]BIGNUM,
};
pub const ECDSA_SIG = struct_ecdsa_sig_st;
pub const struct_engine_st = opaque {};
pub const ENGINE = struct_engine_st;
pub const struct_env_md_st = opaque {};
pub const EVP_MD = struct_env_md_st;
pub const struct_evp_pkey_ctx_st = opaque {};
pub const EVP_PKEY_CTX = struct_evp_pkey_ctx_st;
pub const struct_evp_md_pctx_ops = opaque {};
pub const struct_env_md_ctx_st = extern struct {
    digest: ?*const EVP_MD,
    md_data: ?*anyopaque,
    pctx: ?*EVP_PKEY_CTX,
    pctx_ops: ?*const struct_evp_md_pctx_ops,
};
pub const EVP_MD_CTX = struct_env_md_ctx_st;
pub const struct_evp_aead_st = opaque {};
pub const EVP_AEAD = struct_evp_aead_st;
pub const union_evp_aead_ctx_st_state = extern union {
    @"opaque": [580]u8,
    alignment: u64,
};
pub const struct_evp_aead_ctx_st = extern struct {
    aead: ?*const EVP_AEAD,
    state: union_evp_aead_ctx_st_state,
    tag_len: u8,
};
pub const EVP_AEAD_CTX = struct_evp_aead_ctx_st;
pub const struct_evp_cipher_ctx_st = extern struct {
    cipher: ?*const EVP_CIPHER,
    app_data: ?*anyopaque,
    cipher_data: ?*anyopaque,
    key_len: c_uint,
    encrypt: c_int,
    flags: u32,
    oiv: [16]u8,
    iv: [16]u8,
    buf: [32]u8,
    buf_len: c_int,
    num: c_uint,
    final_used: c_int,
    final: [32]u8,
    poisoned: c_int,
};
pub const EVP_CIPHER_CTX = struct_evp_cipher_ctx_st;
pub const struct_evp_encode_ctx_st = extern struct {
    data_used: c_uint,
    data: [48]u8,
    eof_seen: u8,
    error_encountered: u8,
};
pub const EVP_ENCODE_CTX = struct_evp_encode_ctx_st;
pub const struct_evp_hpke_aead_st = opaque {};
pub const EVP_HPKE_AEAD = struct_evp_hpke_aead_st;
pub const struct_evp_hpke_ctx_st = opaque {};
pub const EVP_HPKE_CTX = struct_evp_hpke_ctx_st;
pub const struct_evp_hpke_kdf_st = opaque {};
pub const EVP_HPKE_KDF = struct_evp_hpke_kdf_st;
pub const struct_evp_hpke_kem_st = opaque {};
pub const EVP_HPKE_KEM = struct_evp_hpke_kem_st;
pub const struct_evp_hpke_key_st = opaque {};
pub const EVP_HPKE_KEY = struct_evp_hpke_key_st;
pub const struct_evp_pkey_method_st = opaque {};
pub const EVP_PKEY_METHOD = struct_evp_pkey_method_st;
pub const struct_hmac_ctx_st = extern struct {
    md: ?*const EVP_MD,
    md_ctx: EVP_MD_CTX,
    i_ctx: EVP_MD_CTX,
    o_ctx: EVP_MD_CTX,
};
pub const HMAC_CTX = struct_hmac_ctx_st;
pub const struct_md4_state_st = opaque {};
pub const MD4_CTX = struct_md4_state_st;
pub const struct_md5_state_st = opaque {};
pub const MD5_CTX = struct_md5_state_st;
pub const struct_ossl_init_settings_st = opaque {};
pub const OPENSSL_INIT_SETTINGS = struct_ossl_init_settings_st;
pub const struct_pkcs12_st = opaque {};
pub const PKCS12 = struct_pkcs12_st;
pub const struct_pkcs8_priv_key_info_st = opaque {};
pub const PKCS8_PRIV_KEY_INFO = struct_pkcs8_priv_key_info_st;
pub const struct_rand_meth_st = opaque {};
pub const RAND_METHOD = struct_rand_meth_st;
pub const struct_rc4_key_st = opaque {};
pub const RC4_KEY = struct_rc4_key_st;
pub const struct_rsa_pss_params_st = extern struct {
    hashAlgorithm: [*c]X509_ALGOR,
    maskGenAlgorithm: [*c]X509_ALGOR,
    saltLength: [*c]ASN1_INTEGER,
    trailerField: [*c]ASN1_INTEGER,
    maskHash: [*c]X509_ALGOR,
};
pub const RSA_PSS_PARAMS = struct_rsa_pss_params_st;
pub const struct_sha256_state_st = extern struct {
    h: [8]u32,
    Nl: u32,
    Nh: u32,
    data: [64]u8,
    num: c_uint,
    md_len: c_uint,
};
pub const SHA256_CTX = struct_sha256_state_st;
pub const struct_sha512_state_st = extern struct {
    h: [8]u64,
    Nl: u64,
    Nh: u64,
    p: [128]u8,
    num: c_uint,
    md_len: c_uint,
};
pub const SHA512_CTX = struct_sha512_state_st;
const struct_unnamed_5 = extern struct {
    h0: u32,
    h1: u32,
    h2: u32,
    h3: u32,
    h4: u32,
};
const union_unnamed_4 = extern union {
    h: [5]u32,
    unnamed_0: struct_unnamed_5,
};
pub const struct_sha_state_st = extern struct {
    unnamed_0: union_unnamed_4,
    Nl: u32,
    Nh: u32,
    data: [64]u8,
    num: c_uint,
};
pub const SHA_CTX = struct_sha_state_st;
pub const struct_spake2_ctx_st = opaque {};
pub const SPAKE2_CTX = struct_spake2_ctx_st;
pub const struct_srtp_protection_profile_st = extern struct {
    name: [*c]const u8,
    id: c_ulong,
};
pub const SRTP_PROTECTION_PROFILE = struct_srtp_protection_profile_st;
pub const struct_ssl_cipher_st = opaque {};
pub const SSL_CIPHER = struct_ssl_cipher_st;
// pub const struct_ssl_ctx_st = opaque {};
// pub const SSL_CTX = struct_ssl_ctx_st;
// pub const struct_ssl_st = opaque {};
// pub const SSL = struct_ssl_st;
pub const struct_ssl_early_callback_ctx = extern struct {
    ssl: ?*SSL,
    client_hello: [*c]const u8,
    client_hello_len: usize,
    version: u16,
    random: [*c]const u8,
    random_len: usize,
    session_id: [*c]const u8,
    session_id_len: usize,
    cipher_suites: [*c]const u8,
    cipher_suites_len: usize,
    compression_methods: [*c]const u8,
    compression_methods_len: usize,
    extensions: [*c]const u8,
    extensions_len: usize,
};
pub const SSL_CLIENT_HELLO = struct_ssl_early_callback_ctx;
pub const struct_ssl_ech_keys_st = opaque {};
pub const SSL_ECH_KEYS = struct_ssl_ech_keys_st;
pub const struct_ssl_method_st = opaque {};
pub const SSL_METHOD = struct_ssl_method_st;
pub const ssl_private_key_success: c_int = 0;
pub const ssl_private_key_retry: c_int = 1;
pub const ssl_private_key_failure: c_int = 2;
pub const enum_ssl_private_key_result_t = c_uint;
pub const struct_ssl_private_key_method_st = extern struct {
    sign: ?*const fn (?*SSL, [*c]u8, [*c]usize, usize, u16, [*c]const u8, usize) callconv(.C) enum_ssl_private_key_result_t,
    decrypt: ?*const fn (?*SSL, [*c]u8, [*c]usize, usize, [*c]const u8, usize) callconv(.C) enum_ssl_private_key_result_t,
    complete: ?*const fn (?*SSL, [*c]u8, [*c]usize, usize) callconv(.C) enum_ssl_private_key_result_t,
};
pub const SSL_PRIVATE_KEY_METHOD = struct_ssl_private_key_method_st;
pub const ssl_encryption_initial: c_int = 0;
pub const ssl_encryption_early_data: c_int = 1;
pub const ssl_encryption_handshake: c_int = 2;
pub const ssl_encryption_application: c_int = 3;
pub const enum_ssl_encryption_level_t = c_uint;
pub const struct_ssl_quic_method_st = extern struct {
    set_read_secret: ?*const fn (?*SSL, enum_ssl_encryption_level_t, ?*const SSL_CIPHER, [*c]const u8, usize) callconv(.C) c_int,
    set_write_secret: ?*const fn (?*SSL, enum_ssl_encryption_level_t, ?*const SSL_CIPHER, [*c]const u8, usize) callconv(.C) c_int,
    add_handshake_data: ?*const fn (?*SSL, enum_ssl_encryption_level_t, [*c]const u8, usize) callconv(.C) c_int,
    flush_flight: ?*const fn (?*SSL) callconv(.C) c_int,
    send_alert: ?*const fn (?*SSL, enum_ssl_encryption_level_t, u8) callconv(.C) c_int,
};
pub const SSL_QUIC_METHOD = struct_ssl_quic_method_st;
pub const struct_ssl_session_st = opaque {};
pub const SSL_SESSION = struct_ssl_session_st;
pub const ssl_ticket_aead_success: c_int = 0;
pub const ssl_ticket_aead_retry: c_int = 1;
pub const ssl_ticket_aead_ignore_ticket: c_int = 2;
pub const ssl_ticket_aead_error: c_int = 3;
pub const enum_ssl_ticket_aead_result_t = c_uint;
pub const struct_ssl_ticket_aead_method_st = extern struct {
    max_overhead: ?*const fn (?*SSL) callconv(.C) usize,
    seal: ?*const fn (?*SSL, [*c]u8, [*c]usize, usize, [*c]const u8, usize) callconv(.C) c_int,
    open: ?*const fn (?*SSL, [*c]u8, [*c]usize, usize, [*c]const u8, usize) callconv(.C) enum_ssl_ticket_aead_result_t,
};
pub const SSL_TICKET_AEAD_METHOD = struct_ssl_ticket_aead_method_st;
pub const struct_st_ERR_FNS = opaque {};
pub const ERR_FNS = struct_st_ERR_FNS;
pub const struct_trust_token_st = opaque {};
pub const TRUST_TOKEN = struct_trust_token_st;
pub const struct_trust_token_client_st = opaque {};
pub const TRUST_TOKEN_CLIENT = struct_trust_token_client_st;
pub const struct_trust_token_issuer_st = opaque {};
pub const TRUST_TOKEN_ISSUER = struct_trust_token_issuer_st;
pub const struct_trust_token_method_st = opaque {};
pub const TRUST_TOKEN_METHOD = struct_trust_token_method_st;
pub const struct_v3_ext_ctx = opaque {};
pub const X509V3_CTX = struct_v3_ext_ctx;
pub const struct_x509_attributes_st = opaque {};
pub const X509_ATTRIBUTE = struct_x509_attributes_st;
pub const struct_x509_lookup_st = opaque {};
pub const X509_LOOKUP = struct_x509_lookup_st;
pub const struct_x509_lookup_method_st = opaque {};
pub const X509_LOOKUP_METHOD = struct_x509_lookup_method_st;
pub const struct_x509_object_st = opaque {};
pub const X509_OBJECT = struct_x509_object_st;
pub const struct_x509_revoked_st = opaque {};
pub const X509_REVOKED = struct_x509_revoked_st;
pub const struct_x509_store_ctx_st = opaque {};
pub const X509_STORE_CTX = struct_x509_store_ctx_st;
pub const struct_x509_store_st = opaque {};
pub const X509_STORE = struct_x509_store_st;
pub const struct_x509_trust_st = extern struct {
    trust: c_int,
    flags: c_int,
    check_trust: ?*const fn ([*c]struct_x509_trust_st, ?*X509, c_int) callconv(.C) c_int,
    name: [*c]u8,
    arg1: c_int,
    arg2: ?*anyopaque,
};
pub const X509_TRUST = struct_x509_trust_st;
pub const OPENSSL_BLOCK = ?*anyopaque;
pub const struct___sbuf = extern struct {
    _base: [*c]u8,
    _size: c_int,
};
pub extern fn BUF_MEM_new() [*c]BUF_MEM;
pub extern fn BUF_MEM_free(buf: [*c]BUF_MEM) void;
pub extern fn BUF_MEM_reserve(buf: [*c]BUF_MEM, cap: usize) c_int;
pub extern fn BUF_MEM_grow(buf: [*c]BUF_MEM, len: usize) usize;
pub extern fn BUF_MEM_grow_clean(buf: [*c]BUF_MEM, len: usize) usize;
pub extern fn BUF_MEM_append(buf: [*c]BUF_MEM, in: ?*const anyopaque, len: usize) c_int;
pub extern fn BUF_strdup(str: [*c]const u8) [*c]u8;
pub extern fn BUF_strnlen(str: [*c]const u8, max_len: usize) usize;
pub extern fn BUF_strndup(str: [*c]const u8, size: usize) [*c]u8;
pub extern fn BUF_memdup(data: ?*const anyopaque, size: usize) ?*anyopaque;
pub extern fn BUF_strlcpy(dst: [*c]u8, src: [*c]const u8, dst_size: usize) usize;
pub extern fn BUF_strlcat(dst: [*c]u8, src: [*c]const u8, dst_size: usize) usize;
pub extern fn ERR_load_BIO_strings() void;
pub extern fn ERR_load_ERR_strings() void;
pub extern fn ERR_load_crypto_strings() void;
pub extern fn ERR_load_RAND_strings() void;
pub extern fn ERR_free_strings() void;
pub extern fn ERR_get_error() u32;
// pub extern fn ERR_get_error_line(file: [*c][*c]const u8, line: [*c]c_int) u32;
// pub extern fn ERR_get_error_line_data(file: [*c][*c]const u8, line: [*c]c_int, data: [*c][*c]const u8, flags: [*c]c_int) u32;
pub extern fn ERR_peek_error() u32;
// pub extern fn ERR_peek_error_line(file: [*c][*c]const u8, line: [*c]c_int) u32;
// pub extern fn ERR_peek_error_line_data(file: [*c][*c]const u8, line: [*c]c_int, data: [*c][*c]const u8, flags: [*c]c_int) u32;
pub extern fn ERR_peek_last_error() u32;
// pub extern fn ERR_peek_last_error_line(file: [*c][*c]const u8, line: [*c]c_int) u32;
// pub extern fn ERR_peek_last_error_line_data(file: [*c][*c]const u8, line: [*c]c_int, data: [*c][*c]const u8, flags: [*c]c_int) u32;
pub extern fn ERR_error_string_n(packed_error: u32, buf: [*c]u8, len: usize) [*c]u8;
pub extern fn ERR_lib_error_string(packed_error: u32) [*c]const u8;
pub extern fn ERR_reason_error_string(packed_error: u32) [*c]const u8;
pub const ERR_print_errors_callback_t = ?*const fn ([*c]const u8, usize, ?*anyopaque) callconv(.C) c_int;
pub const ERR_LIB_NONE: c_int = 1;
pub const ERR_LIB_SYS: c_int = 2;
pub const ERR_LIB_BN: c_int = 3;
pub const ERR_LIB_RSA: c_int = 4;
pub const ERR_LIB_DH: c_int = 5;
pub const ERR_LIB_EVP: c_int = 6;
pub const ERR_LIB_BUF: c_int = 7;
pub const ERR_LIB_OBJ: c_int = 8;
pub const ERR_LIB_PEM: c_int = 9;
pub const ERR_LIB_DSA: c_int = 10;
pub const ERR_LIB_X509: c_int = 11;
pub const ERR_LIB_ASN1: c_int = 12;
pub const ERR_LIB_CONF: c_int = 13;
pub const ERR_LIB_CRYPTO: c_int = 14;
pub const ERR_LIB_EC: c_int = 15;
pub const ERR_LIB_SSL: c_int = 16;
pub const ERR_LIB_BIO: c_int = 17;
pub const ERR_LIB_PKCS7: c_int = 18;
pub const ERR_LIB_PKCS8: c_int = 19;
pub const ERR_LIB_X509V3: c_int = 20;
pub const ERR_LIB_RAND: c_int = 21;
pub const ERR_LIB_ENGINE: c_int = 22;
pub const ERR_LIB_OCSP: c_int = 23;
pub const ERR_LIB_UI: c_int = 24;
pub const ERR_LIB_COMP: c_int = 25;
pub const ERR_LIB_ECDSA: c_int = 26;
pub const ERR_LIB_ECDH: c_int = 27;
pub const ERR_LIB_HMAC: c_int = 28;
pub const ERR_LIB_DIGEST: c_int = 29;
pub const ERR_LIB_CIPHER: c_int = 30;
pub const ERR_LIB_HKDF: c_int = 31;
pub const ERR_LIB_TRUST_TOKEN: c_int = 32;
pub const ERR_LIB_USER: c_int = 33;
pub const ERR_NUM_LIBS: c_int = 34;
const enum_unnamed_6 = c_uint;
pub extern fn ERR_remove_state(pid: c_ulong) void;
pub extern fn ERR_remove_thread_state(tid: [*c]const CRYPTO_THREADID) void;
pub extern fn ERR_func_error_string(packed_error: u32) [*c]const u8;
pub extern fn ERR_error_string(packed_error: u32, buf: [*c]u8) [*c]u8;
pub extern fn ERR_clear_system_error() void;
pub extern fn ERR_put_error(library: c_int, unused: c_int, reason: c_int, file: [*c]const u8, line: u32) void;
pub extern fn ERR_add_error_data(count: c_uint, ...) void;
pub extern fn ERR_add_error_dataf(format: [*c]const u8, ...) void;
pub extern fn ERR_set_error_data(data: [*c]u8, flags: c_int) void;
pub const OPENSSL_sk_free_func = ?*const fn (?*anyopaque) callconv(.C) void;
pub const OPENSSL_sk_copy_func = ?*const fn (?*anyopaque) callconv(.C) ?*anyopaque;
pub const OPENSSL_sk_cmp_func = ?*const fn ([*c]?*const anyopaque, [*c]?*const anyopaque) callconv(.C) c_int;
pub const OPENSSL_sk_call_free_func = ?*const fn (OPENSSL_sk_free_func, ?*anyopaque) callconv(.C) void;
pub const OPENSSL_sk_call_copy_func = ?*const fn (OPENSSL_sk_copy_func, ?*anyopaque) callconv(.C) ?*anyopaque;
pub const OPENSSL_sk_call_cmp_func = ?*const fn (OPENSSL_sk_cmp_func, [*c]const ?*const anyopaque, [*c]const ?*const anyopaque) callconv(.C) c_int;
pub const struct_stack_st = extern struct {
    num: usize,
    data: [*c]?*anyopaque,
    sorted: c_int,
    num_alloc: usize,
    comp: OPENSSL_sk_cmp_func,
};
pub const _STACK = struct_stack_st;
pub extern fn sk_new(comp: OPENSSL_sk_cmp_func) [*c]_STACK;
pub extern fn sk_new_null() [*c]_STACK;
pub extern fn sk_num(sk: [*c]const _STACK) usize;
pub extern fn sk_zero(sk: [*c]_STACK) void;
pub extern fn sk_value(sk: [*c]const _STACK, i: usize) ?*anyopaque;
pub extern fn sk_set(sk: [*c]_STACK, i: usize, p: ?*anyopaque) ?*anyopaque;
pub extern fn sk_free(sk: [*c]_STACK) void;
pub extern fn sk_pop_free_ex(sk: [*c]_STACK, call_free_func: OPENSSL_sk_call_free_func, free_func: OPENSSL_sk_free_func) void;
pub extern fn sk_insert(sk: [*c]_STACK, p: ?*anyopaque, where: usize) usize;
pub extern fn sk_delete(sk: [*c]_STACK, where: usize) ?*anyopaque;
pub extern fn sk_delete_ptr(sk: [*c]_STACK, p: ?*const anyopaque) ?*anyopaque;
pub extern fn sk_find(sk: [*c]const _STACK, out_index: [*c]usize, p: ?*const anyopaque, call_cmp_func: OPENSSL_sk_call_cmp_func) c_int;
pub extern fn sk_shift(sk: [*c]_STACK) ?*anyopaque;
pub extern fn sk_push(sk: [*c]_STACK, p: ?*anyopaque) usize;
pub extern fn sk_pop(sk: [*c]_STACK) ?*anyopaque;
pub extern fn sk_dup(sk: [*c]const _STACK) [*c]_STACK;
pub extern fn sk_sort(sk: [*c]_STACK, call_cmp_func: OPENSSL_sk_call_cmp_func) void;
pub extern fn sk_is_sorted(sk: [*c]const _STACK) c_int;
pub extern fn sk_set_cmp_func(sk: [*c]_STACK, comp: OPENSSL_sk_cmp_func) OPENSSL_sk_cmp_func;
pub extern fn sk_deep_copy(sk: [*c]const _STACK, call_copy_func: OPENSSL_sk_call_copy_func, copy_func: OPENSSL_sk_copy_func, call_free_func: OPENSSL_sk_call_free_func, free_func: OPENSSL_sk_free_func) [*c]_STACK;
pub extern fn sk_pop_free(sk: [*c]_STACK, free_func: OPENSSL_sk_free_func) void;
pub const OPENSSL_STRING = [*c]u8;
pub const sk_void_free_func = ?*const fn (?*anyopaque) callconv(.C) void;
pub const sk_void_copy_func = ?*const fn (?*anyopaque) callconv(.C) ?*anyopaque;
pub const sk_void_cmp_func = ?*const fn ([*c]?*const anyopaque, [*c]?*const anyopaque) callconv(.C) c_int;
pub fn sk_void_call_free_func(arg_free_func: OPENSSL_sk_free_func, arg_ptr: ?*anyopaque) callconv(.C) void {
    const free_func = arg_free_func;
    const ptr = arg_ptr;
    @as(sk_void_free_func, @ptrCast(@alignCast(free_func))).?(ptr);
}
pub fn sk_void_call_copy_func(arg_copy_func: OPENSSL_sk_copy_func, arg_ptr: ?*anyopaque) callconv(.C) ?*anyopaque {
    const copy_func = arg_copy_func;
    const ptr = arg_ptr;
    return @as(sk_void_copy_func, @ptrCast(@alignCast(copy_func))).?(ptr);
}
pub fn sk_void_call_cmp_func(arg_cmp_func: OPENSSL_sk_cmp_func, arg_a: [*c]const ?*const anyopaque, arg_b: [*c]const ?*const anyopaque) callconv(.C) c_int {
    const cmp_func = arg_cmp_func;
    const a = arg_a;
    const b = arg_b;
    var a_ptr: ?*const anyopaque = a.*;
    var b_ptr: ?*const anyopaque = b.*;
    return @as(sk_void_cmp_func, @ptrCast(@alignCast(cmp_func))).?(&a_ptr, &b_ptr);
}
pub fn sk_void_new(arg_comp: sk_void_cmp_func) callconv(.C) ?*struct_stack_st_void {
    const comp = arg_comp;
    return @as(?*struct_stack_st_void, @ptrCast(sk_new(@as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp))))));
}
pub fn sk_void_new_null() callconv(.C) ?*struct_stack_st_void {
    return @as(?*struct_stack_st_void, @ptrCast(sk_new_null()));
}
pub fn sk_void_num(arg_sk: ?*const struct_stack_st_void) callconv(.C) usize {
    const sk = arg_sk;
    return sk_num(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_void_zero(arg_sk: ?*struct_stack_st_void) callconv(.C) void {
    const sk = arg_sk;
    sk_zero(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_void_value(arg_sk: ?*const struct_stack_st_void, arg_i: usize) callconv(.C) ?*anyopaque {
    const sk = arg_sk;
    const i = arg_i;
    return @alignCast(@ptrCast(sk_value(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), i)));
}
pub fn sk_void_set(arg_sk: ?*struct_stack_st_void, arg_i: usize, arg_p: ?*anyopaque) callconv(.C) ?*anyopaque {
    const sk = arg_sk;
    const i = arg_i;
    const p = arg_p;
    return sk_set(@as([*c]_STACK, @ptrCast(@alignCast(sk))), i, p);
}
pub fn sk_void_free(arg_sk: ?*struct_stack_st_void) callconv(.C) void {
    const sk = arg_sk;
    sk_free(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_void_pop_free(arg_sk: ?*struct_stack_st_void, arg_free_func: sk_void_free_func) callconv(.C) void {
    const sk = arg_sk;
    const free_func = arg_free_func;
    sk_pop_free_ex(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_void_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))));
}
pub fn sk_void_insert(arg_sk: ?*struct_stack_st_void, arg_p: ?*anyopaque, arg_where: usize) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    const where = arg_where;
    return sk_insert(@as([*c]_STACK, @ptrCast(@alignCast(sk))), p, where);
}
pub fn sk_void_delete(arg_sk: ?*struct_stack_st_void, arg_where: usize) callconv(.C) ?*anyopaque {
    const sk = arg_sk;
    const where = arg_where;
    return sk_delete(@as([*c]_STACK, @ptrCast(@alignCast(sk))), where);
}
pub fn sk_void_delete_ptr(arg_sk: ?*struct_stack_st_void, arg_p: ?*const anyopaque) callconv(.C) ?*anyopaque {
    const sk = arg_sk;
    const p = arg_p;
    return sk_delete_ptr(@as([*c]_STACK, @ptrCast(@alignCast(sk))), p);
}
pub fn sk_void_find(arg_sk: ?*const struct_stack_st_void, arg_out_index: [*c]usize, arg_p: ?*const anyopaque) callconv(.C) c_int {
    const sk = arg_sk;
    const out_index = arg_out_index;
    const p = arg_p;
    return sk_find(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), out_index, p, &sk_void_call_cmp_func);
}
pub fn sk_void_shift(arg_sk: ?*struct_stack_st_void) callconv(.C) ?*anyopaque {
    const sk = arg_sk;
    return sk_shift(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_void_push(arg_sk: ?*struct_stack_st_void, arg_p: ?*anyopaque) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    return sk_push(@as([*c]_STACK, @ptrCast(@alignCast(sk))), p);
}
pub fn sk_void_pop(arg_sk: ?*struct_stack_st_void) callconv(.C) ?*anyopaque {
    const sk = arg_sk;
    return sk_pop(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_void_dup(arg_sk: ?*const struct_stack_st_void) callconv(.C) ?*struct_stack_st_void {
    const sk = arg_sk;
    return @as(?*struct_stack_st_void, @ptrCast(sk_dup(@as([*c]const _STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_void_sort(arg_sk: ?*struct_stack_st_void) callconv(.C) void {
    const sk = arg_sk;
    sk_sort(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_void_call_cmp_func);
}
pub fn sk_void_is_sorted(arg_sk: ?*const struct_stack_st_void) callconv(.C) c_int {
    const sk = arg_sk;
    return sk_is_sorted(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_void_set_cmp_func(arg_sk: ?*struct_stack_st_void, arg_comp: sk_void_cmp_func) callconv(.C) sk_void_cmp_func {
    const sk = arg_sk;
    const comp = arg_comp;
    return @as(sk_void_cmp_func, @ptrCast(@alignCast(sk_set_cmp_func(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp)))))));
}
pub fn sk_void_deep_copy(arg_sk: ?*const struct_stack_st_void, arg_copy_func: sk_void_copy_func, arg_free_func: sk_void_free_func) callconv(.C) ?*struct_stack_st_void {
    const sk = arg_sk;
    const copy_func = arg_copy_func;
    const free_func = arg_free_func;
    return @as(?*struct_stack_st_void, @ptrCast(sk_deep_copy(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), &sk_void_call_copy_func, @as(OPENSSL_sk_copy_func, @ptrCast(@alignCast(copy_func))), &sk_void_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))))));
}
pub const struct_stack_st_OPENSSL_STRING = opaque {};
pub const sk_OPENSSL_STRING_free_func = ?*const fn ([*c]u8) callconv(.C) void;
pub const sk_OPENSSL_STRING_copy_func = ?*const fn ([*c]u8) callconv(.C) [*c]u8;
pub const sk_OPENSSL_STRING_cmp_func = ?*const fn ([*c][*c]const u8, [*c][*c]const u8) callconv(.C) c_int;
pub fn sk_OPENSSL_STRING_call_free_func(arg_free_func: OPENSSL_sk_free_func, arg_ptr: ?*anyopaque) callconv(.C) void {
    const free_func = arg_free_func;
    const ptr = arg_ptr;
    @as(sk_OPENSSL_STRING_free_func, @ptrCast(@alignCast(free_func))).?(@as([*c]u8, @ptrCast(@alignCast(ptr))));
}
pub fn sk_OPENSSL_STRING_call_copy_func(arg_copy_func: OPENSSL_sk_copy_func, arg_ptr: ?*anyopaque) callconv(.C) ?*anyopaque {
    const copy_func = arg_copy_func;
    const ptr = arg_ptr;
    return @as(?*anyopaque, @ptrCast(@as(sk_OPENSSL_STRING_copy_func, @ptrCast(@alignCast(copy_func))).?(@as([*c]u8, @ptrCast(@alignCast(ptr))))));
}
pub fn sk_OPENSSL_STRING_call_cmp_func(arg_cmp_func: OPENSSL_sk_cmp_func, arg_a: [*c]const ?*const anyopaque, arg_b: [*c]const ?*const anyopaque) callconv(.C) c_int {
    const cmp_func = arg_cmp_func;
    const a = arg_a;
    const b = arg_b;
    var a_ptr: [*c]const u8 = @as([*c]const u8, @ptrCast(@alignCast(a.*)));
    var b_ptr: [*c]const u8 = @as([*c]const u8, @ptrCast(@alignCast(b.*)));
    return @as(sk_OPENSSL_STRING_cmp_func, @ptrCast(@alignCast(cmp_func))).?(&a_ptr, &b_ptr);
}
pub fn sk_OPENSSL_STRING_new(arg_comp: sk_OPENSSL_STRING_cmp_func) callconv(.C) ?*struct_stack_st_OPENSSL_STRING {
    const comp = arg_comp;
    return @as(?*struct_stack_st_OPENSSL_STRING, @ptrCast(sk_new(@as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp))))));
}
pub fn sk_OPENSSL_STRING_new_null() callconv(.C) ?*struct_stack_st_OPENSSL_STRING {
    return @as(?*struct_stack_st_OPENSSL_STRING, @ptrCast(sk_new_null()));
}
pub fn sk_OPENSSL_STRING_num(arg_sk: ?*const struct_stack_st_OPENSSL_STRING) callconv(.C) usize {
    const sk = arg_sk;
    return sk_num(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_OPENSSL_STRING_zero(arg_sk: ?*struct_stack_st_OPENSSL_STRING) callconv(.C) void {
    const sk = arg_sk;
    sk_zero(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_OPENSSL_STRING_value(arg_sk: ?*const struct_stack_st_OPENSSL_STRING, arg_i: usize) callconv(.C) [*c]u8 {
    const sk = arg_sk;
    const i = arg_i;
    return @as([*c]u8, @ptrCast(@alignCast(sk_value(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), i))));
}
pub fn sk_OPENSSL_STRING_set(arg_sk: ?*struct_stack_st_OPENSSL_STRING, arg_i: usize, arg_p: [*c]u8) callconv(.C) [*c]u8 {
    const sk = arg_sk;
    const i = arg_i;
    const p = arg_p;
    return @as([*c]u8, @ptrCast(@alignCast(sk_set(@as([*c]_STACK, @ptrCast(@alignCast(sk))), i, @as(?*anyopaque, @ptrCast(p))))));
}
pub fn sk_OPENSSL_STRING_free(arg_sk: ?*struct_stack_st_OPENSSL_STRING) callconv(.C) void {
    const sk = arg_sk;
    sk_free(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_OPENSSL_STRING_pop_free(arg_sk: ?*struct_stack_st_OPENSSL_STRING, arg_free_func: sk_OPENSSL_STRING_free_func) callconv(.C) void {
    const sk = arg_sk;
    const free_func = arg_free_func;
    sk_pop_free_ex(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_OPENSSL_STRING_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))));
}
pub fn sk_OPENSSL_STRING_insert(arg_sk: ?*struct_stack_st_OPENSSL_STRING, arg_p: [*c]u8, arg_where: usize) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    const where = arg_where;
    return sk_insert(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)), where);
}
pub fn sk_OPENSSL_STRING_delete(arg_sk: ?*struct_stack_st_OPENSSL_STRING, arg_where: usize) callconv(.C) [*c]u8 {
    const sk = arg_sk;
    const where = arg_where;
    return @as([*c]u8, @ptrCast(@alignCast(sk_delete(@as([*c]_STACK, @ptrCast(@alignCast(sk))), where))));
}
pub fn sk_OPENSSL_STRING_delete_ptr(arg_sk: ?*struct_stack_st_OPENSSL_STRING, arg_p: [*c]const u8) callconv(.C) [*c]u8 {
    const sk = arg_sk;
    const p = arg_p;
    return @as([*c]u8, @ptrCast(@alignCast(sk_delete_ptr(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*const anyopaque, @ptrCast(p))))));
}
pub fn sk_OPENSSL_STRING_find(arg_sk: ?*const struct_stack_st_OPENSSL_STRING, arg_out_index: [*c]usize, arg_p: [*c]const u8) callconv(.C) c_int {
    const sk = arg_sk;
    const out_index = arg_out_index;
    const p = arg_p;
    return sk_find(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), out_index, @as(?*const anyopaque, @ptrCast(p)), &sk_OPENSSL_STRING_call_cmp_func);
}
pub fn sk_OPENSSL_STRING_shift(arg_sk: ?*struct_stack_st_OPENSSL_STRING) callconv(.C) [*c]u8 {
    const sk = arg_sk;
    return @as([*c]u8, @ptrCast(@alignCast(sk_shift(@as([*c]_STACK, @ptrCast(@alignCast(sk)))))));
}
pub fn sk_OPENSSL_STRING_push(arg_sk: ?*struct_stack_st_OPENSSL_STRING, arg_p: [*c]u8) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    return sk_push(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)));
}
pub fn sk_OPENSSL_STRING_pop(arg_sk: ?*struct_stack_st_OPENSSL_STRING) callconv(.C) [*c]u8 {
    const sk = arg_sk;
    return @as([*c]u8, @ptrCast(@alignCast(sk_pop(@as([*c]_STACK, @ptrCast(@alignCast(sk)))))));
}
pub fn sk_OPENSSL_STRING_dup(arg_sk: ?*const struct_stack_st_OPENSSL_STRING) callconv(.C) ?*struct_stack_st_OPENSSL_STRING {
    const sk = arg_sk;
    return @as(?*struct_stack_st_OPENSSL_STRING, @ptrCast(sk_dup(@as([*c]const _STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_OPENSSL_STRING_sort(arg_sk: ?*struct_stack_st_OPENSSL_STRING) callconv(.C) void {
    const sk = arg_sk;
    sk_sort(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_OPENSSL_STRING_call_cmp_func);
}
pub fn sk_OPENSSL_STRING_is_sorted(arg_sk: ?*const struct_stack_st_OPENSSL_STRING) callconv(.C) c_int {
    const sk = arg_sk;
    return sk_is_sorted(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_OPENSSL_STRING_set_cmp_func(arg_sk: ?*struct_stack_st_OPENSSL_STRING, arg_comp: sk_OPENSSL_STRING_cmp_func) callconv(.C) sk_OPENSSL_STRING_cmp_func {
    const sk = arg_sk;
    const comp = arg_comp;
    return @as(sk_OPENSSL_STRING_cmp_func, @ptrCast(@alignCast(sk_set_cmp_func(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp)))))));
}
pub fn sk_OPENSSL_STRING_deep_copy(arg_sk: ?*const struct_stack_st_OPENSSL_STRING, arg_copy_func: sk_OPENSSL_STRING_copy_func, arg_free_func: sk_OPENSSL_STRING_free_func) callconv(.C) ?*struct_stack_st_OPENSSL_STRING {
    const sk = arg_sk;
    const copy_func = arg_copy_func;
    const free_func = arg_free_func;
    return @as(?*struct_stack_st_OPENSSL_STRING, @ptrCast(sk_deep_copy(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), &sk_OPENSSL_STRING_call_copy_func, @as(OPENSSL_sk_copy_func, @ptrCast(@alignCast(copy_func))), &sk_OPENSSL_STRING_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))))));
}
pub const CRYPTO_EX_free = fn (?*anyopaque, ?*anyopaque, [*c]CRYPTO_EX_DATA, c_int, c_long, ?*anyopaque) callconv(.C) void;
pub extern fn CRYPTO_cleanup_all_ex_data() void;
pub const CRYPTO_EX_dup = fn ([*c]CRYPTO_EX_DATA, [*c]const CRYPTO_EX_DATA, [*c]?*anyopaque, c_int, c_long, ?*anyopaque) callconv(.C) c_int;
pub const CRYPTO_EX_unused = c_int;
pub extern fn CRYPTO_num_locks() c_int;
pub extern fn CRYPTO_set_locking_callback(func: ?*const fn (c_int, c_int, [*c]const u8, c_int) callconv(.C) void) void;
pub extern fn CRYPTO_set_add_lock_callback(func: ?*const fn ([*c]c_int, c_int, c_int, [*c]const u8, c_int) callconv(.C) c_int) void;
pub extern fn CRYPTO_get_locking_callback() ?*const fn (c_int, c_int, [*c]const u8, c_int) callconv(.C) void;
pub extern fn CRYPTO_get_lock_name(lock_num: c_int) [*c]const u8;
pub extern fn CRYPTO_THREADID_set_callback(threadid_func: ?*const fn ([*c]CRYPTO_THREADID) callconv(.C) void) c_int;
pub extern fn CRYPTO_THREADID_set_numeric(id: [*c]CRYPTO_THREADID, val: c_ulong) void;
pub extern fn CRYPTO_THREADID_set_pointer(id: [*c]CRYPTO_THREADID, ptr: ?*anyopaque) void;
pub extern fn CRYPTO_THREADID_current(id: [*c]CRYPTO_THREADID) void;
pub extern fn CRYPTO_set_id_callback(func: ?*const fn () callconv(.C) c_ulong) void;
pub const struct_CRYPTO_dynlock_value = opaque {};
pub const CRYPTO_dynlock = extern struct {
    references: c_int,
    data: ?*struct_CRYPTO_dynlock_value,
};
pub extern fn CRYPTO_set_dynlock_create_callback(dyn_create_function: ?*const fn ([*c]const u8, c_int) callconv(.C) ?*struct_CRYPTO_dynlock_value) void;
pub extern fn CRYPTO_set_dynlock_lock_callback(dyn_lock_function: ?*const fn (c_int, ?*struct_CRYPTO_dynlock_value, [*c]const u8, c_int) callconv(.C) void) void;
pub extern fn CRYPTO_set_dynlock_destroy_callback(dyn_destroy_function: ?*const fn (?*struct_CRYPTO_dynlock_value, [*c]const u8, c_int) callconv(.C) void) void;
pub extern fn CRYPTO_get_dynlock_create_callback() ?*const fn ([*c]const u8, c_int) callconv(.C) ?*struct_CRYPTO_dynlock_value;
pub extern fn CRYPTO_get_dynlock_lock_callback() ?*const fn (c_int, ?*struct_CRYPTO_dynlock_value, [*c]const u8, c_int) callconv(.C) void;
pub extern fn CRYPTO_get_dynlock_destroy_callback() ?*const fn (?*struct_CRYPTO_dynlock_value, [*c]const u8, c_int) callconv(.C) void;
pub const struct_stack_st_BIO = opaque {};
pub const sk_BIO_free_func = ?*const fn ([*c]BIO) callconv(.C) void;
pub const sk_BIO_copy_func = ?*const fn ([*c]BIO) callconv(.C) [*c]BIO;
pub const sk_BIO_cmp_func = ?*const fn ([*c][*c]const BIO, [*c][*c]const BIO) callconv(.C) c_int;
pub fn sk_BIO_call_free_func(arg_free_func: OPENSSL_sk_free_func, arg_ptr: ?*anyopaque) callconv(.C) void {
    const free_func = arg_free_func;
    const ptr = arg_ptr;
    @as(sk_BIO_free_func, @ptrCast(@alignCast(free_func))).?(@as([*c]BIO, @ptrCast(@alignCast(ptr))));
}
pub fn sk_BIO_call_copy_func(arg_copy_func: OPENSSL_sk_copy_func, arg_ptr: ?*anyopaque) callconv(.C) ?*anyopaque {
    const copy_func = arg_copy_func;
    const ptr = arg_ptr;
    return @as(?*anyopaque, @ptrCast(@as(sk_BIO_copy_func, @ptrCast(@alignCast(copy_func))).?(@as([*c]BIO, @ptrCast(@alignCast(ptr))))));
}
pub fn sk_BIO_call_cmp_func(arg_cmp_func: OPENSSL_sk_cmp_func, arg_a: [*c]const ?*const anyopaque, arg_b: [*c]const ?*const anyopaque) callconv(.C) c_int {
    const cmp_func = arg_cmp_func;
    const a = arg_a;
    const b = arg_b;
    var a_ptr: [*c]const BIO = @as([*c]const BIO, @ptrCast(@alignCast(a.*)));
    var b_ptr: [*c]const BIO = @as([*c]const BIO, @ptrCast(@alignCast(b.*)));
    return @as(sk_BIO_cmp_func, @ptrCast(@alignCast(cmp_func))).?(&a_ptr, &b_ptr);
}
pub fn sk_BIO_new(arg_comp: sk_BIO_cmp_func) callconv(.C) ?*struct_stack_st_BIO {
    const comp = arg_comp;
    return @as(?*struct_stack_st_BIO, @ptrCast(sk_new(@as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp))))));
}
pub fn sk_BIO_new_null() callconv(.C) ?*struct_stack_st_BIO {
    return @as(?*struct_stack_st_BIO, @ptrCast(sk_new_null()));
}
pub fn sk_BIO_num(arg_sk: ?*const struct_stack_st_BIO) callconv(.C) usize {
    const sk = arg_sk;
    return sk_num(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_BIO_zero(arg_sk: ?*struct_stack_st_BIO) callconv(.C) void {
    const sk = arg_sk;
    sk_zero(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_BIO_value(arg_sk: ?*const struct_stack_st_BIO, arg_i: usize) callconv(.C) [*c]BIO {
    const sk = arg_sk;
    const i = arg_i;
    return @as([*c]BIO, @ptrCast(@alignCast(sk_value(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), i))));
}
pub fn sk_BIO_set(arg_sk: ?*struct_stack_st_BIO, arg_i: usize, arg_p: [*c]BIO) callconv(.C) [*c]BIO {
    const sk = arg_sk;
    const i = arg_i;
    const p = arg_p;
    return @as([*c]BIO, @ptrCast(@alignCast(sk_set(@as([*c]_STACK, @ptrCast(@alignCast(sk))), i, @as(?*anyopaque, @ptrCast(p))))));
}
pub fn sk_BIO_free(arg_sk: ?*struct_stack_st_BIO) callconv(.C) void {
    const sk = arg_sk;
    sk_free(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_BIO_pop_free(arg_sk: ?*struct_stack_st_BIO, arg_free_func: sk_BIO_free_func) callconv(.C) void {
    const sk = arg_sk;
    const free_func = arg_free_func;
    sk_pop_free_ex(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_BIO_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))));
}
pub fn sk_BIO_insert(arg_sk: ?*struct_stack_st_BIO, arg_p: [*c]BIO, arg_where: usize) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    const where = arg_where;
    return sk_insert(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)), where);
}
pub fn sk_BIO_delete(arg_sk: ?*struct_stack_st_BIO, arg_where: usize) callconv(.C) [*c]BIO {
    const sk = arg_sk;
    const where = arg_where;
    return @as([*c]BIO, @ptrCast(@alignCast(sk_delete(@as([*c]_STACK, @ptrCast(@alignCast(sk))), where))));
}
pub fn sk_BIO_delete_ptr(arg_sk: ?*struct_stack_st_BIO, arg_p: [*c]const BIO) callconv(.C) [*c]BIO {
    const sk = arg_sk;
    const p = arg_p;
    return @as([*c]BIO, @ptrCast(@alignCast(sk_delete_ptr(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*const anyopaque, @ptrCast(p))))));
}
pub fn sk_BIO_find(arg_sk: ?*const struct_stack_st_BIO, arg_out_index: [*c]usize, arg_p: [*c]const BIO) callconv(.C) c_int {
    const sk = arg_sk;
    const out_index = arg_out_index;
    const p = arg_p;
    return sk_find(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), out_index, @as(?*const anyopaque, @ptrCast(p)), &sk_BIO_call_cmp_func);
}
pub fn sk_BIO_shift(arg_sk: ?*struct_stack_st_BIO) callconv(.C) [*c]BIO {
    const sk = arg_sk;
    return @as([*c]BIO, @ptrCast(@alignCast(sk_shift(@as([*c]_STACK, @ptrCast(@alignCast(sk)))))));
}
pub fn sk_BIO_push(arg_sk: ?*struct_stack_st_BIO, arg_p: [*c]BIO) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    return sk_push(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)));
}
pub fn sk_BIO_pop(arg_sk: ?*struct_stack_st_BIO) callconv(.C) [*c]BIO {
    const sk = arg_sk;
    return @as([*c]BIO, @ptrCast(@alignCast(sk_pop(@as([*c]_STACK, @ptrCast(@alignCast(sk)))))));
}
pub fn sk_BIO_dup(arg_sk: ?*const struct_stack_st_BIO) callconv(.C) ?*struct_stack_st_BIO {
    const sk = arg_sk;
    return @as(?*struct_stack_st_BIO, @ptrCast(sk_dup(@as([*c]const _STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_BIO_sort(arg_sk: ?*struct_stack_st_BIO) callconv(.C) void {
    const sk = arg_sk;
    sk_sort(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_BIO_call_cmp_func);
}
pub fn sk_BIO_is_sorted(arg_sk: ?*const struct_stack_st_BIO) callconv(.C) c_int {
    const sk = arg_sk;
    return sk_is_sorted(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_BIO_set_cmp_func(arg_sk: ?*struct_stack_st_BIO, arg_comp: sk_BIO_cmp_func) callconv(.C) sk_BIO_cmp_func {
    const sk = arg_sk;
    const comp = arg_comp;
    return @as(sk_BIO_cmp_func, @ptrCast(@alignCast(sk_set_cmp_func(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp)))))));
}
pub fn sk_BIO_deep_copy(arg_sk: ?*const struct_stack_st_BIO, arg_copy_func: sk_BIO_copy_func, arg_free_func: sk_BIO_free_func) callconv(.C) ?*struct_stack_st_BIO {
    const sk = arg_sk;
    const copy_func = arg_copy_func;
    const free_func = arg_free_func;
    return @as(?*struct_stack_st_BIO, @ptrCast(sk_deep_copy(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), &sk_BIO_call_copy_func, @as(OPENSSL_sk_copy_func, @ptrCast(@alignCast(copy_func))), &sk_BIO_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))))));
}
pub extern fn BIO_new(method: [*c]const BIO_METHOD) ?*BIO;
pub extern fn BIO_free(bio: [*c]BIO) c_int;
pub extern fn BIO_vfree(bio: [*c]BIO) void;
pub extern fn BIO_up_ref(bio: [*c]BIO) c_int;
pub extern fn BIO_read(bio: [*c]BIO, data: ?*anyopaque, len: c_int) c_int;
pub extern fn BIO_gets(bio: [*c]BIO, buf: [*c]u8, size: c_int) c_int;
pub extern fn BIO_write(bio: [*c]BIO, data: ?*const anyopaque, len: c_int) c_int;
pub extern fn BIO_write_all(bio: [*c]BIO, data: ?*const anyopaque, len: usize) c_int;
pub extern fn BIO_puts(bio: [*c]BIO, buf: [*c]const u8) c_int;
pub extern fn BIO_flush(bio: [*c]BIO) c_int;
pub extern fn BIO_ctrl(bio: [*c]BIO, cmd: c_int, larg: c_long, parg: ?*anyopaque) c_long;
pub extern fn BIO_ptr_ctrl(bp: [*c]BIO, cmd: c_int, larg: c_long) [*c]u8;
pub extern fn BIO_int_ctrl(bp: [*c]BIO, cmd: c_int, larg: c_long, iarg: c_int) c_long;
pub extern fn BIO_reset(bio: [*c]BIO) c_int;
pub extern fn BIO_eof(bio: [*c]BIO) c_int;
pub extern fn BIO_set_flags(bio: [*c]BIO, flags: c_int) void;
pub extern fn BIO_test_flags(bio: [*c]const BIO, flags: c_int) c_int;
pub extern fn BIO_should_read(bio: [*c]const BIO) c_int;
pub extern fn BIO_should_write(bio: [*c]const BIO) c_int;
pub extern fn BIO_should_retry(bio: [*c]const BIO) c_int;
pub extern fn BIO_should_io_special(bio: [*c]const BIO) c_int;
pub extern fn BIO_get_retry_reason(bio: [*c]const BIO) c_int;
pub extern fn BIO_set_retry_reason(bio: [*c]BIO, reason: c_int) void;
pub extern fn BIO_clear_flags(bio: [*c]BIO, flags: c_int) void;
pub extern fn BIO_set_retry_read(bio: [*c]BIO) void;
pub extern fn BIO_set_retry_write(bio: [*c]BIO) void;
pub extern fn BIO_get_retry_flags(bio: [*c]BIO) c_int;
pub extern fn BIO_clear_retry_flags(bio: [*c]BIO) void;
pub extern fn BIO_method_type(bio: [*c]const BIO) c_int;
pub extern fn BIO_callback_ctrl(bio: [*c]BIO, cmd: c_int, fp: bio_info_cb) c_long;
pub extern fn BIO_pending(bio: [*c]const BIO) usize;
pub extern fn BIO_ctrl_pending(bio: [*c]const BIO) usize;
pub extern fn BIO_wpending(bio: [*c]const BIO) usize;
pub extern fn BIO_set_close(bio: [*c]BIO, close_flag: c_int) c_int;
pub extern fn BIO_number_read(bio: [*c]const BIO) usize;
pub extern fn BIO_number_written(bio: [*c]const BIO) usize;
pub extern fn BIO_push(bio: [*c]BIO, appended_bio: [*c]BIO) [*c]BIO;
pub extern fn BIO_pop(bio: [*c]BIO) [*c]BIO;
pub extern fn BIO_next(bio: [*c]BIO) [*c]BIO;
pub extern fn BIO_free_all(bio: [*c]BIO) void;
pub extern fn BIO_find_type(bio: [*c]BIO, @"type": c_int) [*c]BIO;
pub extern fn BIO_copy_next_retry(bio: [*c]BIO) void;
pub extern fn BIO_printf(bio: [*c]BIO, format: [*c]const u8, ...) c_int;
pub extern fn BIO_indent(bio: [*c]BIO, indent: c_uint, max_indent: c_uint) c_int;
pub extern fn BIO_hexdump(bio: [*c]BIO, data: [*c]const u8, len: usize, indent: c_uint) c_int;
pub extern fn ERR_print_errors(bio: [*c]BIO) void;
pub extern fn BIO_read_asn1(bio: [*c]BIO, out: [*c][*c]u8, out_len: [*c]usize, max_len: usize) c_int;
pub extern fn BIO_s_mem() ?*const BIO_METHOD;

/// BIO_new_mem_buf creates read-only BIO that reads from |len| bytes at |buf|.
/// It returns the BIO or NULL on error. This function does not copy or take
/// ownership of |buf|. The caller must ensure the memory pointed to by |buf|
/// outlives the |BIO|.
///
/// If |len| is negative, then |buf| is treated as a NUL-terminated string, but
/// don't depend on this in new code.
pub extern fn BIO_new_mem_buf(buf: ?*const anyopaque, len: ossl_ssize_t) [*c]BIO;
// pub extern fn BIO_mem_contents(bio: [*c]const BIO, out_contents: [*c][*c]const u8, out_len: [*c]usize) c_int;
pub extern fn BIO_get_mem_data(bio: [*c]BIO, contents: [*c][*c]u8) c_long;
pub extern fn BIO_get_mem_ptr(bio: [*c]BIO, out: [*c][*c]BUF_MEM) c_int;
pub extern fn BIO_set_mem_buf(bio: [*c]BIO, b: [*c]BUF_MEM, take_ownership: c_int) c_int;
pub extern fn BIO_set_mem_eof_return(bio: [*c]BIO, eof_value: c_int) c_int;
pub extern fn BIO_s_fd() [*c]const BIO_METHOD;
pub extern fn BIO_new_fd(fd: c_int, close_flag: c_int) [*c]BIO;
pub extern fn BIO_set_fd(bio: [*c]BIO, fd: c_int, close_flag: c_int) c_int;
pub extern fn BIO_get_fd(bio: [*c]BIO, out_fd: [*c]c_int) c_int;
// pub extern fn BIO_s_file() [*c]const BIO_METHOD;
pub extern fn BIO_new_file(filename: [*c]const u8, mode: [*c]const u8) [*c]BIO;
// pub extern fn BIO_new_fp(stream: [*c]FILE, close_flag: c_int) [*c]BIO;
// pub extern fn BIO_get_fp(bio: [*c]BIO, out_file: [*c][*c]FILE) c_int;
// pub extern fn BIO_set_fp(bio: [*c]BIO, file: [*c]FILE, close_flag: c_int) c_int;
pub extern fn BIO_read_filename(bio: [*c]BIO, filename: [*c]const u8) c_int;
pub extern fn BIO_write_filename(bio: [*c]BIO, filename: [*c]const u8) c_int;
pub extern fn BIO_append_filename(bio: [*c]BIO, filename: [*c]const u8) c_int;
pub extern fn BIO_rw_filename(bio: [*c]BIO, filename: [*c]const u8) c_int;
// pub extern fn BIO_tell(bio: [*c]BIO) c_long;
// pub extern fn BIO_seek(bio: [*c]BIO, offset: c_long) c_long;
// pub extern fn BIO_s_socket() [*c]const BIO_METHOD;
// pub extern fn BIO_new_socket(fd: c_int, close_flag: c_int) [*c]BIO;
// pub extern fn BIO_s_connect() [*c]const BIO_METHOD;
// pub extern fn BIO_new_connect(host_and_optional_port: [*c]const u8) [*c]BIO;
// pub extern fn BIO_set_conn_hostname(bio: [*c]BIO, host_and_optional_port: [*c]const u8) c_int;
// pub extern fn BIO_set_conn_port(bio: [*c]BIO, port_str: [*c]const u8) c_int;
// pub extern fn BIO_set_conn_int_port(bio: [*c]BIO, port: [*c]const c_int) c_int;
// pub extern fn BIO_set_nbio(bio: [*c]BIO, on: c_int) c_int;
// pub extern fn BIO_do_connect(bio: [*c]BIO) c_int;
// pub extern fn BIO_new_bio_pair(out1: [*c][*c]BIO, writebuf1: usize, out2: [*c][*c]BIO, writebuf2: usize) c_int;
// pub extern fn BIO_ctrl_get_read_request(bio: [*c]BIO) usize;
// pub extern fn BIO_ctrl_get_write_guarantee(bio: [*c]BIO) usize;
// pub extern fn BIO_shutdown_wr(bio: [*c]BIO) c_int;
pub extern fn BIO_get_new_index() c_int;
pub extern fn BIO_meth_new(@"type": c_int, name: [*c]const u8) [*c]BIO_METHOD;
pub extern fn BIO_meth_free(method: [*c]BIO_METHOD) void;
pub extern fn BIO_meth_set_create(method: [*c]BIO_METHOD, create: ?*const fn ([*c]BIO) callconv(.C) c_int) c_int;
pub extern fn BIO_meth_set_destroy(method: [*c]BIO_METHOD, destroy: ?*const fn ([*c]BIO) callconv(.C) c_int) c_int;
pub extern fn BIO_meth_set_write(method: [*c]BIO_METHOD, write: ?*const fn ([*c]BIO, [*c]const u8, c_int) callconv(.C) c_int) c_int;
pub extern fn BIO_meth_set_read(method: [*c]BIO_METHOD, read: ?*const fn ([*c]BIO, [*c]u8, c_int) callconv(.C) c_int) c_int;
pub extern fn BIO_meth_set_gets(method: [*c]BIO_METHOD, gets: ?*const fn ([*c]BIO, [*c]u8, c_int) callconv(.C) c_int) c_int;
pub extern fn BIO_meth_set_ctrl(method: [*c]BIO_METHOD, ctrl: ?*const fn ([*c]BIO, c_int, c_long, ?*anyopaque) callconv(.C) c_long) c_int;
pub extern fn BIO_set_data(bio: [*c]BIO, ptr: ?*anyopaque) void;
pub extern fn BIO_get_data(bio: [*c]BIO) ?*anyopaque;
pub extern fn BIO_set_init(bio: [*c]BIO, init: c_int) void;
pub extern fn BIO_get_init(bio: [*c]BIO) c_int;
pub extern fn BIO_f_base64() [*c]const BIO_METHOD;
pub extern fn BIO_set_retry_special(bio: [*c]BIO) void;
pub extern fn BIO_set_write_buffer_size(bio: [*c]BIO, buffer_size: c_int) c_int;
pub extern fn BIO_set_shutdown(bio: [*c]BIO, shutdown: c_int) void;
pub extern fn BIO_get_shutdown(bio: [*c]BIO) c_int;
pub extern fn BIO_meth_set_puts(method: [*c]BIO_METHOD, puts: ?*const fn ([*c]BIO, [*c]const u8) callconv(.C) c_int) c_int;
pub extern fn EVP_EncodeBlock(dst: [*c]u8, src: [*c]const u8, src_len: usize) usize;
pub extern fn EVP_EncodedLength(out_len: [*c]usize, len: usize) c_int;
pub extern fn EVP_DecodedLength(out_len: [*c]usize, len: usize) c_int;
pub extern fn EVP_DecodeBase64(out: [*c]u8, out_len: [*c]usize, max_out: usize, in: [*c]const u8, in_len: usize) c_int;
pub extern fn EVP_ENCODE_CTX_new() [*c]EVP_ENCODE_CTX;
pub extern fn EVP_ENCODE_CTX_free(ctx: [*c]EVP_ENCODE_CTX) void;
pub extern fn EVP_EncodeInit(ctx: [*c]EVP_ENCODE_CTX) void;
pub extern fn EVP_EncodeUpdate(ctx: [*c]EVP_ENCODE_CTX, out: [*c]u8, out_len: [*c]c_int, in: [*c]const u8, in_len: usize) void;
pub extern fn EVP_EncodeFinal(ctx: [*c]EVP_ENCODE_CTX, out: [*c]u8, out_len: [*c]c_int) void;
pub extern fn EVP_DecodeInit(ctx: [*c]EVP_ENCODE_CTX) void;
pub extern fn EVP_DecodeUpdate(ctx: [*c]EVP_ENCODE_CTX, out: [*c]u8, out_len: [*c]c_int, in: [*c]const u8, in_len: usize) c_int;
pub extern fn EVP_DecodeFinal(ctx: [*c]EVP_ENCODE_CTX, out: [*c]u8, out_len: [*c]c_int) c_int;
pub extern fn EVP_DecodeBlock(dst: [*c]u8, src: [*c]const u8, src_len: usize) c_int;
pub extern fn EVP_rc4() ?*const EVP_CIPHER;
pub extern fn EVP_des_cbc() ?*const EVP_CIPHER;
pub extern fn EVP_des_ecb() ?*const EVP_CIPHER;
pub extern fn EVP_des_ede() ?*const EVP_CIPHER;
pub extern fn EVP_des_ede3() ?*const EVP_CIPHER;
pub extern fn EVP_des_ede_cbc() ?*const EVP_CIPHER;
pub extern fn EVP_des_ede3_cbc() ?*const EVP_CIPHER;
pub extern fn EVP_aes_128_ecb() ?*const EVP_CIPHER;
pub extern fn EVP_aes_128_cbc() ?*const EVP_CIPHER;
pub extern fn EVP_aes_128_ctr() ?*const EVP_CIPHER;
pub extern fn EVP_aes_128_ofb() ?*const EVP_CIPHER;
pub extern fn EVP_aes_256_ecb() ?*const EVP_CIPHER;
pub extern fn EVP_aes_256_cbc() ?*const EVP_CIPHER;
pub extern fn EVP_aes_256_ctr() ?*const EVP_CIPHER;
pub extern fn EVP_aes_256_ofb() ?*const EVP_CIPHER;
pub extern fn EVP_aes_256_xts() ?*const EVP_CIPHER;
pub extern fn EVP_enc_null() ?*const EVP_CIPHER;
pub extern fn EVP_rc2_cbc() ?*const EVP_CIPHER;
pub extern fn EVP_rc2_40_cbc() ?*const EVP_CIPHER;
pub extern fn EVP_get_cipherbynid(nid: c_int) ?*const EVP_CIPHER;
pub extern fn EVP_CIPHER_CTX_init(ctx: [*c]EVP_CIPHER_CTX) void;
pub extern fn EVP_CIPHER_CTX_new() [*c]EVP_CIPHER_CTX;
pub extern fn EVP_CIPHER_CTX_cleanup(ctx: [*c]EVP_CIPHER_CTX) c_int;
pub extern fn EVP_CIPHER_CTX_free(ctx: [*c]EVP_CIPHER_CTX) void;
pub extern fn EVP_CIPHER_CTX_copy(out: [*c]EVP_CIPHER_CTX, in: [*c]const EVP_CIPHER_CTX) c_int;
pub extern fn EVP_CIPHER_CTX_reset(ctx: [*c]EVP_CIPHER_CTX) c_int;
pub extern fn EVP_CipherInit_ex(ctx: [*c]EVP_CIPHER_CTX, cipher: ?*const EVP_CIPHER, engine: ?*ENGINE, key: [*c]const u8, iv: [*c]const u8, enc: c_int) c_int;
pub extern fn EVP_EncryptInit_ex(ctx: [*c]EVP_CIPHER_CTX, cipher: ?*const EVP_CIPHER, impl: ?*ENGINE, key: [*c]const u8, iv: [*c]const u8) c_int;
pub extern fn EVP_DecryptInit_ex(ctx: [*c]EVP_CIPHER_CTX, cipher: ?*const EVP_CIPHER, impl: ?*ENGINE, key: [*c]const u8, iv: [*c]const u8) c_int;
pub extern fn EVP_EncryptUpdate(ctx: [*c]EVP_CIPHER_CTX, out: [*c]u8, out_len: [*c]c_int, in: [*c]const u8, in_len: c_int) c_int;
pub extern fn EVP_EncryptFinal_ex(ctx: [*c]EVP_CIPHER_CTX, out: [*c]u8, out_len: [*c]c_int) c_int;
pub extern fn EVP_DecryptUpdate(ctx: [*c]EVP_CIPHER_CTX, out: [*c]u8, out_len: [*c]c_int, in: [*c]const u8, in_len: c_int) c_int;
pub extern fn EVP_DecryptFinal_ex(ctx: [*c]EVP_CIPHER_CTX, out: [*c]u8, out_len: [*c]c_int) c_int;
pub extern fn EVP_CipherUpdate(ctx: [*c]EVP_CIPHER_CTX, out: [*c]u8, out_len: [*c]c_int, in: [*c]const u8, in_len: c_int) c_int;
pub extern fn EVP_CipherFinal_ex(ctx: [*c]EVP_CIPHER_CTX, out: [*c]u8, out_len: [*c]c_int) c_int;
pub extern fn EVP_CIPHER_CTX_cipher(ctx: [*c]const EVP_CIPHER_CTX) ?*const EVP_CIPHER;
pub extern fn EVP_CIPHER_CTX_nid(ctx: [*c]const EVP_CIPHER_CTX) c_int;
pub extern fn EVP_CIPHER_CTX_encrypting(ctx: [*c]const EVP_CIPHER_CTX) c_int;
pub extern fn EVP_CIPHER_CTX_block_size(ctx: [*c]const EVP_CIPHER_CTX) c_uint;
pub extern fn EVP_CIPHER_CTX_key_length(ctx: [*c]const EVP_CIPHER_CTX) c_uint;
pub extern fn EVP_CIPHER_CTX_iv_length(ctx: [*c]const EVP_CIPHER_CTX) c_uint;
pub extern fn EVP_CIPHER_CTX_get_app_data(ctx: [*c]const EVP_CIPHER_CTX) ?*anyopaque;
pub extern fn EVP_CIPHER_CTX_set_app_data(ctx: [*c]EVP_CIPHER_CTX, data: ?*anyopaque) void;
pub extern fn EVP_CIPHER_CTX_flags(ctx: [*c]const EVP_CIPHER_CTX) u32;
pub extern fn EVP_CIPHER_CTX_mode(ctx: [*c]const EVP_CIPHER_CTX) u32;
pub extern fn EVP_CIPHER_CTX_ctrl(ctx: [*c]EVP_CIPHER_CTX, command: c_int, arg: c_int, ptr: ?*anyopaque) c_int;
pub extern fn EVP_CIPHER_CTX_set_padding(ctx: [*c]EVP_CIPHER_CTX, pad: c_int) c_int;
pub extern fn EVP_CIPHER_CTX_set_key_length(ctx: [*c]EVP_CIPHER_CTX, key_len: c_uint) c_int;
pub extern fn EVP_CIPHER_nid(cipher: ?*const EVP_CIPHER) c_int;
pub extern fn EVP_CIPHER_block_size(cipher: ?*const EVP_CIPHER) c_uint;
pub extern fn EVP_CIPHER_key_length(cipher: ?*const EVP_CIPHER) c_uint;
pub extern fn EVP_CIPHER_iv_length(cipher: ?*const EVP_CIPHER) c_uint;
pub extern fn EVP_CIPHER_flags(cipher: ?*const EVP_CIPHER) u32;
pub extern fn EVP_CIPHER_mode(cipher: ?*const EVP_CIPHER) u32;
pub extern fn EVP_BytesToKey(@"type": ?*const EVP_CIPHER, md: ?*const EVP_MD, salt: [*c]const u8, data: [*c]const u8, data_len: usize, count: c_uint, key: [*c]u8, iv: [*c]u8) c_int;
pub extern fn EVP_CipherInit(ctx: [*c]EVP_CIPHER_CTX, cipher: ?*const EVP_CIPHER, key: [*c]const u8, iv: [*c]const u8, enc: c_int) c_int;
pub extern fn EVP_EncryptInit(ctx: [*c]EVP_CIPHER_CTX, cipher: ?*const EVP_CIPHER, key: [*c]const u8, iv: [*c]const u8) c_int;
pub extern fn EVP_DecryptInit(ctx: [*c]EVP_CIPHER_CTX, cipher: ?*const EVP_CIPHER, key: [*c]const u8, iv: [*c]const u8) c_int;
pub extern fn EVP_CipherFinal(ctx: [*c]EVP_CIPHER_CTX, out: [*c]u8, out_len: [*c]c_int) c_int;
pub extern fn EVP_EncryptFinal(ctx: [*c]EVP_CIPHER_CTX, out: [*c]u8, out_len: [*c]c_int) c_int;
pub extern fn EVP_DecryptFinal(ctx: [*c]EVP_CIPHER_CTX, out: [*c]u8, out_len: [*c]c_int) c_int;
pub extern fn EVP_Cipher(ctx: [*c]EVP_CIPHER_CTX, out: [*c]u8, in: [*c]const u8, in_len: usize) c_int;
pub extern fn EVP_add_cipher_alias(a: [*c]const u8, b: [*c]const u8) c_int;
pub extern fn EVP_get_cipherbyname(name: [*c]const u8) ?*const EVP_CIPHER;
pub extern fn EVP_aes_128_gcm() ?*const EVP_CIPHER;
pub extern fn EVP_aes_256_gcm() ?*const EVP_CIPHER;
pub extern fn EVP_aes_192_ecb() ?*const EVP_CIPHER;
pub extern fn EVP_aes_192_cbc() ?*const EVP_CIPHER;
pub extern fn EVP_aes_192_ctr() ?*const EVP_CIPHER;
pub extern fn EVP_aes_192_gcm() ?*const EVP_CIPHER;
pub extern fn EVP_aes_192_ofb() ?*const EVP_CIPHER;
pub extern fn EVP_des_ede3_ecb() ?*const EVP_CIPHER;
pub extern fn EVP_aes_128_cfb128() ?*const EVP_CIPHER;
pub extern fn EVP_aes_256_cfb128() ?*const EVP_CIPHER;
pub extern fn EVP_aes_128_cfb() ?*const EVP_CIPHER;
pub extern fn EVP_aes_192_cfb128() ?*const EVP_CIPHER;
pub extern fn EVP_aes_192_cfb() ?*const EVP_CIPHER;
pub extern fn EVP_aes_256_cfb() ?*const EVP_CIPHER;
pub extern fn EVP_bf_ecb() ?*const EVP_CIPHER;
pub extern fn EVP_bf_cbc() ?*const EVP_CIPHER;
pub extern fn EVP_bf_cfb() ?*const EVP_CIPHER;
pub extern fn EVP_cast5_ecb() ?*const EVP_CIPHER;
pub extern fn EVP_cast5_cbc() ?*const EVP_CIPHER;
pub extern fn EVP_CIPHER_CTX_set_flags(ctx: [*c]const EVP_CIPHER_CTX, flags: u32) void;
pub extern fn EVP_md5_sha1() ?*const EVP_MD;
pub extern fn EVP_ripemd160() ?*const EVP_MD;
pub extern fn EVP_get_digestbynid(nid: c_int) ?*const EVP_MD;
pub extern fn EVP_get_digestbyobj(obj: ?*const ASN1_OBJECT) ?*const EVP_MD;
pub extern fn EVP_MD_CTX_init(ctx: [*c]EVP_MD_CTX) void;
pub extern fn EVP_MD_CTX_new() [*c]EVP_MD_CTX;
pub extern fn EVP_MD_CTX_cleanup(ctx: [*c]EVP_MD_CTX) c_int;
pub extern fn EVP_MD_CTX_cleanse(ctx: [*c]EVP_MD_CTX) void;
pub extern fn EVP_MD_CTX_free(ctx: [*c]EVP_MD_CTX) void;
pub extern fn EVP_MD_CTX_copy_ex(out: [*c]EVP_MD_CTX, in: [*c]const EVP_MD_CTX) c_int;
pub extern fn EVP_MD_CTX_move(out: [*c]EVP_MD_CTX, in: [*c]EVP_MD_CTX) void;
pub extern fn EVP_MD_CTX_reset(ctx: [*c]EVP_MD_CTX) c_int;
pub extern fn EVP_DigestInit_ex(ctx: [*c]EVP_MD_CTX, @"type": ?*const EVP_MD, engine: ?*ENGINE) c_int;
pub extern fn EVP_DigestInit(ctx: [*c]EVP_MD_CTX, @"type": ?*const EVP_MD) c_int;
pub extern fn EVP_DigestUpdate(ctx: [*c]EVP_MD_CTX, data: ?*const anyopaque, len: usize) c_int;
pub extern fn EVP_DigestFinal_ex(ctx: [*c]EVP_MD_CTX, md_out: [*c]u8, out_size: [*c]c_uint) c_int;
pub extern fn EVP_DigestFinal(ctx: [*c]EVP_MD_CTX, md_out: [*c]u8, out_size: [*c]c_uint) c_int;
pub extern fn EVP_Digest(data: ?*const anyopaque, len: usize, md_out: [*c]u8, md_out_size: [*c]c_uint, @"type": ?*const EVP_MD, impl: ?*ENGINE) c_int;
pub extern fn EVP_MD_type(md: ?*const EVP_MD) c_int;
pub extern fn EVP_MD_flags(md: ?*const EVP_MD) u32;
pub extern fn EVP_MD_size(md: ?*const EVP_MD) usize;
pub extern fn EVP_MD_block_size(md: ?*const EVP_MD) usize;
pub extern fn EVP_MD_CTX_md(ctx: [*c]const EVP_MD_CTX) ?*const EVP_MD;
pub extern fn EVP_MD_CTX_size(ctx: [*c]const EVP_MD_CTX) usize;
pub extern fn EVP_MD_CTX_block_size(ctx: [*c]const EVP_MD_CTX) usize;
pub extern fn EVP_MD_CTX_type(ctx: [*c]const EVP_MD_CTX) c_int;
pub extern fn EVP_parse_digest_algorithm(cbs: [*c]CBS) ?*const EVP_MD;
pub extern fn EVP_marshal_digest_algorithm(cbb: ?*CBB, md: ?*const EVP_MD) c_int;
pub extern fn EVP_MD_CTX_copy(out: [*c]EVP_MD_CTX, in: [*c]const EVP_MD_CTX) c_int;
pub extern fn EVP_add_digest(digest: ?*const EVP_MD) c_int;
pub extern fn EVP_get_digestbyname([*c]const u8) ?*const EVP_MD;
pub extern fn EVP_dss1() ?*const EVP_MD;
pub extern fn EVP_MD_CTX_create() [*c]EVP_MD_CTX;
pub extern fn EVP_MD_CTX_destroy(ctx: [*c]EVP_MD_CTX) void;
pub extern fn EVP_DigestFinalXOF(ctx: [*c]EVP_MD_CTX, out: [*c]u8, len: usize) c_int;
pub extern fn EVP_MD_meth_get_flags(md: ?*const EVP_MD) u32;
pub extern fn EVP_MD_CTX_set_flags(ctx: [*c]EVP_MD_CTX, flags: c_int) void;
pub extern fn EVP_MD_nid(md: ?*const EVP_MD) c_int;
pub extern fn EVP_aead_aes_128_gcm() ?*const EVP_AEAD;
pub extern fn EVP_aead_aes_192_gcm() ?*const EVP_AEAD;
pub extern fn EVP_aead_aes_256_gcm() ?*const EVP_AEAD;
pub extern fn EVP_aead_chacha20_poly1305() ?*const EVP_AEAD;
pub extern fn EVP_aead_xchacha20_poly1305() ?*const EVP_AEAD;
pub extern fn EVP_aead_aes_128_ctr_hmac_sha256() ?*const EVP_AEAD;
pub extern fn EVP_aead_aes_256_ctr_hmac_sha256() ?*const EVP_AEAD;
pub extern fn EVP_aead_aes_128_gcm_siv() ?*const EVP_AEAD;
pub extern fn EVP_aead_aes_256_gcm_siv() ?*const EVP_AEAD;
pub extern fn EVP_aead_aes_128_gcm_randnonce() ?*const EVP_AEAD;
pub extern fn EVP_aead_aes_256_gcm_randnonce() ?*const EVP_AEAD;
pub extern fn EVP_aead_aes_128_ccm_bluetooth() ?*const EVP_AEAD;
pub extern fn EVP_aead_aes_128_ccm_bluetooth_8() ?*const EVP_AEAD;
pub extern fn EVP_aead_aes_128_ccm_matter() ?*const EVP_AEAD;
pub extern fn EVP_has_aes_hardware() c_int;
pub extern fn EVP_AEAD_key_length(aead: ?*const EVP_AEAD) usize;
pub extern fn EVP_AEAD_nonce_length(aead: ?*const EVP_AEAD) usize;
pub extern fn EVP_AEAD_max_overhead(aead: ?*const EVP_AEAD) usize;
pub extern fn EVP_AEAD_max_tag_len(aead: ?*const EVP_AEAD) usize;
pub extern fn EVP_AEAD_CTX_zero(ctx: [*c]EVP_AEAD_CTX) void;
pub extern fn EVP_AEAD_CTX_new(aead: ?*const EVP_AEAD, key: [*c]const u8, key_len: usize, tag_len: usize) [*c]EVP_AEAD_CTX;
pub extern fn EVP_AEAD_CTX_free(ctx: [*c]EVP_AEAD_CTX) void;
pub extern fn EVP_AEAD_CTX_init(ctx: [*c]EVP_AEAD_CTX, aead: ?*const EVP_AEAD, key: [*c]const u8, key_len: usize, tag_len: usize, impl: ?*ENGINE) c_int;
pub extern fn EVP_AEAD_CTX_cleanup(ctx: [*c]EVP_AEAD_CTX) void;
pub extern fn EVP_AEAD_CTX_seal(ctx: [*c]const EVP_AEAD_CTX, out: [*c]u8, out_len: [*c]usize, max_out_len: usize, nonce: [*c]const u8, nonce_len: usize, in: [*c]const u8, in_len: usize, ad: [*c]const u8, ad_len: usize) c_int;
pub extern fn EVP_AEAD_CTX_open(ctx: [*c]const EVP_AEAD_CTX, out: [*c]u8, out_len: [*c]usize, max_out_len: usize, nonce: [*c]const u8, nonce_len: usize, in: [*c]const u8, in_len: usize, ad: [*c]const u8, ad_len: usize) c_int;
pub extern fn EVP_AEAD_CTX_seal_scatter(ctx: [*c]const EVP_AEAD_CTX, out: [*c]u8, out_tag: [*c]u8, out_tag_len: [*c]usize, max_out_tag_len: usize, nonce: [*c]const u8, nonce_len: usize, in: [*c]const u8, in_len: usize, extra_in: [*c]const u8, extra_in_len: usize, ad: [*c]const u8, ad_len: usize) c_int;
pub extern fn EVP_AEAD_CTX_open_gather(ctx: [*c]const EVP_AEAD_CTX, out: [*c]u8, nonce: [*c]const u8, nonce_len: usize, in: [*c]const u8, in_len: usize, in_tag: [*c]const u8, in_tag_len: usize, ad: [*c]const u8, ad_len: usize) c_int;
pub extern fn EVP_AEAD_CTX_aead(ctx: [*c]const EVP_AEAD_CTX) ?*const EVP_AEAD;
pub extern fn EVP_aead_aes_128_cbc_sha1_tls() ?*const EVP_AEAD;
pub extern fn EVP_aead_aes_128_cbc_sha1_tls_implicit_iv() ?*const EVP_AEAD;
pub extern fn EVP_aead_aes_256_cbc_sha1_tls() ?*const EVP_AEAD;
pub extern fn EVP_aead_aes_256_cbc_sha1_tls_implicit_iv() ?*const EVP_AEAD;
pub extern fn EVP_aead_des_ede3_cbc_sha1_tls() ?*const EVP_AEAD;
pub extern fn EVP_aead_des_ede3_cbc_sha1_tls_implicit_iv() ?*const EVP_AEAD;
pub extern fn EVP_aead_null_sha1_tls() ?*const EVP_AEAD;
pub extern fn EVP_aead_aes_128_gcm_tls12() ?*const EVP_AEAD;
pub extern fn EVP_aead_aes_256_gcm_tls12() ?*const EVP_AEAD;
pub extern fn EVP_aead_aes_128_gcm_tls13() ?*const EVP_AEAD;
pub extern fn EVP_aead_aes_256_gcm_tls13() ?*const EVP_AEAD;
pub const evp_aead_open: c_int = 0;
pub const evp_aead_seal: c_int = 1;
pub const enum_evp_aead_direction_t = c_uint;
pub extern fn EVP_AEAD_CTX_init_with_direction(ctx: [*c]EVP_AEAD_CTX, aead: ?*const EVP_AEAD, key: [*c]const u8, key_len: usize, tag_len: usize, dir: enum_evp_aead_direction_t) c_int;
pub extern fn EVP_AEAD_CTX_get_iv(ctx: [*c]const EVP_AEAD_CTX, out_iv: [*c][*c]const u8, out_len: [*c]usize) c_int;
pub extern fn EVP_AEAD_CTX_tag_len(ctx: [*c]const EVP_AEAD_CTX, out_tag_len: [*c]usize, in_len: usize, extra_in_len: usize) c_int;
pub extern fn EVP_PKEY_new() [*c]EVP_PKEY;
pub extern fn EVP_PKEY_free(pkey: [*c]EVP_PKEY) void;
pub extern fn EVP_PKEY_up_ref(pkey: [*c]EVP_PKEY) c_int;
pub extern fn EVP_PKEY_is_opaque(pkey: [*c]const EVP_PKEY) c_int;
pub extern fn EVP_PKEY_cmp(a: [*c]const EVP_PKEY, b: [*c]const EVP_PKEY) c_int;
pub extern fn EVP_PKEY_copy_parameters(to: [*c]EVP_PKEY, from: [*c]const EVP_PKEY) c_int;
pub extern fn EVP_PKEY_missing_parameters(pkey: [*c]const EVP_PKEY) c_int;
pub extern fn EVP_PKEY_size(pkey: [*c]const EVP_PKEY) c_int;
pub extern fn EVP_PKEY_bits(pkey: [*c]const EVP_PKEY) c_int;
pub extern fn EVP_PKEY_id(pkey: [*c]const EVP_PKEY) c_int;
pub extern fn EVP_PKEY_type(nid: c_int) c_int;
pub extern fn EVP_PKEY_set1_RSA(pkey: [*c]EVP_PKEY, key: ?*RSA) c_int;
pub extern fn EVP_PKEY_assign_RSA(pkey: [*c]EVP_PKEY, key: ?*RSA) c_int;
pub extern fn EVP_PKEY_get0_RSA(pkey: [*c]const EVP_PKEY) ?*RSA;
pub extern fn EVP_PKEY_get1_RSA(pkey: [*c]const EVP_PKEY) ?*RSA;
pub extern fn EVP_PKEY_set1_DSA(pkey: [*c]EVP_PKEY, key: [*c]DSA) c_int;
pub extern fn EVP_PKEY_assign_DSA(pkey: [*c]EVP_PKEY, key: [*c]DSA) c_int;
pub extern fn EVP_PKEY_get0_DSA(pkey: [*c]const EVP_PKEY) [*c]DSA;
pub extern fn EVP_PKEY_get1_DSA(pkey: [*c]const EVP_PKEY) [*c]DSA;
pub extern fn EVP_PKEY_set1_EC_KEY(pkey: [*c]EVP_PKEY, key: ?*EC_KEY) c_int;
pub extern fn EVP_PKEY_assign_EC_KEY(pkey: [*c]EVP_PKEY, key: ?*EC_KEY) c_int;
pub extern fn EVP_PKEY_get0_EC_KEY(pkey: [*c]const EVP_PKEY) ?*EC_KEY;
pub extern fn EVP_PKEY_get1_EC_KEY(pkey: [*c]const EVP_PKEY) ?*EC_KEY;
pub extern fn EVP_PKEY_assign(pkey: [*c]EVP_PKEY, @"type": c_int, key: ?*anyopaque) c_int;
pub extern fn EVP_PKEY_set_type(pkey: [*c]EVP_PKEY, @"type": c_int) c_int;
pub extern fn EVP_PKEY_cmp_parameters(a: [*c]const EVP_PKEY, b: [*c]const EVP_PKEY) c_int;
pub extern fn EVP_parse_public_key(cbs: [*c]CBS) [*c]EVP_PKEY;
pub extern fn EVP_marshal_public_key(cbb: ?*CBB, key: [*c]const EVP_PKEY) c_int;
pub extern fn EVP_parse_private_key(cbs: [*c]CBS) [*c]EVP_PKEY;
pub extern fn EVP_marshal_private_key(cbb: ?*CBB, key: [*c]const EVP_PKEY) c_int;
pub extern fn EVP_PKEY_new_raw_private_key(@"type": c_int, unused: ?*ENGINE, in: [*c]const u8, len: usize) [*c]EVP_PKEY;
pub extern fn EVP_PKEY_new_raw_public_key(@"type": c_int, unused: ?*ENGINE, in: [*c]const u8, len: usize) [*c]EVP_PKEY;
pub extern fn EVP_PKEY_get_raw_private_key(pkey: [*c]const EVP_PKEY, out: [*c]u8, out_len: [*c]usize) c_int;
pub extern fn EVP_PKEY_get_raw_public_key(pkey: [*c]const EVP_PKEY, out: [*c]u8, out_len: [*c]usize) c_int;
pub extern fn EVP_DigestSignInit(ctx: [*c]EVP_MD_CTX, pctx: [*c]?*EVP_PKEY_CTX, @"type": ?*const EVP_MD, e: ?*ENGINE, pkey: [*c]EVP_PKEY) c_int;
pub extern fn EVP_DigestSignUpdate(ctx: [*c]EVP_MD_CTX, data: ?*const anyopaque, len: usize) c_int;
pub extern fn EVP_DigestSignFinal(ctx: [*c]EVP_MD_CTX, out_sig: [*c]u8, out_sig_len: [*c]usize) c_int;
pub extern fn EVP_DigestSign(ctx: [*c]EVP_MD_CTX, out_sig: [*c]u8, out_sig_len: [*c]usize, data: [*c]const u8, data_len: usize) c_int;
pub extern fn EVP_DigestVerifyInit(ctx: [*c]EVP_MD_CTX, pctx: [*c]?*EVP_PKEY_CTX, @"type": ?*const EVP_MD, e: ?*ENGINE, pkey: [*c]EVP_PKEY) c_int;
pub extern fn EVP_DigestVerifyUpdate(ctx: [*c]EVP_MD_CTX, data: ?*const anyopaque, len: usize) c_int;
pub extern fn EVP_DigestVerifyFinal(ctx: [*c]EVP_MD_CTX, sig: [*c]const u8, sig_len: usize) c_int;
pub extern fn EVP_DigestVerify(ctx: [*c]EVP_MD_CTX, sig: [*c]const u8, sig_len: usize, data: [*c]const u8, len: usize) c_int;
pub extern fn EVP_SignInit_ex(ctx: [*c]EVP_MD_CTX, @"type": ?*const EVP_MD, impl: ?*ENGINE) c_int;
pub extern fn EVP_SignInit(ctx: [*c]EVP_MD_CTX, @"type": ?*const EVP_MD) c_int;
pub extern fn EVP_SignUpdate(ctx: [*c]EVP_MD_CTX, data: ?*const anyopaque, len: usize) c_int;
pub extern fn EVP_SignFinal(ctx: [*c]const EVP_MD_CTX, sig: [*c]u8, out_sig_len: [*c]c_uint, pkey: [*c]EVP_PKEY) c_int;
pub extern fn EVP_VerifyInit_ex(ctx: [*c]EVP_MD_CTX, @"type": ?*const EVP_MD, impl: ?*ENGINE) c_int;
pub extern fn EVP_VerifyInit(ctx: [*c]EVP_MD_CTX, @"type": ?*const EVP_MD) c_int;
pub extern fn EVP_VerifyUpdate(ctx: [*c]EVP_MD_CTX, data: ?*const anyopaque, len: usize) c_int;
pub extern fn EVP_VerifyFinal(ctx: [*c]EVP_MD_CTX, sig: [*c]const u8, sig_len: usize, pkey: [*c]EVP_PKEY) c_int;
pub extern fn EVP_PKEY_print_public(out: [*c]BIO, pkey: [*c]const EVP_PKEY, indent: c_int, pctx: ?*ASN1_PCTX) c_int;
pub extern fn EVP_PKEY_print_private(out: [*c]BIO, pkey: [*c]const EVP_PKEY, indent: c_int, pctx: ?*ASN1_PCTX) c_int;
pub extern fn EVP_PKEY_print_params(out: [*c]BIO, pkey: [*c]const EVP_PKEY, indent: c_int, pctx: ?*ASN1_PCTX) c_int;
pub extern fn PKCS5_PBKDF2_HMAC(password: ?[*]const u8, password_len: usize, salt: ?[*]const u8, salt_len: usize, iterations: c_uint, digest: ?*const EVP_MD, key_len: usize, out_key: ?[*]u8) c_int;
pub extern fn PKCS5_PBKDF2_HMAC_SHA1(password: [*c]const u8, password_len: usize, salt: [*c]const u8, salt_len: usize, iterations: c_uint, key_len: usize, out_key: [*c]u8) c_int;
pub extern fn EVP_PBE_validate_scrypt_params(password: [*c]const u8, password_len: usize, salt: [*c]const u8, salt_len: usize, N: u64, r: u64, p: u64, max_mem: usize, out_key: [*c]u8, key_len: usize) c_int;
pub extern fn EVP_PBE_scrypt(password: [*c]const u8, password_len: usize, salt: [*c]const u8, salt_len: usize, N: u64, r: u64, p: u64, max_mem: usize, out_key: [*c]u8, key_len: usize) c_int;
pub extern fn EVP_PKEY_CTX_new(pkey: [*c]EVP_PKEY, e: ?*ENGINE) ?*EVP_PKEY_CTX;
pub extern fn EVP_PKEY_CTX_new_id(id: c_int, e: ?*ENGINE) ?*EVP_PKEY_CTX;
pub extern fn EVP_PKEY_CTX_free(ctx: ?*EVP_PKEY_CTX) void;
pub extern fn EVP_PKEY_CTX_dup(ctx: ?*EVP_PKEY_CTX) ?*EVP_PKEY_CTX;
pub extern fn EVP_PKEY_CTX_get0_pkey(ctx: ?*EVP_PKEY_CTX) [*c]EVP_PKEY;
pub extern fn EVP_PKEY_sign_init(ctx: ?*EVP_PKEY_CTX) c_int;
pub extern fn EVP_PKEY_sign(ctx: ?*EVP_PKEY_CTX, sig: [*c]u8, sig_len: [*c]usize, digest: [*c]const u8, digest_len: usize) c_int;
pub extern fn EVP_PKEY_verify_init(ctx: ?*EVP_PKEY_CTX) c_int;
pub extern fn EVP_PKEY_verify(ctx: ?*EVP_PKEY_CTX, sig: [*c]const u8, sig_len: usize, digest: [*c]const u8, digest_len: usize) c_int;
pub extern fn EVP_PKEY_encrypt_init(ctx: ?*EVP_PKEY_CTX) c_int;
pub extern fn EVP_PKEY_encrypt(ctx: ?*EVP_PKEY_CTX, out: [*c]u8, out_len: [*c]usize, in: [*c]const u8, in_len: usize) c_int;
pub extern fn EVP_PKEY_decrypt_init(ctx: ?*EVP_PKEY_CTX) c_int;
pub extern fn EVP_PKEY_decrypt(ctx: ?*EVP_PKEY_CTX, out: [*c]u8, out_len: [*c]usize, in: [*c]const u8, in_len: usize) c_int;
pub extern fn EVP_PKEY_verify_recover_init(ctx: ?*EVP_PKEY_CTX) c_int;
pub extern fn EVP_PKEY_verify_recover(ctx: ?*EVP_PKEY_CTX, out: [*c]u8, out_len: [*c]usize, sig: [*c]const u8, siglen: usize) c_int;
pub extern fn EVP_PKEY_derive_init(ctx: ?*EVP_PKEY_CTX) c_int;
pub extern fn EVP_PKEY_derive_set_peer(ctx: ?*EVP_PKEY_CTX, peer: [*c]EVP_PKEY) c_int;
pub extern fn EVP_PKEY_derive(ctx: ?*EVP_PKEY_CTX, key: [*c]u8, out_key_len: [*c]usize) c_int;
pub extern fn EVP_PKEY_keygen_init(ctx: ?*EVP_PKEY_CTX) c_int;
pub extern fn EVP_PKEY_keygen(ctx: ?*EVP_PKEY_CTX, out_pkey: [*c][*c]EVP_PKEY) c_int;
pub extern fn EVP_PKEY_paramgen_init(ctx: ?*EVP_PKEY_CTX) c_int;
pub extern fn EVP_PKEY_paramgen(ctx: ?*EVP_PKEY_CTX, out_pkey: [*c][*c]EVP_PKEY) c_int;
pub extern fn EVP_PKEY_CTX_set_signature_md(ctx: ?*EVP_PKEY_CTX, md: ?*const EVP_MD) c_int;
pub extern fn EVP_PKEY_CTX_get_signature_md(ctx: ?*EVP_PKEY_CTX, out_md: [*c]?*const EVP_MD) c_int;
pub extern fn EVP_PKEY_CTX_set_rsa_padding(ctx: ?*EVP_PKEY_CTX, padding: c_int) c_int;
pub extern fn EVP_PKEY_CTX_get_rsa_padding(ctx: ?*EVP_PKEY_CTX, out_padding: [*c]c_int) c_int;
pub extern fn EVP_PKEY_CTX_set_rsa_pss_saltlen(ctx: ?*EVP_PKEY_CTX, salt_len: c_int) c_int;
pub extern fn EVP_PKEY_CTX_get_rsa_pss_saltlen(ctx: ?*EVP_PKEY_CTX, out_salt_len: [*c]c_int) c_int;
pub extern fn EVP_PKEY_CTX_set_rsa_keygen_bits(ctx: ?*EVP_PKEY_CTX, bits: c_int) c_int;
pub extern fn EVP_PKEY_CTX_set_rsa_keygen_pubexp(ctx: ?*EVP_PKEY_CTX, e: [*c]BIGNUM) c_int;
pub extern fn EVP_PKEY_CTX_set_rsa_oaep_md(ctx: ?*EVP_PKEY_CTX, md: ?*const EVP_MD) c_int;
pub extern fn EVP_PKEY_CTX_get_rsa_oaep_md(ctx: ?*EVP_PKEY_CTX, out_md: [*c]?*const EVP_MD) c_int;
pub extern fn EVP_PKEY_CTX_set_rsa_mgf1_md(ctx: ?*EVP_PKEY_CTX, md: ?*const EVP_MD) c_int;
pub extern fn EVP_PKEY_CTX_get_rsa_mgf1_md(ctx: ?*EVP_PKEY_CTX, out_md: [*c]?*const EVP_MD) c_int;
pub extern fn EVP_PKEY_CTX_set0_rsa_oaep_label(ctx: ?*EVP_PKEY_CTX, label: [*c]u8, label_len: usize) c_int;
pub extern fn EVP_PKEY_CTX_get0_rsa_oaep_label(ctx: ?*EVP_PKEY_CTX, out_label: [*c][*c]const u8) c_int;
pub extern fn EVP_PKEY_CTX_set_ec_paramgen_curve_nid(ctx: ?*EVP_PKEY_CTX, nid: c_int) c_int;
pub extern fn EVP_PKEY_get0(pkey: [*c]const EVP_PKEY) ?*anyopaque;
pub extern fn OpenSSL_add_all_algorithms() void;
pub extern fn OPENSSL_add_all_algorithms_conf() void;
pub extern fn OpenSSL_add_all_ciphers() void;
pub extern fn OpenSSL_add_all_digests() void;
pub extern fn EVP_cleanup() void;
pub extern fn EVP_CIPHER_do_all_sorted(callback: ?*const fn (?*const EVP_CIPHER, [*c]const u8, [*c]const u8, ?*anyopaque) callconv(.C) void, arg: ?*anyopaque) void;
pub extern fn EVP_MD_do_all_sorted(callback: *const fn (*const EVP_MD, ?[*:0]const u8, ?[*:0]const u8, *anyopaque) callconv(.C) void, arg: *anyopaque) void;
pub extern fn EVP_MD_do_all(callback: ?*const fn (?*const EVP_MD, [*c]const u8, [*c]const u8, ?*anyopaque) callconv(.C) void, arg: ?*anyopaque) void;
pub extern fn i2d_PrivateKey(key: [*c]const EVP_PKEY, outp: [*c][*c]u8) c_int;
pub extern fn i2d_PublicKey(key: [*c]const EVP_PKEY, outp: [*c][*c]u8) c_int;
pub extern fn d2i_PrivateKey(@"type": c_int, out: [*c][*c]EVP_PKEY, inp: [*c][*c]const u8, len: c_long) [*c]EVP_PKEY;
pub extern fn d2i_AutoPrivateKey(out: [*c][*c]EVP_PKEY, inp: [*c][*c]const u8, len: c_long) [*c]EVP_PKEY;
pub extern fn d2i_PublicKey(@"type": c_int, out: [*c][*c]EVP_PKEY, inp: [*c][*c]const u8, len: c_long) [*c]EVP_PKEY;
pub extern fn EVP_PKEY_get0_DH(pkey: [*c]const EVP_PKEY) ?*DH;
pub extern fn EVP_PKEY_get1_DH(pkey: [*c]const EVP_PKEY) ?*DH;
pub extern fn EVP_PKEY_CTX_set_ec_param_enc(ctx: ?*EVP_PKEY_CTX, encoding: c_int) c_int;
pub extern fn EVP_PKEY_set1_tls_encodedpoint(pkey: [*c]EVP_PKEY, in: [*c]const u8, len: usize) c_int;
pub extern fn EVP_PKEY_get1_tls_encodedpoint(pkey: [*c]const EVP_PKEY, out_ptr: [*c][*c]u8) usize;
pub extern fn EVP_PKEY_base_id(pkey: [*c]const EVP_PKEY) c_int;
pub extern fn EVP_PKEY_CTX_set_rsa_pss_keygen_md(ctx: ?*EVP_PKEY_CTX, md: ?*const EVP_MD) c_int;
pub extern fn EVP_PKEY_CTX_set_rsa_pss_keygen_saltlen(ctx: ?*EVP_PKEY_CTX, salt_len: c_int) c_int;
pub extern fn EVP_PKEY_CTX_set_rsa_pss_keygen_mgf1_md(ctx: ?*EVP_PKEY_CTX, md: ?*const EVP_MD) c_int;
pub extern fn i2d_PUBKEY(pkey: [*c]const EVP_PKEY, outp: [*c][*c]u8) c_int;
pub extern fn d2i_PUBKEY(out: [*c][*c]EVP_PKEY, inp: [*c][*c]const u8, len: c_long) [*c]EVP_PKEY;
pub extern fn i2d_RSA_PUBKEY(rsa: ?*const RSA, outp: [*c][*c]u8) c_int;
pub extern fn d2i_RSA_PUBKEY(out: [*c]?*RSA, inp: [*c][*c]const u8, len: c_long) ?*RSA;
pub extern fn i2d_DSA_PUBKEY(dsa: [*c]const DSA, outp: [*c][*c]u8) c_int;
pub extern fn d2i_DSA_PUBKEY(out: [*c][*c]DSA, inp: [*c][*c]const u8, len: c_long) [*c]DSA;
pub extern fn i2d_EC_PUBKEY(ec_key: ?*const EC_KEY, outp: [*c][*c]u8) c_int;
pub extern fn d2i_EC_PUBKEY(out: [*c]?*EC_KEY, inp: [*c][*c]const u8, len: c_long) ?*EC_KEY;
pub extern fn EVP_PKEY_CTX_set_dsa_paramgen_bits(ctx: ?*EVP_PKEY_CTX, nbits: c_int) c_int;
pub extern fn EVP_PKEY_CTX_set_dsa_paramgen_q_bits(ctx: ?*EVP_PKEY_CTX, qbits: c_int) c_int;
pub const struct_stack_st_CRYPTO_BUFFER = opaque {};
pub const struct_stack_st_X509 = opaque {};
pub const struct_stack_st_X509_CRL = opaque {};
pub extern fn PKCS7_get_raw_certificates(out_certs: ?*struct_stack_st_CRYPTO_BUFFER, cbs: [*c]CBS, pool: ?*CRYPTO_BUFFER_POOL) c_int;
pub extern fn PKCS7_get_certificates(out_certs: ?*struct_stack_st_X509, cbs: [*c]CBS) c_int;
pub extern fn PKCS7_bundle_raw_certificates(out: ?*CBB, certs: ?*const struct_stack_st_CRYPTO_BUFFER) c_int;
pub extern fn PKCS7_bundle_certificates(out: ?*CBB, certs: ?*const struct_stack_st_X509) c_int;
pub extern fn PKCS7_get_CRLs(out_crls: ?*struct_stack_st_X509_CRL, cbs: [*c]CBS) c_int;
pub extern fn PKCS7_bundle_CRLs(out: ?*CBB, crls: ?*const struct_stack_st_X509_CRL) c_int;
pub extern fn PKCS7_get_PEM_certificates(out_certs: ?*struct_stack_st_X509, pem_bio: [*c]BIO) c_int;
pub extern fn PKCS7_get_PEM_CRLs(out_crls: ?*struct_stack_st_X509_CRL, pem_bio: [*c]BIO) c_int;
pub const PKCS7_SIGNED = extern struct {
    cert: ?*struct_stack_st_X509,
    crl: ?*struct_stack_st_X509_CRL,
};
pub const PKCS7_SIGN_ENVELOPE = extern struct {
    cert: ?*struct_stack_st_X509,
    crl: ?*struct_stack_st_X509_CRL,
};
pub const PKCS7_ENVELOPE = anyopaque;
pub const PKCS7_DIGEST = anyopaque;
pub const PKCS7_ENCRYPT = anyopaque;
pub const PKCS7_SIGNER_INFO = anyopaque;
const union_unnamed_7 = extern union {
    ptr: [*c]u8,
    data: [*c]ASN1_OCTET_STRING,
    sign: [*c]PKCS7_SIGNED,
    enveloped: ?*PKCS7_ENVELOPE,
    signed_and_enveloped: [*c]PKCS7_SIGN_ENVELOPE,
    digest: ?*PKCS7_DIGEST,
    encrypted: ?*PKCS7_ENCRYPT,
    other: [*c]ASN1_TYPE,
};
pub const PKCS7 = extern struct {
    ber_bytes: [*c]u8,
    ber_len: usize,
    type: ?*ASN1_OBJECT,
    d: union_unnamed_7,
};
pub extern fn d2i_PKCS7(out: [*c][*c]PKCS7, inp: [*c][*c]const u8, len: usize) [*c]PKCS7;
pub extern fn d2i_PKCS7_bio(bio: [*c]BIO, out: [*c][*c]PKCS7) [*c]PKCS7;
pub extern fn i2d_PKCS7(p7: [*c]const PKCS7, out: [*c][*c]u8) c_int;
pub extern fn i2d_PKCS7_bio(bio: [*c]BIO, p7: [*c]const PKCS7) c_int;
pub extern fn PKCS7_free(p7: [*c]PKCS7) void;
pub extern fn PKCS7_type_is_data(p7: [*c]const PKCS7) c_int;
pub extern fn PKCS7_type_is_digest(p7: [*c]const PKCS7) c_int;
pub extern fn PKCS7_type_is_encrypted(p7: [*c]const PKCS7) c_int;
pub extern fn PKCS7_type_is_enveloped(p7: [*c]const PKCS7) c_int;
pub extern fn PKCS7_type_is_signed(p7: [*c]const PKCS7) c_int;
pub extern fn PKCS7_type_is_signedAndEnveloped(p7: [*c]const PKCS7) c_int;
pub extern fn PKCS7_sign(sign_cert: ?*X509, pkey: [*c]EVP_PKEY, certs: ?*struct_stack_st_X509, data: [*c]BIO, flags: c_int) [*c]PKCS7;
pub extern fn BN_new() [*c]BIGNUM;
pub extern fn BN_init(bn: [*c]BIGNUM) void;
pub extern fn BN_free(bn: [*c]BIGNUM) void;
pub extern fn BN_clear_free(bn: [*c]BIGNUM) void;
pub extern fn BN_dup(src: [*c]const BIGNUM) [*c]BIGNUM;
pub extern fn BN_copy(dest: [*c]BIGNUM, src: [*c]const BIGNUM) [*c]BIGNUM;
pub extern fn BN_clear(bn: [*c]BIGNUM) void;
pub extern fn BN_value_one() [*c]const BIGNUM;
pub extern fn BN_num_bits(bn: [*c]const BIGNUM) c_uint;
pub extern fn BN_num_bytes(bn: [*c]const BIGNUM) c_uint;
pub extern fn BN_zero(bn: [*c]BIGNUM) void;
pub extern fn BN_one(bn: [*c]BIGNUM) c_int;
pub extern fn BN_set_word(bn: [*c]BIGNUM, value: BN_ULONG) c_int;
pub extern fn BN_set_u64(bn: [*c]BIGNUM, value: u64) c_int;
pub extern fn BN_set_negative(bn: [*c]BIGNUM, sign: c_int) void;
pub extern fn BN_is_negative(bn: [*c]const BIGNUM) c_int;
pub extern fn BN_bin2bn(in: [*c]const u8, len: usize, ret: [*c]BIGNUM) [*c]BIGNUM;
pub extern fn BN_bn2bin(in: [*c]const BIGNUM, out: [*c]u8) usize;
pub extern fn BN_le2bn(in: [*c]const u8, len: usize, ret: [*c]BIGNUM) [*c]BIGNUM;
pub extern fn BN_bn2le_padded(out: [*c]u8, len: usize, in: [*c]const BIGNUM) c_int;
pub extern fn BN_bn2bin_padded(out: [*c]u8, len: usize, in: [*c]const BIGNUM) c_int;
pub extern fn BN_bn2cbb_padded(out: ?*CBB, len: usize, in: [*c]const BIGNUM) c_int;
pub extern fn BN_bn2hex(bn: [*c]const BIGNUM) [*c]u8;
pub extern fn BN_hex2bn(outp: [*c][*c]BIGNUM, in: [*c]const u8) c_int;
pub extern fn BN_bn2dec(a: [*c]const BIGNUM) [*c]u8;
pub extern fn BN_dec2bn(outp: [*c][*c]BIGNUM, in: [*c]const u8) c_int;
pub extern fn BN_asc2bn(outp: [*c][*c]BIGNUM, in: [*c]const u8) c_int;
pub extern fn BN_print(bio: [*c]BIO, a: [*c]const BIGNUM) c_int;
pub extern fn BN_get_word(bn: [*c]const BIGNUM) BN_ULONG;
pub extern fn BN_get_u64(bn: [*c]const BIGNUM, out: [*c]u64) c_int;
pub extern fn BN_parse_asn1_unsigned(cbs: [*c]CBS, ret: [*c]BIGNUM) c_int;
pub extern fn BN_marshal_asn1(cbb: ?*CBB, bn: [*c]const BIGNUM) c_int;
pub extern fn BN_CTX_new() ?*BN_CTX;
pub extern fn BN_CTX_free(ctx: ?*BN_CTX) void;
pub extern fn BN_CTX_start(ctx: ?*BN_CTX) void;
pub extern fn BN_CTX_get(ctx: ?*BN_CTX) [*c]BIGNUM;
pub extern fn BN_CTX_end(ctx: ?*BN_CTX) void;
pub extern fn BN_add(r: [*c]BIGNUM, a: [*c]const BIGNUM, b: [*c]const BIGNUM) c_int;
pub extern fn BN_uadd(r: [*c]BIGNUM, a: [*c]const BIGNUM, b: [*c]const BIGNUM) c_int;
pub extern fn BN_add_word(a: [*c]BIGNUM, w: BN_ULONG) c_int;
pub extern fn BN_sub(r: [*c]BIGNUM, a: [*c]const BIGNUM, b: [*c]const BIGNUM) c_int;
pub extern fn BN_usub(r: [*c]BIGNUM, a: [*c]const BIGNUM, b: [*c]const BIGNUM) c_int;
pub extern fn BN_sub_word(a: [*c]BIGNUM, w: BN_ULONG) c_int;
pub extern fn BN_mul(r: [*c]BIGNUM, a: [*c]const BIGNUM, b: [*c]const BIGNUM, ctx: ?*BN_CTX) c_int;
pub extern fn BN_mul_word(bn: [*c]BIGNUM, w: BN_ULONG) c_int;
pub extern fn BN_sqr(r: [*c]BIGNUM, a: [*c]const BIGNUM, ctx: ?*BN_CTX) c_int;
pub extern fn BN_div(quotient: [*c]BIGNUM, rem: [*c]BIGNUM, numerator: [*c]const BIGNUM, divisor: [*c]const BIGNUM, ctx: ?*BN_CTX) c_int;
pub extern fn BN_div_word(numerator: [*c]BIGNUM, divisor: BN_ULONG) BN_ULONG;
pub extern fn BN_sqrt(out_sqrt: [*c]BIGNUM, in: [*c]const BIGNUM, ctx: ?*BN_CTX) c_int;
pub extern fn BN_cmp(a: [*c]const BIGNUM, b: [*c]const BIGNUM) c_int;
pub extern fn BN_cmp_word(a: [*c]const BIGNUM, b: BN_ULONG) c_int;
pub extern fn BN_ucmp(a: [*c]const BIGNUM, b: [*c]const BIGNUM) c_int;
pub extern fn BN_equal_consttime(a: [*c]const BIGNUM, b: [*c]const BIGNUM) c_int;
pub extern fn BN_abs_is_word(bn: [*c]const BIGNUM, w: BN_ULONG) c_int;
pub extern fn BN_is_zero(bn: [*c]const BIGNUM) c_int;
pub extern fn BN_is_one(bn: [*c]const BIGNUM) c_int;
pub extern fn BN_is_word(bn: [*c]const BIGNUM, w: BN_ULONG) c_int;
pub extern fn BN_is_odd(bn: [*c]const BIGNUM) c_int;
pub extern fn BN_is_pow2(a: [*c]const BIGNUM) c_int;
pub extern fn BN_lshift(r: [*c]BIGNUM, a: [*c]const BIGNUM, n: c_int) c_int;
pub extern fn BN_lshift1(r: [*c]BIGNUM, a: [*c]const BIGNUM) c_int;
pub extern fn BN_rshift(r: [*c]BIGNUM, a: [*c]const BIGNUM, n: c_int) c_int;
pub extern fn BN_rshift1(r: [*c]BIGNUM, a: [*c]const BIGNUM) c_int;
pub extern fn BN_set_bit(a: [*c]BIGNUM, n: c_int) c_int;
pub extern fn BN_clear_bit(a: [*c]BIGNUM, n: c_int) c_int;
pub extern fn BN_is_bit_set(a: [*c]const BIGNUM, n: c_int) c_int;
pub extern fn BN_mask_bits(a: [*c]BIGNUM, n: c_int) c_int;
pub extern fn BN_count_low_zero_bits(bn: [*c]const BIGNUM) c_int;
pub extern fn BN_mod_word(a: [*c]const BIGNUM, w: BN_ULONG) BN_ULONG;
pub extern fn BN_mod_pow2(r: [*c]BIGNUM, a: [*c]const BIGNUM, e: usize) c_int;
pub extern fn BN_nnmod_pow2(r: [*c]BIGNUM, a: [*c]const BIGNUM, e: usize) c_int;
pub extern fn BN_nnmod(rem: [*c]BIGNUM, numerator: [*c]const BIGNUM, divisor: [*c]const BIGNUM, ctx: ?*BN_CTX) c_int;
pub extern fn BN_mod_add(r: [*c]BIGNUM, a: [*c]const BIGNUM, b: [*c]const BIGNUM, m: [*c]const BIGNUM, ctx: ?*BN_CTX) c_int;
pub extern fn BN_mod_add_quick(r: [*c]BIGNUM, a: [*c]const BIGNUM, b: [*c]const BIGNUM, m: [*c]const BIGNUM) c_int;
pub extern fn BN_mod_sub(r: [*c]BIGNUM, a: [*c]const BIGNUM, b: [*c]const BIGNUM, m: [*c]const BIGNUM, ctx: ?*BN_CTX) c_int;
pub extern fn BN_mod_sub_quick(r: [*c]BIGNUM, a: [*c]const BIGNUM, b: [*c]const BIGNUM, m: [*c]const BIGNUM) c_int;
pub extern fn BN_mod_mul(r: [*c]BIGNUM, a: [*c]const BIGNUM, b: [*c]const BIGNUM, m: [*c]const BIGNUM, ctx: ?*BN_CTX) c_int;
pub extern fn BN_mod_sqr(r: [*c]BIGNUM, a: [*c]const BIGNUM, m: [*c]const BIGNUM, ctx: ?*BN_CTX) c_int;
pub extern fn BN_mod_lshift(r: [*c]BIGNUM, a: [*c]const BIGNUM, n: c_int, m: [*c]const BIGNUM, ctx: ?*BN_CTX) c_int;
pub extern fn BN_mod_lshift_quick(r: [*c]BIGNUM, a: [*c]const BIGNUM, n: c_int, m: [*c]const BIGNUM) c_int;
pub extern fn BN_mod_lshift1(r: [*c]BIGNUM, a: [*c]const BIGNUM, m: [*c]const BIGNUM, ctx: ?*BN_CTX) c_int;
pub extern fn BN_mod_lshift1_quick(r: [*c]BIGNUM, a: [*c]const BIGNUM, m: [*c]const BIGNUM) c_int;
pub extern fn BN_mod_sqrt(in: [*c]BIGNUM, a: [*c]const BIGNUM, p: [*c]const BIGNUM, ctx: ?*BN_CTX) [*c]BIGNUM;
pub extern fn BN_rand(rnd: [*c]BIGNUM, bits: c_int, top: c_int, bottom: c_int) c_int;
pub extern fn BN_pseudo_rand(rnd: [*c]BIGNUM, bits: c_int, top: c_int, bottom: c_int) c_int;
pub extern fn BN_rand_range(rnd: [*c]BIGNUM, range: [*c]const BIGNUM) c_int;
pub extern fn BN_rand_range_ex(r: [*c]BIGNUM, min_inclusive: BN_ULONG, max_exclusive: [*c]const BIGNUM) c_int;
pub extern fn BN_pseudo_rand_range(rnd: [*c]BIGNUM, range: [*c]const BIGNUM) c_int;
pub extern fn BN_GENCB_new() [*c]BN_GENCB;
pub extern fn BN_GENCB_free(callback: [*c]BN_GENCB) void;
pub extern fn BN_GENCB_set(callback: [*c]BN_GENCB, f: ?*const fn (c_int, c_int, [*c]BN_GENCB) callconv(.C) c_int, arg: ?*anyopaque) void;
pub extern fn BN_GENCB_call(callback: [*c]BN_GENCB, event: c_int, n: c_int) c_int;
pub extern fn BN_GENCB_get_arg(callback: [*c]const BN_GENCB) ?*anyopaque;
pub extern fn BN_generate_prime_ex(ret: [*c]BIGNUM, bits: c_int, safe: c_int, add: [*c]const BIGNUM, rem: [*c]const BIGNUM, cb: [*c]BN_GENCB) c_int;
pub const bn_probably_prime: c_int = 0;
pub const bn_composite: c_int = 1;
pub const bn_non_prime_power_composite: c_int = 2;
pub const enum_bn_primality_result_t = c_uint;
pub extern fn ASN1_tag2bit(tag: c_int) c_ulong;
pub extern fn ASN1_tag2str(tag: c_int) [*c]const u8;
pub const d2i_of_void = fn ([*c]?*anyopaque, [*c][*c]const u8, c_long) callconv(.C) ?*anyopaque;
pub const i2d_of_void = fn (?*const anyopaque, [*c][*c]u8) callconv(.C) c_int;
pub const ASN1_ITEM_EXP = ASN1_ITEM;
pub extern fn ASN1_item_new(it: ?*const ASN1_ITEM) ?*ASN1_VALUE;
pub extern fn ASN1_item_free(val: ?*ASN1_VALUE, it: ?*const ASN1_ITEM) void;
pub extern fn ASN1_item_d2i(out: [*c]?*ASN1_VALUE, inp: [*c][*c]const u8, len: c_long, it: ?*const ASN1_ITEM) ?*ASN1_VALUE;
pub extern fn ASN1_item_i2d(val: ?*ASN1_VALUE, outp: [*c][*c]u8, it: ?*const ASN1_ITEM) c_int;
pub extern fn ASN1_item_dup(it: ?*const ASN1_ITEM, x: ?*anyopaque) ?*anyopaque;
// pub extern fn ASN1_item_d2i_fp(it: ?*const ASN1_ITEM, in: [*c]FILE, out: ?*anyopaque) ?*anyopaque;
pub extern fn ASN1_item_d2i_bio(it: ?*const ASN1_ITEM, in: [*c]BIO, out: ?*anyopaque) ?*anyopaque;
// pub extern fn ASN1_item_i2d_fp(it: ?*const ASN1_ITEM, out: [*c]FILE, in: ?*anyopaque) c_int;
pub extern fn ASN1_item_i2d_bio(it: ?*const ASN1_ITEM, out: [*c]BIO, in: ?*anyopaque) c_int;
pub extern fn ASN1_item_unpack(oct: [*c]const ASN1_STRING, it: ?*const ASN1_ITEM) ?*anyopaque;
pub extern fn ASN1_item_pack(obj: ?*anyopaque, it: ?*const ASN1_ITEM, out: [*c][*c]ASN1_STRING) [*c]ASN1_STRING;
pub extern fn d2i_ASN1_BOOLEAN(out: [*c]ASN1_BOOLEAN, inp: [*c][*c]const u8, len: c_long) ASN1_BOOLEAN;
pub extern fn i2d_ASN1_BOOLEAN(a: ASN1_BOOLEAN, outp: [*c][*c]u8) c_int;
pub extern const ASN1_BOOLEAN_it: ASN1_ITEM;
pub extern const ASN1_TBOOLEAN_it: ASN1_ITEM;
pub extern const ASN1_FBOOLEAN_it: ASN1_ITEM;
pub extern fn ASN1_STRING_type_new(@"type": c_int) [*c]ASN1_STRING;
pub extern fn ASN1_STRING_new() [*c]ASN1_STRING;
pub extern fn ASN1_STRING_free(str: [*c]ASN1_STRING) void;
pub extern fn ASN1_STRING_copy(dst: [*c]ASN1_STRING, str: [*c]const ASN1_STRING) c_int;
pub extern fn ASN1_STRING_dup(str: [*c]const ASN1_STRING) [*c]ASN1_STRING;
pub extern fn ASN1_STRING_type(str: [*c]const ASN1_STRING) c_int;
pub extern fn ASN1_STRING_get0_data(str: [*c]const ASN1_STRING) [*c]const u8;
pub extern fn ASN1_STRING_data(str: [*c]ASN1_STRING) [*c]u8;
pub extern fn ASN1_STRING_length(str: [*c]const ASN1_STRING) c_int;
pub extern fn ASN1_STRING_cmp(a: [*c]const ASN1_STRING, b: [*c]const ASN1_STRING) c_int;
// pub extern fn ASN1_STRING_set(str: [*c]ASN1_STRING, data: ?*const anyopaque, len: ossl_ssize_t) c_int;
// pub extern fn ASN1_STRING_set0(str: [*c]ASN1_STRING, data: ?*anyopaque, len: c_int) void;
pub extern fn ASN1_BMPSTRING_new() [*c]ASN1_BMPSTRING;
pub extern fn ASN1_GENERALSTRING_new() [*c]ASN1_GENERALSTRING;
pub extern fn ASN1_IA5STRING_new() [*c]ASN1_IA5STRING;
pub extern fn ASN1_OCTET_STRING_new() [*c]ASN1_OCTET_STRING;
pub extern fn ASN1_PRINTABLESTRING_new() [*c]ASN1_PRINTABLESTRING;
pub extern fn ASN1_T61STRING_new() [*c]ASN1_T61STRING;
pub extern fn ASN1_UNIVERSALSTRING_new() [*c]ASN1_UNIVERSALSTRING;
pub extern fn ASN1_UTF8STRING_new() [*c]ASN1_UTF8STRING;
pub extern fn ASN1_VISIBLESTRING_new() [*c]ASN1_VISIBLESTRING;
pub extern fn ASN1_BMPSTRING_free(str: [*c]ASN1_BMPSTRING) void;
pub extern fn ASN1_GENERALSTRING_free(str: [*c]ASN1_GENERALSTRING) void;
pub extern fn ASN1_IA5STRING_free(str: [*c]ASN1_IA5STRING) void;
pub extern fn ASN1_OCTET_STRING_free(str: [*c]ASN1_OCTET_STRING) void;
pub extern fn ASN1_PRINTABLESTRING_free(str: [*c]ASN1_PRINTABLESTRING) void;
pub extern fn ASN1_T61STRING_free(str: [*c]ASN1_T61STRING) void;
pub extern fn ASN1_UNIVERSALSTRING_free(str: [*c]ASN1_UNIVERSALSTRING) void;
pub extern fn ASN1_UTF8STRING_free(str: [*c]ASN1_UTF8STRING) void;
pub extern fn ASN1_VISIBLESTRING_free(str: [*c]ASN1_VISIBLESTRING) void;
pub extern fn d2i_ASN1_BMPSTRING(out: [*c][*c]ASN1_BMPSTRING, inp: [*c][*c]const u8, len: c_long) [*c]ASN1_BMPSTRING;
pub extern fn d2i_ASN1_GENERALSTRING(out: [*c][*c]ASN1_GENERALSTRING, inp: [*c][*c]const u8, len: c_long) [*c]ASN1_GENERALSTRING;
pub extern fn d2i_ASN1_IA5STRING(out: [*c][*c]ASN1_IA5STRING, inp: [*c][*c]const u8, len: c_long) [*c]ASN1_IA5STRING;
pub extern fn d2i_ASN1_OCTET_STRING(out: [*c][*c]ASN1_OCTET_STRING, inp: [*c][*c]const u8, len: c_long) [*c]ASN1_OCTET_STRING;
pub extern fn d2i_ASN1_PRINTABLESTRING(out: [*c][*c]ASN1_PRINTABLESTRING, inp: [*c][*c]const u8, len: c_long) [*c]ASN1_PRINTABLESTRING;
pub extern fn d2i_ASN1_T61STRING(out: [*c][*c]ASN1_T61STRING, inp: [*c][*c]const u8, len: c_long) [*c]ASN1_T61STRING;
pub extern fn d2i_ASN1_UNIVERSALSTRING(out: [*c][*c]ASN1_UNIVERSALSTRING, inp: [*c][*c]const u8, len: c_long) [*c]ASN1_UNIVERSALSTRING;
pub extern fn d2i_ASN1_UTF8STRING(out: [*c][*c]ASN1_UTF8STRING, inp: [*c][*c]const u8, len: c_long) [*c]ASN1_UTF8STRING;
pub extern fn d2i_ASN1_VISIBLESTRING(out: [*c][*c]ASN1_VISIBLESTRING, inp: [*c][*c]const u8, len: c_long) [*c]ASN1_VISIBLESTRING;
pub extern fn i2d_ASN1_BMPSTRING(in: [*c]const ASN1_BMPSTRING, outp: [*c][*c]u8) c_int;
pub extern fn i2d_ASN1_GENERALSTRING(in: [*c]const ASN1_GENERALSTRING, outp: [*c][*c]u8) c_int;
pub extern fn i2d_ASN1_IA5STRING(in: [*c]const ASN1_IA5STRING, outp: [*c][*c]u8) c_int;
pub extern fn i2d_ASN1_OCTET_STRING(in: [*c]const ASN1_OCTET_STRING, outp: [*c][*c]u8) c_int;
pub extern fn i2d_ASN1_PRINTABLESTRING(in: [*c]const ASN1_PRINTABLESTRING, outp: [*c][*c]u8) c_int;
pub extern fn i2d_ASN1_T61STRING(in: [*c]const ASN1_T61STRING, outp: [*c][*c]u8) c_int;
pub extern fn i2d_ASN1_UNIVERSALSTRING(in: [*c]const ASN1_UNIVERSALSTRING, outp: [*c][*c]u8) c_int;
pub extern fn i2d_ASN1_UTF8STRING(in: [*c]const ASN1_UTF8STRING, outp: [*c][*c]u8) c_int;
pub extern fn i2d_ASN1_VISIBLESTRING(in: [*c]const ASN1_VISIBLESTRING, outp: [*c][*c]u8) c_int;
pub extern const ASN1_BMPSTRING_it: ASN1_ITEM;
pub extern const ASN1_GENERALSTRING_it: ASN1_ITEM;
pub extern const ASN1_IA5STRING_it: ASN1_ITEM;
pub extern const ASN1_OCTET_STRING_it: ASN1_ITEM;
pub extern const ASN1_PRINTABLESTRING_it: ASN1_ITEM;
pub extern const ASN1_T61STRING_it: ASN1_ITEM;
pub extern const ASN1_UNIVERSALSTRING_it: ASN1_ITEM;
pub extern const ASN1_UTF8STRING_it: ASN1_ITEM;
pub extern const ASN1_VISIBLESTRING_it: ASN1_ITEM;
pub extern fn ASN1_OCTET_STRING_dup(a: [*c]const ASN1_OCTET_STRING) [*c]ASN1_OCTET_STRING;
pub extern fn ASN1_OCTET_STRING_cmp(a: [*c]const ASN1_OCTET_STRING, b: [*c]const ASN1_OCTET_STRING) c_int;
pub extern fn ASN1_OCTET_STRING_set(str: [*c]ASN1_OCTET_STRING, data: [*c]const u8, len: c_int) c_int;
pub extern fn ASN1_STRING_to_UTF8(out: [*c][*c]u8, in: [*c]const ASN1_STRING) c_int;
pub extern fn ASN1_mbstring_copy(out: [*c][*c]ASN1_STRING, in: [*c]const u8, len: c_int, inform: c_int, mask: c_ulong) c_int;
pub extern fn ASN1_mbstring_ncopy(out: [*c][*c]ASN1_STRING, in: [*c]const u8, len: c_int, inform: c_int, mask: c_ulong, minsize: c_long, maxsize: c_long) c_int;
pub extern fn ASN1_STRING_set_by_NID(out: [*c][*c]ASN1_STRING, in: [*c]const u8, len: c_int, inform: c_int, nid: c_int) [*c]ASN1_STRING;
pub extern fn ASN1_STRING_TABLE_add(nid: c_int, minsize: c_long, maxsize: c_long, mask: c_ulong, flags: c_ulong) c_int;
pub extern fn DIRECTORYSTRING_new() [*c]ASN1_STRING;
pub extern fn DIRECTORYSTRING_free(str: [*c]ASN1_STRING) void;
pub extern fn d2i_DIRECTORYSTRING(out: [*c][*c]ASN1_STRING, inp: [*c][*c]const u8, len: c_long) [*c]ASN1_STRING;
pub extern fn i2d_DIRECTORYSTRING(in: [*c]const ASN1_STRING, outp: [*c][*c]u8) c_int;
pub extern const DIRECTORYSTRING_it: ASN1_ITEM;
pub extern fn DISPLAYTEXT_new() [*c]ASN1_STRING;
pub extern fn DISPLAYTEXT_free(str: [*c]ASN1_STRING) void;
pub extern fn d2i_DISPLAYTEXT(out: [*c][*c]ASN1_STRING, inp: [*c][*c]const u8, len: c_long) [*c]ASN1_STRING;
pub extern fn i2d_DISPLAYTEXT(in: [*c]const ASN1_STRING, outp: [*c][*c]u8) c_int;
pub extern const DISPLAYTEXT_it: ASN1_ITEM;
pub extern fn ASN1_BIT_STRING_new() [*c]ASN1_BIT_STRING;
pub extern fn ASN1_BIT_STRING_free(str: [*c]ASN1_BIT_STRING) void;
pub extern fn d2i_ASN1_BIT_STRING(out: [*c][*c]ASN1_BIT_STRING, inp: [*c][*c]const u8, len: c_long) [*c]ASN1_BIT_STRING;
pub extern fn i2d_ASN1_BIT_STRING(in: [*c]const ASN1_BIT_STRING, outp: [*c][*c]u8) c_int;
pub extern fn c2i_ASN1_BIT_STRING(out: [*c][*c]ASN1_BIT_STRING, inp: [*c][*c]const u8, len: c_long) [*c]ASN1_BIT_STRING;
pub extern fn i2c_ASN1_BIT_STRING(in: [*c]const ASN1_BIT_STRING, outp: [*c][*c]u8) c_int;
pub extern const ASN1_BIT_STRING_it: ASN1_ITEM;
pub extern fn ASN1_BIT_STRING_num_bytes(str: [*c]const ASN1_BIT_STRING, out: [*c]usize) c_int;
// pub extern fn ASN1_BIT_STRING_set(str: [*c]ASN1_BIT_STRING, d: [*c]const u8, length: ossl_ssize_t) c_int;
pub extern fn ASN1_BIT_STRING_set_bit(str: [*c]ASN1_BIT_STRING, n: c_int, value: c_int) c_int;
pub extern fn ASN1_BIT_STRING_get_bit(str: [*c]const ASN1_BIT_STRING, n: c_int) c_int;
pub extern fn ASN1_BIT_STRING_check(str: [*c]const ASN1_BIT_STRING, flags: [*c]const u8, flags_len: c_int) c_int;
pub const struct_stack_st_ASN1_INTEGER = opaque {};
pub const sk_ASN1_INTEGER_free_func = ?*const fn ([*c]ASN1_INTEGER) callconv(.C) void;
pub const sk_ASN1_INTEGER_copy_func = ?*const fn ([*c]ASN1_INTEGER) callconv(.C) [*c]ASN1_INTEGER;
pub const sk_ASN1_INTEGER_cmp_func = ?*const fn ([*c][*c]const ASN1_INTEGER, [*c][*c]const ASN1_INTEGER) callconv(.C) c_int;
pub fn sk_ASN1_INTEGER_call_free_func(arg_free_func: OPENSSL_sk_free_func, arg_ptr: ?*anyopaque) callconv(.C) void {
    const free_func = arg_free_func;
    const ptr = arg_ptr;
    @as(sk_ASN1_INTEGER_free_func, @ptrCast(@alignCast(free_func))).?(@as([*c]ASN1_INTEGER, @ptrCast(@alignCast(ptr))));
}
pub fn sk_ASN1_INTEGER_call_copy_func(arg_copy_func: OPENSSL_sk_copy_func, arg_ptr: ?*anyopaque) callconv(.C) ?*anyopaque {
    const copy_func = arg_copy_func;
    const ptr = arg_ptr;
    return @as(?*anyopaque, @ptrCast(@as(sk_ASN1_INTEGER_copy_func, @ptrCast(@alignCast(copy_func))).?(@as([*c]ASN1_INTEGER, @ptrCast(@alignCast(ptr))))));
}
pub fn sk_ASN1_INTEGER_call_cmp_func(arg_cmp_func: OPENSSL_sk_cmp_func, arg_a: [*c]const ?*const anyopaque, arg_b: [*c]const ?*const anyopaque) callconv(.C) c_int {
    const cmp_func = arg_cmp_func;
    const a = arg_a;
    const b = arg_b;
    var a_ptr: [*c]const ASN1_INTEGER = @as([*c]const ASN1_INTEGER, @ptrCast(@alignCast(a.*)));
    var b_ptr: [*c]const ASN1_INTEGER = @as([*c]const ASN1_INTEGER, @ptrCast(@alignCast(b.*)));
    return @as(sk_ASN1_INTEGER_cmp_func, @ptrCast(@alignCast(cmp_func))).?(&a_ptr, &b_ptr);
}
pub fn sk_ASN1_INTEGER_new(arg_comp: sk_ASN1_INTEGER_cmp_func) callconv(.C) ?*struct_stack_st_ASN1_INTEGER {
    const comp = arg_comp;
    return @as(?*struct_stack_st_ASN1_INTEGER, @ptrCast(sk_new(@as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp))))));
}
pub fn sk_ASN1_INTEGER_new_null() callconv(.C) ?*struct_stack_st_ASN1_INTEGER {
    return @as(?*struct_stack_st_ASN1_INTEGER, @ptrCast(sk_new_null()));
}
pub fn sk_ASN1_INTEGER_num(arg_sk: ?*const struct_stack_st_ASN1_INTEGER) callconv(.C) usize {
    const sk = arg_sk;
    return sk_num(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_ASN1_INTEGER_zero(arg_sk: ?*struct_stack_st_ASN1_INTEGER) callconv(.C) void {
    const sk = arg_sk;
    sk_zero(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_ASN1_INTEGER_value(arg_sk: ?*const struct_stack_st_ASN1_INTEGER, arg_i: usize) callconv(.C) [*c]ASN1_INTEGER {
    const sk = arg_sk;
    const i = arg_i;
    return @as([*c]ASN1_INTEGER, @ptrCast(@alignCast(sk_value(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), i))));
}
pub fn sk_ASN1_INTEGER_set(arg_sk: ?*struct_stack_st_ASN1_INTEGER, arg_i: usize, arg_p: [*c]ASN1_INTEGER) callconv(.C) [*c]ASN1_INTEGER {
    const sk = arg_sk;
    const i = arg_i;
    const p = arg_p;
    return @as([*c]ASN1_INTEGER, @ptrCast(@alignCast(sk_set(@as([*c]_STACK, @ptrCast(@alignCast(sk))), i, @as(?*anyopaque, @ptrCast(p))))));
}
pub fn sk_ASN1_INTEGER_free(arg_sk: ?*struct_stack_st_ASN1_INTEGER) callconv(.C) void {
    const sk = arg_sk;
    sk_free(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_ASN1_INTEGER_pop_free(arg_sk: ?*struct_stack_st_ASN1_INTEGER, arg_free_func: sk_ASN1_INTEGER_free_func) callconv(.C) void {
    const sk = arg_sk;
    const free_func = arg_free_func;
    sk_pop_free_ex(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_ASN1_INTEGER_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))));
}
pub fn sk_ASN1_INTEGER_insert(arg_sk: ?*struct_stack_st_ASN1_INTEGER, arg_p: [*c]ASN1_INTEGER, arg_where: usize) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    const where = arg_where;
    return sk_insert(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)), where);
}
pub fn sk_ASN1_INTEGER_delete(arg_sk: ?*struct_stack_st_ASN1_INTEGER, arg_where: usize) callconv(.C) [*c]ASN1_INTEGER {
    const sk = arg_sk;
    const where = arg_where;
    return @as([*c]ASN1_INTEGER, @ptrCast(@alignCast(sk_delete(@as([*c]_STACK, @ptrCast(@alignCast(sk))), where))));
}
pub fn sk_ASN1_INTEGER_delete_ptr(arg_sk: ?*struct_stack_st_ASN1_INTEGER, arg_p: [*c]const ASN1_INTEGER) callconv(.C) [*c]ASN1_INTEGER {
    const sk = arg_sk;
    const p = arg_p;
    return @as([*c]ASN1_INTEGER, @ptrCast(@alignCast(sk_delete_ptr(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*const anyopaque, @ptrCast(p))))));
}
pub fn sk_ASN1_INTEGER_find(arg_sk: ?*const struct_stack_st_ASN1_INTEGER, arg_out_index: [*c]usize, arg_p: [*c]const ASN1_INTEGER) callconv(.C) c_int {
    const sk = arg_sk;
    const out_index = arg_out_index;
    const p = arg_p;
    return sk_find(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), out_index, @as(?*const anyopaque, @ptrCast(p)), &sk_ASN1_INTEGER_call_cmp_func);
}
pub fn sk_ASN1_INTEGER_shift(arg_sk: ?*struct_stack_st_ASN1_INTEGER) callconv(.C) [*c]ASN1_INTEGER {
    const sk = arg_sk;
    return @as([*c]ASN1_INTEGER, @ptrCast(@alignCast(sk_shift(@as([*c]_STACK, @ptrCast(@alignCast(sk)))))));
}
pub fn sk_ASN1_INTEGER_push(arg_sk: ?*struct_stack_st_ASN1_INTEGER, arg_p: [*c]ASN1_INTEGER) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    return sk_push(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)));
}
pub fn sk_ASN1_INTEGER_pop(arg_sk: ?*struct_stack_st_ASN1_INTEGER) callconv(.C) [*c]ASN1_INTEGER {
    const sk = arg_sk;
    return @as([*c]ASN1_INTEGER, @ptrCast(@alignCast(sk_pop(@as([*c]_STACK, @ptrCast(@alignCast(sk)))))));
}
pub fn sk_ASN1_INTEGER_dup(arg_sk: ?*const struct_stack_st_ASN1_INTEGER) callconv(.C) ?*struct_stack_st_ASN1_INTEGER {
    const sk = arg_sk;
    return @as(?*struct_stack_st_ASN1_INTEGER, @ptrCast(sk_dup(@as([*c]const _STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_ASN1_INTEGER_sort(arg_sk: ?*struct_stack_st_ASN1_INTEGER) callconv(.C) void {
    const sk = arg_sk;
    sk_sort(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_ASN1_INTEGER_call_cmp_func);
}
pub fn sk_ASN1_INTEGER_is_sorted(arg_sk: ?*const struct_stack_st_ASN1_INTEGER) callconv(.C) c_int {
    const sk = arg_sk;
    return sk_is_sorted(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_ASN1_INTEGER_set_cmp_func(arg_sk: ?*struct_stack_st_ASN1_INTEGER, arg_comp: sk_ASN1_INTEGER_cmp_func) callconv(.C) sk_ASN1_INTEGER_cmp_func {
    const sk = arg_sk;
    const comp = arg_comp;
    return @as(sk_ASN1_INTEGER_cmp_func, @ptrCast(@alignCast(sk_set_cmp_func(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp)))))));
}
pub fn sk_ASN1_INTEGER_deep_copy(arg_sk: ?*const struct_stack_st_ASN1_INTEGER, arg_copy_func: sk_ASN1_INTEGER_copy_func, arg_free_func: sk_ASN1_INTEGER_free_func) callconv(.C) ?*struct_stack_st_ASN1_INTEGER {
    const sk = arg_sk;
    const copy_func = arg_copy_func;
    const free_func = arg_free_func;
    return @as(?*struct_stack_st_ASN1_INTEGER, @ptrCast(sk_deep_copy(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), &sk_ASN1_INTEGER_call_copy_func, @as(OPENSSL_sk_copy_func, @ptrCast(@alignCast(copy_func))), &sk_ASN1_INTEGER_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))))));
}
pub extern fn ASN1_INTEGER_new() [*c]ASN1_INTEGER;
pub extern fn ASN1_INTEGER_free(str: [*c]ASN1_INTEGER) void;
pub extern fn ASN1_INTEGER_dup(x: [*c]const ASN1_INTEGER) [*c]ASN1_INTEGER;
pub extern fn d2i_ASN1_INTEGER(out: [*c][*c]ASN1_INTEGER, inp: [*c][*c]const u8, len: c_long) [*c]ASN1_INTEGER;
pub extern fn i2d_ASN1_INTEGER(in: [*c]const ASN1_INTEGER, outp: [*c][*c]u8) c_int;
pub extern fn c2i_ASN1_INTEGER(in: [*c][*c]ASN1_INTEGER, outp: [*c][*c]const u8, len: c_long) [*c]ASN1_INTEGER;
pub extern fn i2c_ASN1_INTEGER(in: [*c]const ASN1_INTEGER, outp: [*c][*c]u8) c_int;
pub extern const ASN1_INTEGER_it: ASN1_ITEM;
pub extern fn ASN1_INTEGER_set_uint64(out: [*c]ASN1_INTEGER, v: u64) c_int;
pub extern fn ASN1_INTEGER_set_int64(out: [*c]ASN1_INTEGER, v: i64) c_int;
pub extern fn ASN1_INTEGER_get_uint64(out: [*c]u64, a: [*c]const ASN1_INTEGER) c_int;
pub extern fn ASN1_INTEGER_get_int64(out: [*c]i64, a: [*c]const ASN1_INTEGER) c_int;
pub extern fn BN_to_ASN1_INTEGER(bn: [*c]const BIGNUM, ai: [*c]ASN1_INTEGER) [*c]ASN1_INTEGER;
pub extern fn ASN1_INTEGER_to_BN(ai: [*c]const ASN1_INTEGER, bn: [*c]BIGNUM) [*c]BIGNUM;
pub extern fn ASN1_INTEGER_cmp(x: [*c]const ASN1_INTEGER, y: [*c]const ASN1_INTEGER) c_int;
pub extern fn ASN1_ENUMERATED_new() [*c]ASN1_ENUMERATED;
pub extern fn ASN1_ENUMERATED_free(str: [*c]ASN1_ENUMERATED) void;
pub extern fn d2i_ASN1_ENUMERATED(out: [*c][*c]ASN1_ENUMERATED, inp: [*c][*c]const u8, len: c_long) [*c]ASN1_ENUMERATED;
pub extern fn i2d_ASN1_ENUMERATED(in: [*c]const ASN1_ENUMERATED, outp: [*c][*c]u8) c_int;
pub extern const ASN1_ENUMERATED_it: ASN1_ITEM;
pub extern fn ASN1_ENUMERATED_set_uint64(out: [*c]ASN1_ENUMERATED, v: u64) c_int;
pub extern fn ASN1_ENUMERATED_set_int64(out: [*c]ASN1_ENUMERATED, v: i64) c_int;
pub extern fn ASN1_ENUMERATED_get_uint64(out: [*c]u64, a: [*c]const ASN1_ENUMERATED) c_int;
pub extern fn ASN1_ENUMERATED_get_int64(out: [*c]i64, a: [*c]const ASN1_ENUMERATED) c_int;
pub extern fn BN_to_ASN1_ENUMERATED(bn: [*c]const BIGNUM, ai: [*c]ASN1_ENUMERATED) [*c]ASN1_ENUMERATED;
pub extern fn ASN1_ENUMERATED_to_BN(ai: [*c]const ASN1_ENUMERATED, bn: [*c]BIGNUM) [*c]BIGNUM;
pub extern fn ASN1_UTCTIME_new() [*c]ASN1_UTCTIME;
pub extern fn ASN1_UTCTIME_free(str: [*c]ASN1_UTCTIME) void;
pub extern fn d2i_ASN1_UTCTIME(out: [*c][*c]ASN1_UTCTIME, inp: [*c][*c]const u8, len: c_long) [*c]ASN1_UTCTIME;
pub extern fn i2d_ASN1_UTCTIME(in: [*c]const ASN1_UTCTIME, outp: [*c][*c]u8) c_int;
pub extern const ASN1_UTCTIME_it: ASN1_ITEM;
pub extern fn ASN1_UTCTIME_check(a: [*c]const ASN1_UTCTIME) c_int;
pub extern fn ASN1_UTCTIME_set(s: [*c]ASN1_UTCTIME, t: time_t) [*c]ASN1_UTCTIME;
pub extern fn ASN1_UTCTIME_adj(s: [*c]ASN1_UTCTIME, t: time_t, offset_day: c_int, offset_sec: c_long) [*c]ASN1_UTCTIME;
pub extern fn ASN1_UTCTIME_set_string(s: [*c]ASN1_UTCTIME, str: [*c]const u8) c_int;
pub extern fn ASN1_UTCTIME_cmp_time_t(s: [*c]const ASN1_UTCTIME, t: time_t) c_int;
pub extern fn ASN1_GENERALIZEDTIME_new() [*c]ASN1_GENERALIZEDTIME;
pub extern fn ASN1_GENERALIZEDTIME_free(str: [*c]ASN1_GENERALIZEDTIME) void;
pub extern fn d2i_ASN1_GENERALIZEDTIME(out: [*c][*c]ASN1_GENERALIZEDTIME, inp: [*c][*c]const u8, len: c_long) [*c]ASN1_GENERALIZEDTIME;
pub extern fn i2d_ASN1_GENERALIZEDTIME(in: [*c]const ASN1_GENERALIZEDTIME, outp: [*c][*c]u8) c_int;
pub extern const ASN1_GENERALIZEDTIME_it: ASN1_ITEM;
pub extern fn ASN1_GENERALIZEDTIME_check(a: [*c]const ASN1_GENERALIZEDTIME) c_int;
pub extern fn ASN1_GENERALIZEDTIME_set(s: [*c]ASN1_GENERALIZEDTIME, t: time_t) [*c]ASN1_GENERALIZEDTIME;
pub extern fn ASN1_GENERALIZEDTIME_adj(s: [*c]ASN1_GENERALIZEDTIME, t: time_t, offset_day: c_int, offset_sec: c_long) [*c]ASN1_GENERALIZEDTIME;
pub extern fn ASN1_GENERALIZEDTIME_set_string(s: [*c]ASN1_GENERALIZEDTIME, str: [*c]const u8) c_int;
pub extern fn ASN1_TIME_new() [*c]ASN1_TIME;
pub extern fn ASN1_TIME_free(str: [*c]ASN1_TIME) void;
pub extern fn d2i_ASN1_TIME(out: [*c][*c]ASN1_TIME, inp: [*c][*c]const u8, len: c_long) [*c]ASN1_TIME;
pub extern fn i2d_ASN1_TIME(in: [*c]const ASN1_TIME, outp: [*c][*c]u8) c_int;
pub extern const ASN1_TIME_it: ASN1_ITEM;
pub extern fn ASN1_TIME_diff(out_days: [*c]c_int, out_seconds: [*c]c_int, from: [*c]const ASN1_TIME, to: [*c]const ASN1_TIME) c_int;
pub extern fn ASN1_TIME_set(s: [*c]ASN1_TIME, t: time_t) [*c]ASN1_TIME;
pub extern fn ASN1_TIME_adj(s: [*c]ASN1_TIME, t: time_t, offset_day: c_int, offset_sec: c_long) [*c]ASN1_TIME;
pub extern fn ASN1_TIME_check(t: [*c]const ASN1_TIME) c_int;
pub extern fn ASN1_TIME_to_generalizedtime(t: [*c]const ASN1_TIME, out: [*c][*c]ASN1_GENERALIZEDTIME) [*c]ASN1_GENERALIZEDTIME;
pub extern fn ASN1_TIME_set_string(s: [*c]ASN1_TIME, str: [*c]const u8) c_int;
pub extern fn ASN1_TIME_to_time_t(t: [*c]const ASN1_TIME, out: [*c]time_t) c_int;
pub extern fn ASN1_TIME_to_posix(t: [*c]const ASN1_TIME, out: [*c]i64) c_int;
pub extern fn ASN1_NULL_new() ?*ASN1_NULL;
pub extern fn ASN1_NULL_free(@"null": ?*ASN1_NULL) void;
pub extern fn d2i_ASN1_NULL(out: [*c]?*ASN1_NULL, inp: [*c][*c]const u8, len: c_long) ?*ASN1_NULL;
pub extern fn i2d_ASN1_NULL(in: ?*const ASN1_NULL, outp: [*c][*c]u8) c_int;
pub extern const ASN1_NULL_it: ASN1_ITEM;
pub const struct_stack_st_ASN1_OBJECT = opaque {};
pub const sk_ASN1_OBJECT_free_func = ?*const fn (?*ASN1_OBJECT) callconv(.C) void;
pub const sk_ASN1_OBJECT_copy_func = ?*const fn (?*ASN1_OBJECT) callconv(.C) ?*ASN1_OBJECT;
pub const sk_ASN1_OBJECT_cmp_func = ?*const fn ([*c]?*const ASN1_OBJECT, [*c]?*const ASN1_OBJECT) callconv(.C) c_int;
pub fn sk_ASN1_OBJECT_call_free_func(arg_free_func: OPENSSL_sk_free_func, arg_ptr: ?*anyopaque) callconv(.C) void {
    const free_func = arg_free_func;
    const ptr = arg_ptr;
    @as(sk_ASN1_OBJECT_free_func, @ptrCast(@alignCast(free_func))).?(@as(?*ASN1_OBJECT, @ptrCast(ptr)));
}
pub fn sk_ASN1_OBJECT_call_copy_func(arg_copy_func: OPENSSL_sk_copy_func, arg_ptr: ?*anyopaque) callconv(.C) ?*anyopaque {
    const copy_func = arg_copy_func;
    const ptr = arg_ptr;
    return @as(?*anyopaque, @ptrCast(@as(sk_ASN1_OBJECT_copy_func, @ptrCast(@alignCast(copy_func))).?(@as(?*ASN1_OBJECT, @ptrCast(ptr)))));
}
pub fn sk_ASN1_OBJECT_call_cmp_func(arg_cmp_func: OPENSSL_sk_cmp_func, arg_a: [*c]const ?*const anyopaque, arg_b: [*c]const ?*const anyopaque) callconv(.C) c_int {
    const cmp_func = arg_cmp_func;
    const a = arg_a;
    const b = arg_b;
    var a_ptr: ?*const ASN1_OBJECT = @as(?*const ASN1_OBJECT, @ptrCast(a.*));
    var b_ptr: ?*const ASN1_OBJECT = @as(?*const ASN1_OBJECT, @ptrCast(b.*));
    return @as(sk_ASN1_OBJECT_cmp_func, @ptrCast(@alignCast(cmp_func))).?(&a_ptr, &b_ptr);
}
pub fn sk_ASN1_OBJECT_new(arg_comp: sk_ASN1_OBJECT_cmp_func) callconv(.C) ?*struct_stack_st_ASN1_OBJECT {
    const comp = arg_comp;
    return @as(?*struct_stack_st_ASN1_OBJECT, @ptrCast(sk_new(@as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp))))));
}
pub fn sk_ASN1_OBJECT_new_null() callconv(.C) ?*struct_stack_st_ASN1_OBJECT {
    return @as(?*struct_stack_st_ASN1_OBJECT, @ptrCast(sk_new_null()));
}
pub fn sk_ASN1_OBJECT_num(arg_sk: ?*const struct_stack_st_ASN1_OBJECT) callconv(.C) usize {
    const sk = arg_sk;
    return sk_num(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_ASN1_OBJECT_zero(arg_sk: ?*struct_stack_st_ASN1_OBJECT) callconv(.C) void {
    const sk = arg_sk;
    sk_zero(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_ASN1_OBJECT_value(arg_sk: ?*const struct_stack_st_ASN1_OBJECT, arg_i: usize) callconv(.C) ?*ASN1_OBJECT {
    const sk = arg_sk;
    const i = arg_i;
    return @as(?*ASN1_OBJECT, @ptrCast(sk_value(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), i)));
}
pub fn sk_ASN1_OBJECT_set(arg_sk: ?*struct_stack_st_ASN1_OBJECT, arg_i: usize, arg_p: ?*ASN1_OBJECT) callconv(.C) ?*ASN1_OBJECT {
    const sk = arg_sk;
    const i = arg_i;
    const p = arg_p;
    return @as(?*ASN1_OBJECT, @ptrCast(sk_set(@as([*c]_STACK, @ptrCast(@alignCast(sk))), i, @as(?*anyopaque, @ptrCast(p)))));
}
pub fn sk_ASN1_OBJECT_free(arg_sk: ?*struct_stack_st_ASN1_OBJECT) callconv(.C) void {
    const sk = arg_sk;
    sk_free(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_ASN1_OBJECT_pop_free(arg_sk: ?*struct_stack_st_ASN1_OBJECT, arg_free_func: sk_ASN1_OBJECT_free_func) callconv(.C) void {
    const sk = arg_sk;
    const free_func = arg_free_func;
    sk_pop_free_ex(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_ASN1_OBJECT_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))));
}
pub fn sk_ASN1_OBJECT_insert(arg_sk: ?*struct_stack_st_ASN1_OBJECT, arg_p: ?*ASN1_OBJECT, arg_where: usize) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    const where = arg_where;
    return sk_insert(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)), where);
}
pub fn sk_ASN1_OBJECT_delete(arg_sk: ?*struct_stack_st_ASN1_OBJECT, arg_where: usize) callconv(.C) ?*ASN1_OBJECT {
    const sk = arg_sk;
    const where = arg_where;
    return @as(?*ASN1_OBJECT, @ptrCast(sk_delete(@as([*c]_STACK, @ptrCast(@alignCast(sk))), where)));
}
pub fn sk_ASN1_OBJECT_delete_ptr(arg_sk: ?*struct_stack_st_ASN1_OBJECT, arg_p: ?*const ASN1_OBJECT) callconv(.C) ?*ASN1_OBJECT {
    const sk = arg_sk;
    const p = arg_p;
    return @as(?*ASN1_OBJECT, @ptrCast(sk_delete_ptr(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*const anyopaque, @ptrCast(p)))));
}
pub fn sk_ASN1_OBJECT_find(arg_sk: ?*const struct_stack_st_ASN1_OBJECT, arg_out_index: [*c]usize, arg_p: ?*const ASN1_OBJECT) callconv(.C) c_int {
    const sk = arg_sk;
    const out_index = arg_out_index;
    const p = arg_p;
    return sk_find(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), out_index, @as(?*const anyopaque, @ptrCast(p)), &sk_ASN1_OBJECT_call_cmp_func);
}
pub fn sk_ASN1_OBJECT_shift(arg_sk: ?*struct_stack_st_ASN1_OBJECT) callconv(.C) ?*ASN1_OBJECT {
    const sk = arg_sk;
    return @as(?*ASN1_OBJECT, @ptrCast(sk_shift(@as([*c]_STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_ASN1_OBJECT_push(arg_sk: ?*struct_stack_st_ASN1_OBJECT, arg_p: ?*ASN1_OBJECT) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    return sk_push(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)));
}
pub fn sk_ASN1_OBJECT_pop(arg_sk: ?*struct_stack_st_ASN1_OBJECT) callconv(.C) ?*ASN1_OBJECT {
    const sk = arg_sk;
    return @as(?*ASN1_OBJECT, @ptrCast(sk_pop(@as([*c]_STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_ASN1_OBJECT_dup(arg_sk: ?*const struct_stack_st_ASN1_OBJECT) callconv(.C) ?*struct_stack_st_ASN1_OBJECT {
    const sk = arg_sk;
    return @as(?*struct_stack_st_ASN1_OBJECT, @ptrCast(sk_dup(@as([*c]const _STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_ASN1_OBJECT_sort(arg_sk: ?*struct_stack_st_ASN1_OBJECT) callconv(.C) void {
    const sk = arg_sk;
    sk_sort(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_ASN1_OBJECT_call_cmp_func);
}
pub fn sk_ASN1_OBJECT_is_sorted(arg_sk: ?*const struct_stack_st_ASN1_OBJECT) callconv(.C) c_int {
    const sk = arg_sk;
    return sk_is_sorted(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_ASN1_OBJECT_set_cmp_func(arg_sk: ?*struct_stack_st_ASN1_OBJECT, arg_comp: sk_ASN1_OBJECT_cmp_func) callconv(.C) sk_ASN1_OBJECT_cmp_func {
    const sk = arg_sk;
    const comp = arg_comp;
    return @as(sk_ASN1_OBJECT_cmp_func, @ptrCast(@alignCast(sk_set_cmp_func(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp)))))));
}
pub fn sk_ASN1_OBJECT_deep_copy(arg_sk: ?*const struct_stack_st_ASN1_OBJECT, arg_copy_func: sk_ASN1_OBJECT_copy_func, arg_free_func: sk_ASN1_OBJECT_free_func) callconv(.C) ?*struct_stack_st_ASN1_OBJECT {
    const sk = arg_sk;
    const copy_func = arg_copy_func;
    const free_func = arg_free_func;
    return @as(?*struct_stack_st_ASN1_OBJECT, @ptrCast(sk_deep_copy(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), &sk_ASN1_OBJECT_call_copy_func, @as(OPENSSL_sk_copy_func, @ptrCast(@alignCast(copy_func))), &sk_ASN1_OBJECT_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))))));
}
pub extern fn ASN1_OBJECT_create(nid: c_int, data: [*c]const u8, len: c_int, sn: [*c]const u8, ln: [*c]const u8) ?*ASN1_OBJECT;
pub extern fn ASN1_OBJECT_free(a: ?*ASN1_OBJECT) void;
pub extern fn d2i_ASN1_OBJECT(out: [*c]?*ASN1_OBJECT, inp: [*c][*c]const u8, len: c_long) ?*ASN1_OBJECT;
pub extern fn i2d_ASN1_OBJECT(a: ?*const ASN1_OBJECT, outp: [*c][*c]u8) c_int;
pub extern fn c2i_ASN1_OBJECT(out: [*c]?*ASN1_OBJECT, inp: [*c][*c]const u8, len: c_long) ?*ASN1_OBJECT;
pub extern const ASN1_OBJECT_it: ASN1_ITEM;
pub const struct_stack_st_ASN1_TYPE = opaque {};
pub const sk_ASN1_TYPE_free_func = ?*const fn ([*c]ASN1_TYPE) callconv(.C) void;
pub const sk_ASN1_TYPE_copy_func = ?*const fn ([*c]ASN1_TYPE) callconv(.C) [*c]ASN1_TYPE;
pub const sk_ASN1_TYPE_cmp_func = ?*const fn ([*c][*c]const ASN1_TYPE, [*c][*c]const ASN1_TYPE) callconv(.C) c_int;
pub fn sk_ASN1_TYPE_call_free_func(arg_free_func: OPENSSL_sk_free_func, arg_ptr: ?*anyopaque) callconv(.C) void {
    const free_func = arg_free_func;
    const ptr = arg_ptr;
    @as(sk_ASN1_TYPE_free_func, @ptrCast(@alignCast(free_func))).?(@as([*c]ASN1_TYPE, @ptrCast(@alignCast(ptr))));
}
pub fn sk_ASN1_TYPE_call_copy_func(arg_copy_func: OPENSSL_sk_copy_func, arg_ptr: ?*anyopaque) callconv(.C) ?*anyopaque {
    const copy_func = arg_copy_func;
    const ptr = arg_ptr;
    return @as(?*anyopaque, @ptrCast(@as(sk_ASN1_TYPE_copy_func, @ptrCast(@alignCast(copy_func))).?(@as([*c]ASN1_TYPE, @ptrCast(@alignCast(ptr))))));
}
pub fn sk_ASN1_TYPE_call_cmp_func(arg_cmp_func: OPENSSL_sk_cmp_func, arg_a: [*c]const ?*const anyopaque, arg_b: [*c]const ?*const anyopaque) callconv(.C) c_int {
    const cmp_func = arg_cmp_func;
    const a = arg_a;
    const b = arg_b;
    var a_ptr: [*c]const ASN1_TYPE = @as([*c]const ASN1_TYPE, @ptrCast(@alignCast(a.*)));
    var b_ptr: [*c]const ASN1_TYPE = @as([*c]const ASN1_TYPE, @ptrCast(@alignCast(b.*)));
    return @as(sk_ASN1_TYPE_cmp_func, @ptrCast(@alignCast(cmp_func))).?(&a_ptr, &b_ptr);
}
pub fn sk_ASN1_TYPE_new(arg_comp: sk_ASN1_TYPE_cmp_func) callconv(.C) ?*struct_stack_st_ASN1_TYPE {
    const comp = arg_comp;
    return @as(?*struct_stack_st_ASN1_TYPE, @ptrCast(sk_new(@as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp))))));
}
pub fn sk_ASN1_TYPE_new_null() callconv(.C) ?*struct_stack_st_ASN1_TYPE {
    return @as(?*struct_stack_st_ASN1_TYPE, @ptrCast(sk_new_null()));
}
pub fn sk_ASN1_TYPE_num(arg_sk: ?*const struct_stack_st_ASN1_TYPE) callconv(.C) usize {
    const sk = arg_sk;
    return sk_num(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_ASN1_TYPE_zero(arg_sk: ?*struct_stack_st_ASN1_TYPE) callconv(.C) void {
    const sk = arg_sk;
    sk_zero(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_ASN1_TYPE_value(arg_sk: ?*const struct_stack_st_ASN1_TYPE, arg_i: usize) callconv(.C) [*c]ASN1_TYPE {
    const sk = arg_sk;
    const i = arg_i;
    return @as([*c]ASN1_TYPE, @ptrCast(@alignCast(sk_value(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), i))));
}
pub fn sk_ASN1_TYPE_set(arg_sk: ?*struct_stack_st_ASN1_TYPE, arg_i: usize, arg_p: [*c]ASN1_TYPE) callconv(.C) [*c]ASN1_TYPE {
    const sk = arg_sk;
    const i = arg_i;
    const p = arg_p;
    return @as([*c]ASN1_TYPE, @ptrCast(@alignCast(sk_set(@as([*c]_STACK, @ptrCast(@alignCast(sk))), i, @as(?*anyopaque, @ptrCast(p))))));
}
pub fn sk_ASN1_TYPE_free(arg_sk: ?*struct_stack_st_ASN1_TYPE) callconv(.C) void {
    const sk = arg_sk;
    sk_free(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_ASN1_TYPE_pop_free(arg_sk: ?*struct_stack_st_ASN1_TYPE, arg_free_func: sk_ASN1_TYPE_free_func) callconv(.C) void {
    const sk = arg_sk;
    const free_func = arg_free_func;
    sk_pop_free_ex(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_ASN1_TYPE_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))));
}
pub fn sk_ASN1_TYPE_insert(arg_sk: ?*struct_stack_st_ASN1_TYPE, arg_p: [*c]ASN1_TYPE, arg_where: usize) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    const where = arg_where;
    return sk_insert(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)), where);
}
pub fn sk_ASN1_TYPE_delete(arg_sk: ?*struct_stack_st_ASN1_TYPE, arg_where: usize) callconv(.C) [*c]ASN1_TYPE {
    const sk = arg_sk;
    const where = arg_where;
    return @as([*c]ASN1_TYPE, @ptrCast(@alignCast(sk_delete(@as([*c]_STACK, @ptrCast(@alignCast(sk))), where))));
}
pub fn sk_ASN1_TYPE_delete_ptr(arg_sk: ?*struct_stack_st_ASN1_TYPE, arg_p: [*c]const ASN1_TYPE) callconv(.C) [*c]ASN1_TYPE {
    const sk = arg_sk;
    const p = arg_p;
    return @as([*c]ASN1_TYPE, @ptrCast(@alignCast(sk_delete_ptr(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*const anyopaque, @ptrCast(p))))));
}
pub fn sk_ASN1_TYPE_find(arg_sk: ?*const struct_stack_st_ASN1_TYPE, arg_out_index: [*c]usize, arg_p: [*c]const ASN1_TYPE) callconv(.C) c_int {
    const sk = arg_sk;
    const out_index = arg_out_index;
    const p = arg_p;
    return sk_find(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), out_index, @as(?*const anyopaque, @ptrCast(p)), &sk_ASN1_TYPE_call_cmp_func);
}
pub fn sk_ASN1_TYPE_shift(arg_sk: ?*struct_stack_st_ASN1_TYPE) callconv(.C) [*c]ASN1_TYPE {
    const sk = arg_sk;
    return @as([*c]ASN1_TYPE, @ptrCast(@alignCast(sk_shift(@as([*c]_STACK, @ptrCast(@alignCast(sk)))))));
}
pub fn sk_ASN1_TYPE_push(arg_sk: ?*struct_stack_st_ASN1_TYPE, arg_p: [*c]ASN1_TYPE) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    return sk_push(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)));
}
pub fn sk_ASN1_TYPE_pop(arg_sk: ?*struct_stack_st_ASN1_TYPE) callconv(.C) [*c]ASN1_TYPE {
    const sk = arg_sk;
    return @as([*c]ASN1_TYPE, @ptrCast(@alignCast(sk_pop(@as([*c]_STACK, @ptrCast(@alignCast(sk)))))));
}
pub fn sk_ASN1_TYPE_dup(arg_sk: ?*const struct_stack_st_ASN1_TYPE) callconv(.C) ?*struct_stack_st_ASN1_TYPE {
    const sk = arg_sk;
    return @as(?*struct_stack_st_ASN1_TYPE, @ptrCast(sk_dup(@as([*c]const _STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_ASN1_TYPE_sort(arg_sk: ?*struct_stack_st_ASN1_TYPE) callconv(.C) void {
    const sk = arg_sk;
    sk_sort(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_ASN1_TYPE_call_cmp_func);
}
pub fn sk_ASN1_TYPE_is_sorted(arg_sk: ?*const struct_stack_st_ASN1_TYPE) callconv(.C) c_int {
    const sk = arg_sk;
    return sk_is_sorted(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_ASN1_TYPE_set_cmp_func(arg_sk: ?*struct_stack_st_ASN1_TYPE, arg_comp: sk_ASN1_TYPE_cmp_func) callconv(.C) sk_ASN1_TYPE_cmp_func {
    const sk = arg_sk;
    const comp = arg_comp;
    return @as(sk_ASN1_TYPE_cmp_func, @ptrCast(@alignCast(sk_set_cmp_func(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp)))))));
}
pub fn sk_ASN1_TYPE_deep_copy(arg_sk: ?*const struct_stack_st_ASN1_TYPE, arg_copy_func: sk_ASN1_TYPE_copy_func, arg_free_func: sk_ASN1_TYPE_free_func) callconv(.C) ?*struct_stack_st_ASN1_TYPE {
    const sk = arg_sk;
    const copy_func = arg_copy_func;
    const free_func = arg_free_func;
    return @as(?*struct_stack_st_ASN1_TYPE, @ptrCast(sk_deep_copy(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), &sk_ASN1_TYPE_call_copy_func, @as(OPENSSL_sk_copy_func, @ptrCast(@alignCast(copy_func))), &sk_ASN1_TYPE_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))))));
}
pub extern fn ASN1_TYPE_new() [*c]ASN1_TYPE;
pub extern fn ASN1_TYPE_free(a: [*c]ASN1_TYPE) void;
pub extern fn d2i_ASN1_TYPE(out: [*c][*c]ASN1_TYPE, inp: [*c][*c]const u8, len: c_long) [*c]ASN1_TYPE;
pub extern fn i2d_ASN1_TYPE(in: [*c]const ASN1_TYPE, outp: [*c][*c]u8) c_int;
pub extern const ASN1_ANY_it: ASN1_ITEM;
pub extern fn ASN1_TYPE_get(a: [*c]const ASN1_TYPE) c_int;
pub extern fn ASN1_TYPE_set(a: [*c]ASN1_TYPE, @"type": c_int, value: ?*anyopaque) void;
pub extern fn ASN1_TYPE_set1(a: [*c]ASN1_TYPE, @"type": c_int, value: ?*const anyopaque) c_int;
pub extern fn ASN1_TYPE_cmp(a: [*c]const ASN1_TYPE, b: [*c]const ASN1_TYPE) c_int;
pub const ASN1_SEQUENCE_ANY = struct_stack_st_ASN1_TYPE;
pub extern fn d2i_ASN1_SEQUENCE_ANY(out: [*c]?*ASN1_SEQUENCE_ANY, inp: [*c][*c]const u8, len: c_long) ?*ASN1_SEQUENCE_ANY;
pub extern fn i2d_ASN1_SEQUENCE_ANY(in: ?*const ASN1_SEQUENCE_ANY, outp: [*c][*c]u8) c_int;
pub extern fn d2i_ASN1_SET_ANY(out: [*c]?*ASN1_SEQUENCE_ANY, inp: [*c][*c]const u8, len: c_long) ?*ASN1_SEQUENCE_ANY;
pub extern fn i2d_ASN1_SET_ANY(in: ?*const ASN1_SEQUENCE_ANY, outp: [*c][*c]u8) c_int;
pub extern fn ASN1_UTCTIME_print(out: [*c]BIO, a: [*c]const ASN1_UTCTIME) c_int;
pub extern fn ASN1_GENERALIZEDTIME_print(out: [*c]BIO, a: [*c]const ASN1_GENERALIZEDTIME) c_int;
pub extern fn ASN1_TIME_print(out: [*c]BIO, a: [*c]const ASN1_TIME) c_int;
pub extern fn ASN1_STRING_print(out: [*c]BIO, str: [*c]const ASN1_STRING) c_int;
pub extern fn ASN1_STRING_print_ex(out: [*c]BIO, str: [*c]const ASN1_STRING, flags: c_ulong) c_int;
// pub extern fn ASN1_STRING_print_ex_fp(fp: [*c]FILE, str: [*c]const ASN1_STRING, flags: c_ulong) c_int;
pub extern fn i2a_ASN1_INTEGER(bp: [*c]BIO, a: [*c]const ASN1_INTEGER) c_int;
pub extern fn i2a_ASN1_ENUMERATED(bp: [*c]BIO, a: [*c]const ASN1_ENUMERATED) c_int;
pub extern fn i2a_ASN1_OBJECT(bp: [*c]BIO, a: ?*const ASN1_OBJECT) c_int;
pub extern fn i2a_ASN1_STRING(bp: [*c]BIO, a: [*c]const ASN1_STRING, @"type": c_int) c_int;
pub extern fn i2t_ASN1_OBJECT(buf: [*c]u8, buf_len: c_int, a: ?*const ASN1_OBJECT) c_int;
pub extern fn ASN1_get_object(inp: [*c][*c]const u8, out_length: [*c]c_long, out_tag: [*c]c_int, out_class: [*c]c_int, max_len: c_long) c_int;
pub extern fn ASN1_put_object(outp: [*c][*c]u8, constructed: c_int, length: c_int, tag: c_int, xclass: c_int) void;
pub extern fn ASN1_put_eoc(outp: [*c][*c]u8) c_int;
pub extern fn ASN1_object_size(constructed: c_int, length: c_int, tag: c_int) c_int;
pub extern fn ASN1_STRING_set_default_mask(mask: c_ulong) void;
pub extern fn ASN1_STRING_set_default_mask_asc(p: [*c]const u8) c_int;
pub extern fn ASN1_STRING_get_default_mask() c_ulong;
pub extern fn ASN1_STRING_TABLE_cleanup() void;
pub extern fn ASN1_PRINTABLE_new() [*c]ASN1_STRING;
pub extern fn ASN1_PRINTABLE_free(str: [*c]ASN1_STRING) void;
pub extern fn d2i_ASN1_PRINTABLE(out: [*c][*c]ASN1_STRING, inp: [*c][*c]const u8, len: c_long) [*c]ASN1_STRING;
pub extern fn i2d_ASN1_PRINTABLE(in: [*c]const ASN1_STRING, outp: [*c][*c]u8) c_int;
pub extern const ASN1_PRINTABLE_it: ASN1_ITEM;
pub extern fn ASN1_INTEGER_set(a: [*c]ASN1_INTEGER, v: c_long) c_int;
pub extern fn ASN1_ENUMERATED_set(a: [*c]ASN1_ENUMERATED, v: c_long) c_int;
pub extern fn ASN1_INTEGER_get(a: [*c]const ASN1_INTEGER) c_long;
pub extern fn ASN1_ENUMERATED_get(a: [*c]const ASN1_ENUMERATED) c_long;
pub extern fn DH_new() ?*DH;
pub extern fn DH_free(dh: ?*DH) void;
pub extern fn DH_up_ref(dh: ?*DH) c_int;
pub extern fn DH_bits(dh: ?*const DH) c_uint;
pub extern fn DH_get0_pub_key(dh: ?*const DH) [*c]const BIGNUM;
pub extern fn DH_get0_priv_key(dh: ?*const DH) [*c]const BIGNUM;
pub extern fn DH_get0_p(dh: ?*const DH) [*c]const BIGNUM;
pub extern fn DH_get0_q(dh: ?*const DH) [*c]const BIGNUM;
pub extern fn DH_get0_g(dh: ?*const DH) [*c]const BIGNUM;
pub extern fn DH_get0_key(dh: ?*const DH, out_pub_key: [*c][*c]const BIGNUM, out_priv_key: [*c][*c]const BIGNUM) void;
pub extern fn DH_set0_key(dh: ?*DH, pub_key: [*c]BIGNUM, priv_key: [*c]BIGNUM) c_int;
pub extern fn DH_get0_pqg(dh: ?*const DH, out_p: [*c][*c]const BIGNUM, out_q: [*c][*c]const BIGNUM, out_g: [*c][*c]const BIGNUM) void;
pub extern fn DH_set0_pqg(dh: ?*DH, p: [*c]BIGNUM, q: [*c]BIGNUM, g: [*c]BIGNUM) c_int;
pub extern fn DH_set_length(dh: ?*DH, priv_length: c_uint) c_int;
pub extern fn DH_get_rfc7919_2048() ?*DH;
pub extern fn BN_get_rfc3526_prime_1536(ret: [*c]BIGNUM) [*c]BIGNUM;
pub extern fn BN_get_rfc3526_prime_2048(ret: [*c]BIGNUM) [*c]BIGNUM;
pub extern fn BN_get_rfc3526_prime_3072(ret: [*c]BIGNUM) [*c]BIGNUM;
pub extern fn BN_get_rfc3526_prime_4096(ret: [*c]BIGNUM) [*c]BIGNUM;
pub extern fn BN_get_rfc3526_prime_6144(ret: [*c]BIGNUM) [*c]BIGNUM;
pub extern fn BN_get_rfc3526_prime_8192(ret: [*c]BIGNUM) [*c]BIGNUM;
pub extern fn DH_generate_parameters_ex(dh: ?*DH, prime_bits: c_int, generator: c_int, cb: [*c]BN_GENCB) c_int;
pub extern fn DH_generate_key(dh: ?*DH) c_int;
pub extern fn DH_compute_key_padded(out: [*c]u8, peers_key: [*c]const BIGNUM, dh: ?*DH) c_int;
pub extern fn DH_compute_key_hashed(dh: ?*DH, out: [*c]u8, out_len: [*c]usize, max_out_len: usize, peers_key: [*c]const BIGNUM, digest: ?*const EVP_MD) c_int;
pub extern fn DH_size(dh: ?*const DH) c_int;
pub extern fn DH_num_bits(dh: ?*const DH) c_uint;
pub extern fn DH_check(dh: ?*const DH, out_flags: [*c]c_int) c_int;
pub extern fn DH_check_pub_key(dh: ?*const DH, pub_key: [*c]const BIGNUM, out_flags: [*c]c_int) c_int;
pub extern fn DHparams_dup(dh: ?*const DH) ?*DH;
pub extern fn DH_parse_parameters(cbs: [*c]CBS) ?*DH;
pub extern fn DH_marshal_parameters(cbb: ?*CBB, dh: ?*const DH) c_int;
pub extern fn DH_generate_parameters(prime_len: c_int, generator: c_int, callback: ?*const fn (c_int, c_int, ?*anyopaque) callconv(.C) void, cb_arg: ?*anyopaque) ?*DH;
pub extern fn d2i_DHparams(ret: [*c]?*DH, inp: [*c][*c]const u8, len: c_long) ?*DH;
pub extern fn i2d_DHparams(in: ?*const DH, outp: [*c][*c]u8) c_int;
pub extern fn DH_compute_key(out: [*c]u8, peers_key: [*c]const BIGNUM, dh: ?*DH) c_int;
pub extern fn ENGINE_new() ?*ENGINE;
pub extern fn ENGINE_free(engine: ?*ENGINE) c_int;
pub extern fn ENGINE_set_RSA_method(engine: ?*ENGINE, method: [*c]const RSA_METHOD, method_size: usize) c_int;
pub extern fn ENGINE_get_RSA_method(engine: ?*const ENGINE) [*c]RSA_METHOD;
pub extern fn ENGINE_set_ECDSA_method(engine: ?*ENGINE, method: [*c]const ECDSA_METHOD, method_size: usize) c_int;
pub extern fn ENGINE_get_ECDSA_method(engine: ?*const ENGINE) [*c]ECDSA_METHOD;
pub extern fn METHOD_ref(method: ?*anyopaque) void;
pub extern fn METHOD_unref(method: ?*anyopaque) void;
pub extern fn DSA_new() [*c]DSA;
pub extern fn DSA_free(dsa: [*c]DSA) void;
pub extern fn DSA_up_ref(dsa: [*c]DSA) c_int;
pub extern fn DSA_bits(dsa: [*c]const DSA) c_uint;
pub extern fn DSA_get0_pub_key(dsa: [*c]const DSA) [*c]const BIGNUM;
pub extern fn DSA_get0_priv_key(dsa: [*c]const DSA) [*c]const BIGNUM;
pub extern fn DSA_get0_p(dsa: [*c]const DSA) [*c]const BIGNUM;
pub extern fn DSA_get0_q(dsa: [*c]const DSA) [*c]const BIGNUM;
pub extern fn DSA_get0_g(dsa: [*c]const DSA) [*c]const BIGNUM;
pub extern fn DSA_get0_key(dsa: [*c]const DSA, out_pub_key: [*c][*c]const BIGNUM, out_priv_key: [*c][*c]const BIGNUM) void;
pub extern fn DSA_get0_pqg(dsa: [*c]const DSA, out_p: [*c][*c]const BIGNUM, out_q: [*c][*c]const BIGNUM, out_g: [*c][*c]const BIGNUM) void;
pub extern fn DSA_set0_key(dsa: [*c]DSA, pub_key: [*c]BIGNUM, priv_key: [*c]BIGNUM) c_int;
pub extern fn DSA_set0_pqg(dsa: [*c]DSA, p: [*c]BIGNUM, q: [*c]BIGNUM, g: [*c]BIGNUM) c_int;
pub extern fn DSA_generate_parameters_ex(dsa: [*c]DSA, bits: c_uint, seed: [*c]const u8, seed_len: usize, out_counter: [*c]c_int, out_h: [*c]c_ulong, cb: [*c]BN_GENCB) c_int;
pub extern fn DSAparams_dup(dsa: [*c]const DSA) [*c]DSA;
pub extern fn DSA_generate_key(dsa: [*c]DSA) c_int;
pub extern fn DSA_SIG_new() [*c]DSA_SIG;
pub extern fn DSA_SIG_free(sig: [*c]DSA_SIG) void;
pub extern fn DSA_SIG_get0(sig: [*c]const DSA_SIG, out_r: [*c][*c]const BIGNUM, out_s: [*c][*c]const BIGNUM) void;
pub extern fn DSA_SIG_set0(sig: [*c]DSA_SIG, r: [*c]BIGNUM, s: [*c]BIGNUM) c_int;
pub extern fn DSA_do_sign(digest: [*c]const u8, digest_len: usize, dsa: [*c]const DSA) [*c]DSA_SIG;
pub extern fn DSA_do_verify(digest: [*c]const u8, digest_len: usize, sig: [*c]DSA_SIG, dsa: [*c]const DSA) c_int;
pub extern fn DSA_do_check_signature(out_valid: [*c]c_int, digest: [*c]const u8, digest_len: usize, sig: [*c]DSA_SIG, dsa: [*c]const DSA) c_int;
pub extern fn DSA_sign(@"type": c_int, digest: [*c]const u8, digest_len: usize, out_sig: [*c]u8, out_siglen: [*c]c_uint, dsa: [*c]const DSA) c_int;
pub extern fn DSA_verify(@"type": c_int, digest: [*c]const u8, digest_len: usize, sig: [*c]const u8, sig_len: usize, dsa: [*c]const DSA) c_int;
pub extern fn DSA_check_signature(out_valid: [*c]c_int, digest: [*c]const u8, digest_len: usize, sig: [*c]const u8, sig_len: usize, dsa: [*c]const DSA) c_int;
pub extern fn DSA_size(dsa: [*c]const DSA) c_int;
pub extern fn DSA_SIG_parse(cbs: [*c]CBS) [*c]DSA_SIG;
pub extern fn DSA_SIG_marshal(cbb: ?*CBB, sig: [*c]const DSA_SIG) c_int;
pub extern fn DSA_parse_public_key(cbs: [*c]CBS) [*c]DSA;
pub extern fn DSA_marshal_public_key(cbb: ?*CBB, dsa: [*c]const DSA) c_int;
pub extern fn DSA_parse_private_key(cbs: [*c]CBS) [*c]DSA;
pub extern fn DSA_marshal_private_key(cbb: ?*CBB, dsa: [*c]const DSA) c_int;
pub extern fn DSA_parse_parameters(cbs: [*c]CBS) [*c]DSA;
pub extern fn DSA_marshal_parameters(cbb: ?*CBB, dsa: [*c]const DSA) c_int;
pub extern fn DSA_dup_DH(dsa: [*c]const DSA) ?*DH;
pub extern fn DSA_get_ex_new_index(argl: c_long, argp: ?*anyopaque, unused: [*c]CRYPTO_EX_unused, dup_unused: ?*const CRYPTO_EX_dup, free_func: ?*const CRYPTO_EX_free) c_int;
pub extern fn DSA_set_ex_data(dsa: [*c]DSA, idx: c_int, arg: ?*anyopaque) c_int;
pub extern fn DSA_get_ex_data(dsa: [*c]const DSA, idx: c_int) ?*anyopaque;
pub extern fn d2i_DSA_SIG(out_sig: [*c][*c]DSA_SIG, inp: [*c][*c]const u8, len: c_long) [*c]DSA_SIG;
pub extern fn i2d_DSA_SIG(in: [*c]const DSA_SIG, outp: [*c][*c]u8) c_int;
pub extern fn d2i_DSAPublicKey(out: [*c][*c]DSA, inp: [*c][*c]const u8, len: c_long) [*c]DSA;
pub extern fn i2d_DSAPublicKey(in: [*c]const DSA, outp: [*c][*c]u8) c_int;
pub extern fn d2i_DSAPrivateKey(out: [*c][*c]DSA, inp: [*c][*c]const u8, len: c_long) [*c]DSA;
pub extern fn i2d_DSAPrivateKey(in: [*c]const DSA, outp: [*c][*c]u8) c_int;
pub extern fn d2i_DSAparams(out: [*c][*c]DSA, inp: [*c][*c]const u8, len: c_long) [*c]DSA;
pub extern fn i2d_DSAparams(in: [*c]const DSA, outp: [*c][*c]u8) c_int;
pub extern fn DSA_generate_parameters(bits: c_int, seed: [*c]u8, seed_len: c_int, counter_ret: [*c]c_int, h_ret: [*c]c_ulong, callback: ?*const fn (c_int, c_int, ?*anyopaque) callconv(.C) void, cb_arg: ?*anyopaque) [*c]DSA;
pub const POINT_CONVERSION_COMPRESSED: c_int = 2;
pub const POINT_CONVERSION_UNCOMPRESSED: c_int = 4;
pub const POINT_CONVERSION_HYBRID: c_int = 6;
pub const point_conversion_form_t = c_uint;
pub extern fn EC_GROUP_new_by_curve_name(nid: c_int) ?*EC_GROUP;
pub extern fn EC_GROUP_free(group: ?*EC_GROUP) void;
pub extern fn EC_GROUP_dup(a: ?*const EC_GROUP) ?*EC_GROUP;
pub extern fn EC_GROUP_cmp(a: ?*const EC_GROUP, b: ?*const EC_GROUP, ignored: ?*BN_CTX) c_int;
pub extern fn EC_GROUP_get0_generator(group: ?*const EC_GROUP) ?*const EC_POINT;
pub extern fn EC_GROUP_get0_order(group: ?*const EC_GROUP) [*c]const BIGNUM;
pub extern fn EC_GROUP_order_bits(group: ?*const EC_GROUP) c_int;
pub extern fn EC_GROUP_get_cofactor(group: ?*const EC_GROUP, cofactor: [*c]BIGNUM, ctx: ?*BN_CTX) c_int;
pub extern fn EC_GROUP_get_curve_GFp(group: ?*const EC_GROUP, out_p: [*c]BIGNUM, out_a: [*c]BIGNUM, out_b: [*c]BIGNUM, ctx: ?*BN_CTX) c_int;
pub extern fn EC_GROUP_get_curve_name(group: ?*const EC_GROUP) c_int;
pub extern fn EC_GROUP_get_degree(group: ?*const EC_GROUP) c_uint;
pub extern fn EC_curve_nid2nist(nid: c_int) [*c]const u8;
pub extern fn EC_curve_nist2nid(name: [*c]const u8) c_int;
pub extern fn EC_POINT_new(group: ?*const EC_GROUP) ?*EC_POINT;
pub extern fn EC_POINT_free(point: ?*EC_POINT) void;
pub extern fn EC_POINT_copy(dest: ?*EC_POINT, src: ?*const EC_POINT) c_int;
pub extern fn EC_POINT_dup(src: ?*const EC_POINT, group: ?*const EC_GROUP) ?*EC_POINT;
pub extern fn EC_POINT_set_to_infinity(group: ?*const EC_GROUP, point: ?*EC_POINT) c_int;
pub extern fn EC_POINT_is_at_infinity(group: ?*const EC_GROUP, point: ?*const EC_POINT) c_int;
pub extern fn EC_POINT_is_on_curve(group: ?*const EC_GROUP, point: ?*const EC_POINT, ctx: ?*BN_CTX) c_int;
pub extern fn EC_POINT_cmp(group: ?*const EC_GROUP, a: ?*const EC_POINT, b: ?*const EC_POINT, ctx: ?*BN_CTX) c_int;
pub extern fn EC_POINT_get_affine_coordinates_GFp(group: ?*const EC_GROUP, point: ?*const EC_POINT, x: [*c]BIGNUM, y: [*c]BIGNUM, ctx: ?*BN_CTX) c_int;
pub extern fn EC_POINT_get_affine_coordinates(group: ?*const EC_GROUP, point: ?*const EC_POINT, x: [*c]BIGNUM, y: [*c]BIGNUM, ctx: ?*BN_CTX) c_int;
pub extern fn EC_POINT_set_affine_coordinates_GFp(group: ?*const EC_GROUP, point: ?*EC_POINT, x: [*c]const BIGNUM, y: [*c]const BIGNUM, ctx: ?*BN_CTX) c_int;
pub extern fn EC_POINT_set_affine_coordinates(group: ?*const EC_GROUP, point: ?*EC_POINT, x: [*c]const BIGNUM, y: [*c]const BIGNUM, ctx: ?*BN_CTX) c_int;
pub extern fn EC_POINT_point2oct(group: ?*const EC_GROUP, point: ?*const EC_POINT, form: point_conversion_form_t, buf: [*c]u8, max_out: usize, ctx: ?*BN_CTX) usize;
pub extern fn EC_POINT_point2buf(group: ?*const EC_GROUP, point: ?*const EC_POINT, form: point_conversion_form_t, out_buf: [*c][*c]u8, ctx: ?*BN_CTX) usize;
pub extern fn EC_POINT_point2cbb(out: ?*CBB, group: ?*const EC_GROUP, point: ?*const EC_POINT, form: point_conversion_form_t, ctx: ?*BN_CTX) c_int;
pub extern fn EC_POINT_oct2point(group: ?*const EC_GROUP, point: ?*EC_POINT, buf: [*c]const u8, len: usize, ctx: ?*BN_CTX) c_int;
pub extern fn EC_POINT_set_compressed_coordinates_GFp(group: ?*const EC_GROUP, point: ?*EC_POINT, x: [*c]const BIGNUM, y_bit: c_int, ctx: ?*BN_CTX) c_int;
pub extern fn EC_POINT_add(group: ?*const EC_GROUP, r: ?*EC_POINT, a: ?*const EC_POINT, b: ?*const EC_POINT, ctx: ?*BN_CTX) c_int;
pub extern fn EC_POINT_dbl(group: ?*const EC_GROUP, r: ?*EC_POINT, a: ?*const EC_POINT, ctx: ?*BN_CTX) c_int;
pub extern fn EC_POINT_invert(group: ?*const EC_GROUP, a: ?*EC_POINT, ctx: ?*BN_CTX) c_int;
pub extern fn EC_POINT_mul(group: ?*const EC_GROUP, r: ?*EC_POINT, n: [*c]const BIGNUM, q: ?*const EC_POINT, m: [*c]const BIGNUM, ctx: ?*BN_CTX) c_int;
pub extern fn EC_GROUP_new_curve_GFp(p: [*c]const BIGNUM, a: [*c]const BIGNUM, b: [*c]const BIGNUM, ctx: ?*BN_CTX) ?*EC_GROUP;
pub extern fn EC_GROUP_set_generator(group: ?*EC_GROUP, generator: ?*const EC_POINT, order: [*c]const BIGNUM, cofactor: [*c]const BIGNUM) c_int;
pub extern fn EC_GROUP_get_order(group: ?*const EC_GROUP, order: [*c]BIGNUM, ctx: ?*BN_CTX) c_int;
pub extern fn EC_GROUP_set_asn1_flag(group: ?*EC_GROUP, flag: c_int) void;
pub extern fn EC_GROUP_get_asn1_flag(group: ?*const EC_GROUP) c_int;
pub const struct_ec_method_st = opaque {};
pub const EC_METHOD = struct_ec_method_st;
pub extern fn EC_GROUP_method_of(group: ?*const EC_GROUP) ?*const EC_METHOD;
pub extern fn EC_METHOD_get_field_type(meth: ?*const EC_METHOD) c_int;
pub extern fn EC_GROUP_set_point_conversion_form(group: ?*EC_GROUP, form: point_conversion_form_t) void;
pub const EC_builtin_curve = extern struct {
    nid: c_int,
    comment: [*c]const u8,
};
pub extern fn EC_get_builtin_curves(out_curves: [*c]EC_builtin_curve, max_num_curves: usize) usize;
pub extern fn EC_POINT_clear_free(point: ?*EC_POINT) void;
pub extern fn EC_KEY_new() ?*EC_KEY;
pub extern fn EC_KEY_new_method(engine: ?*const ENGINE) ?*EC_KEY;
pub extern fn EC_KEY_new_by_curve_name(nid: c_int) ?*EC_KEY;
pub extern fn EC_KEY_free(key: ?*EC_KEY) void;
pub extern fn EC_KEY_dup(src: ?*const EC_KEY) ?*EC_KEY;
pub extern fn EC_KEY_up_ref(key: ?*EC_KEY) c_int;
pub extern fn EC_KEY_is_opaque(key: ?*const EC_KEY) c_int;
pub extern fn EC_KEY_get0_group(key: ?*const EC_KEY) ?*const EC_GROUP;
pub extern fn EC_KEY_set_group(key: ?*EC_KEY, group: ?*const EC_GROUP) c_int;
pub extern fn EC_KEY_get0_private_key(key: ?*const EC_KEY) [*c]const BIGNUM;
pub extern fn EC_KEY_set_private_key(key: ?*EC_KEY, priv: [*c]const BIGNUM) c_int;
pub extern fn EC_KEY_get0_public_key(key: ?*const EC_KEY) ?*const EC_POINT;
pub extern fn EC_KEY_set_public_key(key: ?*EC_KEY, @"pub": ?*const EC_POINT) c_int;
pub extern fn EC_KEY_get_enc_flags(key: ?*const EC_KEY) c_uint;
pub extern fn EC_KEY_set_enc_flags(key: ?*EC_KEY, flags: c_uint) void;
pub extern fn EC_KEY_get_conv_form(key: ?*const EC_KEY) point_conversion_form_t;
pub extern fn EC_KEY_set_conv_form(key: ?*EC_KEY, cform: point_conversion_form_t) void;
pub extern fn EC_KEY_check_key(key: ?*const EC_KEY) c_int;
pub extern fn EC_KEY_check_fips(key: ?*const EC_KEY) c_int;
pub extern fn EC_KEY_set_public_key_affine_coordinates(key: ?*EC_KEY, x: [*c]const BIGNUM, y: [*c]const BIGNUM) c_int;
pub extern fn EC_KEY_oct2key(key: ?*EC_KEY, in: [*c]const u8, len: usize, ctx: ?*BN_CTX) c_int;
pub extern fn EC_KEY_key2buf(key: ?*const EC_KEY, form: point_conversion_form_t, out_buf: [*c][*c]u8, ctx: ?*BN_CTX) usize;
pub extern fn EC_KEY_oct2priv(key: ?*EC_KEY, in: [*c]const u8, len: usize) c_int;
pub extern fn EC_KEY_priv2oct(key: ?*const EC_KEY, out: [*c]u8, max_out: usize) usize;
pub extern fn EC_KEY_priv2buf(key: ?*const EC_KEY, out_buf: [*c][*c]u8) usize;
pub extern fn EC_KEY_generate_key(key: ?*EC_KEY) c_int;
pub extern fn EC_KEY_generate_key_fips(key: ?*EC_KEY) c_int;
pub extern fn EC_KEY_derive_from_secret(group: ?*const EC_GROUP, secret: [*c]const u8, secret_len: usize) ?*EC_KEY;
pub extern fn EC_KEY_parse_private_key(cbs: [*c]CBS, group: ?*const EC_GROUP) ?*EC_KEY;
pub extern fn EC_KEY_marshal_private_key(cbb: ?*CBB, key: ?*const EC_KEY, enc_flags: c_uint) c_int;
pub extern fn EC_KEY_parse_curve_name(cbs: [*c]CBS) ?*EC_GROUP;
pub extern fn EC_KEY_marshal_curve_name(cbb: ?*CBB, group: ?*const EC_GROUP) c_int;
pub extern fn EC_KEY_parse_parameters(cbs: [*c]CBS) ?*EC_GROUP;
pub extern fn EC_KEY_get_ex_new_index(argl: c_long, argp: ?*anyopaque, unused: [*c]CRYPTO_EX_unused, dup_unused: ?*const CRYPTO_EX_dup, free_func: ?*const CRYPTO_EX_free) c_int;
pub extern fn EC_KEY_set_ex_data(r: ?*EC_KEY, idx: c_int, arg: ?*anyopaque) c_int;
pub extern fn EC_KEY_get_ex_data(r: ?*const EC_KEY, idx: c_int) ?*anyopaque;
pub extern fn EC_KEY_set_asn1_flag(key: ?*EC_KEY, flag: c_int) void;
pub extern fn d2i_ECPrivateKey(out_key: [*c]?*EC_KEY, inp: [*c][*c]const u8, len: c_long) ?*EC_KEY;
pub extern fn i2d_ECPrivateKey(key: ?*const EC_KEY, outp: [*c][*c]u8) c_int;
pub extern fn d2i_ECParameters(out_key: [*c]?*EC_KEY, inp: [*c][*c]const u8, len: c_long) ?*EC_KEY;
pub extern fn i2d_ECParameters(key: ?*const EC_KEY, outp: [*c][*c]u8) c_int;
pub extern fn o2i_ECPublicKey(out_key: [*c]?*EC_KEY, inp: [*c][*c]const u8, len: c_long) ?*EC_KEY;
pub extern fn i2o_ECPublicKey(key: ?*const EC_KEY, outp: [*c][*c]u8) c_int;
pub extern fn ECDH_compute_key(out: ?*anyopaque, outlen: usize, pub_key: ?*const EC_POINT, priv_key: ?*const EC_KEY, kdf: ?*const fn (?*const anyopaque, usize, ?*anyopaque, [*c]usize) callconv(.C) ?*anyopaque) c_int;
pub extern fn ECDH_compute_key_fips(out: [*c]u8, out_len: usize, pub_key: ?*const EC_POINT, priv_key: ?*const EC_KEY) c_int;
pub extern fn ECDSA_sign(@"type": c_int, digest: [*c]const u8, digest_len: usize, sig: [*c]u8, sig_len: [*c]c_uint, key: ?*const EC_KEY) c_int;
pub extern fn ECDSA_verify(@"type": c_int, digest: [*c]const u8, digest_len: usize, sig: [*c]const u8, sig_len: usize, key: ?*const EC_KEY) c_int;
pub extern fn ECDSA_size(key: ?*const EC_KEY) usize;
pub extern fn ECDSA_SIG_new() [*c]ECDSA_SIG;
pub extern fn ECDSA_SIG_free(sig: [*c]ECDSA_SIG) void;
pub extern fn ECDSA_SIG_get0_r(sig: [*c]const ECDSA_SIG) [*c]const BIGNUM;
pub extern fn ECDSA_SIG_get0_s(sig: [*c]const ECDSA_SIG) [*c]const BIGNUM;
pub extern fn ECDSA_SIG_get0(sig: [*c]const ECDSA_SIG, out_r: [*c][*c]const BIGNUM, out_s: [*c][*c]const BIGNUM) void;
pub extern fn ECDSA_SIG_set0(sig: [*c]ECDSA_SIG, r: [*c]BIGNUM, s: [*c]BIGNUM) c_int;
pub extern fn ECDSA_do_sign(digest: [*c]const u8, digest_len: usize, key: ?*const EC_KEY) [*c]ECDSA_SIG;
pub extern fn ECDSA_do_verify(digest: [*c]const u8, digest_len: usize, sig: [*c]const ECDSA_SIG, key: ?*const EC_KEY) c_int;
pub extern fn ECDSA_SIG_parse(cbs: [*c]CBS) [*c]ECDSA_SIG;
pub extern fn ECDSA_SIG_from_bytes(in: [*c]const u8, in_len: usize) [*c]ECDSA_SIG;
pub extern fn ECDSA_SIG_marshal(cbb: ?*CBB, sig: [*c]const ECDSA_SIG) c_int;
pub extern fn ECDSA_SIG_to_bytes(out_bytes: [*c][*c]u8, out_len: [*c]usize, sig: [*c]const ECDSA_SIG) c_int;
pub extern fn ECDSA_SIG_max_len(order_len: usize) usize;
pub extern fn ECDSA_sign_with_nonce_and_leak_private_key_for_testing(digest: [*c]const u8, digest_len: usize, eckey: ?*const EC_KEY, nonce: [*c]const u8, nonce_len: usize) [*c]ECDSA_SIG;
pub extern fn d2i_ECDSA_SIG(out: [*c][*c]ECDSA_SIG, inp: [*c][*c]const u8, len: c_long) [*c]ECDSA_SIG;
pub extern fn i2d_ECDSA_SIG(sig: [*c]const ECDSA_SIG, outp: [*c][*c]u8) c_int;
// pub extern fn CBS_init(cbs: [*c]CBS, data: [*c]const u8, len: usize) void;
// pub extern fn CBS_skip(cbs: [*c]CBS, len: usize) c_int;
// pub extern fn CBS_data(cbs: [*c]const CBS) [*c]const u8;
// pub extern fn CBS_len(cbs: [*c]const CBS) usize;
// pub extern fn CBS_stow(cbs: [*c]const CBS, out_ptr: [*c][*c]u8, out_len: [*c]usize) c_int;
// pub extern fn CBS_strdup(cbs: [*c]const CBS, out_ptr: [*c][*c]u8) c_int;
// pub extern fn CBS_contains_zero_byte(cbs: [*c]const CBS) c_int;
// pub extern fn CBS_mem_equal(cbs: [*c]const CBS, data: [*c]const u8, len: usize) c_int;
// pub extern fn CBS_get_u8(cbs: [*c]CBS, out: [*c]u8) c_int;
// pub extern fn CBS_get_u16(cbs: [*c]CBS, out: [*c]u16) c_int;
// pub extern fn CBS_get_u16le(cbs: [*c]CBS, out: [*c]u16) c_int;
// pub extern fn CBS_get_u24(cbs: [*c]CBS, out: [*c]u32) c_int;
// pub extern fn CBS_get_u32(cbs: [*c]CBS, out: [*c]u32) c_int;
// pub extern fn CBS_get_u32le(cbs: [*c]CBS, out: [*c]u32) c_int;
// pub extern fn CBS_get_u64(cbs: [*c]CBS, out: [*c]u64) c_int;
// pub extern fn CBS_get_u64le(cbs: [*c]CBS, out: [*c]u64) c_int;
// pub extern fn CBS_get_last_u8(cbs: [*c]CBS, out: [*c]u8) c_int;
// pub extern fn CBS_get_bytes(cbs: [*c]CBS, out: [*c]CBS, len: usize) c_int;
// pub extern fn CBS_copy_bytes(cbs: [*c]CBS, out: [*c]u8, len: usize) c_int;
// pub extern fn CBS_get_u8_length_prefixed(cbs: [*c]CBS, out: [*c]CBS) c_int;
// pub extern fn CBS_get_u16_length_prefixed(cbs: [*c]CBS, out: [*c]CBS) c_int;
// pub extern fn CBS_get_u24_length_prefixed(cbs: [*c]CBS, out: [*c]CBS) c_int;
// pub extern fn CBS_get_until_first(cbs: [*c]CBS, out: [*c]CBS, c: u8) c_int;
// pub extern fn CBS_get_asn1(cbs: [*c]CBS, out: [*c]CBS, tag_value: CBS_ASN1_TAG) c_int;
// pub extern fn CBS_get_asn1_element(cbs: [*c]CBS, out: [*c]CBS, tag_value: CBS_ASN1_TAG) c_int;
// pub extern fn CBS_peek_asn1_tag(cbs: [*c]const CBS, tag_value: CBS_ASN1_TAG) c_int;
// pub extern fn CBS_get_any_asn1(cbs: [*c]CBS, out: [*c]CBS, out_tag: [*c]CBS_ASN1_TAG) c_int;
// pub extern fn CBS_get_any_asn1_element(cbs: [*c]CBS, out: [*c]CBS, out_tag: [*c]CBS_ASN1_TAG, out_header_len: [*c]usize) c_int;
// pub extern fn CBS_get_any_ber_asn1_element(cbs: [*c]CBS, out: [*c]CBS, out_tag: [*c]CBS_ASN1_TAG, out_header_len: [*c]usize, out_ber_found: [*c]c_int, out_indefinite: [*c]c_int) c_int;
// pub extern fn CBS_get_asn1_uint64(cbs: [*c]CBS, out: [*c]u64) c_int;
// pub extern fn CBS_get_asn1_int64(cbs: [*c]CBS, out: [*c]i64) c_int;
// pub extern fn CBS_get_asn1_bool(cbs: [*c]CBS, out: [*c]c_int) c_int;
// pub extern fn CBS_get_optional_asn1(cbs: [*c]CBS, out: [*c]CBS, out_present: [*c]c_int, tag: CBS_ASN1_TAG) c_int;
// pub extern fn CBS_get_optional_asn1_octet_string(cbs: [*c]CBS, out: [*c]CBS, out_present: [*c]c_int, tag: CBS_ASN1_TAG) c_int;
// pub extern fn CBS_get_optional_asn1_uint64(cbs: [*c]CBS, out: [*c]u64, tag: CBS_ASN1_TAG, default_value: u64) c_int;
// pub extern fn CBS_get_optional_asn1_bool(cbs: [*c]CBS, out: [*c]c_int, tag: CBS_ASN1_TAG, default_value: c_int) c_int;
// pub extern fn CBS_is_valid_asn1_bitstring(cbs: [*c]const CBS) c_int;
// pub extern fn CBS_asn1_bitstring_has_bit(cbs: [*c]const CBS, bit: c_uint) c_int;
// pub extern fn CBS_is_valid_asn1_integer(cbs: [*c]const CBS, out_is_negative: [*c]c_int) c_int;
// pub extern fn CBS_is_unsigned_asn1_integer(cbs: [*c]const CBS) c_int;
// pub extern fn CBS_asn1_oid_to_text(cbs: [*c]const CBS) [*c]u8;
// pub extern fn CBS_parse_generalized_time(cbs: [*c]const CBS, out_tm: [*c]struct_tm, allow_timezone_offset: c_int) c_int;
// pub extern fn CBS_parse_utc_time(cbs: [*c]const CBS, out_tm: [*c]struct_tm, allow_timezone_offset: c_int) c_int;
// pub extern fn CBB_zero(cbb: ?*CBB) void;
// pub extern fn CBB_init(cbb: ?*CBB, initial_capacity: usize) c_int;
// pub extern fn CBB_init_fixed(cbb: ?*CBB, buf: [*c]u8, len: usize) c_int;
// pub extern fn CBB_cleanup(cbb: ?*CBB) void;
// pub extern fn CBB_finish(cbb: ?*CBB, out_data: [*c][*c]u8, out_len: [*c]usize) c_int;
// pub extern fn CBB_flush(cbb: ?*CBB) c_int;
// pub extern fn CBB_data(cbb: ?*const CBB) [*c]const u8;
// pub extern fn CBB_len(cbb: ?*const CBB) usize;
// pub extern fn CBB_add_u8_length_prefixed(cbb: ?*CBB, out_contents: ?*CBB) c_int;
// pub extern fn CBB_add_u16_length_prefixed(cbb: ?*CBB, out_contents: ?*CBB) c_int;
// pub extern fn CBB_add_u24_length_prefixed(cbb: ?*CBB, out_contents: ?*CBB) c_int;
// pub extern fn CBB_add_asn1(cbb: ?*CBB, out_contents: ?*CBB, tag: CBS_ASN1_TAG) c_int;
// pub extern fn CBB_add_bytes(cbb: ?*CBB, data: [*c]const u8, len: usize) c_int;
// pub extern fn CBB_add_zeros(cbb: ?*CBB, len: usize) c_int;
// pub extern fn CBB_add_space(cbb: ?*CBB, out_data: [*c][*c]u8, len: usize) c_int;
// pub extern fn CBB_reserve(cbb: ?*CBB, out_data: [*c][*c]u8, len: usize) c_int;
// pub extern fn CBB_did_write(cbb: ?*CBB, len: usize) c_int;
// pub extern fn CBB_add_u8(cbb: ?*CBB, value: u8) c_int;
// pub extern fn CBB_add_u16(cbb: ?*CBB, value: u16) c_int;
// pub extern fn CBB_add_u16le(cbb: ?*CBB, value: u16) c_int;
// pub extern fn CBB_add_u24(cbb: ?*CBB, value: u32) c_int;
// pub extern fn CBB_add_u32(cbb: ?*CBB, value: u32) c_int;
// pub extern fn CBB_add_u32le(cbb: ?*CBB, value: u32) c_int;
// pub extern fn CBB_add_u64(cbb: ?*CBB, value: u64) c_int;
// pub extern fn CBB_add_u64le(cbb: ?*CBB, value: u64) c_int;
// pub extern fn CBB_discard_child(cbb: ?*CBB) void;
// pub extern fn CBB_add_asn1_uint64(cbb: ?*CBB, value: u64) c_int;
// pub extern fn CBB_add_asn1_uint64_with_tag(cbb: ?*CBB, value: u64, tag: CBS_ASN1_TAG) c_int;
// pub extern fn CBB_add_asn1_int64(cbb: ?*CBB, value: i64) c_int;
// pub extern fn CBB_add_asn1_int64_with_tag(cbb: ?*CBB, value: i64, tag: CBS_ASN1_TAG) c_int;
// pub extern fn CBB_add_asn1_octet_string(cbb: ?*CBB, data: [*c]const u8, data_len: usize) c_int;
// pub extern fn CBB_add_asn1_bool(cbb: ?*CBB, value: c_int) c_int;
// pub extern fn CBB_add_asn1_oid_from_text(cbb: ?*CBB, text: [*c]const u8, len: usize) c_int;
// pub extern fn CBB_flush_asn1_set_of(cbb: ?*CBB) c_int;
pub extern fn OBJ_dup(obj: ?*const ASN1_OBJECT) ?*ASN1_OBJECT;
pub extern fn OBJ_cmp(a: ?*const ASN1_OBJECT, b: ?*const ASN1_OBJECT) c_int;
pub extern fn OBJ_get0_data(obj: ?*const ASN1_OBJECT) [*c]const u8;
pub extern fn OBJ_length(obj: ?*const ASN1_OBJECT) usize;
pub extern fn OBJ_obj2nid(obj: ?*const ASN1_OBJECT) c_int;
pub extern fn OBJ_cbs2nid(cbs: [*c]const CBS) c_int;
pub extern fn OBJ_sn2nid(short_name: [*c]const u8) c_int;
pub extern fn OBJ_ln2nid(long_name: [*c]const u8) c_int;
pub extern fn OBJ_txt2nid(s: [*c]const u8) c_int;
pub extern fn OBJ_nid2obj(nid: c_int) ?*ASN1_OBJECT;
pub extern fn OBJ_nid2sn(nid: c_int) [*c]const u8;
pub extern fn OBJ_nid2ln(nid: c_int) [*c]const u8;
pub extern fn OBJ_nid2cbb(out: ?*CBB, nid: c_int) c_int;
pub extern fn OBJ_txt2obj(s: [*c]const u8, dont_search_names: c_int) ?*ASN1_OBJECT;
pub extern fn OBJ_obj2txt(out: [*c]u8, out_len: c_int, obj: ?*const ASN1_OBJECT, always_return_oid: c_int) c_int;
pub extern fn OBJ_create(oid: [*c]const u8, short_name: [*c]const u8, long_name: [*c]const u8) c_int;
pub extern fn OBJ_find_sigid_algs(sign_nid: c_int, out_digest_nid: [*c]c_int, out_pkey_nid: [*c]c_int) c_int;
pub extern fn OBJ_find_sigid_by_algs(out_sign_nid: [*c]c_int, digest_nid: c_int, pkey_nid: c_int) c_int;
pub const struct_obj_name_st = extern struct {
    type: c_int,
    alias: c_int,
    name: [*c]const u8,
    data: [*c]const u8,
};
pub const OBJ_NAME = struct_obj_name_st;
pub extern fn OBJ_NAME_do_all_sorted(@"type": c_int, callback: ?*const fn ([*c]const OBJ_NAME, ?*anyopaque) callconv(.C) void, arg: ?*anyopaque) void;
pub extern fn OBJ_NAME_do_all(@"type": c_int, callback: ?*const fn ([*c]const OBJ_NAME, ?*anyopaque) callconv(.C) void, arg: ?*anyopaque) void;
pub extern fn OBJ_cleanup() void;
pub const sk_CRYPTO_BUFFER_free_func = ?*const fn (?*CRYPTO_BUFFER) callconv(.C) void;
pub const sk_CRYPTO_BUFFER_copy_func = ?*const fn (?*CRYPTO_BUFFER) callconv(.C) ?*CRYPTO_BUFFER;
pub const sk_CRYPTO_BUFFER_cmp_func = ?*const fn ([*c]?*const CRYPTO_BUFFER, [*c]?*const CRYPTO_BUFFER) callconv(.C) c_int;
pub fn sk_CRYPTO_BUFFER_call_free_func(arg_free_func: OPENSSL_sk_free_func, arg_ptr: ?*anyopaque) callconv(.C) void {
    const free_func = arg_free_func;
    const ptr = arg_ptr;
    @as(sk_CRYPTO_BUFFER_free_func, @ptrCast(@alignCast(free_func))).?(@as(?*CRYPTO_BUFFER, @ptrCast(ptr)));
}
pub fn sk_CRYPTO_BUFFER_call_copy_func(arg_copy_func: OPENSSL_sk_copy_func, arg_ptr: ?*anyopaque) callconv(.C) ?*anyopaque {
    const copy_func = arg_copy_func;
    const ptr = arg_ptr;
    return @as(?*anyopaque, @ptrCast(@as(sk_CRYPTO_BUFFER_copy_func, @ptrCast(@alignCast(copy_func))).?(@as(?*CRYPTO_BUFFER, @ptrCast(ptr)))));
}
pub fn sk_CRYPTO_BUFFER_call_cmp_func(arg_cmp_func: OPENSSL_sk_cmp_func, arg_a: [*c]const ?*const anyopaque, arg_b: [*c]const ?*const anyopaque) callconv(.C) c_int {
    const cmp_func = arg_cmp_func;
    const a = arg_a;
    const b = arg_b;
    var a_ptr: ?*const CRYPTO_BUFFER = @as(?*const CRYPTO_BUFFER, @ptrCast(a.*));
    var b_ptr: ?*const CRYPTO_BUFFER = @as(?*const CRYPTO_BUFFER, @ptrCast(b.*));
    return @as(sk_CRYPTO_BUFFER_cmp_func, @ptrCast(@alignCast(cmp_func))).?(&a_ptr, &b_ptr);
}
pub fn sk_CRYPTO_BUFFER_new(arg_comp: sk_CRYPTO_BUFFER_cmp_func) callconv(.C) ?*struct_stack_st_CRYPTO_BUFFER {
    const comp = arg_comp;
    return @as(?*struct_stack_st_CRYPTO_BUFFER, @ptrCast(sk_new(@as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp))))));
}
pub fn sk_CRYPTO_BUFFER_new_null() callconv(.C) ?*struct_stack_st_CRYPTO_BUFFER {
    return @as(?*struct_stack_st_CRYPTO_BUFFER, @ptrCast(sk_new_null()));
}
pub fn sk_CRYPTO_BUFFER_num(arg_sk: ?*const struct_stack_st_CRYPTO_BUFFER) callconv(.C) usize {
    const sk = arg_sk;
    return sk_num(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_CRYPTO_BUFFER_zero(arg_sk: ?*struct_stack_st_CRYPTO_BUFFER) callconv(.C) void {
    const sk = arg_sk;
    sk_zero(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_CRYPTO_BUFFER_value(arg_sk: ?*const struct_stack_st_CRYPTO_BUFFER, arg_i: usize) callconv(.C) ?*CRYPTO_BUFFER {
    const sk = arg_sk;
    const i = arg_i;
    return @as(?*CRYPTO_BUFFER, @ptrCast(sk_value(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), i)));
}
pub fn sk_CRYPTO_BUFFER_set(arg_sk: ?*struct_stack_st_CRYPTO_BUFFER, arg_i: usize, arg_p: ?*CRYPTO_BUFFER) callconv(.C) ?*CRYPTO_BUFFER {
    const sk = arg_sk;
    const i = arg_i;
    const p = arg_p;
    return @as(?*CRYPTO_BUFFER, @ptrCast(sk_set(@as([*c]_STACK, @ptrCast(@alignCast(sk))), i, @as(?*anyopaque, @ptrCast(p)))));
}
pub fn sk_CRYPTO_BUFFER_free(arg_sk: ?*struct_stack_st_CRYPTO_BUFFER) callconv(.C) void {
    const sk = arg_sk;
    sk_free(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_CRYPTO_BUFFER_pop_free(arg_sk: ?*struct_stack_st_CRYPTO_BUFFER, arg_free_func: sk_CRYPTO_BUFFER_free_func) callconv(.C) void {
    const sk = arg_sk;
    const free_func = arg_free_func;
    sk_pop_free_ex(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_CRYPTO_BUFFER_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))));
}
pub fn sk_CRYPTO_BUFFER_insert(arg_sk: ?*struct_stack_st_CRYPTO_BUFFER, arg_p: ?*CRYPTO_BUFFER, arg_where: usize) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    const where = arg_where;
    return sk_insert(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)), where);
}
pub fn sk_CRYPTO_BUFFER_delete(arg_sk: ?*struct_stack_st_CRYPTO_BUFFER, arg_where: usize) callconv(.C) ?*CRYPTO_BUFFER {
    const sk = arg_sk;
    const where = arg_where;
    return @as(?*CRYPTO_BUFFER, @ptrCast(sk_delete(@as([*c]_STACK, @ptrCast(@alignCast(sk))), where)));
}
pub fn sk_CRYPTO_BUFFER_delete_ptr(arg_sk: ?*struct_stack_st_CRYPTO_BUFFER, arg_p: ?*const CRYPTO_BUFFER) callconv(.C) ?*CRYPTO_BUFFER {
    const sk = arg_sk;
    const p = arg_p;
    return @as(?*CRYPTO_BUFFER, @ptrCast(sk_delete_ptr(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*const anyopaque, @ptrCast(p)))));
}
pub fn sk_CRYPTO_BUFFER_find(arg_sk: ?*const struct_stack_st_CRYPTO_BUFFER, arg_out_index: [*c]usize, arg_p: ?*const CRYPTO_BUFFER) callconv(.C) c_int {
    const sk = arg_sk;
    const out_index = arg_out_index;
    const p = arg_p;
    return sk_find(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), out_index, @as(?*const anyopaque, @ptrCast(p)), &sk_CRYPTO_BUFFER_call_cmp_func);
}
pub fn sk_CRYPTO_BUFFER_shift(arg_sk: ?*struct_stack_st_CRYPTO_BUFFER) callconv(.C) ?*CRYPTO_BUFFER {
    const sk = arg_sk;
    return @as(?*CRYPTO_BUFFER, @ptrCast(sk_shift(@as([*c]_STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_CRYPTO_BUFFER_push(arg_sk: ?*struct_stack_st_CRYPTO_BUFFER, arg_p: ?*CRYPTO_BUFFER) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    return sk_push(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)));
}
pub fn sk_CRYPTO_BUFFER_pop(arg_sk: ?*struct_stack_st_CRYPTO_BUFFER) callconv(.C) ?*CRYPTO_BUFFER {
    const sk = arg_sk;
    return @as(?*CRYPTO_BUFFER, @ptrCast(sk_pop(@as([*c]_STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_CRYPTO_BUFFER_dup(arg_sk: ?*const struct_stack_st_CRYPTO_BUFFER) callconv(.C) ?*struct_stack_st_CRYPTO_BUFFER {
    const sk = arg_sk;
    return @as(?*struct_stack_st_CRYPTO_BUFFER, @ptrCast(sk_dup(@as([*c]const _STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_CRYPTO_BUFFER_sort(arg_sk: ?*struct_stack_st_CRYPTO_BUFFER) callconv(.C) void {
    const sk = arg_sk;
    sk_sort(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_CRYPTO_BUFFER_call_cmp_func);
}
pub fn sk_CRYPTO_BUFFER_is_sorted(arg_sk: ?*const struct_stack_st_CRYPTO_BUFFER) callconv(.C) c_int {
    const sk = arg_sk;
    return sk_is_sorted(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_CRYPTO_BUFFER_set_cmp_func(arg_sk: ?*struct_stack_st_CRYPTO_BUFFER, arg_comp: sk_CRYPTO_BUFFER_cmp_func) callconv(.C) sk_CRYPTO_BUFFER_cmp_func {
    const sk = arg_sk;
    const comp = arg_comp;
    return @as(sk_CRYPTO_BUFFER_cmp_func, @ptrCast(@alignCast(sk_set_cmp_func(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp)))))));
}
pub fn sk_CRYPTO_BUFFER_deep_copy(arg_sk: ?*const struct_stack_st_CRYPTO_BUFFER, arg_copy_func: sk_CRYPTO_BUFFER_copy_func, arg_free_func: sk_CRYPTO_BUFFER_free_func) callconv(.C) ?*struct_stack_st_CRYPTO_BUFFER {
    const sk = arg_sk;
    const copy_func = arg_copy_func;
    const free_func = arg_free_func;
    return @as(?*struct_stack_st_CRYPTO_BUFFER, @ptrCast(sk_deep_copy(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), &sk_CRYPTO_BUFFER_call_copy_func, @as(OPENSSL_sk_copy_func, @ptrCast(@alignCast(copy_func))), &sk_CRYPTO_BUFFER_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))))));
}
pub extern fn CRYPTO_BUFFER_POOL_new() ?*CRYPTO_BUFFER_POOL;
pub extern fn CRYPTO_BUFFER_POOL_free(pool: ?*CRYPTO_BUFFER_POOL) void;
pub extern fn CRYPTO_BUFFER_new(data: [*c]const u8, len: usize, pool: ?*CRYPTO_BUFFER_POOL) ?*CRYPTO_BUFFER;
pub extern fn CRYPTO_BUFFER_alloc(out_data: [*c][*c]u8, len: usize) ?*CRYPTO_BUFFER;
pub extern fn CRYPTO_BUFFER_new_from_CBS(cbs: [*c]const CBS, pool: ?*CRYPTO_BUFFER_POOL) ?*CRYPTO_BUFFER;
pub extern fn CRYPTO_BUFFER_new_from_static_data_unsafe(data: [*c]const u8, len: usize, pool: ?*CRYPTO_BUFFER_POOL) ?*CRYPTO_BUFFER;
pub extern fn CRYPTO_BUFFER_free(buf: ?*CRYPTO_BUFFER) void;
pub extern fn CRYPTO_BUFFER_up_ref(buf: ?*CRYPTO_BUFFER) c_int;
pub extern fn CRYPTO_BUFFER_data(buf: ?*const CRYPTO_BUFFER) [*c]const u8;
pub extern fn CRYPTO_BUFFER_len(buf: ?*const CRYPTO_BUFFER) usize;
pub extern fn CRYPTO_BUFFER_init_CBS(buf: ?*const CRYPTO_BUFFER, out: [*c]CBS) void;
pub extern fn RSA_new() ?*RSA;
pub extern fn RSA_new_method(engine: ?*const ENGINE) ?*RSA;
pub extern fn RSA_free(rsa: ?*RSA) void;
pub extern fn RSA_up_ref(rsa: ?*RSA) c_int;
pub extern fn RSA_bits(rsa: ?*const RSA) c_uint;
pub extern fn RSA_get0_n(rsa: ?*const RSA) [*c]const BIGNUM;
pub extern fn RSA_get0_e(rsa: ?*const RSA) [*c]const BIGNUM;
pub extern fn RSA_get0_d(rsa: ?*const RSA) [*c]const BIGNUM;
pub extern fn RSA_get0_p(rsa: ?*const RSA) [*c]const BIGNUM;
pub extern fn RSA_get0_q(rsa: ?*const RSA) [*c]const BIGNUM;
pub extern fn RSA_get0_dmp1(rsa: ?*const RSA) [*c]const BIGNUM;
pub extern fn RSA_get0_dmq1(rsa: ?*const RSA) [*c]const BIGNUM;
pub extern fn RSA_get0_iqmp(rsa: ?*const RSA) [*c]const BIGNUM;
pub extern fn RSA_get0_key(rsa: ?*const RSA, out_n: [*c][*c]const BIGNUM, out_e: [*c][*c]const BIGNUM, out_d: [*c][*c]const BIGNUM) void;
pub extern fn RSA_get0_factors(rsa: ?*const RSA, out_p: [*c][*c]const BIGNUM, out_q: [*c][*c]const BIGNUM) void;
pub extern fn RSA_get0_crt_params(rsa: ?*const RSA, out_dmp1: [*c][*c]const BIGNUM, out_dmq1: [*c][*c]const BIGNUM, out_iqmp: [*c][*c]const BIGNUM) void;
pub extern fn RSA_set0_key(rsa: ?*RSA, n: [*c]BIGNUM, e: [*c]BIGNUM, d: [*c]BIGNUM) c_int;
pub extern fn RSA_set0_factors(rsa: ?*RSA, p: [*c]BIGNUM, q: [*c]BIGNUM) c_int;
pub extern fn RSA_set0_crt_params(rsa: ?*RSA, dmp1: [*c]BIGNUM, dmq1: [*c]BIGNUM, iqmp: [*c]BIGNUM) c_int;
pub extern fn RSA_generate_key_ex(rsa: ?*RSA, bits: c_int, e: [*c]const BIGNUM, cb: [*c]BN_GENCB) c_int;
pub extern fn RSA_generate_key_fips(rsa: ?*RSA, bits: c_int, cb: [*c]BN_GENCB) c_int;
pub extern fn RSA_encrypt(rsa: ?*RSA, out_len: [*c]usize, out: [*c]u8, max_out: usize, in: [*c]const u8, in_len: usize, padding: c_int) c_int;
pub extern fn RSA_decrypt(rsa: ?*RSA, out_len: [*c]usize, out: [*c]u8, max_out: usize, in: [*c]const u8, in_len: usize, padding: c_int) c_int;
pub extern fn RSA_public_encrypt(flen: usize, from: [*c]const u8, to: [*c]u8, rsa: ?*RSA, padding: c_int) c_int;
pub extern fn RSA_private_decrypt(flen: usize, from: [*c]const u8, to: [*c]u8, rsa: ?*RSA, padding: c_int) c_int;
pub extern fn RSA_sign(hash_nid: c_int, digest: [*c]const u8, digest_len: usize, out: [*c]u8, out_len: [*c]c_uint, rsa: ?*RSA) c_int;
pub extern fn RSA_sign_pss_mgf1(rsa: ?*RSA, out_len: [*c]usize, out: [*c]u8, max_out: usize, digest: [*c]const u8, digest_len: usize, md: ?*const EVP_MD, mgf1_md: ?*const EVP_MD, salt_len: c_int) c_int;
pub extern fn RSA_sign_raw(rsa: ?*RSA, out_len: [*c]usize, out: [*c]u8, max_out: usize, in: [*c]const u8, in_len: usize, padding: c_int) c_int;
pub extern fn RSA_verify(hash_nid: c_int, digest: [*c]const u8, digest_len: usize, sig: [*c]const u8, sig_len: usize, rsa: ?*RSA) c_int;
pub extern fn RSA_verify_pss_mgf1(rsa: ?*RSA, digest: [*c]const u8, digest_len: usize, md: ?*const EVP_MD, mgf1_md: ?*const EVP_MD, salt_len: c_int, sig: [*c]const u8, sig_len: usize) c_int;
pub extern fn RSA_verify_raw(rsa: ?*RSA, out_len: [*c]usize, out: [*c]u8, max_out: usize, in: [*c]const u8, in_len: usize, padding: c_int) c_int;
pub extern fn RSA_private_encrypt(flen: usize, from: [*c]const u8, to: [*c]u8, rsa: ?*RSA, padding: c_int) c_int;
pub extern fn RSA_public_decrypt(flen: usize, from: [*c]const u8, to: [*c]u8, rsa: ?*RSA, padding: c_int) c_int;
pub extern fn RSA_size(rsa: ?*const RSA) c_uint;
pub extern fn RSA_is_opaque(rsa: ?*const RSA) c_int;
pub extern fn RSAPublicKey_dup(rsa: ?*const RSA) ?*RSA;
pub extern fn RSAPrivateKey_dup(rsa: ?*const RSA) ?*RSA;
pub extern fn RSA_check_key(rsa: ?*const RSA) c_int;
pub extern fn RSA_check_fips(key: ?*RSA) c_int;
pub extern fn RSA_verify_PKCS1_PSS_mgf1(rsa: ?*const RSA, mHash: [*c]const u8, Hash: ?*const EVP_MD, mgf1Hash: ?*const EVP_MD, EM: [*c]const u8, sLen: c_int) c_int;
pub extern fn RSA_padding_add_PKCS1_PSS_mgf1(rsa: ?*const RSA, EM: [*c]u8, mHash: [*c]const u8, Hash: ?*const EVP_MD, mgf1Hash: ?*const EVP_MD, sLen: c_int) c_int;
pub extern fn RSA_padding_add_PKCS1_OAEP_mgf1(to: [*c]u8, to_len: usize, from: [*c]const u8, from_len: usize, param: [*c]const u8, param_len: usize, md: ?*const EVP_MD, mgf1md: ?*const EVP_MD) c_int;
pub extern fn RSA_add_pkcs1_prefix(out_msg: [*c][*c]u8, out_msg_len: [*c]usize, is_alloced: [*c]c_int, hash_nid: c_int, digest: [*c]const u8, digest_len: usize) c_int;
pub extern fn RSA_parse_public_key(cbs: [*c]CBS) ?*RSA;
pub extern fn RSA_public_key_from_bytes(in: [*c]const u8, in_len: usize) ?*RSA;
pub extern fn RSA_marshal_public_key(cbb: ?*CBB, rsa: ?*const RSA) c_int;
pub extern fn RSA_public_key_to_bytes(out_bytes: [*c][*c]u8, out_len: [*c]usize, rsa: ?*const RSA) c_int;
pub extern fn RSA_parse_private_key(cbs: [*c]CBS) ?*RSA;
pub extern fn RSA_private_key_from_bytes(in: [*c]const u8, in_len: usize) ?*RSA;
pub extern fn RSA_marshal_private_key(cbb: ?*CBB, rsa: ?*const RSA) c_int;
pub extern fn RSA_private_key_to_bytes(out_bytes: [*c][*c]u8, out_len: [*c]usize, rsa: ?*const RSA) c_int;
pub extern fn RSA_get_ex_new_index(argl: c_long, argp: ?*anyopaque, unused: [*c]CRYPTO_EX_unused, dup_unused: ?*const CRYPTO_EX_dup, free_func: ?*const CRYPTO_EX_free) c_int;
pub extern fn RSA_set_ex_data(rsa: ?*RSA, idx: c_int, arg: ?*anyopaque) c_int;
pub extern fn RSA_get_ex_data(rsa: ?*const RSA, idx: c_int) ?*anyopaque;
pub extern fn RSA_flags(rsa: ?*const RSA) c_int;
pub extern fn RSA_test_flags(rsa: ?*const RSA, flags: c_int) c_int;
pub extern fn RSA_blinding_on(rsa: ?*RSA, ctx: ?*BN_CTX) c_int;
pub extern fn RSA_generate_key(bits: c_int, e: u64, callback: ?*anyopaque, cb_arg: ?*anyopaque) ?*RSA;
pub extern fn d2i_RSAPublicKey(out: [*c]?*RSA, inp: [*c][*c]const u8, len: c_long) ?*RSA;
pub extern fn i2d_RSAPublicKey(in: ?*const RSA, outp: [*c][*c]u8) c_int;
pub extern fn d2i_RSAPrivateKey(out: [*c]?*RSA, inp: [*c][*c]const u8, len: c_long) ?*RSA;
pub extern fn i2d_RSAPrivateKey(in: ?*const RSA, outp: [*c][*c]u8) c_int;
pub extern fn RSA_padding_add_PKCS1_PSS(rsa: ?*const RSA, EM: [*c]u8, mHash: [*c]const u8, Hash: ?*const EVP_MD, sLen: c_int) c_int;
pub extern fn RSA_verify_PKCS1_PSS(rsa: ?*const RSA, mHash: [*c]const u8, Hash: ?*const EVP_MD, EM: [*c]const u8, sLen: c_int) c_int;
pub extern fn RSA_padding_add_PKCS1_OAEP(to: [*c]u8, to_len: usize, from: [*c]const u8, from_len: usize, param: [*c]const u8, param_len: usize) c_int;
pub extern fn RSA_print(bio: [*c]BIO, rsa: ?*const RSA, indent: c_int) c_int;
pub extern fn RSA_get0_pss_params(rsa: ?*const RSA) [*c]const RSA_PSS_PARAMS;
pub extern fn SHA1_Init(sha: [*c]SHA_CTX) c_int;
pub extern fn SHA1_Update(sha: [*c]SHA_CTX, data: ?*const anyopaque, len: usize) c_int;
pub extern fn SHA1_Final(out: [*c]u8, sha: [*c]SHA_CTX) c_int;
pub extern fn SHA1(data: [*c]const u8, len: usize, out: [*c]u8) [*c]u8;
pub extern fn SHA1_Transform(sha: [*c]SHA_CTX, block: [*c]const u8) void;
pub extern fn SHA224_Init(sha: [*c]SHA256_CTX) c_int;
pub extern fn SHA224_Update(sha: [*c]SHA256_CTX, data: ?*const anyopaque, len: usize) c_int;
pub extern fn SHA224_Final(out: [*c]u8, sha: [*c]SHA256_CTX) c_int;
pub extern fn SHA224(data: [*c]const u8, len: usize, out: [*c]u8) [*c]u8;
pub extern fn SHA256_Init(sha: [*c]SHA256_CTX) c_int;
pub extern fn SHA256_Update(sha: [*c]SHA256_CTX, data: ?*const anyopaque, len: usize) c_int;
pub extern fn SHA256_Final(out: [*c]u8, sha: [*c]SHA256_CTX) c_int;
pub extern fn SHA256(data: [*c]const u8, len: usize, out: [*c]u8) [*c]u8;
pub extern fn SHA256_Transform(sha: [*c]SHA256_CTX, block: [*c]const u8) void;
pub extern fn SHA256_TransformBlocks(state: [*c]u32, data: [*c]const u8, num_blocks: usize) void;
pub extern fn SHA384_Init(sha: [*c]SHA512_CTX) c_int;
pub extern fn SHA384_Update(sha: [*c]SHA512_CTX, data: ?*const anyopaque, len: usize) c_int;
pub extern fn SHA384_Final(out: [*c]u8, sha: [*c]SHA512_CTX) c_int;
pub extern fn SHA384(data: [*c]const u8, len: usize, out: [*c]u8) [*c]u8;
pub extern fn SHA512_Init(sha: [*c]SHA512_CTX) c_int;
pub extern fn SHA512_Update(sha: [*c]SHA512_CTX, data: ?*const anyopaque, len: usize) c_int;
pub extern fn SHA512_Final(out: [*c]u8, sha: [*c]SHA512_CTX) c_int;
pub extern fn SHA512(data: [*c]const u8, len: usize, out: [*c]u8) [*c]u8;
pub extern fn SHA512_Transform(sha: [*c]SHA512_CTX, block: [*c]const u8) void;
pub extern fn SHA512_256_Init(sha: [*c]SHA512_CTX) c_int;
pub extern fn SHA512_256_Update(sha: [*c]SHA512_CTX, data: ?*const anyopaque, len: usize) c_int;
pub extern fn SHA512_256_Final(out: [*c]u8, sha: [*c]SHA512_CTX) c_int;
pub extern fn SHA512_256(data: [*c]const u8, len: usize, out: [*c]u8) [*c]u8;
pub const sk_X509_free_func = ?*const fn (?*X509) callconv(.C) void;
pub const sk_X509_copy_func = ?*const fn (?*X509) callconv(.C) ?*X509;
pub const sk_X509_cmp_func = ?*const fn ([*c]?*const X509, [*c]?*const X509) callconv(.C) c_int;
pub fn sk_X509_call_free_func(arg_free_func: OPENSSL_sk_free_func, arg_ptr: ?*anyopaque) callconv(.C) void {
    const free_func = arg_free_func;
    const ptr = arg_ptr;
    @as(sk_X509_free_func, @ptrCast(@alignCast(free_func))).?(@as(?*X509, @ptrCast(ptr)));
}
pub fn sk_X509_call_copy_func(arg_copy_func: OPENSSL_sk_copy_func, arg_ptr: ?*anyopaque) callconv(.C) ?*anyopaque {
    const copy_func = arg_copy_func;
    const ptr = arg_ptr;
    return @as(?*anyopaque, @ptrCast(@as(sk_X509_copy_func, @ptrCast(@alignCast(copy_func))).?(@as(?*X509, @ptrCast(ptr)))));
}
pub fn sk_X509_call_cmp_func(arg_cmp_func: OPENSSL_sk_cmp_func, arg_a: [*c]const ?*const anyopaque, arg_b: [*c]const ?*const anyopaque) callconv(.C) c_int {
    const cmp_func = arg_cmp_func;
    const a = arg_a;
    const b = arg_b;
    var a_ptr: ?*const X509 = @as(?*const X509, @ptrCast(a.*));
    var b_ptr: ?*const X509 = @as(?*const X509, @ptrCast(b.*));
    return @as(sk_X509_cmp_func, @ptrCast(@alignCast(cmp_func))).?(&a_ptr, &b_ptr);
}
pub fn sk_X509_new(arg_comp: sk_X509_cmp_func) callconv(.C) ?*struct_stack_st_X509 {
    const comp = arg_comp;
    return @as(?*struct_stack_st_X509, @ptrCast(sk_new(@as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp))))));
}
pub fn sk_X509_new_null() callconv(.C) ?*struct_stack_st_X509 {
    return @as(?*struct_stack_st_X509, @ptrCast(sk_new_null()));
}
pub fn sk_X509_num(arg_sk: ?*const struct_stack_st_X509) callconv(.C) usize {
    const sk = arg_sk;
    return sk_num(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_zero(arg_sk: ?*struct_stack_st_X509) callconv(.C) void {
    const sk = arg_sk;
    sk_zero(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_value(arg_sk: ?*const struct_stack_st_X509, arg_i: usize) callconv(.C) ?*X509 {
    const sk = arg_sk;
    const i = arg_i;
    return @as(?*X509, @ptrCast(sk_value(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), i)));
}
pub fn sk_X509_set(arg_sk: ?*struct_stack_st_X509, arg_i: usize, arg_p: ?*X509) callconv(.C) ?*X509 {
    const sk = arg_sk;
    const i = arg_i;
    const p = arg_p;
    return @as(?*X509, @ptrCast(sk_set(@as([*c]_STACK, @ptrCast(@alignCast(sk))), i, @as(?*anyopaque, @ptrCast(p)))));
}
pub fn sk_X509_free(arg_sk: ?*struct_stack_st_X509) callconv(.C) void {
    const sk = arg_sk;
    sk_free(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_pop_free(arg_sk: ?*struct_stack_st_X509, arg_free_func: sk_X509_free_func) callconv(.C) void {
    const sk = arg_sk;
    const free_func = arg_free_func;
    sk_pop_free_ex(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_X509_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))));
}
pub fn sk_X509_insert(arg_sk: ?*struct_stack_st_X509, arg_p: ?*X509, arg_where: usize) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    const where = arg_where;
    return sk_insert(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)), where);
}
pub fn sk_X509_delete(arg_sk: ?*struct_stack_st_X509, arg_where: usize) callconv(.C) ?*X509 {
    const sk = arg_sk;
    const where = arg_where;
    return @as(?*X509, @ptrCast(sk_delete(@as([*c]_STACK, @ptrCast(@alignCast(sk))), where)));
}
pub fn sk_X509_delete_ptr(arg_sk: ?*struct_stack_st_X509, arg_p: ?*const X509) callconv(.C) ?*X509 {
    const sk = arg_sk;
    const p = arg_p;
    return @as(?*X509, @ptrCast(sk_delete_ptr(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*const anyopaque, @ptrCast(p)))));
}
pub fn sk_X509_find(arg_sk: ?*const struct_stack_st_X509, arg_out_index: [*c]usize, arg_p: ?*const X509) callconv(.C) c_int {
    const sk = arg_sk;
    const out_index = arg_out_index;
    const p = arg_p;
    return sk_find(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), out_index, @as(?*const anyopaque, @ptrCast(p)), &sk_X509_call_cmp_func);
}
pub fn sk_X509_shift(arg_sk: ?*struct_stack_st_X509) callconv(.C) ?*X509 {
    const sk = arg_sk;
    return @as(?*X509, @ptrCast(sk_shift(@as([*c]_STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_push(arg_sk: ?*struct_stack_st_X509, arg_p: ?*X509) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    return sk_push(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)));
}
pub fn sk_X509_pop(arg_sk: ?*struct_stack_st_X509) callconv(.C) ?*X509 {
    const sk = arg_sk;
    return @as(?*X509, @ptrCast(sk_pop(@as([*c]_STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_dup(arg_sk: ?*const struct_stack_st_X509) callconv(.C) ?*struct_stack_st_X509 {
    const sk = arg_sk;
    return @as(?*struct_stack_st_X509, @ptrCast(sk_dup(@as([*c]const _STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_sort(arg_sk: ?*struct_stack_st_X509) callconv(.C) void {
    const sk = arg_sk;
    sk_sort(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_X509_call_cmp_func);
}
pub fn sk_X509_is_sorted(arg_sk: ?*const struct_stack_st_X509) callconv(.C) c_int {
    const sk = arg_sk;
    return sk_is_sorted(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_set_cmp_func(arg_sk: ?*struct_stack_st_X509, arg_comp: sk_X509_cmp_func) callconv(.C) sk_X509_cmp_func {
    const sk = arg_sk;
    const comp = arg_comp;
    return @as(sk_X509_cmp_func, @ptrCast(@alignCast(sk_set_cmp_func(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp)))))));
}
pub fn sk_X509_deep_copy(arg_sk: ?*const struct_stack_st_X509, arg_copy_func: sk_X509_copy_func, arg_free_func: sk_X509_free_func) callconv(.C) ?*struct_stack_st_X509 {
    const sk = arg_sk;
    const copy_func = arg_copy_func;
    const free_func = arg_free_func;
    return @as(?*struct_stack_st_X509, @ptrCast(sk_deep_copy(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), &sk_X509_call_copy_func, @as(OPENSSL_sk_copy_func, @ptrCast(@alignCast(copy_func))), &sk_X509_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))))));
}
pub const stack_free_func = ?*const fn (?*anyopaque) callconv(.C) void;
pub const stack_copy_func = ?*const fn (?*anyopaque) callconv(.C) ?*anyopaque;
pub const stack_cmp_func = ?*const fn ([*c]?*const anyopaque, [*c]?*const anyopaque) callconv(.C) c_int;
pub extern const X509_it: ASN1_ITEM;
pub extern fn X509_up_ref(x509: ?*X509) c_int;
pub extern fn X509_chain_up_ref(chain: ?*struct_stack_st_X509) ?*struct_stack_st_X509;
pub extern fn X509_dup(x509: ?*X509) ?*X509;
pub extern fn X509_free(x509: ?*X509) void;
pub extern fn d2i_X509(out: [*c]?*X509, inp: *[*]const u8, len: c_long) ?*X509;
pub extern fn X509_parse_from_buffer(buf: ?*CRYPTO_BUFFER) ?*X509;
pub extern fn i2d_X509(x509: ?*X509, outp: ?*[*]u8) c_int;
pub extern fn X509_get_version(x509: ?*const X509) c_long;
pub extern fn X509_get0_serialNumber(x509: ?*const X509) [*c]const ASN1_INTEGER;
pub extern fn X509_get0_notBefore(x509: ?*const X509) [*c]const ASN1_TIME;
pub extern fn X509_get0_notAfter(x509: ?*const X509) [*c]const ASN1_TIME;
pub extern fn X509_get_issuer_name(x509: ?*const X509) ?*X509_NAME;
pub extern fn X509_get_subject_name(x509: ?*const X509) ?*X509_NAME;
pub extern fn X509_get_X509_PUBKEY(x509: ?*const X509) ?*X509_PUBKEY;
pub extern fn X509_get_pubkey(x509: ?*X509) [*c]EVP_PKEY;
pub extern fn X509_get0_pubkey_bitstr(x509: ?*const X509) [*c]ASN1_BIT_STRING;
pub extern fn X509_get0_uids(x509: ?*const X509, out_issuer_uid: [*c][*c]const ASN1_BIT_STRING, out_subject_uid: [*c][*c]const ASN1_BIT_STRING) void;
pub const struct_stack_st_X509_EXTENSION = opaque {};
pub extern fn X509_get0_extensions(x509: ?*const X509) ?*const struct_stack_st_X509_EXTENSION;
pub extern fn X509_get_ext_count(x: ?*const X509) c_int;
pub extern fn X509_get_ext_by_NID(x: ?*const X509, nid: c_int, lastpos: c_int) c_int;
pub extern fn X509_get_ext_by_OBJ(x: ?*const X509, obj: ?*const ASN1_OBJECT, lastpos: c_int) c_int;
pub extern fn X509_get_ext_by_critical(x: ?*const X509, crit: c_int, lastpos: c_int) c_int;
pub extern fn X509_get_ext(x: ?*const X509, loc: c_int) ?*X509_EXTENSION;
pub extern fn X509_get0_tbs_sigalg(x509: ?*const X509) [*c]const X509_ALGOR;
pub extern fn X509_get0_signature(out_sig: [*c][*c]const ASN1_BIT_STRING, out_alg: [*c][*c]const X509_ALGOR, x509: ?*const X509) void;
pub extern fn X509_get_signature_nid(x509: ?*const X509) c_int;
pub extern fn i2d_X509_tbs(x509: ?*X509, outp: [*c][*c]u8) c_int;
pub extern fn X509_new() ?*X509;
pub extern fn X509_set_version(x509: ?*X509, version: c_long) c_int;
pub extern fn X509_set_serialNumber(x509: ?*X509, serial: [*c]const ASN1_INTEGER) c_int;
pub extern fn X509_set1_notBefore(x509: ?*X509, tm: [*c]const ASN1_TIME) c_int;
pub extern fn X509_set1_notAfter(x509: ?*X509, tm: [*c]const ASN1_TIME) c_int;
pub extern fn X509_getm_notBefore(x509: ?*X509) [*c]ASN1_TIME;
pub extern fn X509_getm_notAfter(x: ?*X509) [*c]ASN1_TIME;
pub extern fn X509_set_issuer_name(x509: ?*X509, name: ?*X509_NAME) c_int;
pub extern fn X509_set_subject_name(x509: ?*X509, name: ?*X509_NAME) c_int;
pub extern fn X509_set_pubkey(x509: ?*X509, pkey: [*c]EVP_PKEY) c_int;
pub extern fn X509_delete_ext(x: ?*X509, loc: c_int) ?*X509_EXTENSION;
pub extern fn X509_add_ext(x: ?*X509, ex: ?*const X509_EXTENSION, loc: c_int) c_int;
pub extern fn X509_sign(x509: ?*X509, pkey: [*c]EVP_PKEY, md: ?*const EVP_MD) c_int;
pub extern fn X509_sign_ctx(x509: ?*X509, ctx: [*c]EVP_MD_CTX) c_int;
pub extern fn i2d_re_X509_tbs(x509: ?*X509, outp: [*c][*c]u8) c_int;
pub extern fn X509_set1_signature_algo(x509: ?*X509, algo: [*c]const X509_ALGOR) c_int;
pub extern fn X509_set1_signature_value(x509: ?*X509, sig: [*c]const u8, sig_len: usize) c_int;
pub extern fn i2d_X509_AUX(x509: ?*X509, outp: [*c][*c]u8) c_int;
pub extern fn d2i_X509_AUX(x509: [*c]?*X509, inp: [*c][*c]const u8, length: c_long) ?*X509;
pub extern fn X509_alias_set1(x509: ?*X509, name: [*c]const u8, len: c_int) c_int;
pub extern fn X509_keyid_set1(x509: ?*X509, id: [*c]const u8, len: c_int) c_int;
pub extern fn X509_alias_get0(x509: ?*X509, out_len: [*c]c_int) [*c]u8;
pub extern fn X509_keyid_get0(x509: ?*X509, out_len: [*c]c_int) [*c]u8;
pub const sk_X509_CRL_free_func = ?*const fn (?*X509_CRL) callconv(.C) void;
pub const sk_X509_CRL_copy_func = ?*const fn (?*X509_CRL) callconv(.C) ?*X509_CRL;
pub const sk_X509_CRL_cmp_func = ?*const fn ([*c]?*const X509_CRL, [*c]?*const X509_CRL) callconv(.C) c_int;
pub fn sk_X509_CRL_call_free_func(arg_free_func: OPENSSL_sk_free_func, arg_ptr: ?*anyopaque) callconv(.C) void {
    const free_func = arg_free_func;
    const ptr = arg_ptr;
    @as(sk_X509_CRL_free_func, @ptrCast(@alignCast(free_func))).?(@as(?*X509_CRL, @ptrCast(ptr)));
}
pub extern fn X509V3_EXT_d2i(ex: ?*X509_EXTENSION) ?*anyopaque;
pub extern fn X509V3_EXT_get(ex: ?*X509_EXTENSION) ?*X509V3_EXT_METHOD;
pub const X509V3_EXT_METHOD = opaque {};
pub extern fn X509V3_EXT_get_nid(ndi: c_int) ?*X509V3_EXT_METHOD;
pub fn sk_X509_CRL_call_cmp_func(arg_cmp_func: OPENSSL_sk_cmp_func, arg_a: [*c]const ?*const anyopaque, arg_b: [*c]const ?*const anyopaque) callconv(.C) c_int {
    const cmp_func = arg_cmp_func;
    const a = arg_a;
    const b = arg_b;
    var a_ptr: ?*const X509_CRL = @as(?*const X509_CRL, @ptrCast(a.*));
    var b_ptr: ?*const X509_CRL = @as(?*const X509_CRL, @ptrCast(b.*));
    return @as(sk_X509_CRL_cmp_func, @ptrCast(@alignCast(cmp_func))).?(&a_ptr, &b_ptr);
}
pub const struct_stack_st_X509_REVOKED = opaque {};
pub const stack_X509_REVOKED_free_func = ?*const fn ([*c]X509_REVOKED) callconv(.C) void;
pub const stack_X509_REVOKED_copy_func = ?*const fn ([*c]X509_REVOKED) callconv(.C) [*c]X509_REVOKED;
pub const stack_X509_REVOKED_cmp_func = ?*const fn ([*c][*c]const X509_REVOKED, [*c][*c]const X509_REVOKED) callconv(.C) c_int;
pub const struct_stack_st_GENERAL_NAMES = opaque {};
pub const struct_stack_st_ACCESS_DESCRIPTION = opaque {};

pub const OTHERNAME = extern struct {
    type_id: ?*ASN1_OBJECT,
    value: ?*ASN1_TYPE,
};

pub const GENERAL_NAME = extern struct {
    name_type: enum(c_int) {
        GEN_OTHERNAME = 0,
        GEN_EMAIL = 1,
        GEN_DNS = 2,
        GEN_X400 = 3,
        GEN_DIRNAME = 4,
        GEN_EDIPARTY = 5,
        GEN_URI = 6,
        GEN_IPADD = 7,
        GEN_RID = 8,
    },
    d: extern union {
        ptr: *c_char,
        otherName: *OTHERNAME,
        rfc822Name: *ASN1_IA5STRING,
        dNSName: *ASN1_IA5STRING,
        x400Address: *ASN1_STRING,
        directoryName: *X509_NAME,
        //EDIPARTYNAME
        ediPartyName: *anyopaque,
        uniformResourceIdentifier: *ASN1_IA5STRING,
        iPAddress: *ASN1_OCTET_STRING,
        registeredID: *ASN1_OBJECT,
        ip: *ASN1_OCTET_STRING,
        dirn: *X509_NAME,
        ia5: *ASN1_IA5STRING,
        rid: *ASN1_OBJECT,
        other: *ASN1_TYPE,
    },
};

pub const ACCESS_DESCRIPTION = extern struct {
    method: *ASN1_OBJECT,
    location: *GENERAL_NAME,
};

pub fn sk_GENERAL_NAME_num(arg_sk: ?*const struct_stack_st_GENERAL_NAME) callconv(.C) usize {
    const sk = arg_sk;
    return sk_num(@as([*c]const _STACK, @alignCast(@ptrCast(sk))));
}
pub fn sk_GENERAL_NAME_free(arg_sk: ?*struct_stack_st_GENERAL_NAME) callconv(.C) void {
    const sk = arg_sk;
    sk_free(@as([*c]_STACK, @alignCast(@ptrCast(sk))));
}
pub const stack_GENERAL_NAME_free_func = ?*const fn (?*struct_stack_st_GENERAL_NAME) callconv(.C) void;

pub fn sk_GENERAL_NAME_call_free_func(arg_free_func: stack_free_func, arg_ptr: ?*anyopaque) callconv(.C) void {
    const free_func = arg_free_func;
    const ptr = arg_ptr;
    @as(stack_GENERAL_NAME_free_func, @ptrCast(@alignCast(free_func))).?(@as(?*struct_stack_st_GENERAL_NAME, @ptrCast(ptr)));
}
pub fn sk_GENERAL_NAME_pop_free(arg_sk: ?*struct_stack_st_GENERAL_NAME, arg_free_func: stack_GENERAL_NAME_free_func) callconv(.C) void {
    const sk = arg_sk;
    const free_func = arg_free_func;
    sk_pop_free_ex(@as([*c]_STACK, @alignCast(@ptrCast(sk))), sk_GENERAL_NAME_call_free_func, @as(stack_free_func, @ptrCast(free_func)));
}
pub fn sk_GENERAL_NAME_value(arg_sk: ?*const struct_stack_st_GENERAL_NAME, arg_i: usize) callconv(.C) ?*GENERAL_NAME {
    const sk = arg_sk;
    const i = arg_i;
    return @alignCast(@ptrCast(sk_value(@as([*c]const _STACK, @alignCast(@ptrCast(sk))), i)));
}

pub fn sk_ACCESS_DESCRIPTION_num(arg_sk: ?*const AUTHORITY_INFO_ACCESS) callconv(.C) usize {
    const sk = arg_sk;
    return sk_num(@as([*c]const _STACK, @alignCast(@ptrCast(sk))));
}
pub fn sk_ACCESS_DESCRIPTION_free(arg_sk: ?*AUTHORITY_INFO_ACCESS) callconv(.C) void {
    const sk = arg_sk;
    sk_free(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub const stack_ACCESS_DESCRIPTION_free_func = ?*const fn (?*AUTHORITY_INFO_ACCESS) callconv(.C) void;

pub fn sk_ACCESS_DESCRIPTION_call_free_func(arg_free_func: stack_free_func, arg_ptr: ?*anyopaque) callconv(.C) void {
    const free_func = arg_free_func;
    const ptr = arg_ptr;
    @as(stack_ACCESS_DESCRIPTION_free_func, @ptrCast(free_func)).?(@as(?*AUTHORITY_INFO_ACCESS, @ptrCast(ptr)));
}
pub fn sk_ACCESS_DESCRIPTION_pop_free(arg_sk: ?*AUTHORITY_INFO_ACCESS, arg_free_func: stack_ACCESS_DESCRIPTION_free_func) callconv(.C) void {
    const sk = arg_sk;
    const free_func = arg_free_func;
    sk_pop_free_ex(@as([*c]_STACK, @alignCast(@ptrCast(sk))), sk_ACCESS_DESCRIPTION_call_free_func, @as(stack_free_func, @ptrCast(free_func)));
}
pub extern fn X509_get_serialNumber(x509: ?*X509) [*c]ASN1_INTEGER;
pub fn sk_ACCESS_DESCRIPTION_value(arg_sk: ?*const AUTHORITY_INFO_ACCESS, arg_i: usize) callconv(.C) ?*ACCESS_DESCRIPTION {
    const sk = arg_sk;
    const i = arg_i;
    return @alignCast(@ptrCast(sk_value(@as([*c]const _STACK, @alignCast(@ptrCast(sk))), i)));
}
pub const NID_id_on_SmtpUTF8Mailbox = @as(c_int, 1208);
pub const NID_XmppAddr = @as(c_int, 1209);
pub const NID_SRVName = @as(c_int, 1210);
pub const NID_NAIRealm = @as(c_int, 1211);

pub const stack_X509_CRL_free_func = ?*const fn (?*X509_CRL) callconv(.C) void;
pub const stack_X509_CRL_copy_func = ?*const fn (?*X509_CRL) callconv(.C) ?*X509_CRL;
pub const stack_X509_CRL_cmp_func = ?*const fn ([*c]?*const X509_CRL, [*c]?*const X509_CRL) callconv(.C) c_int;
pub fn sk_X509_CRL_call_copy_func(arg_copy_func: stack_copy_func, arg_ptr: ?*anyopaque) callconv(.C) ?*anyopaque {
    const copy_func = arg_copy_func;
    const ptr = arg_ptr;
    return @as(?*anyopaque, @ptrCast(@as(stack_X509_CRL_copy_func, @ptrCast(copy_func)).?(@as(?*X509_CRL, @ptrCast(ptr)))));
}
pub fn sk_X509_CRL_new(arg_comp: stack_X509_CRL_cmp_func) callconv(.C) ?*struct_stack_st_X509_CRL {
    const comp = arg_comp;
    return @as(?*struct_stack_st_X509_CRL, @ptrCast(sk_new(@as(stack_cmp_func, @ptrCast(comp)))));
}
pub fn sk_X509_CRL_new_null() callconv(.C) ?*struct_stack_st_X509_CRL {
    return @as(?*struct_stack_st_X509_CRL, @ptrCast(sk_new_null()));
}
pub fn sk_X509_CRL_num(arg_sk: ?*const struct_stack_st_X509_CRL) callconv(.C) usize {
    const sk = arg_sk;
    return sk_num(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_CRL_zero(arg_sk: ?*struct_stack_st_X509_CRL) callconv(.C) void {
    const sk = arg_sk;
    sk_zero(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_CRL_value(arg_sk: ?*const struct_stack_st_X509_CRL, arg_i: usize) callconv(.C) ?*X509_CRL {
    const sk = arg_sk;
    const i = arg_i;
    return @as(?*X509_CRL, @ptrCast(sk_value(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), i)));
}
pub fn sk_X509_CRL_set(arg_sk: ?*struct_stack_st_X509_CRL, arg_i: usize, arg_p: ?*X509_CRL) callconv(.C) ?*X509_CRL {
    const sk = arg_sk;
    const i = arg_i;
    const p = arg_p;
    return @as(?*X509_CRL, @ptrCast(sk_set(@as([*c]_STACK, @ptrCast(@alignCast(sk))), i, @as(?*anyopaque, @ptrCast(p)))));
}
pub fn sk_X509_CRL_free(arg_sk: ?*struct_stack_st_X509_CRL) callconv(.C) void {
    const sk = arg_sk;
    sk_free(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_CRL_pop_free(arg_sk: ?*struct_stack_st_X509_CRL, arg_free_func: sk_X509_CRL_free_func) callconv(.C) void {
    const sk = arg_sk;
    const free_func = arg_free_func;
    sk_pop_free_ex(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_X509_CRL_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))));
}
pub fn sk_X509_CRL_insert(arg_sk: ?*struct_stack_st_X509_CRL, arg_p: ?*X509_CRL, arg_where: usize) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    const where = arg_where;
    return sk_insert(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)), where);
}
pub fn sk_X509_CRL_delete(arg_sk: ?*struct_stack_st_X509_CRL, arg_where: usize) callconv(.C) ?*X509_CRL {
    const sk = arg_sk;
    const where = arg_where;
    return @as(?*X509_CRL, @ptrCast(sk_delete(@as([*c]_STACK, @ptrCast(@alignCast(sk))), where)));
}
pub fn sk_X509_CRL_delete_ptr(arg_sk: ?*struct_stack_st_X509_CRL, arg_p: ?*const X509_CRL) callconv(.C) ?*X509_CRL {
    const sk = arg_sk;
    const p = arg_p;
    return @as(?*X509_CRL, @ptrCast(sk_delete_ptr(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*const anyopaque, @ptrCast(p)))));
}
pub fn sk_X509_CRL_find(arg_sk: ?*const struct_stack_st_X509_CRL, arg_out_index: [*c]usize, arg_p: ?*const X509_CRL) callconv(.C) c_int {
    const sk = arg_sk;
    const out_index = arg_out_index;
    const p = arg_p;
    return sk_find(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), out_index, @as(?*const anyopaque, @ptrCast(p)), &sk_X509_CRL_call_cmp_func);
}
pub fn sk_X509_CRL_shift(arg_sk: ?*struct_stack_st_X509_CRL) callconv(.C) ?*X509_CRL {
    const sk = arg_sk;
    return @as(?*X509_CRL, @ptrCast(sk_shift(@as([*c]_STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_CRL_push(arg_sk: ?*struct_stack_st_X509_CRL, arg_p: ?*X509_CRL) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    return sk_push(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)));
}
pub fn sk_X509_CRL_pop(arg_sk: ?*struct_stack_st_X509_CRL) callconv(.C) ?*X509_CRL {
    const sk = arg_sk;
    return @as(?*X509_CRL, @ptrCast(sk_pop(@as([*c]_STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_CRL_dup(arg_sk: ?*const struct_stack_st_X509_CRL) callconv(.C) ?*struct_stack_st_X509_CRL {
    const sk = arg_sk;
    return @as(?*struct_stack_st_X509_CRL, @ptrCast(sk_dup(@as([*c]const _STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_CRL_sort(arg_sk: ?*struct_stack_st_X509_CRL) callconv(.C) void {
    const sk = arg_sk;
    sk_sort(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_X509_CRL_call_cmp_func);
}
pub fn sk_X509_CRL_is_sorted(arg_sk: ?*const struct_stack_st_X509_CRL) callconv(.C) c_int {
    const sk = arg_sk;
    return sk_is_sorted(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_CRL_set_cmp_func(arg_sk: ?*struct_stack_st_X509_CRL, arg_comp: sk_X509_CRL_cmp_func) callconv(.C) sk_X509_CRL_cmp_func {
    const sk = arg_sk;
    const comp = arg_comp;
    return @as(sk_X509_CRL_cmp_func, @ptrCast(@alignCast(sk_set_cmp_func(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp)))))));
}
pub fn sk_X509_CRL_deep_copy(arg_sk: ?*const struct_stack_st_X509_CRL, arg_copy_func: sk_X509_CRL_copy_func, arg_free_func: sk_X509_CRL_free_func) callconv(.C) ?*struct_stack_st_X509_CRL {
    const sk = arg_sk;
    const copy_func = arg_copy_func;
    const free_func = arg_free_func;
    return @as(?*struct_stack_st_X509_CRL, @ptrCast(sk_deep_copy(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), &sk_X509_CRL_call_copy_func, @as(OPENSSL_sk_copy_func, @ptrCast(@alignCast(copy_func))), &sk_X509_CRL_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))))));
}
pub extern const X509_CRL_it: ASN1_ITEM;
pub extern fn X509_CRL_up_ref(crl: ?*X509_CRL) c_int;
pub extern fn X509_CRL_dup(crl: ?*X509_CRL) ?*X509_CRL;
pub extern fn X509_CRL_free(crl: ?*X509_CRL) void;
pub extern fn d2i_X509_CRL(out: [*c]?*X509_CRL, inp: [*c][*c]const u8, len: c_long) ?*X509_CRL;
pub extern fn i2d_X509_CRL(crl: ?*X509_CRL, outp: [*c][*c]u8) c_int;
pub extern fn X509_CRL_get_version(crl: ?*const X509_CRL) c_long;
pub extern fn X509_CRL_get0_lastUpdate(crl: ?*const X509_CRL) [*c]const ASN1_TIME;
pub extern fn X509_CRL_get0_nextUpdate(crl: ?*const X509_CRL) [*c]const ASN1_TIME;
pub extern fn X509_CRL_get_issuer(crl: ?*const X509_CRL) ?*X509_NAME;
pub extern fn X509_CRL_get_REVOKED(crl: ?*X509_CRL) ?*struct_stack_st_X509_REVOKED;
pub extern fn X509_CRL_get0_extensions(crl: ?*const X509_CRL) ?*const struct_stack_st_X509_EXTENSION;
pub extern fn X509_CRL_get_ext_count(x: ?*const X509_CRL) c_int;
pub extern fn X509_CRL_get_ext_by_NID(x: ?*const X509_CRL, nid: c_int, lastpos: c_int) c_int;
pub extern fn X509_CRL_get_ext_by_OBJ(x: ?*const X509_CRL, obj: ?*const ASN1_OBJECT, lastpos: c_int) c_int;
pub extern fn X509_CRL_get_ext_by_critical(x: ?*const X509_CRL, crit: c_int, lastpos: c_int) c_int;
pub extern fn X509_CRL_get_ext(x: ?*const X509_CRL, loc: c_int) ?*X509_EXTENSION;
pub extern fn X509_CRL_get0_signature(crl: ?*const X509_CRL, out_sig: [*c][*c]const ASN1_BIT_STRING, out_alg: [*c][*c]const X509_ALGOR) void;
pub extern fn X509_CRL_get_signature_nid(crl: ?*const X509_CRL) c_int;
pub extern fn i2d_X509_CRL_tbs(crl: ?*X509_CRL, outp: [*c][*c]u8) c_int;
pub extern fn X509_CRL_new() ?*X509_CRL;
pub extern fn X509_CRL_set_version(crl: ?*X509_CRL, version: c_long) c_int;
pub extern fn X509_CRL_set_issuer_name(crl: ?*X509_CRL, name: ?*X509_NAME) c_int;
pub extern fn X509_CRL_set1_lastUpdate(crl: ?*X509_CRL, tm: [*c]const ASN1_TIME) c_int;
pub extern fn X509_CRL_set1_nextUpdate(crl: ?*X509_CRL, tm: [*c]const ASN1_TIME) c_int;
pub extern fn X509_CRL_delete_ext(x: ?*X509_CRL, loc: c_int) ?*X509_EXTENSION;
pub extern fn X509_CRL_add_ext(x: ?*X509_CRL, ex: ?*const X509_EXTENSION, loc: c_int) c_int;
pub extern fn X509_CRL_sign(crl: ?*X509_CRL, pkey: [*c]EVP_PKEY, md: ?*const EVP_MD) c_int;
pub extern fn X509_CRL_sign_ctx(crl: ?*X509_CRL, ctx: [*c]EVP_MD_CTX) c_int;
pub extern fn i2d_re_X509_CRL_tbs(crl: ?*X509_CRL, outp: [*c][*c]u8) c_int;
pub extern fn X509_CRL_set1_signature_algo(crl: ?*X509_CRL, algo: [*c]const X509_ALGOR) c_int;
pub extern fn X509_CRL_set1_signature_value(crl: ?*X509_CRL, sig: [*c]const u8, sig_len: usize) c_int;
pub extern const X509_REQ_it: ASN1_ITEM;
pub extern fn X509_REQ_dup(req: ?*X509_REQ) ?*X509_REQ;
pub extern fn X509_REQ_free(req: ?*X509_REQ) void;
pub extern fn d2i_X509_REQ(out: [*c]?*X509_REQ, inp: [*c][*c]const u8, len: c_long) ?*X509_REQ;
pub extern fn i2d_X509_REQ(req: ?*X509_REQ, outp: [*c][*c]u8) c_int;
pub extern fn X509_REQ_get_version(req: ?*const X509_REQ) c_long;
pub extern fn X509_REQ_get_subject_name(req: ?*const X509_REQ) ?*X509_NAME;
pub extern fn X509_REQ_get_pubkey(req: ?*X509_REQ) [*c]EVP_PKEY;
pub extern fn X509_REQ_get0_signature(req: ?*const X509_REQ, out_sig: [*c][*c]const ASN1_BIT_STRING, out_alg: [*c][*c]const X509_ALGOR) void;
pub extern fn X509_REQ_get_signature_nid(req: ?*const X509_REQ) c_int;
pub extern fn X509_REQ_new() ?*X509_REQ;
pub extern fn X509_REQ_set_version(req: ?*X509_REQ, version: c_long) c_int;
pub extern fn X509_REQ_set_subject_name(req: ?*X509_REQ, name: ?*X509_NAME) c_int;
pub extern fn X509_REQ_set_pubkey(req: ?*X509_REQ, pkey: [*c]EVP_PKEY) c_int;
pub extern fn X509_REQ_sign(req: ?*X509_REQ, pkey: [*c]EVP_PKEY, md: ?*const EVP_MD) c_int;
pub extern fn X509_REQ_sign_ctx(req: ?*X509_REQ, ctx: [*c]EVP_MD_CTX) c_int;
pub extern fn i2d_re_X509_REQ_tbs(req: ?*X509_REQ, outp: [*c][*c]u8) c_int;
pub extern fn X509_REQ_set1_signature_algo(req: ?*X509_REQ, algo: [*c]const X509_ALGOR) c_int;
pub extern fn X509_REQ_set1_signature_value(req: ?*X509_REQ, sig: [*c]const u8, sig_len: usize) c_int;
pub const struct_stack_st_X509_NAME_ENTRY = opaque {};
pub const sk_X509_NAME_ENTRY_free_func = ?*const fn (?*X509_NAME_ENTRY) callconv(.C) void;
pub const sk_X509_NAME_ENTRY_copy_func = ?*const fn (?*X509_NAME_ENTRY) callconv(.C) ?*X509_NAME_ENTRY;
pub const sk_X509_NAME_ENTRY_cmp_func = ?*const fn ([*c]?*const X509_NAME_ENTRY, [*c]?*const X509_NAME_ENTRY) callconv(.C) c_int;
pub fn sk_X509_NAME_ENTRY_call_free_func(arg_free_func: OPENSSL_sk_free_func, arg_ptr: ?*anyopaque) callconv(.C) void {
    const free_func = arg_free_func;
    const ptr = arg_ptr;
    @as(sk_X509_NAME_ENTRY_free_func, @ptrCast(@alignCast(free_func))).?(@as(?*X509_NAME_ENTRY, @ptrCast(ptr)));
}
pub fn sk_X509_NAME_ENTRY_call_copy_func(arg_copy_func: OPENSSL_sk_copy_func, arg_ptr: ?*anyopaque) callconv(.C) ?*anyopaque {
    const copy_func = arg_copy_func;
    const ptr = arg_ptr;
    return @as(?*anyopaque, @ptrCast(@as(sk_X509_NAME_ENTRY_copy_func, @ptrCast(@alignCast(copy_func))).?(@as(?*X509_NAME_ENTRY, @ptrCast(ptr)))));
}
pub fn sk_X509_NAME_ENTRY_call_cmp_func(arg_cmp_func: OPENSSL_sk_cmp_func, arg_a: [*c]const ?*const anyopaque, arg_b: [*c]const ?*const anyopaque) callconv(.C) c_int {
    const cmp_func = arg_cmp_func;
    const a = arg_a;
    const b = arg_b;
    var a_ptr: ?*const X509_NAME_ENTRY = @as(?*const X509_NAME_ENTRY, @ptrCast(a.*));
    var b_ptr: ?*const X509_NAME_ENTRY = @as(?*const X509_NAME_ENTRY, @ptrCast(b.*));
    return @as(sk_X509_NAME_ENTRY_cmp_func, @ptrCast(@alignCast(cmp_func))).?(&a_ptr, &b_ptr);
}
pub fn sk_X509_NAME_ENTRY_new(arg_comp: sk_X509_NAME_ENTRY_cmp_func) callconv(.C) ?*struct_stack_st_X509_NAME_ENTRY {
    const comp = arg_comp;
    return @as(?*struct_stack_st_X509_NAME_ENTRY, @ptrCast(sk_new(@as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp))))));
}
pub fn sk_X509_NAME_ENTRY_new_null() callconv(.C) ?*struct_stack_st_X509_NAME_ENTRY {
    return @as(?*struct_stack_st_X509_NAME_ENTRY, @ptrCast(sk_new_null()));
}
pub fn sk_X509_NAME_ENTRY_num(arg_sk: ?*const struct_stack_st_X509_NAME_ENTRY) callconv(.C) usize {
    const sk = arg_sk;
    return sk_num(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_NAME_ENTRY_zero(arg_sk: ?*struct_stack_st_X509_NAME_ENTRY) callconv(.C) void {
    const sk = arg_sk;
    sk_zero(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_NAME_ENTRY_value(arg_sk: ?*const struct_stack_st_X509_NAME_ENTRY, arg_i: usize) callconv(.C) ?*X509_NAME_ENTRY {
    const sk = arg_sk;
    const i = arg_i;
    return @as(?*X509_NAME_ENTRY, @ptrCast(sk_value(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), i)));
}
pub fn sk_X509_NAME_ENTRY_set(arg_sk: ?*struct_stack_st_X509_NAME_ENTRY, arg_i: usize, arg_p: ?*X509_NAME_ENTRY) callconv(.C) ?*X509_NAME_ENTRY {
    const sk = arg_sk;
    const i = arg_i;
    const p = arg_p;
    return @as(?*X509_NAME_ENTRY, @ptrCast(sk_set(@as([*c]_STACK, @ptrCast(@alignCast(sk))), i, @as(?*anyopaque, @ptrCast(p)))));
}
pub fn sk_X509_NAME_ENTRY_free(arg_sk: ?*struct_stack_st_X509_NAME_ENTRY) callconv(.C) void {
    const sk = arg_sk;
    sk_free(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_NAME_ENTRY_pop_free(arg_sk: ?*struct_stack_st_X509_NAME_ENTRY, arg_free_func: sk_X509_NAME_ENTRY_free_func) callconv(.C) void {
    const sk = arg_sk;
    const free_func = arg_free_func;
    sk_pop_free_ex(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_X509_NAME_ENTRY_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))));
}
pub fn sk_X509_NAME_ENTRY_insert(arg_sk: ?*struct_stack_st_X509_NAME_ENTRY, arg_p: ?*X509_NAME_ENTRY, arg_where: usize) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    const where = arg_where;
    return sk_insert(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)), where);
}
pub fn sk_X509_NAME_ENTRY_delete(arg_sk: ?*struct_stack_st_X509_NAME_ENTRY, arg_where: usize) callconv(.C) ?*X509_NAME_ENTRY {
    const sk = arg_sk;
    const where = arg_where;
    return @as(?*X509_NAME_ENTRY, @ptrCast(sk_delete(@as([*c]_STACK, @ptrCast(@alignCast(sk))), where)));
}
pub fn sk_X509_NAME_ENTRY_delete_ptr(arg_sk: ?*struct_stack_st_X509_NAME_ENTRY, arg_p: ?*const X509_NAME_ENTRY) callconv(.C) ?*X509_NAME_ENTRY {
    const sk = arg_sk;
    const p = arg_p;
    return @as(?*X509_NAME_ENTRY, @ptrCast(sk_delete_ptr(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*const anyopaque, @ptrCast(p)))));
}
pub fn sk_X509_NAME_ENTRY_find(arg_sk: ?*const struct_stack_st_X509_NAME_ENTRY, arg_out_index: [*c]usize, arg_p: ?*const X509_NAME_ENTRY) callconv(.C) c_int {
    const sk = arg_sk;
    const out_index = arg_out_index;
    const p = arg_p;
    return sk_find(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), out_index, @as(?*const anyopaque, @ptrCast(p)), &sk_X509_NAME_ENTRY_call_cmp_func);
}
pub fn sk_X509_NAME_ENTRY_shift(arg_sk: ?*struct_stack_st_X509_NAME_ENTRY) callconv(.C) ?*X509_NAME_ENTRY {
    const sk = arg_sk;
    return @as(?*X509_NAME_ENTRY, @ptrCast(sk_shift(@as([*c]_STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_NAME_ENTRY_push(arg_sk: ?*struct_stack_st_X509_NAME_ENTRY, arg_p: ?*X509_NAME_ENTRY) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    return sk_push(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)));
}
pub fn sk_X509_NAME_ENTRY_pop(arg_sk: ?*struct_stack_st_X509_NAME_ENTRY) callconv(.C) ?*X509_NAME_ENTRY {
    const sk = arg_sk;
    return @as(?*X509_NAME_ENTRY, @ptrCast(sk_pop(@as([*c]_STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_NAME_ENTRY_dup(arg_sk: ?*const struct_stack_st_X509_NAME_ENTRY) callconv(.C) ?*struct_stack_st_X509_NAME_ENTRY {
    const sk = arg_sk;
    return @as(?*struct_stack_st_X509_NAME_ENTRY, @ptrCast(sk_dup(@as([*c]const _STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_NAME_ENTRY_sort(arg_sk: ?*struct_stack_st_X509_NAME_ENTRY) callconv(.C) void {
    const sk = arg_sk;
    sk_sort(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_X509_NAME_ENTRY_call_cmp_func);
}
pub fn sk_X509_NAME_ENTRY_is_sorted(arg_sk: ?*const struct_stack_st_X509_NAME_ENTRY) callconv(.C) c_int {
    const sk = arg_sk;
    return sk_is_sorted(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_NAME_ENTRY_set_cmp_func(arg_sk: ?*struct_stack_st_X509_NAME_ENTRY, arg_comp: sk_X509_NAME_ENTRY_cmp_func) callconv(.C) sk_X509_NAME_ENTRY_cmp_func {
    const sk = arg_sk;
    const comp = arg_comp;
    return @as(sk_X509_NAME_ENTRY_cmp_func, @ptrCast(@alignCast(sk_set_cmp_func(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp)))))));
}
pub fn sk_X509_NAME_ENTRY_deep_copy(arg_sk: ?*const struct_stack_st_X509_NAME_ENTRY, arg_copy_func: sk_X509_NAME_ENTRY_copy_func, arg_free_func: sk_X509_NAME_ENTRY_free_func) callconv(.C) ?*struct_stack_st_X509_NAME_ENTRY {
    const sk = arg_sk;
    const copy_func = arg_copy_func;
    const free_func = arg_free_func;
    return @as(?*struct_stack_st_X509_NAME_ENTRY, @ptrCast(sk_deep_copy(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), &sk_X509_NAME_ENTRY_call_copy_func, @as(OPENSSL_sk_copy_func, @ptrCast(@alignCast(copy_func))), &sk_X509_NAME_ENTRY_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))))));
}
pub const struct_stack_st_X509_NAME = opaque {};
pub const sk_X509_NAME_free_func = ?*const fn (?*X509_NAME) callconv(.C) void;
pub const sk_X509_NAME_copy_func = ?*const fn (?*X509_NAME) callconv(.C) ?*X509_NAME;
pub const sk_X509_NAME_cmp_func = ?*const fn ([*c]?*const X509_NAME, [*c]?*const X509_NAME) callconv(.C) c_int;
pub fn sk_X509_NAME_call_free_func(arg_free_func: OPENSSL_sk_free_func, arg_ptr: ?*anyopaque) callconv(.C) void {
    const free_func = arg_free_func;
    const ptr = arg_ptr;
    @as(sk_X509_NAME_free_func, @ptrCast(@alignCast(free_func))).?(@as(?*X509_NAME, @ptrCast(ptr)));
}
pub fn sk_X509_NAME_call_copy_func(arg_copy_func: OPENSSL_sk_copy_func, arg_ptr: ?*anyopaque) callconv(.C) ?*anyopaque {
    const copy_func = arg_copy_func;
    const ptr = arg_ptr;
    return @as(?*anyopaque, @ptrCast(@as(sk_X509_NAME_copy_func, @ptrCast(@alignCast(copy_func))).?(@as(?*X509_NAME, @ptrCast(ptr)))));
}
pub fn sk_X509_NAME_call_cmp_func(arg_cmp_func: OPENSSL_sk_cmp_func, arg_a: [*c]const ?*const anyopaque, arg_b: [*c]const ?*const anyopaque) callconv(.C) c_int {
    const cmp_func = arg_cmp_func;
    const a = arg_a;
    const b = arg_b;
    var a_ptr: ?*const X509_NAME = @as(?*const X509_NAME, @ptrCast(a.*));
    var b_ptr: ?*const X509_NAME = @as(?*const X509_NAME, @ptrCast(b.*));
    return @as(sk_X509_NAME_cmp_func, @ptrCast(@alignCast(cmp_func))).?(&a_ptr, &b_ptr);
}
pub fn sk_X509_NAME_new(arg_comp: sk_X509_NAME_cmp_func) callconv(.C) ?*struct_stack_st_X509_NAME {
    const comp = arg_comp;
    return @as(?*struct_stack_st_X509_NAME, @ptrCast(sk_new(@as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp))))));
}
pub fn sk_X509_NAME_new_null() callconv(.C) ?*struct_stack_st_X509_NAME {
    return @as(?*struct_stack_st_X509_NAME, @ptrCast(sk_new_null()));
}
pub fn sk_X509_NAME_num(arg_sk: ?*const struct_stack_st_X509_NAME) callconv(.C) usize {
    const sk = arg_sk;
    return sk_num(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_NAME_zero(arg_sk: ?*struct_stack_st_X509_NAME) callconv(.C) void {
    const sk = arg_sk;
    sk_zero(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_NAME_value(arg_sk: ?*const struct_stack_st_X509_NAME, arg_i: usize) callconv(.C) ?*X509_NAME {
    const sk = arg_sk;
    const i = arg_i;
    return @as(?*X509_NAME, @ptrCast(sk_value(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), i)));
}
pub fn sk_X509_NAME_set(arg_sk: ?*struct_stack_st_X509_NAME, arg_i: usize, arg_p: ?*X509_NAME) callconv(.C) ?*X509_NAME {
    const sk = arg_sk;
    const i = arg_i;
    const p = arg_p;
    return @as(?*X509_NAME, @ptrCast(sk_set(@as([*c]_STACK, @ptrCast(@alignCast(sk))), i, @as(?*anyopaque, @ptrCast(p)))));
}
pub fn sk_X509_NAME_free(arg_sk: ?*struct_stack_st_X509_NAME) callconv(.C) void {
    const sk = arg_sk;
    sk_free(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_NAME_pop_free(arg_sk: ?*struct_stack_st_X509_NAME, arg_free_func: sk_X509_NAME_free_func) callconv(.C) void {
    const sk = arg_sk;
    const free_func = arg_free_func;
    sk_pop_free_ex(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_X509_NAME_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))));
}
pub fn sk_X509_NAME_insert(arg_sk: ?*struct_stack_st_X509_NAME, arg_p: ?*X509_NAME, arg_where: usize) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    const where = arg_where;
    return sk_insert(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)), where);
}
pub fn sk_X509_NAME_delete(arg_sk: ?*struct_stack_st_X509_NAME, arg_where: usize) callconv(.C) ?*X509_NAME {
    const sk = arg_sk;
    const where = arg_where;
    return @as(?*X509_NAME, @ptrCast(sk_delete(@as([*c]_STACK, @ptrCast(@alignCast(sk))), where)));
}
pub fn sk_X509_NAME_delete_ptr(arg_sk: ?*struct_stack_st_X509_NAME, arg_p: ?*const X509_NAME) callconv(.C) ?*X509_NAME {
    const sk = arg_sk;
    const p = arg_p;
    return @as(?*X509_NAME, @ptrCast(sk_delete_ptr(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*const anyopaque, @ptrCast(p)))));
}
pub fn sk_X509_NAME_find(arg_sk: ?*const struct_stack_st_X509_NAME, arg_out_index: [*c]usize, arg_p: ?*const X509_NAME) callconv(.C) c_int {
    const sk = arg_sk;
    const out_index = arg_out_index;
    const p = arg_p;
    return sk_find(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), out_index, @as(?*const anyopaque, @ptrCast(p)), &sk_X509_NAME_call_cmp_func);
}
pub fn sk_X509_NAME_shift(arg_sk: ?*struct_stack_st_X509_NAME) callconv(.C) ?*X509_NAME {
    const sk = arg_sk;
    return @as(?*X509_NAME, @ptrCast(sk_shift(@as([*c]_STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_NAME_push(arg_sk: ?*struct_stack_st_X509_NAME, arg_p: ?*X509_NAME) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    return sk_push(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)));
}
pub fn sk_X509_NAME_pop(arg_sk: ?*struct_stack_st_X509_NAME) callconv(.C) ?*X509_NAME {
    const sk = arg_sk;
    return @as(?*X509_NAME, @ptrCast(sk_pop(@as([*c]_STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_NAME_dup(arg_sk: ?*const struct_stack_st_X509_NAME) callconv(.C) ?*struct_stack_st_X509_NAME {
    const sk = arg_sk;
    return @as(?*struct_stack_st_X509_NAME, @ptrCast(sk_dup(@as([*c]const _STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_NAME_sort(arg_sk: ?*struct_stack_st_X509_NAME) callconv(.C) void {
    const sk = arg_sk;
    sk_sort(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_X509_NAME_call_cmp_func);
}
pub fn sk_X509_NAME_is_sorted(arg_sk: ?*const struct_stack_st_X509_NAME) callconv(.C) c_int {
    const sk = arg_sk;
    return sk_is_sorted(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_NAME_set_cmp_func(arg_sk: ?*struct_stack_st_X509_NAME, arg_comp: sk_X509_NAME_cmp_func) callconv(.C) sk_X509_NAME_cmp_func {
    const sk = arg_sk;
    const comp = arg_comp;
    return @as(sk_X509_NAME_cmp_func, @ptrCast(@alignCast(sk_set_cmp_func(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp)))))));
}
pub fn sk_X509_NAME_deep_copy(arg_sk: ?*const struct_stack_st_X509_NAME, arg_copy_func: sk_X509_NAME_copy_func, arg_free_func: sk_X509_NAME_free_func) callconv(.C) ?*struct_stack_st_X509_NAME {
    const sk = arg_sk;
    const copy_func = arg_copy_func;
    const free_func = arg_free_func;
    return @as(?*struct_stack_st_X509_NAME, @ptrCast(sk_deep_copy(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), &sk_X509_NAME_call_copy_func, @as(OPENSSL_sk_copy_func, @ptrCast(@alignCast(copy_func))), &sk_X509_NAME_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))))));
}
pub extern const X509_NAME_it: ASN1_ITEM;
pub extern fn X509_NAME_new() ?*X509_NAME;
pub extern fn X509_NAME_free(name: ?*X509_NAME) void;
pub extern fn d2i_X509_NAME(out: [*c]?*X509_NAME, inp: [*c][*c]const u8, len: c_long) ?*X509_NAME;
pub extern fn i2d_X509_NAME(in: ?*X509_NAME, outp: [*c][*c]u8) c_int;
pub extern fn X509_NAME_dup(name: ?*X509_NAME) ?*X509_NAME;
pub extern fn X509_NAME_get0_der(name: ?*X509_NAME, out_der: [*c][*c]const u8, out_der_len: [*c]usize) c_int;
pub extern fn X509_NAME_set(xn: [*c]?*X509_NAME, name: ?*X509_NAME) c_int;
pub extern fn X509_NAME_entry_count(name: ?*const X509_NAME) c_int;
pub extern fn X509_NAME_get_index_by_NID(name: ?*const X509_NAME, nid: c_int, lastpos: c_int) c_int;
pub extern fn X509_NAME_get_index_by_OBJ(name: ?*const X509_NAME, obj: ?*const ASN1_OBJECT, lastpos: c_int) c_int;
pub extern fn X509_NAME_get_entry(name: ?*const X509_NAME, loc: c_int) ?*X509_NAME_ENTRY;
pub extern fn X509_NAME_delete_entry(name: ?*X509_NAME, loc: c_int) ?*X509_NAME_ENTRY;
pub extern fn X509_NAME_add_entry(name: ?*X509_NAME, entry: ?*const X509_NAME_ENTRY, loc: c_int, set: c_int) c_int;
pub extern fn X509_NAME_add_entry_by_OBJ(name: ?*X509_NAME, obj: ?*const ASN1_OBJECT, @"type": c_int, bytes: [*c]const u8, len: c_int, loc: c_int, set: c_int) c_int;
pub extern fn X509_NAME_add_entry_by_NID(name: ?*X509_NAME, nid: c_int, @"type": c_int, bytes: [*c]const u8, len: c_int, loc: c_int, set: c_int) c_int;
pub extern fn X509_NAME_add_entry_by_txt(name: ?*X509_NAME, field: [*c]const u8, @"type": c_int, bytes: [*c]const u8, len: c_int, loc: c_int, set: c_int) c_int;
pub extern const X509_NAME_ENTRY_it: ASN1_ITEM;
pub extern fn X509_NAME_ENTRY_new() ?*X509_NAME_ENTRY;
pub extern fn X509_NAME_ENTRY_free(entry: ?*X509_NAME_ENTRY) void;
pub extern fn d2i_X509_NAME_ENTRY(out: [*c]?*X509_NAME_ENTRY, inp: [*c][*c]const u8, len: c_long) ?*X509_NAME_ENTRY;
pub extern fn i2d_X509_NAME_ENTRY(in: ?*const X509_NAME_ENTRY, outp: [*c][*c]u8) c_int;
pub extern fn X509_NAME_ENTRY_dup(entry: ?*const X509_NAME_ENTRY) ?*X509_NAME_ENTRY;
pub extern fn X509_NAME_ENTRY_get_object(entry: ?*const X509_NAME_ENTRY) ?*ASN1_OBJECT;
pub extern fn X509_NAME_ENTRY_set_object(entry: ?*X509_NAME_ENTRY, obj: ?*const ASN1_OBJECT) c_int;
pub extern fn X509_NAME_ENTRY_get_data(entry: ?*const X509_NAME_ENTRY) [*c]ASN1_STRING;
pub extern fn X509_NAME_ENTRY_set_data(entry: ?*X509_NAME_ENTRY, @"type": c_int, bytes: [*c]const u8, len: c_int) c_int;
pub extern fn X509_NAME_ENTRY_set(entry: ?*const X509_NAME_ENTRY) c_int;
pub extern fn X509_NAME_ENTRY_create_by_OBJ(out: [*c]?*X509_NAME_ENTRY, obj: ?*const ASN1_OBJECT, @"type": c_int, bytes: [*c]const u8, len: c_int) ?*X509_NAME_ENTRY;
pub extern fn X509_NAME_ENTRY_create_by_NID(out: [*c]?*X509_NAME_ENTRY, nid: c_int, @"type": c_int, bytes: [*c]const u8, len: c_int) ?*X509_NAME_ENTRY;
pub extern fn X509_NAME_ENTRY_create_by_txt(out: [*c]?*X509_NAME_ENTRY, field: [*c]const u8, @"type": c_int, bytes: [*c]const u8, len: c_int) ?*X509_NAME_ENTRY;
pub extern const X509_EXTENSION_it: ASN1_ITEM;
pub extern fn X509_EXTENSION_new() ?*X509_EXTENSION;
pub extern fn X509_EXTENSION_free(ex: ?*X509_EXTENSION) void;
pub extern fn d2i_X509_EXTENSION(out: [*c]?*X509_EXTENSION, inp: [*c][*c]const u8, len: c_long) ?*X509_EXTENSION;
pub extern fn i2d_X509_EXTENSION(alg: ?*const X509_EXTENSION, outp: [*c][*c]u8) c_int;
pub extern fn X509_EXTENSION_dup(ex: ?*const X509_EXTENSION) ?*X509_EXTENSION;
pub extern fn X509_EXTENSION_create_by_NID(ex: [*c]?*X509_EXTENSION, nid: c_int, crit: c_int, data: [*c]const ASN1_OCTET_STRING) ?*X509_EXTENSION;
pub extern fn X509_EXTENSION_create_by_OBJ(ex: [*c]?*X509_EXTENSION, obj: ?*const ASN1_OBJECT, crit: c_int, data: [*c]const ASN1_OCTET_STRING) ?*X509_EXTENSION;
pub extern fn X509_EXTENSION_get_object(ex: ?*const X509_EXTENSION) ?*ASN1_OBJECT;
pub extern fn X509_EXTENSION_get_data(ne: ?*const X509_EXTENSION) [*c]ASN1_OCTET_STRING;
pub extern fn X509_EXTENSION_get_critical(ex: ?*const X509_EXTENSION) c_int;
pub extern fn X509_EXTENSION_set_object(ex: ?*X509_EXTENSION, obj: ?*const ASN1_OBJECT) c_int;
pub extern fn X509_EXTENSION_set_critical(ex: ?*X509_EXTENSION, crit: c_int) c_int;
pub extern fn X509_EXTENSION_set_data(ex: ?*X509_EXTENSION, data: [*c]const ASN1_OCTET_STRING) c_int;
pub const sk_X509_EXTENSION_free_func = ?*const fn (?*X509_EXTENSION) callconv(.C) void;
pub const sk_X509_EXTENSION_copy_func = ?*const fn (?*X509_EXTENSION) callconv(.C) ?*X509_EXTENSION;
pub const sk_X509_EXTENSION_cmp_func = ?*const fn ([*c]?*const X509_EXTENSION, [*c]?*const X509_EXTENSION) callconv(.C) c_int;
pub fn sk_X509_EXTENSION_call_free_func(arg_free_func: OPENSSL_sk_free_func, arg_ptr: ?*anyopaque) callconv(.C) void {
    const free_func = arg_free_func;
    const ptr = arg_ptr;
    @as(sk_X509_EXTENSION_free_func, @ptrCast(@alignCast(free_func))).?(@as(?*X509_EXTENSION, @ptrCast(ptr)));
}
pub fn sk_X509_EXTENSION_call_copy_func(arg_copy_func: OPENSSL_sk_copy_func, arg_ptr: ?*anyopaque) callconv(.C) ?*anyopaque {
    const copy_func = arg_copy_func;
    const ptr = arg_ptr;
    return @as(?*anyopaque, @ptrCast(@as(sk_X509_EXTENSION_copy_func, @ptrCast(@alignCast(copy_func))).?(@as(?*X509_EXTENSION, @ptrCast(ptr)))));
}
pub fn sk_X509_EXTENSION_call_cmp_func(arg_cmp_func: OPENSSL_sk_cmp_func, arg_a: [*c]const ?*const anyopaque, arg_b: [*c]const ?*const anyopaque) callconv(.C) c_int {
    const cmp_func = arg_cmp_func;
    const a = arg_a;
    const b = arg_b;
    var a_ptr: ?*const X509_EXTENSION = @as(?*const X509_EXTENSION, @ptrCast(a.*));
    var b_ptr: ?*const X509_EXTENSION = @as(?*const X509_EXTENSION, @ptrCast(b.*));
    return @as(sk_X509_EXTENSION_cmp_func, @ptrCast(@alignCast(cmp_func))).?(&a_ptr, &b_ptr);
}
pub fn sk_X509_EXTENSION_new(arg_comp: sk_X509_EXTENSION_cmp_func) callconv(.C) ?*struct_stack_st_X509_EXTENSION {
    const comp = arg_comp;
    return @as(?*struct_stack_st_X509_EXTENSION, @ptrCast(sk_new(@as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp))))));
}
pub fn sk_X509_EXTENSION_new_null() callconv(.C) ?*struct_stack_st_X509_EXTENSION {
    return @as(?*struct_stack_st_X509_EXTENSION, @ptrCast(sk_new_null()));
}
pub fn sk_X509_EXTENSION_num(arg_sk: ?*const struct_stack_st_X509_EXTENSION) callconv(.C) usize {
    const sk = arg_sk;
    return sk_num(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_EXTENSION_zero(arg_sk: ?*struct_stack_st_X509_EXTENSION) callconv(.C) void {
    const sk = arg_sk;
    sk_zero(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_EXTENSION_value(arg_sk: ?*const struct_stack_st_X509_EXTENSION, arg_i: usize) callconv(.C) ?*X509_EXTENSION {
    const sk = arg_sk;
    const i = arg_i;
    return @as(?*X509_EXTENSION, @ptrCast(sk_value(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), i)));
}
pub fn sk_X509_EXTENSION_set(arg_sk: ?*struct_stack_st_X509_EXTENSION, arg_i: usize, arg_p: ?*X509_EXTENSION) callconv(.C) ?*X509_EXTENSION {
    const sk = arg_sk;
    const i = arg_i;
    const p = arg_p;
    return @as(?*X509_EXTENSION, @ptrCast(sk_set(@as([*c]_STACK, @ptrCast(@alignCast(sk))), i, @as(?*anyopaque, @ptrCast(p)))));
}
pub fn sk_X509_EXTENSION_free(arg_sk: ?*struct_stack_st_X509_EXTENSION) callconv(.C) void {
    const sk = arg_sk;
    sk_free(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_EXTENSION_pop_free(arg_sk: ?*struct_stack_st_X509_EXTENSION, arg_free_func: sk_X509_EXTENSION_free_func) callconv(.C) void {
    const sk = arg_sk;
    const free_func = arg_free_func;
    sk_pop_free_ex(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_X509_EXTENSION_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))));
}
pub fn sk_X509_EXTENSION_insert(arg_sk: ?*struct_stack_st_X509_EXTENSION, arg_p: ?*X509_EXTENSION, arg_where: usize) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    const where = arg_where;
    return sk_insert(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)), where);
}
pub fn sk_X509_EXTENSION_delete(arg_sk: ?*struct_stack_st_X509_EXTENSION, arg_where: usize) callconv(.C) ?*X509_EXTENSION {
    const sk = arg_sk;
    const where = arg_where;
    return @as(?*X509_EXTENSION, @ptrCast(sk_delete(@as([*c]_STACK, @ptrCast(@alignCast(sk))), where)));
}
pub fn sk_X509_EXTENSION_delete_ptr(arg_sk: ?*struct_stack_st_X509_EXTENSION, arg_p: ?*const X509_EXTENSION) callconv(.C) ?*X509_EXTENSION {
    const sk = arg_sk;
    const p = arg_p;
    return @as(?*X509_EXTENSION, @ptrCast(sk_delete_ptr(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*const anyopaque, @ptrCast(p)))));
}
pub fn sk_X509_EXTENSION_find(arg_sk: ?*const struct_stack_st_X509_EXTENSION, arg_out_index: [*c]usize, arg_p: ?*const X509_EXTENSION) callconv(.C) c_int {
    const sk = arg_sk;
    const out_index = arg_out_index;
    const p = arg_p;
    return sk_find(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), out_index, @as(?*const anyopaque, @ptrCast(p)), &sk_X509_EXTENSION_call_cmp_func);
}
pub fn sk_X509_EXTENSION_shift(arg_sk: ?*struct_stack_st_X509_EXTENSION) callconv(.C) ?*X509_EXTENSION {
    const sk = arg_sk;
    return @as(?*X509_EXTENSION, @ptrCast(sk_shift(@as([*c]_STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_EXTENSION_push(arg_sk: ?*struct_stack_st_X509_EXTENSION, arg_p: ?*X509_EXTENSION) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    return sk_push(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)));
}
pub fn sk_X509_EXTENSION_pop(arg_sk: ?*struct_stack_st_X509_EXTENSION) callconv(.C) ?*X509_EXTENSION {
    const sk = arg_sk;
    return @as(?*X509_EXTENSION, @ptrCast(sk_pop(@as([*c]_STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_EXTENSION_dup(arg_sk: ?*const struct_stack_st_X509_EXTENSION) callconv(.C) ?*struct_stack_st_X509_EXTENSION {
    const sk = arg_sk;
    return @as(?*struct_stack_st_X509_EXTENSION, @ptrCast(sk_dup(@as([*c]const _STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_EXTENSION_sort(arg_sk: ?*struct_stack_st_X509_EXTENSION) callconv(.C) void {
    const sk = arg_sk;
    sk_sort(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_X509_EXTENSION_call_cmp_func);
}
pub fn sk_X509_EXTENSION_is_sorted(arg_sk: ?*const struct_stack_st_X509_EXTENSION) callconv(.C) c_int {
    const sk = arg_sk;
    return sk_is_sorted(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_EXTENSION_set_cmp_func(arg_sk: ?*struct_stack_st_X509_EXTENSION, arg_comp: sk_X509_EXTENSION_cmp_func) callconv(.C) sk_X509_EXTENSION_cmp_func {
    const sk = arg_sk;
    const comp = arg_comp;
    return @as(sk_X509_EXTENSION_cmp_func, @ptrCast(@alignCast(sk_set_cmp_func(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp)))))));
}
pub fn sk_X509_EXTENSION_deep_copy(arg_sk: ?*const struct_stack_st_X509_EXTENSION, arg_copy_func: sk_X509_EXTENSION_copy_func, arg_free_func: sk_X509_EXTENSION_free_func) callconv(.C) ?*struct_stack_st_X509_EXTENSION {
    const sk = arg_sk;
    const copy_func = arg_copy_func;
    const free_func = arg_free_func;
    return @as(?*struct_stack_st_X509_EXTENSION, @ptrCast(sk_deep_copy(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), &sk_X509_EXTENSION_call_copy_func, @as(OPENSSL_sk_copy_func, @ptrCast(@alignCast(copy_func))), &sk_X509_EXTENSION_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))))));
}
pub const X509_EXTENSIONS = struct_stack_st_X509_EXTENSION;
pub extern const X509_EXTENSIONS_it: ASN1_ITEM;
pub extern fn d2i_X509_EXTENSIONS(out: [*c]?*X509_EXTENSIONS, inp: [*c][*c]const u8, len: c_long) ?*X509_EXTENSIONS;
pub extern fn i2d_X509_EXTENSIONS(alg: ?*const X509_EXTENSIONS, outp: [*c][*c]u8) c_int;
pub extern fn X509v3_get_ext_count(x: ?*const struct_stack_st_X509_EXTENSION) c_int;
pub extern fn X509v3_get_ext_by_NID(x: ?*const struct_stack_st_X509_EXTENSION, nid: c_int, lastpos: c_int) c_int;
pub extern fn X509v3_get_ext_by_OBJ(x: ?*const struct_stack_st_X509_EXTENSION, obj: ?*const ASN1_OBJECT, lastpos: c_int) c_int;
pub extern fn X509v3_get_ext_by_critical(x: ?*const struct_stack_st_X509_EXTENSION, crit: c_int, lastpos: c_int) c_int;
pub extern fn X509v3_get_ext(x: ?*const struct_stack_st_X509_EXTENSION, loc: c_int) ?*X509_EXTENSION;
pub extern fn X509v3_delete_ext(x: ?*struct_stack_st_X509_EXTENSION, loc: c_int) ?*X509_EXTENSION;
pub extern fn X509v3_add_ext(x: [*c]?*struct_stack_st_X509_EXTENSION, ex: ?*const X509_EXTENSION, loc: c_int) ?*struct_stack_st_X509_EXTENSION;
pub const struct_stack_st_X509_ALGOR = opaque {};
pub const sk_X509_ALGOR_free_func = ?*const fn ([*c]X509_ALGOR) callconv(.C) void;
pub const sk_X509_ALGOR_copy_func = ?*const fn ([*c]X509_ALGOR) callconv(.C) [*c]X509_ALGOR;
pub const sk_X509_ALGOR_cmp_func = ?*const fn ([*c][*c]const X509_ALGOR, [*c][*c]const X509_ALGOR) callconv(.C) c_int;
pub fn sk_X509_ALGOR_call_free_func(arg_free_func: OPENSSL_sk_free_func, arg_ptr: ?*anyopaque) callconv(.C) void {
    const free_func = arg_free_func;
    const ptr = arg_ptr;
    @as(sk_X509_ALGOR_free_func, @ptrCast(@alignCast(free_func))).?(@as([*c]X509_ALGOR, @ptrCast(@alignCast(ptr))));
}
pub fn sk_X509_ALGOR_call_copy_func(arg_copy_func: OPENSSL_sk_copy_func, arg_ptr: ?*anyopaque) callconv(.C) ?*anyopaque {
    const copy_func = arg_copy_func;
    const ptr = arg_ptr;
    return @as(?*anyopaque, @ptrCast(@as(sk_X509_ALGOR_copy_func, @ptrCast(@alignCast(copy_func))).?(@as([*c]X509_ALGOR, @ptrCast(@alignCast(ptr))))));
}
pub fn sk_X509_ALGOR_call_cmp_func(arg_cmp_func: OPENSSL_sk_cmp_func, arg_a: [*c]const ?*const anyopaque, arg_b: [*c]const ?*const anyopaque) callconv(.C) c_int {
    const cmp_func = arg_cmp_func;
    const a = arg_a;
    const b = arg_b;
    var a_ptr: [*c]const X509_ALGOR = @as([*c]const X509_ALGOR, @ptrCast(@alignCast(a.*)));
    var b_ptr: [*c]const X509_ALGOR = @as([*c]const X509_ALGOR, @ptrCast(@alignCast(b.*)));
    return @as(sk_X509_ALGOR_cmp_func, @ptrCast(@alignCast(cmp_func))).?(&a_ptr, &b_ptr);
}
pub fn sk_X509_ALGOR_new(arg_comp: sk_X509_ALGOR_cmp_func) callconv(.C) ?*struct_stack_st_X509_ALGOR {
    const comp = arg_comp;
    return @as(?*struct_stack_st_X509_ALGOR, @ptrCast(sk_new(@as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp))))));
}
pub fn sk_X509_ALGOR_new_null() callconv(.C) ?*struct_stack_st_X509_ALGOR {
    return @as(?*struct_stack_st_X509_ALGOR, @ptrCast(sk_new_null()));
}
pub fn sk_X509_ALGOR_num(arg_sk: ?*const struct_stack_st_X509_ALGOR) callconv(.C) usize {
    const sk = arg_sk;
    return sk_num(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_ALGOR_zero(arg_sk: ?*struct_stack_st_X509_ALGOR) callconv(.C) void {
    const sk = arg_sk;
    sk_zero(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_ALGOR_value(arg_sk: ?*const struct_stack_st_X509_ALGOR, arg_i: usize) callconv(.C) [*c]X509_ALGOR {
    const sk = arg_sk;
    const i = arg_i;
    return @as([*c]X509_ALGOR, @ptrCast(@alignCast(sk_value(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), i))));
}
pub fn sk_X509_ALGOR_set(arg_sk: ?*struct_stack_st_X509_ALGOR, arg_i: usize, arg_p: [*c]X509_ALGOR) callconv(.C) [*c]X509_ALGOR {
    const sk = arg_sk;
    const i = arg_i;
    const p = arg_p;
    return @as([*c]X509_ALGOR, @ptrCast(@alignCast(sk_set(@as([*c]_STACK, @ptrCast(@alignCast(sk))), i, @as(?*anyopaque, @ptrCast(p))))));
}
pub fn sk_X509_ALGOR_free(arg_sk: ?*struct_stack_st_X509_ALGOR) callconv(.C) void {
    const sk = arg_sk;
    sk_free(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_ALGOR_pop_free(arg_sk: ?*struct_stack_st_X509_ALGOR, arg_free_func: sk_X509_ALGOR_free_func) callconv(.C) void {
    const sk = arg_sk;
    const free_func = arg_free_func;
    sk_pop_free_ex(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_X509_ALGOR_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))));
}
pub fn sk_X509_ALGOR_insert(arg_sk: ?*struct_stack_st_X509_ALGOR, arg_p: [*c]X509_ALGOR, arg_where: usize) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    const where = arg_where;
    return sk_insert(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)), where);
}
pub fn sk_X509_ALGOR_delete(arg_sk: ?*struct_stack_st_X509_ALGOR, arg_where: usize) callconv(.C) [*c]X509_ALGOR {
    const sk = arg_sk;
    const where = arg_where;
    return @as([*c]X509_ALGOR, @ptrCast(@alignCast(sk_delete(@as([*c]_STACK, @ptrCast(@alignCast(sk))), where))));
}
pub fn sk_X509_ALGOR_delete_ptr(arg_sk: ?*struct_stack_st_X509_ALGOR, arg_p: [*c]const X509_ALGOR) callconv(.C) [*c]X509_ALGOR {
    const sk = arg_sk;
    const p = arg_p;
    return @as([*c]X509_ALGOR, @ptrCast(@alignCast(sk_delete_ptr(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*const anyopaque, @ptrCast(p))))));
}
pub fn sk_X509_ALGOR_find(arg_sk: ?*const struct_stack_st_X509_ALGOR, arg_out_index: [*c]usize, arg_p: [*c]const X509_ALGOR) callconv(.C) c_int {
    const sk = arg_sk;
    const out_index = arg_out_index;
    const p = arg_p;
    return sk_find(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), out_index, @as(?*const anyopaque, @ptrCast(p)), &sk_X509_ALGOR_call_cmp_func);
}
pub fn sk_X509_ALGOR_shift(arg_sk: ?*struct_stack_st_X509_ALGOR) callconv(.C) [*c]X509_ALGOR {
    const sk = arg_sk;
    return @as([*c]X509_ALGOR, @ptrCast(@alignCast(sk_shift(@as([*c]_STACK, @ptrCast(@alignCast(sk)))))));
}
pub fn sk_X509_ALGOR_push(arg_sk: ?*struct_stack_st_X509_ALGOR, arg_p: [*c]X509_ALGOR) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    return sk_push(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)));
}
pub fn sk_X509_ALGOR_pop(arg_sk: ?*struct_stack_st_X509_ALGOR) callconv(.C) [*c]X509_ALGOR {
    const sk = arg_sk;
    return @as([*c]X509_ALGOR, @ptrCast(@alignCast(sk_pop(@as([*c]_STACK, @ptrCast(@alignCast(sk)))))));
}
pub fn sk_X509_ALGOR_dup(arg_sk: ?*const struct_stack_st_X509_ALGOR) callconv(.C) ?*struct_stack_st_X509_ALGOR {
    const sk = arg_sk;
    return @as(?*struct_stack_st_X509_ALGOR, @ptrCast(sk_dup(@as([*c]const _STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_ALGOR_sort(arg_sk: ?*struct_stack_st_X509_ALGOR) callconv(.C) void {
    const sk = arg_sk;
    sk_sort(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_X509_ALGOR_call_cmp_func);
}
pub fn sk_X509_ALGOR_is_sorted(arg_sk: ?*const struct_stack_st_X509_ALGOR) callconv(.C) c_int {
    const sk = arg_sk;
    return sk_is_sorted(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_ALGOR_set_cmp_func(arg_sk: ?*struct_stack_st_X509_ALGOR, arg_comp: sk_X509_ALGOR_cmp_func) callconv(.C) sk_X509_ALGOR_cmp_func {
    const sk = arg_sk;
    const comp = arg_comp;
    return @as(sk_X509_ALGOR_cmp_func, @ptrCast(@alignCast(sk_set_cmp_func(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp)))))));
}
pub fn sk_X509_ALGOR_deep_copy(arg_sk: ?*const struct_stack_st_X509_ALGOR, arg_copy_func: sk_X509_ALGOR_copy_func, arg_free_func: sk_X509_ALGOR_free_func) callconv(.C) ?*struct_stack_st_X509_ALGOR {
    const sk = arg_sk;
    const copy_func = arg_copy_func;
    const free_func = arg_free_func;
    return @as(?*struct_stack_st_X509_ALGOR, @ptrCast(sk_deep_copy(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), &sk_X509_ALGOR_call_copy_func, @as(OPENSSL_sk_copy_func, @ptrCast(@alignCast(copy_func))), &sk_X509_ALGOR_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))))));
}
pub extern const X509_ALGOR_it: ASN1_ITEM;
pub extern fn X509_ALGOR_new() [*c]X509_ALGOR;
pub extern fn X509_ALGOR_dup(alg: [*c]const X509_ALGOR) [*c]X509_ALGOR;
pub extern fn X509_ALGOR_free(alg: [*c]X509_ALGOR) void;
pub extern fn d2i_X509_ALGOR(out: [*c][*c]X509_ALGOR, inp: [*c][*c]const u8, len: c_long) [*c]X509_ALGOR;
pub extern fn i2d_X509_ALGOR(alg: [*c]const X509_ALGOR, outp: [*c][*c]u8) c_int;
pub extern fn X509_ALGOR_set0(alg: [*c]X509_ALGOR, obj: ?*ASN1_OBJECT, param_type: c_int, param_value: ?*anyopaque) c_int;
pub extern fn X509_ALGOR_get0(out_obj: [*c]?*const ASN1_OBJECT, out_param_type: [*c]c_int, out_param_value: [*c]?*const anyopaque, alg: [*c]const X509_ALGOR) void;
pub extern fn X509_ALGOR_set_md(alg: [*c]X509_ALGOR, md: ?*const EVP_MD) void;
pub extern fn X509_ALGOR_cmp(a: [*c]const X509_ALGOR, b: [*c]const X509_ALGOR) c_int;
pub extern fn X509_signature_dump(bio: [*c]BIO, sig: [*c]const ASN1_STRING, indent: c_int) c_int;
pub extern fn X509_signature_print(bio: [*c]BIO, alg: [*c]const X509_ALGOR, sig: [*c]const ASN1_STRING) c_int;
pub extern fn X509_pubkey_digest(x509: ?*const X509, md: ?*const EVP_MD, out: [*c]u8, out_len: [*c]c_uint) c_int;
pub extern fn X509_digest(x509: ?*const X509, md: ?*const EVP_MD, out: [*c]u8, out_len: [*c]c_uint) c_int;
pub extern fn X509_CRL_digest(crl: ?*const X509_CRL, md: ?*const EVP_MD, out: [*c]u8, out_len: [*c]c_uint) c_int;
pub extern fn X509_REQ_digest(req: ?*const X509_REQ, md: ?*const EVP_MD, out: [*c]u8, out_len: [*c]c_uint) c_int;
pub extern fn X509_NAME_digest(name: ?*const X509_NAME, md: ?*const EVP_MD, out: [*c]u8, out_len: [*c]c_uint) c_int;
pub extern fn d2i_X509_bio(bp: [*c]BIO, x509: [*c]?*X509) ?*X509;
pub extern fn d2i_X509_CRL_bio(bp: [*c]BIO, crl: [*c]?*X509_CRL) ?*X509_CRL;
pub extern fn d2i_X509_REQ_bio(bp: [*c]BIO, req: [*c]?*X509_REQ) ?*X509_REQ;
pub extern fn d2i_RSAPrivateKey_bio(bp: [*c]BIO, rsa: [*c]?*RSA) ?*RSA;
pub extern fn d2i_RSAPublicKey_bio(bp: [*c]BIO, rsa: [*c]?*RSA) ?*RSA;
pub extern fn d2i_RSA_PUBKEY_bio(bp: [*c]BIO, rsa: [*c]?*RSA) ?*RSA;
pub extern fn d2i_DSA_PUBKEY_bio(bp: [*c]BIO, dsa: [*c][*c]DSA) [*c]DSA;
pub extern fn d2i_DSAPrivateKey_bio(bp: [*c]BIO, dsa: [*c][*c]DSA) [*c]DSA;
pub extern fn d2i_EC_PUBKEY_bio(bp: [*c]BIO, eckey: [*c]?*EC_KEY) ?*EC_KEY;
pub extern fn d2i_ECPrivateKey_bio(bp: [*c]BIO, eckey: [*c]?*EC_KEY) ?*EC_KEY;
pub extern fn d2i_PKCS8_bio(bp: [*c]BIO, p8: [*c]?*X509_SIG) ?*X509_SIG;
pub extern fn d2i_PKCS8_PRIV_KEY_INFO_bio(bp: [*c]BIO, p8inf: [*c]?*PKCS8_PRIV_KEY_INFO) ?*PKCS8_PRIV_KEY_INFO;
pub extern fn d2i_PUBKEY_bio(bp: [*c]BIO, a: [*c][*c]EVP_PKEY) [*c]EVP_PKEY;
pub extern fn d2i_DHparams_bio(bp: [*c]BIO, dh: [*c]?*DH) ?*DH;
pub extern fn d2i_PrivateKey_bio(bp: [*c]BIO, a: [*c][*c]EVP_PKEY) [*c]EVP_PKEY;
pub extern fn i2d_X509_bio(bp: [*c]BIO, x509: ?*X509) c_int;
pub extern fn i2d_X509_CRL_bio(bp: [*c]BIO, crl: ?*X509_CRL) c_int;
pub extern fn i2d_X509_REQ_bio(bp: [*c]BIO, req: ?*X509_REQ) c_int;
pub extern fn i2d_RSAPrivateKey_bio(bp: [*c]BIO, rsa: ?*RSA) c_int;
pub extern fn i2d_RSAPublicKey_bio(bp: [*c]BIO, rsa: ?*RSA) c_int;
pub extern fn i2d_RSA_PUBKEY_bio(bp: [*c]BIO, rsa: ?*RSA) c_int;
pub extern fn i2d_DSA_PUBKEY_bio(bp: [*c]BIO, dsa: [*c]DSA) c_int;
pub extern fn i2d_DSAPrivateKey_bio(bp: [*c]BIO, dsa: [*c]DSA) c_int;
pub extern fn i2d_EC_PUBKEY_bio(bp: [*c]BIO, eckey: ?*EC_KEY) c_int;
pub extern fn i2d_ECPrivateKey_bio(bp: [*c]BIO, eckey: ?*EC_KEY) c_int;
pub extern fn i2d_PKCS8_bio(bp: [*c]BIO, p8: ?*X509_SIG) c_int;
pub extern fn i2d_PKCS8_PRIV_KEY_INFO_bio(bp: [*c]BIO, p8inf: ?*PKCS8_PRIV_KEY_INFO) c_int;
pub extern fn i2d_PrivateKey_bio(bp: [*c]BIO, pkey: [*c]EVP_PKEY) c_int;
pub extern fn i2d_PUBKEY_bio(bp: [*c]BIO, pkey: [*c]EVP_PKEY) c_int;
pub extern fn i2d_DHparams_bio(bp: [*c]BIO, dh: ?*const DH) c_int;
pub extern fn i2d_PKCS8PrivateKeyInfo_bio(bp: [*c]BIO, key: [*c]EVP_PKEY) c_int;
// pub extern fn d2i_X509_fp(fp: [*c]FILE, x509: [*c]?*X509) ?*X509;
// pub extern fn d2i_X509_CRL_fp(fp: [*c]FILE, crl: [*c]?*X509_CRL) ?*X509_CRL;
// pub extern fn d2i_X509_REQ_fp(fp: [*c]FILE, req: [*c]?*X509_REQ) ?*X509_REQ;
// pub extern fn d2i_RSAPrivateKey_fp(fp: [*c]FILE, rsa: [*c]?*RSA) ?*RSA;
// pub extern fn d2i_RSAPublicKey_fp(fp: [*c]FILE, rsa: [*c]?*RSA) ?*RSA;
// pub extern fn d2i_RSA_PUBKEY_fp(fp: [*c]FILE, rsa: [*c]?*RSA) ?*RSA;
// pub extern fn d2i_DSA_PUBKEY_fp(fp: [*c]FILE, dsa: [*c][*c]DSA) [*c]DSA;
// pub extern fn d2i_DSAPrivateKey_fp(fp: [*c]FILE, dsa: [*c][*c]DSA) [*c]DSA;
// pub extern fn d2i_EC_PUBKEY_fp(fp: [*c]FILE, eckey: [*c]?*EC_KEY) ?*EC_KEY;
// pub extern fn d2i_ECPrivateKey_fp(fp: [*c]FILE, eckey: [*c]?*EC_KEY) ?*EC_KEY;
// pub extern fn d2i_PKCS8_fp(fp: [*c]FILE, p8: [*c]?*X509_SIG) ?*X509_SIG;
// pub extern fn d2i_PKCS8_PRIV_KEY_INFO_fp(fp: [*c]FILE, p8inf: [*c]?*PKCS8_PRIV_KEY_INFO) ?*PKCS8_PRIV_KEY_INFO;
// pub extern fn d2i_PrivateKey_fp(fp: [*c]FILE, a: [*c][*c]EVP_PKEY) [*c]EVP_PKEY;
// pub extern fn d2i_PUBKEY_fp(fp: [*c]FILE, a: [*c][*c]EVP_PKEY) [*c]EVP_PKEY;
// pub extern fn i2d_X509_fp(fp: [*c]FILE, x509: ?*X509) c_int;
// pub extern fn i2d_X509_CRL_fp(fp: [*c]FILE, crl: ?*X509_CRL) c_int;
// pub extern fn i2d_X509_REQ_fp(fp: [*c]FILE, req: ?*X509_REQ) c_int;
// pub extern fn i2d_RSAPrivateKey_fp(fp: [*c]FILE, rsa: ?*RSA) c_int;
// pub extern fn i2d_RSAPublicKey_fp(fp: [*c]FILE, rsa: ?*RSA) c_int;
// pub extern fn i2d_RSA_PUBKEY_fp(fp: [*c]FILE, rsa: ?*RSA) c_int;
// pub extern fn i2d_DSA_PUBKEY_fp(fp: [*c]FILE, dsa: [*c]DSA) c_int;
// pub extern fn i2d_DSAPrivateKey_fp(fp: [*c]FILE, dsa: [*c]DSA) c_int;
// pub extern fn i2d_EC_PUBKEY_fp(fp: [*c]FILE, eckey: ?*EC_KEY) c_int;
// pub extern fn i2d_ECPrivateKey_fp(fp: [*c]FILE, eckey: ?*EC_KEY) c_int;
// pub extern fn i2d_PKCS8_fp(fp: [*c]FILE, p8: ?*X509_SIG) c_int;
// pub extern fn i2d_PKCS8_PRIV_KEY_INFO_fp(fp: [*c]FILE, p8inf: ?*PKCS8_PRIV_KEY_INFO) c_int;
// pub extern fn i2d_PKCS8PrivateKeyInfo_fp(fp: [*c]FILE, key: [*c]EVP_PKEY) c_int;
// pub extern fn i2d_PrivateKey_fp(fp: [*c]FILE, pkey: [*c]EVP_PKEY) c_int;
// pub extern fn i2d_PUBKEY_fp(fp: [*c]FILE, pkey: [*c]EVP_PKEY) c_int;
pub extern fn X509_NAME_get_text_by_OBJ(name: ?*const X509_NAME, obj: ?*const ASN1_OBJECT, buf: [*c]u8, len: c_int) c_int;
pub extern fn X509_NAME_get_text_by_NID(name: ?*const X509_NAME, nid: c_int, buf: [*c]u8, len: c_int) c_int;
pub const struct_stack_st_X509_ATTRIBUTE = opaque {};
pub const sk_X509_ATTRIBUTE_free_func = ?*const fn (?*X509_ATTRIBUTE) callconv(.C) void;
pub const sk_X509_ATTRIBUTE_copy_func = ?*const fn (?*X509_ATTRIBUTE) callconv(.C) ?*X509_ATTRIBUTE;
pub const sk_X509_ATTRIBUTE_cmp_func = ?*const fn ([*c]?*const X509_ATTRIBUTE, [*c]?*const X509_ATTRIBUTE) callconv(.C) c_int;
pub fn sk_X509_ATTRIBUTE_call_free_func(arg_free_func: OPENSSL_sk_free_func, arg_ptr: ?*anyopaque) callconv(.C) void {
    const free_func = arg_free_func;
    const ptr = arg_ptr;
    @as(sk_X509_ATTRIBUTE_free_func, @ptrCast(@alignCast(free_func))).?(@as(?*X509_ATTRIBUTE, @ptrCast(ptr)));
}
pub fn sk_X509_ATTRIBUTE_call_copy_func(arg_copy_func: OPENSSL_sk_copy_func, arg_ptr: ?*anyopaque) callconv(.C) ?*anyopaque {
    const copy_func = arg_copy_func;
    const ptr = arg_ptr;
    return @as(?*anyopaque, @ptrCast(@as(sk_X509_ATTRIBUTE_copy_func, @ptrCast(@alignCast(copy_func))).?(@as(?*X509_ATTRIBUTE, @ptrCast(ptr)))));
}
pub fn sk_X509_ATTRIBUTE_call_cmp_func(arg_cmp_func: OPENSSL_sk_cmp_func, arg_a: [*c]const ?*const anyopaque, arg_b: [*c]const ?*const anyopaque) callconv(.C) c_int {
    const cmp_func = arg_cmp_func;
    const a = arg_a;
    const b = arg_b;
    var a_ptr: ?*const X509_ATTRIBUTE = @as(?*const X509_ATTRIBUTE, @ptrCast(a.*));
    var b_ptr: ?*const X509_ATTRIBUTE = @as(?*const X509_ATTRIBUTE, @ptrCast(b.*));
    return @as(sk_X509_ATTRIBUTE_cmp_func, @ptrCast(@alignCast(cmp_func))).?(&a_ptr, &b_ptr);
}
pub fn sk_X509_ATTRIBUTE_new(arg_comp: sk_X509_ATTRIBUTE_cmp_func) callconv(.C) ?*struct_stack_st_X509_ATTRIBUTE {
    const comp = arg_comp;
    return @as(?*struct_stack_st_X509_ATTRIBUTE, @ptrCast(sk_new(@as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp))))));
}
pub fn sk_X509_ATTRIBUTE_new_null() callconv(.C) ?*struct_stack_st_X509_ATTRIBUTE {
    return @as(?*struct_stack_st_X509_ATTRIBUTE, @ptrCast(sk_new_null()));
}
pub fn sk_X509_ATTRIBUTE_num(arg_sk: ?*const struct_stack_st_X509_ATTRIBUTE) callconv(.C) usize {
    const sk = arg_sk;
    return sk_num(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_ATTRIBUTE_zero(arg_sk: ?*struct_stack_st_X509_ATTRIBUTE) callconv(.C) void {
    const sk = arg_sk;
    sk_zero(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_ATTRIBUTE_value(arg_sk: ?*const struct_stack_st_X509_ATTRIBUTE, arg_i: usize) callconv(.C) ?*X509_ATTRIBUTE {
    const sk = arg_sk;
    const i = arg_i;
    return @as(?*X509_ATTRIBUTE, @ptrCast(sk_value(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), i)));
}
pub fn sk_X509_ATTRIBUTE_set(arg_sk: ?*struct_stack_st_X509_ATTRIBUTE, arg_i: usize, arg_p: ?*X509_ATTRIBUTE) callconv(.C) ?*X509_ATTRIBUTE {
    const sk = arg_sk;
    const i = arg_i;
    const p = arg_p;
    return @as(?*X509_ATTRIBUTE, @ptrCast(sk_set(@as([*c]_STACK, @ptrCast(@alignCast(sk))), i, @as(?*anyopaque, @ptrCast(p)))));
}
pub fn sk_X509_ATTRIBUTE_free(arg_sk: ?*struct_stack_st_X509_ATTRIBUTE) callconv(.C) void {
    const sk = arg_sk;
    sk_free(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_ATTRIBUTE_pop_free(arg_sk: ?*struct_stack_st_X509_ATTRIBUTE, arg_free_func: sk_X509_ATTRIBUTE_free_func) callconv(.C) void {
    const sk = arg_sk;
    const free_func = arg_free_func;
    sk_pop_free_ex(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_X509_ATTRIBUTE_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))));
}
pub fn sk_X509_ATTRIBUTE_insert(arg_sk: ?*struct_stack_st_X509_ATTRIBUTE, arg_p: ?*X509_ATTRIBUTE, arg_where: usize) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    const where = arg_where;
    return sk_insert(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)), where);
}
pub fn sk_X509_ATTRIBUTE_delete(arg_sk: ?*struct_stack_st_X509_ATTRIBUTE, arg_where: usize) callconv(.C) ?*X509_ATTRIBUTE {
    const sk = arg_sk;
    const where = arg_where;
    return @as(?*X509_ATTRIBUTE, @ptrCast(sk_delete(@as([*c]_STACK, @ptrCast(@alignCast(sk))), where)));
}
pub fn sk_X509_ATTRIBUTE_delete_ptr(arg_sk: ?*struct_stack_st_X509_ATTRIBUTE, arg_p: ?*const X509_ATTRIBUTE) callconv(.C) ?*X509_ATTRIBUTE {
    const sk = arg_sk;
    const p = arg_p;
    return @as(?*X509_ATTRIBUTE, @ptrCast(sk_delete_ptr(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*const anyopaque, @ptrCast(p)))));
}
pub fn sk_X509_ATTRIBUTE_find(arg_sk: ?*const struct_stack_st_X509_ATTRIBUTE, arg_out_index: [*c]usize, arg_p: ?*const X509_ATTRIBUTE) callconv(.C) c_int {
    const sk = arg_sk;
    const out_index = arg_out_index;
    const p = arg_p;
    return sk_find(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), out_index, @as(?*const anyopaque, @ptrCast(p)), &sk_X509_ATTRIBUTE_call_cmp_func);
}
pub fn sk_X509_ATTRIBUTE_shift(arg_sk: ?*struct_stack_st_X509_ATTRIBUTE) callconv(.C) ?*X509_ATTRIBUTE {
    const sk = arg_sk;
    return @as(?*X509_ATTRIBUTE, @ptrCast(sk_shift(@as([*c]_STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_ATTRIBUTE_push(arg_sk: ?*struct_stack_st_X509_ATTRIBUTE, arg_p: ?*X509_ATTRIBUTE) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    return sk_push(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)));
}
pub fn sk_X509_ATTRIBUTE_pop(arg_sk: ?*struct_stack_st_X509_ATTRIBUTE) callconv(.C) ?*X509_ATTRIBUTE {
    const sk = arg_sk;
    return @as(?*X509_ATTRIBUTE, @ptrCast(sk_pop(@as([*c]_STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_ATTRIBUTE_dup(arg_sk: ?*const struct_stack_st_X509_ATTRIBUTE) callconv(.C) ?*struct_stack_st_X509_ATTRIBUTE {
    const sk = arg_sk;
    return @as(?*struct_stack_st_X509_ATTRIBUTE, @ptrCast(sk_dup(@as([*c]const _STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_ATTRIBUTE_sort(arg_sk: ?*struct_stack_st_X509_ATTRIBUTE) callconv(.C) void {
    const sk = arg_sk;
    sk_sort(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_X509_ATTRIBUTE_call_cmp_func);
}
pub fn sk_X509_ATTRIBUTE_is_sorted(arg_sk: ?*const struct_stack_st_X509_ATTRIBUTE) callconv(.C) c_int {
    const sk = arg_sk;
    return sk_is_sorted(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_ATTRIBUTE_set_cmp_func(arg_sk: ?*struct_stack_st_X509_ATTRIBUTE, arg_comp: sk_X509_ATTRIBUTE_cmp_func) callconv(.C) sk_X509_ATTRIBUTE_cmp_func {
    const sk = arg_sk;
    const comp = arg_comp;
    return @as(sk_X509_ATTRIBUTE_cmp_func, @ptrCast(@alignCast(sk_set_cmp_func(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp)))))));
}
pub fn sk_X509_ATTRIBUTE_deep_copy(arg_sk: ?*const struct_stack_st_X509_ATTRIBUTE, arg_copy_func: sk_X509_ATTRIBUTE_copy_func, arg_free_func: sk_X509_ATTRIBUTE_free_func) callconv(.C) ?*struct_stack_st_X509_ATTRIBUTE {
    const sk = arg_sk;
    const copy_func = arg_copy_func;
    const free_func = arg_free_func;
    return @as(?*struct_stack_st_X509_ATTRIBUTE, @ptrCast(sk_deep_copy(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), &sk_X509_ATTRIBUTE_call_copy_func, @as(OPENSSL_sk_copy_func, @ptrCast(@alignCast(copy_func))), &sk_X509_ATTRIBUTE_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))))));
}
pub const struct_stack_st_DIST_POINT = opaque {};
pub const struct_stack_st_GENERAL_NAME = opaque {};
pub const struct_stack_st_X509_TRUST = opaque {};
pub const sk_X509_TRUST_free_func = ?*const fn ([*c]X509_TRUST) callconv(.C) void;
pub const sk_X509_TRUST_copy_func = ?*const fn ([*c]X509_TRUST) callconv(.C) [*c]X509_TRUST;
pub const sk_X509_TRUST_cmp_func = ?*const fn ([*c][*c]const X509_TRUST, [*c][*c]const X509_TRUST) callconv(.C) c_int;
pub fn sk_X509_TRUST_call_free_func(arg_free_func: OPENSSL_sk_free_func, arg_ptr: ?*anyopaque) callconv(.C) void {
    const free_func = arg_free_func;
    const ptr = arg_ptr;
    @as(sk_X509_TRUST_free_func, @ptrCast(@alignCast(free_func))).?(@as([*c]X509_TRUST, @ptrCast(@alignCast(ptr))));
}
pub fn sk_X509_TRUST_call_copy_func(arg_copy_func: OPENSSL_sk_copy_func, arg_ptr: ?*anyopaque) callconv(.C) ?*anyopaque {
    const copy_func = arg_copy_func;
    const ptr = arg_ptr;
    return @as(?*anyopaque, @ptrCast(@as(sk_X509_TRUST_copy_func, @ptrCast(@alignCast(copy_func))).?(@as([*c]X509_TRUST, @ptrCast(@alignCast(ptr))))));
}
pub fn sk_X509_TRUST_call_cmp_func(arg_cmp_func: OPENSSL_sk_cmp_func, arg_a: [*c]const ?*const anyopaque, arg_b: [*c]const ?*const anyopaque) callconv(.C) c_int {
    const cmp_func = arg_cmp_func;
    const a = arg_a;
    const b = arg_b;
    var a_ptr: [*c]const X509_TRUST = @as([*c]const X509_TRUST, @ptrCast(@alignCast(a.*)));
    var b_ptr: [*c]const X509_TRUST = @as([*c]const X509_TRUST, @ptrCast(@alignCast(b.*)));
    return @as(sk_X509_TRUST_cmp_func, @ptrCast(@alignCast(cmp_func))).?(&a_ptr, &b_ptr);
}
pub fn sk_X509_TRUST_new(arg_comp: sk_X509_TRUST_cmp_func) callconv(.C) ?*struct_stack_st_X509_TRUST {
    const comp = arg_comp;
    return @as(?*struct_stack_st_X509_TRUST, @ptrCast(sk_new(@as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp))))));
}
pub fn sk_X509_TRUST_new_null() callconv(.C) ?*struct_stack_st_X509_TRUST {
    return @as(?*struct_stack_st_X509_TRUST, @ptrCast(sk_new_null()));
}
pub fn sk_X509_TRUST_num(arg_sk: ?*const struct_stack_st_X509_TRUST) callconv(.C) usize {
    const sk = arg_sk;
    return sk_num(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_TRUST_zero(arg_sk: ?*struct_stack_st_X509_TRUST) callconv(.C) void {
    const sk = arg_sk;
    sk_zero(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_TRUST_value(arg_sk: ?*const struct_stack_st_X509_TRUST, arg_i: usize) callconv(.C) [*c]X509_TRUST {
    const sk = arg_sk;
    const i = arg_i;
    return @as([*c]X509_TRUST, @ptrCast(@alignCast(sk_value(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), i))));
}
pub fn sk_X509_TRUST_set(arg_sk: ?*struct_stack_st_X509_TRUST, arg_i: usize, arg_p: [*c]X509_TRUST) callconv(.C) [*c]X509_TRUST {
    const sk = arg_sk;
    const i = arg_i;
    const p = arg_p;
    return @as([*c]X509_TRUST, @ptrCast(@alignCast(sk_set(@as([*c]_STACK, @ptrCast(@alignCast(sk))), i, @as(?*anyopaque, @ptrCast(p))))));
}
pub fn sk_X509_TRUST_free(arg_sk: ?*struct_stack_st_X509_TRUST) callconv(.C) void {
    const sk = arg_sk;
    sk_free(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_TRUST_pop_free(arg_sk: ?*struct_stack_st_X509_TRUST, arg_free_func: sk_X509_TRUST_free_func) callconv(.C) void {
    const sk = arg_sk;
    const free_func = arg_free_func;
    sk_pop_free_ex(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_X509_TRUST_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))));
}
pub fn sk_X509_TRUST_insert(arg_sk: ?*struct_stack_st_X509_TRUST, arg_p: [*c]X509_TRUST, arg_where: usize) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    const where = arg_where;
    return sk_insert(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)), where);
}
pub fn sk_X509_TRUST_delete(arg_sk: ?*struct_stack_st_X509_TRUST, arg_where: usize) callconv(.C) [*c]X509_TRUST {
    const sk = arg_sk;
    const where = arg_where;
    return @as([*c]X509_TRUST, @ptrCast(@alignCast(sk_delete(@as([*c]_STACK, @ptrCast(@alignCast(sk))), where))));
}
pub fn sk_X509_TRUST_delete_ptr(arg_sk: ?*struct_stack_st_X509_TRUST, arg_p: [*c]const X509_TRUST) callconv(.C) [*c]X509_TRUST {
    const sk = arg_sk;
    const p = arg_p;
    return @as([*c]X509_TRUST, @ptrCast(@alignCast(sk_delete_ptr(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*const anyopaque, @ptrCast(p))))));
}
pub fn sk_X509_TRUST_find(arg_sk: ?*const struct_stack_st_X509_TRUST, arg_out_index: [*c]usize, arg_p: [*c]const X509_TRUST) callconv(.C) c_int {
    const sk = arg_sk;
    const out_index = arg_out_index;
    const p = arg_p;
    return sk_find(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), out_index, @as(?*const anyopaque, @ptrCast(p)), &sk_X509_TRUST_call_cmp_func);
}
pub fn sk_X509_TRUST_shift(arg_sk: ?*struct_stack_st_X509_TRUST) callconv(.C) [*c]X509_TRUST {
    const sk = arg_sk;
    return @as([*c]X509_TRUST, @ptrCast(@alignCast(sk_shift(@as([*c]_STACK, @ptrCast(@alignCast(sk)))))));
}
pub fn sk_X509_TRUST_push(arg_sk: ?*struct_stack_st_X509_TRUST, arg_p: [*c]X509_TRUST) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    return sk_push(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)));
}
pub fn sk_X509_TRUST_pop(arg_sk: ?*struct_stack_st_X509_TRUST) callconv(.C) [*c]X509_TRUST {
    const sk = arg_sk;
    return @as([*c]X509_TRUST, @ptrCast(@alignCast(sk_pop(@as([*c]_STACK, @ptrCast(@alignCast(sk)))))));
}
pub fn sk_X509_TRUST_dup(arg_sk: ?*const struct_stack_st_X509_TRUST) callconv(.C) ?*struct_stack_st_X509_TRUST {
    const sk = arg_sk;
    return @as(?*struct_stack_st_X509_TRUST, @ptrCast(sk_dup(@as([*c]const _STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_TRUST_sort(arg_sk: ?*struct_stack_st_X509_TRUST) callconv(.C) void {
    const sk = arg_sk;
    sk_sort(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_X509_TRUST_call_cmp_func);
}
pub fn sk_X509_TRUST_is_sorted(arg_sk: ?*const struct_stack_st_X509_TRUST) callconv(.C) c_int {
    const sk = arg_sk;
    return sk_is_sorted(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_TRUST_set_cmp_func(arg_sk: ?*struct_stack_st_X509_TRUST, arg_comp: sk_X509_TRUST_cmp_func) callconv(.C) sk_X509_TRUST_cmp_func {
    const sk = arg_sk;
    const comp = arg_comp;
    return @as(sk_X509_TRUST_cmp_func, @ptrCast(@alignCast(sk_set_cmp_func(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp)))))));
}
pub fn sk_X509_TRUST_deep_copy(arg_sk: ?*const struct_stack_st_X509_TRUST, arg_copy_func: sk_X509_TRUST_copy_func, arg_free_func: sk_X509_TRUST_free_func) callconv(.C) ?*struct_stack_st_X509_TRUST {
    const sk = arg_sk;
    const copy_func = arg_copy_func;
    const free_func = arg_free_func;
    return @as(?*struct_stack_st_X509_TRUST, @ptrCast(sk_deep_copy(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), &sk_X509_TRUST_call_copy_func, @as(OPENSSL_sk_copy_func, @ptrCast(@alignCast(copy_func))), &sk_X509_TRUST_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))))));
}
pub const sk_X509_REVOKED_free_func = ?*const fn (?*X509_REVOKED) callconv(.C) void;
pub const sk_X509_REVOKED_copy_func = ?*const fn (?*X509_REVOKED) callconv(.C) ?*X509_REVOKED;
pub const sk_X509_REVOKED_cmp_func = ?*const fn ([*c]?*const X509_REVOKED, [*c]?*const X509_REVOKED) callconv(.C) c_int;
pub fn sk_X509_REVOKED_call_free_func(arg_free_func: OPENSSL_sk_free_func, arg_ptr: ?*anyopaque) callconv(.C) void {
    const free_func = arg_free_func;
    const ptr = arg_ptr;
    @as(sk_X509_REVOKED_free_func, @ptrCast(@alignCast(free_func))).?(@as(?*X509_REVOKED, @ptrCast(ptr)));
}
pub fn sk_X509_REVOKED_call_copy_func(arg_copy_func: OPENSSL_sk_copy_func, arg_ptr: ?*anyopaque) callconv(.C) ?*anyopaque {
    const copy_func = arg_copy_func;
    const ptr = arg_ptr;
    return @as(?*anyopaque, @ptrCast(@as(sk_X509_REVOKED_copy_func, @ptrCast(@alignCast(copy_func))).?(@as(?*X509_REVOKED, @ptrCast(ptr)))));
}
pub fn sk_X509_REVOKED_call_cmp_func(arg_cmp_func: OPENSSL_sk_cmp_func, arg_a: [*c]const ?*const anyopaque, arg_b: [*c]const ?*const anyopaque) callconv(.C) c_int {
    const cmp_func = arg_cmp_func;
    const a = arg_a;
    const b = arg_b;
    var a_ptr: ?*const X509_REVOKED = @as(?*const X509_REVOKED, @ptrCast(a.*));
    var b_ptr: ?*const X509_REVOKED = @as(?*const X509_REVOKED, @ptrCast(b.*));
    return @as(sk_X509_REVOKED_cmp_func, @ptrCast(@alignCast(cmp_func))).?(&a_ptr, &b_ptr);
}
pub fn sk_X509_REVOKED_new(arg_comp: sk_X509_REVOKED_cmp_func) callconv(.C) ?*struct_stack_st_X509_REVOKED {
    const comp = arg_comp;
    return @as(?*struct_stack_st_X509_REVOKED, @ptrCast(sk_new(@as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp))))));
}
pub fn sk_X509_REVOKED_new_null() callconv(.C) ?*struct_stack_st_X509_REVOKED {
    return @as(?*struct_stack_st_X509_REVOKED, @ptrCast(sk_new_null()));
}
pub fn sk_X509_REVOKED_num(arg_sk: ?*const struct_stack_st_X509_REVOKED) callconv(.C) usize {
    const sk = arg_sk;
    return sk_num(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_REVOKED_zero(arg_sk: ?*struct_stack_st_X509_REVOKED) callconv(.C) void {
    const sk = arg_sk;
    sk_zero(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_REVOKED_value(arg_sk: ?*const struct_stack_st_X509_REVOKED, arg_i: usize) callconv(.C) ?*X509_REVOKED {
    const sk = arg_sk;
    const i = arg_i;
    return @as(?*X509_REVOKED, @ptrCast(sk_value(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), i)));
}
pub fn sk_X509_REVOKED_set(arg_sk: ?*struct_stack_st_X509_REVOKED, arg_i: usize, arg_p: ?*X509_REVOKED) callconv(.C) ?*X509_REVOKED {
    const sk = arg_sk;
    const i = arg_i;
    const p = arg_p;
    return @as(?*X509_REVOKED, @ptrCast(sk_set(@as([*c]_STACK, @ptrCast(@alignCast(sk))), i, @as(?*anyopaque, @ptrCast(p)))));
}
pub fn sk_X509_REVOKED_free(arg_sk: ?*struct_stack_st_X509_REVOKED) callconv(.C) void {
    const sk = arg_sk;
    sk_free(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_REVOKED_pop_free(arg_sk: ?*struct_stack_st_X509_REVOKED, arg_free_func: sk_X509_REVOKED_free_func) callconv(.C) void {
    const sk = arg_sk;
    const free_func = arg_free_func;
    sk_pop_free_ex(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_X509_REVOKED_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))));
}
pub fn sk_X509_REVOKED_insert(arg_sk: ?*struct_stack_st_X509_REVOKED, arg_p: ?*X509_REVOKED, arg_where: usize) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    const where = arg_where;
    return sk_insert(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)), where);
}
pub fn sk_X509_REVOKED_delete(arg_sk: ?*struct_stack_st_X509_REVOKED, arg_where: usize) callconv(.C) ?*X509_REVOKED {
    const sk = arg_sk;
    const where = arg_where;
    return @as(?*X509_REVOKED, @ptrCast(sk_delete(@as([*c]_STACK, @ptrCast(@alignCast(sk))), where)));
}
pub fn sk_X509_REVOKED_delete_ptr(arg_sk: ?*struct_stack_st_X509_REVOKED, arg_p: ?*const X509_REVOKED) callconv(.C) ?*X509_REVOKED {
    const sk = arg_sk;
    const p = arg_p;
    return @as(?*X509_REVOKED, @ptrCast(sk_delete_ptr(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*const anyopaque, @ptrCast(p)))));
}
pub fn sk_X509_REVOKED_find(arg_sk: ?*const struct_stack_st_X509_REVOKED, arg_out_index: [*c]usize, arg_p: ?*const X509_REVOKED) callconv(.C) c_int {
    const sk = arg_sk;
    const out_index = arg_out_index;
    const p = arg_p;
    return sk_find(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), out_index, @as(?*const anyopaque, @ptrCast(p)), &sk_X509_REVOKED_call_cmp_func);
}
pub fn sk_X509_REVOKED_shift(arg_sk: ?*struct_stack_st_X509_REVOKED) callconv(.C) ?*X509_REVOKED {
    const sk = arg_sk;
    return @as(?*X509_REVOKED, @ptrCast(sk_shift(@as([*c]_STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_REVOKED_push(arg_sk: ?*struct_stack_st_X509_REVOKED, arg_p: ?*X509_REVOKED) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    return sk_push(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)));
}
pub fn sk_X509_REVOKED_pop(arg_sk: ?*struct_stack_st_X509_REVOKED) callconv(.C) ?*X509_REVOKED {
    const sk = arg_sk;
    return @as(?*X509_REVOKED, @ptrCast(sk_pop(@as([*c]_STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_REVOKED_dup(arg_sk: ?*const struct_stack_st_X509_REVOKED) callconv(.C) ?*struct_stack_st_X509_REVOKED {
    const sk = arg_sk;
    return @as(?*struct_stack_st_X509_REVOKED, @ptrCast(sk_dup(@as([*c]const _STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_REVOKED_sort(arg_sk: ?*struct_stack_st_X509_REVOKED) callconv(.C) void {
    const sk = arg_sk;
    sk_sort(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_X509_REVOKED_call_cmp_func);
}
pub fn sk_X509_REVOKED_is_sorted(arg_sk: ?*const struct_stack_st_X509_REVOKED) callconv(.C) c_int {
    const sk = arg_sk;
    return sk_is_sorted(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_REVOKED_set_cmp_func(arg_sk: ?*struct_stack_st_X509_REVOKED, arg_comp: sk_X509_REVOKED_cmp_func) callconv(.C) sk_X509_REVOKED_cmp_func {
    const sk = arg_sk;
    const comp = arg_comp;
    return @as(sk_X509_REVOKED_cmp_func, @ptrCast(@alignCast(sk_set_cmp_func(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp)))))));
}
pub fn sk_X509_REVOKED_deep_copy(arg_sk: ?*const struct_stack_st_X509_REVOKED, arg_copy_func: sk_X509_REVOKED_copy_func, arg_free_func: sk_X509_REVOKED_free_func) callconv(.C) ?*struct_stack_st_X509_REVOKED {
    const sk = arg_sk;
    const copy_func = arg_copy_func;
    const free_func = arg_free_func;
    return @as(?*struct_stack_st_X509_REVOKED, @ptrCast(sk_deep_copy(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), &sk_X509_REVOKED_call_copy_func, @as(OPENSSL_sk_copy_func, @ptrCast(@alignCast(copy_func))), &sk_X509_REVOKED_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))))));
}
pub const struct_stack_st_X509_INFO = opaque {};
pub const sk_X509_INFO_free_func = ?*const fn ([*c]X509_INFO) callconv(.C) void;
pub const sk_X509_INFO_copy_func = ?*const fn ([*c]X509_INFO) callconv(.C) [*c]X509_INFO;
pub const sk_X509_INFO_cmp_func = ?*const fn ([*c][*c]const X509_INFO, [*c][*c]const X509_INFO) callconv(.C) c_int;
pub fn sk_X509_INFO_call_free_func(arg_free_func: OPENSSL_sk_free_func, arg_ptr: ?*anyopaque) callconv(.C) void {
    const free_func = arg_free_func;
    const ptr = arg_ptr;
    @as(sk_X509_INFO_free_func, @ptrCast(@alignCast(free_func))).?(@as([*c]X509_INFO, @ptrCast(@alignCast(ptr))));
}
pub fn sk_X509_INFO_call_copy_func(arg_copy_func: OPENSSL_sk_copy_func, arg_ptr: ?*anyopaque) callconv(.C) ?*anyopaque {
    const copy_func = arg_copy_func;
    const ptr = arg_ptr;
    return @as(?*anyopaque, @ptrCast(@as(sk_X509_INFO_copy_func, @ptrCast(@alignCast(copy_func))).?(@as([*c]X509_INFO, @ptrCast(@alignCast(ptr))))));
}
pub fn sk_X509_INFO_call_cmp_func(arg_cmp_func: OPENSSL_sk_cmp_func, arg_a: [*c]const ?*const anyopaque, arg_b: [*c]const ?*const anyopaque) callconv(.C) c_int {
    const cmp_func = arg_cmp_func;
    const a = arg_a;
    const b = arg_b;
    var a_ptr: [*c]const X509_INFO = @as([*c]const X509_INFO, @ptrCast(@alignCast(a.*)));
    var b_ptr: [*c]const X509_INFO = @as([*c]const X509_INFO, @ptrCast(@alignCast(b.*)));
    return @as(sk_X509_INFO_cmp_func, @ptrCast(@alignCast(cmp_func))).?(&a_ptr, &b_ptr);
}
pub fn sk_X509_INFO_new(arg_comp: sk_X509_INFO_cmp_func) callconv(.C) ?*struct_stack_st_X509_INFO {
    const comp = arg_comp;
    return @as(?*struct_stack_st_X509_INFO, @ptrCast(sk_new(@as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp))))));
}
pub fn sk_X509_INFO_new_null() callconv(.C) ?*struct_stack_st_X509_INFO {
    return @as(?*struct_stack_st_X509_INFO, @ptrCast(sk_new_null()));
}
pub fn sk_X509_INFO_num(arg_sk: ?*const struct_stack_st_X509_INFO) callconv(.C) usize {
    const sk = arg_sk;
    return sk_num(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_INFO_zero(arg_sk: ?*struct_stack_st_X509_INFO) callconv(.C) void {
    const sk = arg_sk;
    sk_zero(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_INFO_value(arg_sk: ?*const struct_stack_st_X509_INFO, arg_i: usize) callconv(.C) [*c]X509_INFO {
    const sk = arg_sk;
    const i = arg_i;
    return @as([*c]X509_INFO, @ptrCast(@alignCast(sk_value(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), i))));
}
pub fn sk_X509_INFO_set(arg_sk: ?*struct_stack_st_X509_INFO, arg_i: usize, arg_p: [*c]X509_INFO) callconv(.C) [*c]X509_INFO {
    const sk = arg_sk;
    const i = arg_i;
    const p = arg_p;
    return @as([*c]X509_INFO, @ptrCast(@alignCast(sk_set(@as([*c]_STACK, @ptrCast(@alignCast(sk))), i, @as(?*anyopaque, @ptrCast(p))))));
}
pub fn sk_X509_INFO_free(arg_sk: ?*struct_stack_st_X509_INFO) callconv(.C) void {
    const sk = arg_sk;
    sk_free(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_INFO_pop_free(arg_sk: ?*struct_stack_st_X509_INFO, arg_free_func: sk_X509_INFO_free_func) callconv(.C) void {
    const sk = arg_sk;
    const free_func = arg_free_func;
    sk_pop_free_ex(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_X509_INFO_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))));
}
pub fn sk_X509_INFO_insert(arg_sk: ?*struct_stack_st_X509_INFO, arg_p: [*c]X509_INFO, arg_where: usize) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    const where = arg_where;
    return sk_insert(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)), where);
}
pub fn sk_X509_INFO_delete(arg_sk: ?*struct_stack_st_X509_INFO, arg_where: usize) callconv(.C) [*c]X509_INFO {
    const sk = arg_sk;
    const where = arg_where;
    return @as([*c]X509_INFO, @ptrCast(@alignCast(sk_delete(@as([*c]_STACK, @ptrCast(@alignCast(sk))), where))));
}
pub fn sk_X509_INFO_delete_ptr(arg_sk: ?*struct_stack_st_X509_INFO, arg_p: [*c]const X509_INFO) callconv(.C) [*c]X509_INFO {
    const sk = arg_sk;
    const p = arg_p;
    return @as([*c]X509_INFO, @ptrCast(@alignCast(sk_delete_ptr(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*const anyopaque, @ptrCast(p))))));
}
pub fn sk_X509_INFO_find(arg_sk: ?*const struct_stack_st_X509_INFO, arg_out_index: [*c]usize, arg_p: [*c]const X509_INFO) callconv(.C) c_int {
    const sk = arg_sk;
    const out_index = arg_out_index;
    const p = arg_p;
    return sk_find(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), out_index, @as(?*const anyopaque, @ptrCast(p)), &sk_X509_INFO_call_cmp_func);
}
pub fn sk_X509_INFO_shift(arg_sk: ?*struct_stack_st_X509_INFO) callconv(.C) [*c]X509_INFO {
    const sk = arg_sk;
    return @as([*c]X509_INFO, @ptrCast(@alignCast(sk_shift(@as([*c]_STACK, @ptrCast(@alignCast(sk)))))));
}
pub fn sk_X509_INFO_push(arg_sk: ?*struct_stack_st_X509_INFO, arg_p: [*c]X509_INFO) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    return sk_push(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)));
}
pub fn sk_X509_INFO_pop(arg_sk: ?*struct_stack_st_X509_INFO) callconv(.C) [*c]X509_INFO {
    const sk = arg_sk;
    return @as([*c]X509_INFO, @ptrCast(@alignCast(sk_pop(@as([*c]_STACK, @ptrCast(@alignCast(sk)))))));
}
pub fn sk_X509_INFO_dup(arg_sk: ?*const struct_stack_st_X509_INFO) callconv(.C) ?*struct_stack_st_X509_INFO {
    const sk = arg_sk;
    return @as(?*struct_stack_st_X509_INFO, @ptrCast(sk_dup(@as([*c]const _STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_INFO_sort(arg_sk: ?*struct_stack_st_X509_INFO) callconv(.C) void {
    const sk = arg_sk;
    sk_sort(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_X509_INFO_call_cmp_func);
}
pub fn sk_X509_INFO_is_sorted(arg_sk: ?*const struct_stack_st_X509_INFO) callconv(.C) c_int {
    const sk = arg_sk;
    return sk_is_sorted(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_INFO_set_cmp_func(arg_sk: ?*struct_stack_st_X509_INFO, arg_comp: sk_X509_INFO_cmp_func) callconv(.C) sk_X509_INFO_cmp_func {
    const sk = arg_sk;
    const comp = arg_comp;
    return @as(sk_X509_INFO_cmp_func, @ptrCast(@alignCast(sk_set_cmp_func(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp)))))));
}
pub fn sk_X509_INFO_deep_copy(arg_sk: ?*const struct_stack_st_X509_INFO, arg_copy_func: sk_X509_INFO_copy_func, arg_free_func: sk_X509_INFO_free_func) callconv(.C) ?*struct_stack_st_X509_INFO {
    const sk = arg_sk;
    const copy_func = arg_copy_func;
    const free_func = arg_free_func;
    return @as(?*struct_stack_st_X509_INFO, @ptrCast(sk_deep_copy(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), &sk_X509_INFO_call_copy_func, @as(OPENSSL_sk_copy_func, @ptrCast(@alignCast(copy_func))), &sk_X509_INFO_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))))));
}
pub extern fn X509_get_notBefore(x509: ?*const X509) [*c]ASN1_TIME;
pub extern fn X509_get_notAfter(x509: ?*const X509) [*c]ASN1_TIME;
pub extern fn X509_set_notBefore(x509: ?*X509, tm: [*c]const ASN1_TIME) c_int;
pub extern fn X509_set_notAfter(x509: ?*X509, tm: [*c]const ASN1_TIME) c_int;
pub extern fn X509_get_pathlen(x509: ?*X509) c_long;
pub extern fn X509_SIG_get0(sig: ?*const X509_SIG, out_alg: [*c][*c]const X509_ALGOR, out_digest: [*c][*c]const ASN1_OCTET_STRING) void;
pub extern fn X509_SIG_getm(sig: ?*X509_SIG, out_alg: [*c][*c]X509_ALGOR, out_digest: [*c][*c]ASN1_OCTET_STRING) void;
pub extern fn X509_verify_cert_error_string(err: c_long) [*c]const u8;
pub extern fn X509_verify(x509: ?*X509, pkey: [*c]EVP_PKEY) c_int;
pub extern fn X509_REQ_verify(req: ?*X509_REQ, pkey: [*c]EVP_PKEY) c_int;
pub extern fn X509_CRL_verify(crl: ?*X509_CRL, pkey: [*c]EVP_PKEY) c_int;
pub extern fn NETSCAPE_SPKI_verify(spki: [*c]NETSCAPE_SPKI, pkey: [*c]EVP_PKEY) c_int;
pub extern fn NETSCAPE_SPKI_b64_decode(str: [*c]const u8, len: c_int) [*c]NETSCAPE_SPKI;
pub extern fn NETSCAPE_SPKI_b64_encode(spki: [*c]NETSCAPE_SPKI) [*c]u8;
pub extern fn NETSCAPE_SPKI_get_pubkey(spki: [*c]NETSCAPE_SPKI) [*c]EVP_PKEY;
pub extern fn NETSCAPE_SPKI_set_pubkey(spki: [*c]NETSCAPE_SPKI, pkey: [*c]EVP_PKEY) c_int;
pub extern fn NETSCAPE_SPKI_sign(spki: [*c]NETSCAPE_SPKI, pkey: [*c]EVP_PKEY, md: ?*const EVP_MD) c_int;
pub extern fn X509_ATTRIBUTE_dup(xa: ?*const X509_ATTRIBUTE) ?*X509_ATTRIBUTE;
pub extern fn X509_REVOKED_dup(rev: ?*const X509_REVOKED) ?*X509_REVOKED;
pub extern fn X509_cmp_time(s: [*c]const ASN1_TIME, t: [*c]time_t) c_int;
pub extern fn X509_cmp_current_time(s: [*c]const ASN1_TIME) c_int;
pub extern fn X509_time_adj(s: [*c]ASN1_TIME, offset_sec: c_long, t: [*c]time_t) [*c]ASN1_TIME;
pub extern fn X509_time_adj_ex(s: [*c]ASN1_TIME, offset_day: c_int, offset_sec: c_long, t: [*c]time_t) [*c]ASN1_TIME;
pub extern fn X509_gmtime_adj(s: [*c]ASN1_TIME, offset_sec: c_long) [*c]ASN1_TIME;
pub extern fn X509_get_default_cert_area() [*c]const u8;
pub extern fn X509_get_default_cert_dir() [*c]const u8;
// pub extern fn X509_get_default_cert_file() [*c]const u8;
pub extern fn X509_get_default_cert_dir_env() [*c]const u8;
// pub extern fn X509_get_default_cert_file_env() [*c]const u8;
pub extern fn X509_get_default_private_dir() [*c]const u8;
pub extern fn X509_PUBKEY_new() ?*X509_PUBKEY;
pub extern fn X509_PUBKEY_free(a: ?*X509_PUBKEY) void;
pub extern fn d2i_X509_PUBKEY(a: [*c]?*X509_PUBKEY, in: [*c][*c]const u8, len: c_long) ?*X509_PUBKEY;
pub extern fn i2d_X509_PUBKEY(a: ?*const X509_PUBKEY, out: [*c][*c]u8) c_int;
pub extern const X509_PUBKEY_it: ASN1_ITEM;
pub extern fn X509_PUBKEY_set(x: [*c]?*X509_PUBKEY, pkey: [*c]EVP_PKEY) c_int;
pub extern fn X509_PUBKEY_get(key: ?*X509_PUBKEY) [*c]EVP_PKEY;
pub extern fn X509_SIG_new() ?*X509_SIG;
pub extern fn X509_SIG_free(a: ?*X509_SIG) void;
pub extern fn d2i_X509_SIG(a: [*c]?*X509_SIG, in: [*c][*c]const u8, len: c_long) ?*X509_SIG;
pub extern fn i2d_X509_SIG(a: ?*const X509_SIG, out: [*c][*c]u8) c_int;
pub extern const X509_SIG_it: ASN1_ITEM;
pub extern fn X509_ATTRIBUTE_new() ?*X509_ATTRIBUTE;
pub extern fn X509_ATTRIBUTE_free(a: ?*X509_ATTRIBUTE) void;
pub extern fn d2i_X509_ATTRIBUTE(a: [*c]?*X509_ATTRIBUTE, in: [*c][*c]const u8, len: c_long) ?*X509_ATTRIBUTE;
pub extern fn i2d_X509_ATTRIBUTE(a: ?*const X509_ATTRIBUTE, out: [*c][*c]u8) c_int;
pub extern const X509_ATTRIBUTE_it: ASN1_ITEM;
pub extern fn X509_ATTRIBUTE_create(nid: c_int, attrtype: c_int, value: ?*anyopaque) ?*X509_ATTRIBUTE;
pub extern fn X509_add1_trust_object(x: ?*X509, obj: ?*ASN1_OBJECT) c_int;
pub extern fn X509_add1_reject_object(x: ?*X509, obj: ?*ASN1_OBJECT) c_int;
pub extern fn X509_trust_clear(x: ?*X509) void;
pub extern fn X509_reject_clear(x: ?*X509) void;
pub extern fn X509_TRUST_set(t: [*c]c_int, trust: c_int) c_int;
pub extern fn X509_REVOKED_new() ?*X509_REVOKED;
pub extern fn X509_REVOKED_free(a: ?*X509_REVOKED) void;
pub extern fn d2i_X509_REVOKED(a: [*c]?*X509_REVOKED, in: [*c][*c]const u8, len: c_long) ?*X509_REVOKED;
pub extern fn i2d_X509_REVOKED(a: ?*const X509_REVOKED, out: [*c][*c]u8) c_int;
pub extern const X509_REVOKED_it: ASN1_ITEM;
pub extern fn X509_CRL_add0_revoked(crl: ?*X509_CRL, rev: ?*X509_REVOKED) c_int;
pub extern fn X509_CRL_get0_by_serial(crl: ?*X509_CRL, ret: [*c]?*X509_REVOKED, serial: [*c]ASN1_INTEGER) c_int;
pub extern fn X509_CRL_get0_by_cert(crl: ?*X509_CRL, ret: [*c]?*X509_REVOKED, x: ?*X509) c_int;
pub extern fn X509_PKEY_new() [*c]X509_PKEY;
pub extern fn X509_PKEY_free(a: [*c]X509_PKEY) void;
pub extern fn NETSCAPE_SPKI_new() [*c]NETSCAPE_SPKI;
pub extern fn NETSCAPE_SPKI_free(a: [*c]NETSCAPE_SPKI) void;
pub extern fn d2i_NETSCAPE_SPKI(a: [*c][*c]NETSCAPE_SPKI, in: [*c][*c]const u8, len: c_long) [*c]NETSCAPE_SPKI;
pub extern fn i2d_NETSCAPE_SPKI(a: [*c]const NETSCAPE_SPKI, out: [*c][*c]u8) c_int;
pub extern const NETSCAPE_SPKI_it: ASN1_ITEM;
pub extern fn NETSCAPE_SPKAC_new() [*c]NETSCAPE_SPKAC;
pub extern fn NETSCAPE_SPKAC_free(a: [*c]NETSCAPE_SPKAC) void;
pub extern fn d2i_NETSCAPE_SPKAC(a: [*c][*c]NETSCAPE_SPKAC, in: [*c][*c]const u8, len: c_long) [*c]NETSCAPE_SPKAC;
pub extern fn i2d_NETSCAPE_SPKAC(a: [*c]const NETSCAPE_SPKAC, out: [*c][*c]u8) c_int;
pub extern const NETSCAPE_SPKAC_it: ASN1_ITEM;
pub extern fn X509_INFO_new() [*c]X509_INFO;
pub extern fn X509_INFO_free(a: [*c]X509_INFO) void;
pub extern fn X509_NAME_oneline(a: ?*const X509_NAME, buf: [*c]u8, size: c_int) [*c]u8;
pub extern fn ASN1_digest(i2d: ?*const i2d_of_void, @"type": ?*const EVP_MD, data: [*c]u8, md: [*c]u8, len: [*c]c_uint) c_int;
pub extern fn ASN1_item_digest(it: ?*const ASN1_ITEM, @"type": ?*const EVP_MD, data: ?*anyopaque, md: [*c]u8, len: [*c]c_uint) c_int;
pub extern fn ASN1_item_verify(it: ?*const ASN1_ITEM, algor1: [*c]const X509_ALGOR, signature: [*c]const ASN1_BIT_STRING, data: ?*anyopaque, pkey: [*c]EVP_PKEY) c_int;
pub extern fn ASN1_item_sign(it: ?*const ASN1_ITEM, algor1: [*c]X509_ALGOR, algor2: [*c]X509_ALGOR, signature: [*c]ASN1_BIT_STRING, data: ?*anyopaque, pkey: [*c]EVP_PKEY, @"type": ?*const EVP_MD) c_int;
pub extern fn ASN1_item_sign_ctx(it: ?*const ASN1_ITEM, algor1: [*c]X509_ALGOR, algor2: [*c]X509_ALGOR, signature: [*c]ASN1_BIT_STRING, asn: ?*anyopaque, ctx: [*c]EVP_MD_CTX) c_int;
pub extern fn X509_REQ_extension_nid(nid: c_int) c_int;
pub extern fn X509_REQ_get_extensions(req: ?*X509_REQ) ?*struct_stack_st_X509_EXTENSION;
pub extern fn X509_REQ_add_extensions_nid(req: ?*X509_REQ, exts: ?*const struct_stack_st_X509_EXTENSION, nid: c_int) c_int;
pub extern fn X509_REQ_add_extensions(req: ?*X509_REQ, exts: ?*const struct_stack_st_X509_EXTENSION) c_int;
pub extern fn X509_REQ_get_attr_count(req: ?*const X509_REQ) c_int;
pub extern fn X509_REQ_get_attr_by_NID(req: ?*const X509_REQ, nid: c_int, lastpos: c_int) c_int;
pub extern fn X509_REQ_get_attr_by_OBJ(req: ?*const X509_REQ, obj: ?*const ASN1_OBJECT, lastpos: c_int) c_int;
pub extern fn X509_REQ_get_attr(req: ?*const X509_REQ, loc: c_int) ?*X509_ATTRIBUTE;
pub extern fn X509_REQ_delete_attr(req: ?*X509_REQ, loc: c_int) ?*X509_ATTRIBUTE;
pub extern fn X509_REQ_add1_attr(req: ?*X509_REQ, attr: ?*X509_ATTRIBUTE) c_int;
pub extern fn X509_REQ_add1_attr_by_OBJ(req: ?*X509_REQ, obj: ?*const ASN1_OBJECT, attrtype: c_int, data: [*c]const u8, len: c_int) c_int;
pub extern fn X509_REQ_add1_attr_by_NID(req: ?*X509_REQ, nid: c_int, attrtype: c_int, data: [*c]const u8, len: c_int) c_int;
pub extern fn X509_REQ_add1_attr_by_txt(req: ?*X509_REQ, attrname: [*c]const u8, attrtype: c_int, data: [*c]const u8, len: c_int) c_int;
pub extern fn X509_CRL_sort(crl: ?*X509_CRL) c_int;
pub extern fn X509_REVOKED_get0_serialNumber(revoked: ?*const X509_REVOKED) [*c]const ASN1_INTEGER;
pub extern fn X509_REVOKED_set_serialNumber(revoked: ?*X509_REVOKED, serial: [*c]const ASN1_INTEGER) c_int;
pub extern fn X509_REVOKED_get0_revocationDate(revoked: ?*const X509_REVOKED) [*c]const ASN1_TIME;
pub extern fn X509_REVOKED_set_revocationDate(revoked: ?*X509_REVOKED, tm: [*c]const ASN1_TIME) c_int;
pub extern fn X509_REVOKED_get0_extensions(r: ?*const X509_REVOKED) ?*const struct_stack_st_X509_EXTENSION;
pub extern fn X509_CRL_diff(base: ?*X509_CRL, newer: ?*X509_CRL, skey: [*c]EVP_PKEY, md: ?*const EVP_MD, flags: c_uint) ?*X509_CRL;
pub extern fn X509_REQ_check_private_key(x509: ?*X509_REQ, pkey: [*c]EVP_PKEY) c_int;
pub extern fn X509_check_private_key(x509: ?*X509, pkey: [*c]const EVP_PKEY) c_int;
pub extern fn X509_issuer_name_cmp(a: ?*const X509, b: ?*const X509) c_int;
pub extern fn X509_issuer_name_hash(a: ?*X509) c_ulong;
pub extern fn X509_subject_name_cmp(a: ?*const X509, b: ?*const X509) c_int;
pub extern fn X509_subject_name_hash(x: ?*X509) c_ulong;
pub extern fn X509_issuer_name_hash_old(a: ?*X509) c_ulong;
pub extern fn X509_subject_name_hash_old(x: ?*X509) c_ulong;
pub extern fn X509_cmp(a: ?*const X509, b: ?*const X509) c_int;
pub extern fn X509_NAME_cmp(a: ?*const X509_NAME, b: ?*const X509_NAME) c_int;
pub extern fn X509_NAME_hash(x: ?*X509_NAME) c_ulong;
pub extern fn X509_NAME_hash_old(x: ?*X509_NAME) c_ulong;
pub extern fn X509_CRL_cmp(a: ?*const X509_CRL, b: ?*const X509_CRL) c_int;
pub extern fn X509_CRL_match(a: ?*const X509_CRL, b: ?*const X509_CRL) c_int;
// pub extern fn X509_print_ex_fp(bp: [*c]FILE, x: ?*X509, nmflag: c_ulong, cflag: c_ulong) c_int;
// pub extern fn X509_print_fp(bp: [*c]FILE, x: ?*X509) c_int;
// pub extern fn X509_CRL_print_fp(bp: [*c]FILE, x: ?*X509_CRL) c_int;
// pub extern fn X509_REQ_print_fp(bp: [*c]FILE, req: ?*X509_REQ) c_int;
// pub extern fn X509_NAME_print_ex_fp(fp: [*c]FILE, nm: ?*const X509_NAME, indent: c_int, flags: c_ulong) c_int;
pub extern fn X509_NAME_print(bp: [*c]BIO, name: ?*const X509_NAME, obase: c_int) c_int;
pub extern fn X509_NAME_print_ex(out: [*c]BIO, nm: ?*const X509_NAME, indent: c_int, flags: c_ulong) c_int;
pub extern fn X509_print_ex(bp: [*c]BIO, x: ?*X509, nmflag: c_ulong, cflag: c_ulong) c_int;
pub extern fn X509_print(bp: [*c]BIO, x: ?*X509) c_int;
pub extern fn X509_CRL_print(bp: [*c]BIO, x: ?*X509_CRL) c_int;
pub extern fn X509_REQ_print_ex(bp: [*c]BIO, x: ?*X509_REQ, nmflag: c_ulong, cflag: c_ulong) c_int;
pub extern fn X509_REQ_print(bp: [*c]BIO, req: ?*X509_REQ) c_int;
pub extern fn X509_get_ext_d2i(x509: ?*const X509, nid: c_int, out_critical: [*c]c_int, out_idx: [*c]c_int) ?*anyopaque;
pub extern fn X509_add1_ext_i2d(x: ?*X509, nid: c_int, value: ?*anyopaque, crit: c_int, flags: c_ulong) c_int;
pub extern fn X509_CRL_get_ext_d2i(crl: ?*const X509_CRL, nid: c_int, out_critical: [*c]c_int, out_idx: [*c]c_int) ?*anyopaque;
pub extern fn X509_CRL_add1_ext_i2d(x: ?*X509_CRL, nid: c_int, value: ?*anyopaque, crit: c_int, flags: c_ulong) c_int;
pub extern fn X509_REVOKED_get_ext_count(x: ?*const X509_REVOKED) c_int;
pub extern fn X509_REVOKED_get_ext_by_NID(x: ?*const X509_REVOKED, nid: c_int, lastpos: c_int) c_int;
pub extern fn X509_REVOKED_get_ext_by_OBJ(x: ?*const X509_REVOKED, obj: ?*const ASN1_OBJECT, lastpos: c_int) c_int;
pub extern fn X509_REVOKED_get_ext_by_critical(x: ?*const X509_REVOKED, crit: c_int, lastpos: c_int) c_int;
pub extern fn X509_REVOKED_get_ext(x: ?*const X509_REVOKED, loc: c_int) ?*X509_EXTENSION;
pub extern fn X509_REVOKED_delete_ext(x: ?*X509_REVOKED, loc: c_int) ?*X509_EXTENSION;
pub extern fn X509_REVOKED_add_ext(x: ?*X509_REVOKED, ex: ?*const X509_EXTENSION, loc: c_int) c_int;
pub extern fn X509_REVOKED_get_ext_d2i(revoked: ?*const X509_REVOKED, nid: c_int, out_critical: [*c]c_int, out_idx: [*c]c_int) ?*anyopaque;
pub extern fn X509_REVOKED_add1_ext_i2d(x: ?*X509_REVOKED, nid: c_int, value: ?*anyopaque, crit: c_int, flags: c_ulong) c_int;
pub extern fn X509at_get_attr_count(x: ?*const struct_stack_st_X509_ATTRIBUTE) c_int;
pub extern fn X509at_get_attr_by_NID(x: ?*const struct_stack_st_X509_ATTRIBUTE, nid: c_int, lastpos: c_int) c_int;
pub extern fn X509at_get_attr_by_OBJ(sk: ?*const struct_stack_st_X509_ATTRIBUTE, obj: ?*const ASN1_OBJECT, lastpos: c_int) c_int;
pub extern fn X509at_get_attr(x: ?*const struct_stack_st_X509_ATTRIBUTE, loc: c_int) ?*X509_ATTRIBUTE;
pub extern fn X509at_delete_attr(x: ?*struct_stack_st_X509_ATTRIBUTE, loc: c_int) ?*X509_ATTRIBUTE;
pub extern fn X509at_add1_attr(x: [*c]?*struct_stack_st_X509_ATTRIBUTE, attr: ?*X509_ATTRIBUTE) ?*struct_stack_st_X509_ATTRIBUTE;
pub extern fn X509at_add1_attr_by_OBJ(x: [*c]?*struct_stack_st_X509_ATTRIBUTE, obj: ?*const ASN1_OBJECT, @"type": c_int, bytes: [*c]const u8, len: c_int) ?*struct_stack_st_X509_ATTRIBUTE;
pub extern fn X509at_add1_attr_by_NID(x: [*c]?*struct_stack_st_X509_ATTRIBUTE, nid: c_int, @"type": c_int, bytes: [*c]const u8, len: c_int) ?*struct_stack_st_X509_ATTRIBUTE;
pub extern fn X509at_add1_attr_by_txt(x: [*c]?*struct_stack_st_X509_ATTRIBUTE, attrname: [*c]const u8, @"type": c_int, bytes: [*c]const u8, len: c_int) ?*struct_stack_st_X509_ATTRIBUTE;
pub extern fn X509_ATTRIBUTE_create_by_NID(attr: [*c]?*X509_ATTRIBUTE, nid: c_int, attrtype: c_int, data: ?*const anyopaque, len: c_int) ?*X509_ATTRIBUTE;
pub extern fn X509_ATTRIBUTE_create_by_OBJ(attr: [*c]?*X509_ATTRIBUTE, obj: ?*const ASN1_OBJECT, attrtype: c_int, data: ?*const anyopaque, len: c_int) ?*X509_ATTRIBUTE;
pub extern fn X509_ATTRIBUTE_create_by_txt(attr: [*c]?*X509_ATTRIBUTE, attrname: [*c]const u8, @"type": c_int, bytes: [*c]const u8, len: c_int) ?*X509_ATTRIBUTE;
pub extern fn X509_ATTRIBUTE_set1_object(attr: ?*X509_ATTRIBUTE, obj: ?*const ASN1_OBJECT) c_int;
pub extern fn X509_ATTRIBUTE_set1_data(attr: ?*X509_ATTRIBUTE, attrtype: c_int, data: ?*const anyopaque, len: c_int) c_int;
pub extern fn X509_ATTRIBUTE_get0_data(attr: ?*X509_ATTRIBUTE, idx: c_int, attrtype: c_int, unused: ?*anyopaque) ?*anyopaque;
pub extern fn X509_ATTRIBUTE_count(attr: ?*const X509_ATTRIBUTE) c_int;
pub extern fn X509_ATTRIBUTE_get0_object(attr: ?*X509_ATTRIBUTE) ?*ASN1_OBJECT;
pub extern fn X509_ATTRIBUTE_get0_type(attr: ?*X509_ATTRIBUTE, idx: c_int) [*c]ASN1_TYPE;
pub extern fn X509_verify_cert(ctx: ?*X509_STORE_CTX) c_int;
pub extern fn PKCS8_PRIV_KEY_INFO_new() ?*PKCS8_PRIV_KEY_INFO;
pub extern fn PKCS8_PRIV_KEY_INFO_free(a: ?*PKCS8_PRIV_KEY_INFO) void;
pub extern fn d2i_PKCS8_PRIV_KEY_INFO(a: [*c]?*PKCS8_PRIV_KEY_INFO, in: [*c][*c]const u8, len: c_long) ?*PKCS8_PRIV_KEY_INFO;
pub extern fn i2d_PKCS8_PRIV_KEY_INFO(a: ?*const PKCS8_PRIV_KEY_INFO, out: [*c][*c]u8) c_int;
pub extern const PKCS8_PRIV_KEY_INFO_it: ASN1_ITEM;
pub extern fn EVP_PKCS82PKEY(p8: ?*const PKCS8_PRIV_KEY_INFO) [*c]EVP_PKEY;
pub extern fn EVP_PKEY2PKCS8(pkey: [*c]const EVP_PKEY) ?*PKCS8_PRIV_KEY_INFO;
pub extern fn X509_PUBKEY_set0_param(@"pub": ?*X509_PUBKEY, obj: ?*ASN1_OBJECT, param_type: c_int, param_value: ?*anyopaque, key: [*c]u8, key_len: c_int) c_int;
pub extern fn X509_PUBKEY_get0_param(out_obj: [*c]?*ASN1_OBJECT, out_key: [*c][*c]const u8, out_key_len: [*c]c_int, out_alg: [*c][*c]X509_ALGOR, @"pub": ?*X509_PUBKEY) c_int;
pub extern fn X509_PUBKEY_get0_public_key(@"pub": ?*const X509_PUBKEY) [*c]const ASN1_BIT_STRING;
pub extern fn X509_check_trust(x: ?*X509, id: c_int, flags: c_int) c_int;
pub extern fn X509_TRUST_get_count() c_int;
pub extern fn X509_TRUST_get0(idx: c_int) [*c]X509_TRUST;
pub extern fn X509_TRUST_get_by_id(id: c_int) c_int;
pub extern fn X509_TRUST_add(id: c_int, flags: c_int, ck: ?*const fn ([*c]X509_TRUST, ?*X509, c_int) callconv(.C) c_int, name: [*c]u8, arg1: c_int, arg2: ?*anyopaque) c_int;
pub extern fn X509_TRUST_cleanup() void;
pub extern fn X509_TRUST_get_flags(xp: [*c]const X509_TRUST) c_int;
pub extern fn X509_TRUST_get0_name(xp: [*c]const X509_TRUST) [*c]u8;
pub extern fn X509_TRUST_get_trust(xp: [*c]const X509_TRUST) c_int;
pub extern fn RSA_PSS_PARAMS_new() [*c]RSA_PSS_PARAMS;
pub extern fn RSA_PSS_PARAMS_free(a: [*c]RSA_PSS_PARAMS) void;
pub extern fn d2i_RSA_PSS_PARAMS(a: [*c][*c]RSA_PSS_PARAMS, in: [*c][*c]const u8, len: c_long) [*c]RSA_PSS_PARAMS;
pub extern fn i2d_RSA_PSS_PARAMS(a: [*c]const RSA_PSS_PARAMS, out: [*c][*c]u8) c_int;
pub extern const RSA_PSS_PARAMS_it: ASN1_ITEM;
pub const struct_stack_st_X509_LOOKUP = opaque {};
pub const sk_X509_LOOKUP_free_func = ?*const fn (?*X509_LOOKUP) callconv(.C) void;
pub const sk_X509_LOOKUP_copy_func = ?*const fn (?*X509_LOOKUP) callconv(.C) ?*X509_LOOKUP;
pub const sk_X509_LOOKUP_cmp_func = ?*const fn ([*c]?*const X509_LOOKUP, [*c]?*const X509_LOOKUP) callconv(.C) c_int;
pub fn sk_X509_LOOKUP_call_free_func(arg_free_func: OPENSSL_sk_free_func, arg_ptr: ?*anyopaque) callconv(.C) void {
    const free_func = arg_free_func;
    const ptr = arg_ptr;
    @as(sk_X509_LOOKUP_free_func, @ptrCast(@alignCast(free_func))).?(@as(?*X509_LOOKUP, @ptrCast(ptr)));
}
pub fn sk_X509_LOOKUP_call_copy_func(arg_copy_func: OPENSSL_sk_copy_func, arg_ptr: ?*anyopaque) callconv(.C) ?*anyopaque {
    const copy_func = arg_copy_func;
    const ptr = arg_ptr;
    return @as(?*anyopaque, @ptrCast(@as(sk_X509_LOOKUP_copy_func, @ptrCast(@alignCast(copy_func))).?(@as(?*X509_LOOKUP, @ptrCast(ptr)))));
}
pub fn sk_X509_LOOKUP_call_cmp_func(arg_cmp_func: OPENSSL_sk_cmp_func, arg_a: [*c]const ?*const anyopaque, arg_b: [*c]const ?*const anyopaque) callconv(.C) c_int {
    const cmp_func = arg_cmp_func;
    const a = arg_a;
    const b = arg_b;
    var a_ptr: ?*const X509_LOOKUP = @as(?*const X509_LOOKUP, @ptrCast(a.*));
    var b_ptr: ?*const X509_LOOKUP = @as(?*const X509_LOOKUP, @ptrCast(b.*));
    return @as(sk_X509_LOOKUP_cmp_func, @ptrCast(@alignCast(cmp_func))).?(&a_ptr, &b_ptr);
}
pub fn sk_X509_LOOKUP_new(arg_comp: sk_X509_LOOKUP_cmp_func) callconv(.C) ?*struct_stack_st_X509_LOOKUP {
    const comp = arg_comp;
    return @as(?*struct_stack_st_X509_LOOKUP, @ptrCast(sk_new(@as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp))))));
}
pub fn sk_X509_LOOKUP_new_null() callconv(.C) ?*struct_stack_st_X509_LOOKUP {
    return @as(?*struct_stack_st_X509_LOOKUP, @ptrCast(sk_new_null()));
}
pub fn sk_X509_LOOKUP_num(arg_sk: ?*const struct_stack_st_X509_LOOKUP) callconv(.C) usize {
    const sk = arg_sk;
    return sk_num(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_LOOKUP_zero(arg_sk: ?*struct_stack_st_X509_LOOKUP) callconv(.C) void {
    const sk = arg_sk;
    sk_zero(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_LOOKUP_value(arg_sk: ?*const struct_stack_st_X509_LOOKUP, arg_i: usize) callconv(.C) ?*X509_LOOKUP {
    const sk = arg_sk;
    const i = arg_i;
    return @as(?*X509_LOOKUP, @ptrCast(sk_value(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), i)));
}
pub fn sk_X509_LOOKUP_set(arg_sk: ?*struct_stack_st_X509_LOOKUP, arg_i: usize, arg_p: ?*X509_LOOKUP) callconv(.C) ?*X509_LOOKUP {
    const sk = arg_sk;
    const i = arg_i;
    const p = arg_p;
    return @as(?*X509_LOOKUP, @ptrCast(sk_set(@as([*c]_STACK, @ptrCast(@alignCast(sk))), i, @as(?*anyopaque, @ptrCast(p)))));
}
pub fn sk_X509_LOOKUP_free(arg_sk: ?*struct_stack_st_X509_LOOKUP) callconv(.C) void {
    const sk = arg_sk;
    sk_free(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_LOOKUP_pop_free(arg_sk: ?*struct_stack_st_X509_LOOKUP, arg_free_func: sk_X509_LOOKUP_free_func) callconv(.C) void {
    const sk = arg_sk;
    const free_func = arg_free_func;
    sk_pop_free_ex(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_X509_LOOKUP_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))));
}
pub fn sk_X509_LOOKUP_insert(arg_sk: ?*struct_stack_st_X509_LOOKUP, arg_p: ?*X509_LOOKUP, arg_where: usize) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    const where = arg_where;
    return sk_insert(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)), where);
}
pub fn sk_X509_LOOKUP_delete(arg_sk: ?*struct_stack_st_X509_LOOKUP, arg_where: usize) callconv(.C) ?*X509_LOOKUP {
    const sk = arg_sk;
    const where = arg_where;
    return @as(?*X509_LOOKUP, @ptrCast(sk_delete(@as([*c]_STACK, @ptrCast(@alignCast(sk))), where)));
}
pub fn sk_X509_LOOKUP_delete_ptr(arg_sk: ?*struct_stack_st_X509_LOOKUP, arg_p: ?*const X509_LOOKUP) callconv(.C) ?*X509_LOOKUP {
    const sk = arg_sk;
    const p = arg_p;
    return @as(?*X509_LOOKUP, @ptrCast(sk_delete_ptr(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*const anyopaque, @ptrCast(p)))));
}
pub fn sk_X509_LOOKUP_find(arg_sk: ?*const struct_stack_st_X509_LOOKUP, arg_out_index: [*c]usize, arg_p: ?*const X509_LOOKUP) callconv(.C) c_int {
    const sk = arg_sk;
    const out_index = arg_out_index;
    const p = arg_p;
    return sk_find(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), out_index, @as(?*const anyopaque, @ptrCast(p)), &sk_X509_LOOKUP_call_cmp_func);
}
pub fn sk_X509_LOOKUP_shift(arg_sk: ?*struct_stack_st_X509_LOOKUP) callconv(.C) ?*X509_LOOKUP {
    const sk = arg_sk;
    return @as(?*X509_LOOKUP, @ptrCast(sk_shift(@as([*c]_STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_LOOKUP_push(arg_sk: ?*struct_stack_st_X509_LOOKUP, arg_p: ?*X509_LOOKUP) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    return sk_push(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)));
}
pub fn sk_X509_LOOKUP_pop(arg_sk: ?*struct_stack_st_X509_LOOKUP) callconv(.C) ?*X509_LOOKUP {
    const sk = arg_sk;
    return @as(?*X509_LOOKUP, @ptrCast(sk_pop(@as([*c]_STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_LOOKUP_dup(arg_sk: ?*const struct_stack_st_X509_LOOKUP) callconv(.C) ?*struct_stack_st_X509_LOOKUP {
    const sk = arg_sk;
    return @as(?*struct_stack_st_X509_LOOKUP, @ptrCast(sk_dup(@as([*c]const _STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_LOOKUP_sort(arg_sk: ?*struct_stack_st_X509_LOOKUP) callconv(.C) void {
    const sk = arg_sk;
    sk_sort(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_X509_LOOKUP_call_cmp_func);
}
pub fn sk_X509_LOOKUP_is_sorted(arg_sk: ?*const struct_stack_st_X509_LOOKUP) callconv(.C) c_int {
    const sk = arg_sk;
    return sk_is_sorted(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_LOOKUP_set_cmp_func(arg_sk: ?*struct_stack_st_X509_LOOKUP, arg_comp: sk_X509_LOOKUP_cmp_func) callconv(.C) sk_X509_LOOKUP_cmp_func {
    const sk = arg_sk;
    const comp = arg_comp;
    return @as(sk_X509_LOOKUP_cmp_func, @ptrCast(@alignCast(sk_set_cmp_func(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp)))))));
}
pub fn sk_X509_LOOKUP_deep_copy(arg_sk: ?*const struct_stack_st_X509_LOOKUP, arg_copy_func: sk_X509_LOOKUP_copy_func, arg_free_func: sk_X509_LOOKUP_free_func) callconv(.C) ?*struct_stack_st_X509_LOOKUP {
    const sk = arg_sk;
    const copy_func = arg_copy_func;
    const free_func = arg_free_func;
    return @as(?*struct_stack_st_X509_LOOKUP, @ptrCast(sk_deep_copy(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), &sk_X509_LOOKUP_call_copy_func, @as(OPENSSL_sk_copy_func, @ptrCast(@alignCast(copy_func))), &sk_X509_LOOKUP_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))))));
}
pub const struct_stack_st_X509_OBJECT = opaque {};
pub const sk_X509_OBJECT_free_func = ?*const fn (?*X509_OBJECT) callconv(.C) void;
pub const sk_X509_OBJECT_copy_func = ?*const fn (?*X509_OBJECT) callconv(.C) ?*X509_OBJECT;
pub const sk_X509_OBJECT_cmp_func = ?*const fn ([*c]?*const X509_OBJECT, [*c]?*const X509_OBJECT) callconv(.C) c_int;
pub fn sk_X509_OBJECT_call_free_func(arg_free_func: OPENSSL_sk_free_func, arg_ptr: ?*anyopaque) callconv(.C) void {
    const free_func = arg_free_func;
    const ptr = arg_ptr;
    @as(sk_X509_OBJECT_free_func, @ptrCast(@alignCast(free_func))).?(@as(?*X509_OBJECT, @ptrCast(ptr)));
}
pub fn sk_X509_OBJECT_call_copy_func(arg_copy_func: OPENSSL_sk_copy_func, arg_ptr: ?*anyopaque) callconv(.C) ?*anyopaque {
    const copy_func = arg_copy_func;
    const ptr = arg_ptr;
    return @as(?*anyopaque, @ptrCast(@as(sk_X509_OBJECT_copy_func, @ptrCast(@alignCast(copy_func))).?(@as(?*X509_OBJECT, @ptrCast(ptr)))));
}
pub fn sk_X509_OBJECT_call_cmp_func(arg_cmp_func: OPENSSL_sk_cmp_func, arg_a: [*c]const ?*const anyopaque, arg_b: [*c]const ?*const anyopaque) callconv(.C) c_int {
    const cmp_func = arg_cmp_func;
    const a = arg_a;
    const b = arg_b;
    var a_ptr: ?*const X509_OBJECT = @as(?*const X509_OBJECT, @ptrCast(a.*));
    var b_ptr: ?*const X509_OBJECT = @as(?*const X509_OBJECT, @ptrCast(b.*));
    return @as(sk_X509_OBJECT_cmp_func, @ptrCast(@alignCast(cmp_func))).?(&a_ptr, &b_ptr);
}
pub fn sk_X509_OBJECT_new(arg_comp: sk_X509_OBJECT_cmp_func) callconv(.C) ?*struct_stack_st_X509_OBJECT {
    const comp = arg_comp;
    return @as(?*struct_stack_st_X509_OBJECT, @ptrCast(sk_new(@as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp))))));
}
pub fn sk_X509_OBJECT_new_null() callconv(.C) ?*struct_stack_st_X509_OBJECT {
    return @as(?*struct_stack_st_X509_OBJECT, @ptrCast(sk_new_null()));
}
pub fn sk_X509_OBJECT_num(arg_sk: ?*const struct_stack_st_X509_OBJECT) callconv(.C) usize {
    const sk = arg_sk;
    return sk_num(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_OBJECT_zero(arg_sk: ?*struct_stack_st_X509_OBJECT) callconv(.C) void {
    const sk = arg_sk;
    sk_zero(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_OBJECT_value(arg_sk: ?*const struct_stack_st_X509_OBJECT, arg_i: usize) callconv(.C) ?*X509_OBJECT {
    const sk = arg_sk;
    const i = arg_i;
    return @as(?*X509_OBJECT, @ptrCast(sk_value(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), i)));
}
pub fn sk_X509_OBJECT_set(arg_sk: ?*struct_stack_st_X509_OBJECT, arg_i: usize, arg_p: ?*X509_OBJECT) callconv(.C) ?*X509_OBJECT {
    const sk = arg_sk;
    const i = arg_i;
    const p = arg_p;
    return @as(?*X509_OBJECT, @ptrCast(sk_set(@as([*c]_STACK, @ptrCast(@alignCast(sk))), i, @as(?*anyopaque, @ptrCast(p)))));
}
pub fn sk_X509_OBJECT_free(arg_sk: ?*struct_stack_st_X509_OBJECT) callconv(.C) void {
    const sk = arg_sk;
    sk_free(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_OBJECT_pop_free(arg_sk: ?*struct_stack_st_X509_OBJECT, arg_free_func: sk_X509_OBJECT_free_func) callconv(.C) void {
    const sk = arg_sk;
    const free_func = arg_free_func;
    sk_pop_free_ex(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_X509_OBJECT_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))));
}
pub fn sk_X509_OBJECT_insert(arg_sk: ?*struct_stack_st_X509_OBJECT, arg_p: ?*X509_OBJECT, arg_where: usize) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    const where = arg_where;
    return sk_insert(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)), where);
}
pub fn sk_X509_OBJECT_delete(arg_sk: ?*struct_stack_st_X509_OBJECT, arg_where: usize) callconv(.C) ?*X509_OBJECT {
    const sk = arg_sk;
    const where = arg_where;
    return @as(?*X509_OBJECT, @ptrCast(sk_delete(@as([*c]_STACK, @ptrCast(@alignCast(sk))), where)));
}
pub fn sk_X509_OBJECT_delete_ptr(arg_sk: ?*struct_stack_st_X509_OBJECT, arg_p: ?*const X509_OBJECT) callconv(.C) ?*X509_OBJECT {
    const sk = arg_sk;
    const p = arg_p;
    return @as(?*X509_OBJECT, @ptrCast(sk_delete_ptr(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*const anyopaque, @ptrCast(p)))));
}
pub fn sk_X509_OBJECT_find(arg_sk: ?*const struct_stack_st_X509_OBJECT, arg_out_index: [*c]usize, arg_p: ?*const X509_OBJECT) callconv(.C) c_int {
    const sk = arg_sk;
    const out_index = arg_out_index;
    const p = arg_p;
    return sk_find(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), out_index, @as(?*const anyopaque, @ptrCast(p)), &sk_X509_OBJECT_call_cmp_func);
}
pub fn sk_X509_OBJECT_shift(arg_sk: ?*struct_stack_st_X509_OBJECT) callconv(.C) ?*X509_OBJECT {
    const sk = arg_sk;
    return @as(?*X509_OBJECT, @ptrCast(sk_shift(@as([*c]_STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_OBJECT_push(arg_sk: ?*struct_stack_st_X509_OBJECT, arg_p: ?*X509_OBJECT) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    return sk_push(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)));
}
pub fn sk_X509_OBJECT_pop(arg_sk: ?*struct_stack_st_X509_OBJECT) callconv(.C) ?*X509_OBJECT {
    const sk = arg_sk;
    return @as(?*X509_OBJECT, @ptrCast(sk_pop(@as([*c]_STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_OBJECT_dup(arg_sk: ?*const struct_stack_st_X509_OBJECT) callconv(.C) ?*struct_stack_st_X509_OBJECT {
    const sk = arg_sk;
    return @as(?*struct_stack_st_X509_OBJECT, @ptrCast(sk_dup(@as([*c]const _STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_OBJECT_sort(arg_sk: ?*struct_stack_st_X509_OBJECT) callconv(.C) void {
    const sk = arg_sk;
    sk_sort(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_X509_OBJECT_call_cmp_func);
}
pub fn sk_X509_OBJECT_is_sorted(arg_sk: ?*const struct_stack_st_X509_OBJECT) callconv(.C) c_int {
    const sk = arg_sk;
    return sk_is_sorted(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_OBJECT_set_cmp_func(arg_sk: ?*struct_stack_st_X509_OBJECT, arg_comp: sk_X509_OBJECT_cmp_func) callconv(.C) sk_X509_OBJECT_cmp_func {
    const sk = arg_sk;
    const comp = arg_comp;
    return @as(sk_X509_OBJECT_cmp_func, @ptrCast(@alignCast(sk_set_cmp_func(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp)))))));
}
pub fn sk_X509_OBJECT_deep_copy(arg_sk: ?*const struct_stack_st_X509_OBJECT, arg_copy_func: sk_X509_OBJECT_copy_func, arg_free_func: sk_X509_OBJECT_free_func) callconv(.C) ?*struct_stack_st_X509_OBJECT {
    const sk = arg_sk;
    const copy_func = arg_copy_func;
    const free_func = arg_free_func;
    return @as(?*struct_stack_st_X509_OBJECT, @ptrCast(sk_deep_copy(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), &sk_X509_OBJECT_call_copy_func, @as(OPENSSL_sk_copy_func, @ptrCast(@alignCast(copy_func))), &sk_X509_OBJECT_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))))));
}
pub const struct_stack_st_X509_VERIFY_PARAM = opaque {};
pub const sk_X509_VERIFY_PARAM_free_func = ?*const fn (?*X509_VERIFY_PARAM) callconv(.C) void;
pub const sk_X509_VERIFY_PARAM_copy_func = ?*const fn (?*X509_VERIFY_PARAM) callconv(.C) ?*X509_VERIFY_PARAM;
pub const sk_X509_VERIFY_PARAM_cmp_func = ?*const fn ([*c]?*const X509_VERIFY_PARAM, [*c]?*const X509_VERIFY_PARAM) callconv(.C) c_int;
pub fn sk_X509_VERIFY_PARAM_call_free_func(arg_free_func: OPENSSL_sk_free_func, arg_ptr: ?*anyopaque) callconv(.C) void {
    const free_func = arg_free_func;
    const ptr = arg_ptr;
    @as(sk_X509_VERIFY_PARAM_free_func, @ptrCast(@alignCast(free_func))).?(@as(?*X509_VERIFY_PARAM, @ptrCast(ptr)));
}
pub fn sk_X509_VERIFY_PARAM_call_copy_func(arg_copy_func: OPENSSL_sk_copy_func, arg_ptr: ?*anyopaque) callconv(.C) ?*anyopaque {
    const copy_func = arg_copy_func;
    const ptr = arg_ptr;
    return @as(?*anyopaque, @ptrCast(@as(sk_X509_VERIFY_PARAM_copy_func, @ptrCast(@alignCast(copy_func))).?(@as(?*X509_VERIFY_PARAM, @ptrCast(ptr)))));
}
pub fn sk_X509_VERIFY_PARAM_call_cmp_func(arg_cmp_func: OPENSSL_sk_cmp_func, arg_a: [*c]const ?*const anyopaque, arg_b: [*c]const ?*const anyopaque) callconv(.C) c_int {
    const cmp_func = arg_cmp_func;
    const a = arg_a;
    const b = arg_b;
    var a_ptr: ?*const X509_VERIFY_PARAM = @as(?*const X509_VERIFY_PARAM, @ptrCast(a.*));
    var b_ptr: ?*const X509_VERIFY_PARAM = @as(?*const X509_VERIFY_PARAM, @ptrCast(b.*));
    return @as(sk_X509_VERIFY_PARAM_cmp_func, @ptrCast(@alignCast(cmp_func))).?(&a_ptr, &b_ptr);
}
pub fn sk_X509_VERIFY_PARAM_new(arg_comp: sk_X509_VERIFY_PARAM_cmp_func) callconv(.C) ?*struct_stack_st_X509_VERIFY_PARAM {
    const comp = arg_comp;
    return @as(?*struct_stack_st_X509_VERIFY_PARAM, @ptrCast(sk_new(@as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp))))));
}
pub fn sk_X509_VERIFY_PARAM_new_null() callconv(.C) ?*struct_stack_st_X509_VERIFY_PARAM {
    return @as(?*struct_stack_st_X509_VERIFY_PARAM, @ptrCast(sk_new_null()));
}
pub fn sk_X509_VERIFY_PARAM_num(arg_sk: ?*const struct_stack_st_X509_VERIFY_PARAM) callconv(.C) usize {
    const sk = arg_sk;
    return sk_num(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_VERIFY_PARAM_zero(arg_sk: ?*struct_stack_st_X509_VERIFY_PARAM) callconv(.C) void {
    const sk = arg_sk;
    sk_zero(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_VERIFY_PARAM_value(arg_sk: ?*const struct_stack_st_X509_VERIFY_PARAM, arg_i: usize) callconv(.C) ?*X509_VERIFY_PARAM {
    const sk = arg_sk;
    const i = arg_i;
    return @as(?*X509_VERIFY_PARAM, @ptrCast(sk_value(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), i)));
}
pub fn sk_X509_VERIFY_PARAM_set(arg_sk: ?*struct_stack_st_X509_VERIFY_PARAM, arg_i: usize, arg_p: ?*X509_VERIFY_PARAM) callconv(.C) ?*X509_VERIFY_PARAM {
    const sk = arg_sk;
    const i = arg_i;
    const p = arg_p;
    return @as(?*X509_VERIFY_PARAM, @ptrCast(sk_set(@as([*c]_STACK, @ptrCast(@alignCast(sk))), i, @as(?*anyopaque, @ptrCast(p)))));
}
pub fn sk_X509_VERIFY_PARAM_free(arg_sk: ?*struct_stack_st_X509_VERIFY_PARAM) callconv(.C) void {
    const sk = arg_sk;
    sk_free(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_VERIFY_PARAM_pop_free(arg_sk: ?*struct_stack_st_X509_VERIFY_PARAM, arg_free_func: sk_X509_VERIFY_PARAM_free_func) callconv(.C) void {
    const sk = arg_sk;
    const free_func = arg_free_func;
    sk_pop_free_ex(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_X509_VERIFY_PARAM_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))));
}
pub fn sk_X509_VERIFY_PARAM_insert(arg_sk: ?*struct_stack_st_X509_VERIFY_PARAM, arg_p: ?*X509_VERIFY_PARAM, arg_where: usize) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    const where = arg_where;
    return sk_insert(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)), where);
}
pub fn sk_X509_VERIFY_PARAM_delete(arg_sk: ?*struct_stack_st_X509_VERIFY_PARAM, arg_where: usize) callconv(.C) ?*X509_VERIFY_PARAM {
    const sk = arg_sk;
    const where = arg_where;
    return @as(?*X509_VERIFY_PARAM, @ptrCast(sk_delete(@as([*c]_STACK, @ptrCast(@alignCast(sk))), where)));
}
pub fn sk_X509_VERIFY_PARAM_delete_ptr(arg_sk: ?*struct_stack_st_X509_VERIFY_PARAM, arg_p: ?*const X509_VERIFY_PARAM) callconv(.C) ?*X509_VERIFY_PARAM {
    const sk = arg_sk;
    const p = arg_p;
    return @as(?*X509_VERIFY_PARAM, @ptrCast(sk_delete_ptr(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*const anyopaque, @ptrCast(p)))));
}
pub fn sk_X509_VERIFY_PARAM_find(arg_sk: ?*const struct_stack_st_X509_VERIFY_PARAM, arg_out_index: [*c]usize, arg_p: ?*const X509_VERIFY_PARAM) callconv(.C) c_int {
    const sk = arg_sk;
    const out_index = arg_out_index;
    const p = arg_p;
    return sk_find(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), out_index, @as(?*const anyopaque, @ptrCast(p)), &sk_X509_VERIFY_PARAM_call_cmp_func);
}
pub fn sk_X509_VERIFY_PARAM_shift(arg_sk: ?*struct_stack_st_X509_VERIFY_PARAM) callconv(.C) ?*X509_VERIFY_PARAM {
    const sk = arg_sk;
    return @as(?*X509_VERIFY_PARAM, @ptrCast(sk_shift(@as([*c]_STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_VERIFY_PARAM_push(arg_sk: ?*struct_stack_st_X509_VERIFY_PARAM, arg_p: ?*X509_VERIFY_PARAM) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    return sk_push(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)));
}
pub fn sk_X509_VERIFY_PARAM_pop(arg_sk: ?*struct_stack_st_X509_VERIFY_PARAM) callconv(.C) ?*X509_VERIFY_PARAM {
    const sk = arg_sk;
    return @as(?*X509_VERIFY_PARAM, @ptrCast(sk_pop(@as([*c]_STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_VERIFY_PARAM_dup(arg_sk: ?*const struct_stack_st_X509_VERIFY_PARAM) callconv(.C) ?*struct_stack_st_X509_VERIFY_PARAM {
    const sk = arg_sk;
    return @as(?*struct_stack_st_X509_VERIFY_PARAM, @ptrCast(sk_dup(@as([*c]const _STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_X509_VERIFY_PARAM_sort(arg_sk: ?*struct_stack_st_X509_VERIFY_PARAM) callconv(.C) void {
    const sk = arg_sk;
    sk_sort(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_X509_VERIFY_PARAM_call_cmp_func);
}
pub fn sk_X509_VERIFY_PARAM_is_sorted(arg_sk: ?*const struct_stack_st_X509_VERIFY_PARAM) callconv(.C) c_int {
    const sk = arg_sk;
    return sk_is_sorted(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_X509_VERIFY_PARAM_set_cmp_func(arg_sk: ?*struct_stack_st_X509_VERIFY_PARAM, arg_comp: sk_X509_VERIFY_PARAM_cmp_func) callconv(.C) sk_X509_VERIFY_PARAM_cmp_func {
    const sk = arg_sk;
    const comp = arg_comp;
    return @as(sk_X509_VERIFY_PARAM_cmp_func, @ptrCast(@alignCast(sk_set_cmp_func(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp)))))));
}
pub fn sk_X509_VERIFY_PARAM_deep_copy(arg_sk: ?*const struct_stack_st_X509_VERIFY_PARAM, arg_copy_func: sk_X509_VERIFY_PARAM_copy_func, arg_free_func: sk_X509_VERIFY_PARAM_free_func) callconv(.C) ?*struct_stack_st_X509_VERIFY_PARAM {
    const sk = arg_sk;
    const copy_func = arg_copy_func;
    const free_func = arg_free_func;
    return @as(?*struct_stack_st_X509_VERIFY_PARAM, @ptrCast(sk_deep_copy(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), &sk_X509_VERIFY_PARAM_call_copy_func, @as(OPENSSL_sk_copy_func, @ptrCast(@alignCast(copy_func))), &sk_X509_VERIFY_PARAM_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))))));
}
pub extern fn X509_check_ca(x: ?*X509) c_int;
pub const X509_STORE_CTX_verify_cb = ?*const fn (c_int, ?*X509_STORE_CTX) callconv(.C) c_int;
pub const X509_STORE_CTX_verify_fn = ?*const fn (?*X509_STORE_CTX) callconv(.C) c_int;
pub const X509_STORE_CTX_get_issuer_fn = ?*const fn ([*c]?*X509, ?*X509_STORE_CTX, ?*X509) callconv(.C) c_int;
pub const X509_STORE_CTX_check_issued_fn = ?*const fn (?*X509_STORE_CTX, ?*X509, ?*X509) callconv(.C) c_int;
pub const X509_STORE_CTX_check_revocation_fn = ?*const fn (?*X509_STORE_CTX) callconv(.C) c_int;
pub const X509_STORE_CTX_get_crl_fn = ?*const fn (?*X509_STORE_CTX, [*c]?*X509_CRL, ?*X509) callconv(.C) c_int;
pub const X509_STORE_CTX_check_crl_fn = ?*const fn (?*X509_STORE_CTX, ?*X509_CRL) callconv(.C) c_int;
pub const X509_STORE_CTX_cert_crl_fn = ?*const fn (?*X509_STORE_CTX, ?*X509_CRL, ?*X509) callconv(.C) c_int;
pub const X509_STORE_CTX_check_policy_fn = ?*const fn (?*X509_STORE_CTX) callconv(.C) c_int;
pub const X509_STORE_CTX_lookup_certs_fn = ?*const fn (?*X509_STORE_CTX, ?*X509_NAME) callconv(.C) ?*struct_stack_st_X509;
pub const X509_STORE_CTX_lookup_crls_fn = ?*const fn (?*X509_STORE_CTX, ?*X509_NAME) callconv(.C) ?*struct_stack_st_X509_CRL;
pub const X509_STORE_CTX_cleanup_fn = ?*const fn (?*X509_STORE_CTX) callconv(.C) c_int;
pub extern fn X509_STORE_set_depth(store: ?*X509_STORE, depth: c_int) c_int;
pub extern fn X509_STORE_CTX_set_depth(ctx: ?*X509_STORE_CTX, depth: c_int) void;
pub extern fn X509_OBJECT_idx_by_subject(h: ?*struct_stack_st_X509_OBJECT, @"type": c_int, name: ?*X509_NAME) c_int;
pub extern fn X509_OBJECT_retrieve_by_subject(h: ?*struct_stack_st_X509_OBJECT, @"type": c_int, name: ?*X509_NAME) ?*X509_OBJECT;
pub extern fn X509_OBJECT_retrieve_match(h: ?*struct_stack_st_X509_OBJECT, x: ?*X509_OBJECT) ?*X509_OBJECT;
pub extern fn X509_OBJECT_up_ref_count(a: ?*X509_OBJECT) c_int;
pub extern fn X509_OBJECT_free_contents(a: ?*X509_OBJECT) void;
pub extern fn X509_OBJECT_get_type(a: ?*const X509_OBJECT) c_int;
pub extern fn X509_OBJECT_get0_X509(a: ?*const X509_OBJECT) ?*X509;
pub extern fn X509_STORE_new() ?*X509_STORE;
pub extern fn X509_STORE_up_ref(store: ?*X509_STORE) c_int;
pub extern fn X509_STORE_free(v: ?*X509_STORE) void;
pub extern fn X509_STORE_get0_objects(st: ?*X509_STORE) ?*struct_stack_st_X509_OBJECT;
pub extern fn X509_STORE_get1_certs(st: ?*X509_STORE_CTX, nm: ?*X509_NAME) ?*struct_stack_st_X509;
pub extern fn X509_STORE_get1_crls(st: ?*X509_STORE_CTX, nm: ?*X509_NAME) ?*struct_stack_st_X509_CRL;
pub extern fn X509_STORE_set_flags(ctx: ?*X509_STORE, flags: c_ulong) c_int;
pub extern fn X509_STORE_set_purpose(ctx: ?*X509_STORE, purpose: c_int) c_int;
pub extern fn X509_STORE_set_trust(ctx: ?*X509_STORE, trust: c_int) c_int;
pub extern fn X509_STORE_set1_param(ctx: ?*X509_STORE, pm: ?*X509_VERIFY_PARAM) c_int;
pub extern fn X509_STORE_get0_param(ctx: ?*X509_STORE) ?*X509_VERIFY_PARAM;
pub extern fn X509_STORE_set_verify(ctx: ?*X509_STORE, verify: X509_STORE_CTX_verify_fn) void;
pub extern fn X509_STORE_CTX_set_verify(ctx: ?*X509_STORE_CTX, verify: X509_STORE_CTX_verify_fn) void;
pub extern fn X509_STORE_get_verify(ctx: ?*X509_STORE) X509_STORE_CTX_verify_fn;
pub extern fn X509_STORE_set_verify_cb(ctx: ?*X509_STORE, verify_cb: X509_STORE_CTX_verify_cb) void;
pub extern fn X509_STORE_get_verify_cb(ctx: ?*X509_STORE) X509_STORE_CTX_verify_cb;
pub extern fn X509_STORE_set_get_issuer(ctx: ?*X509_STORE, get_issuer: X509_STORE_CTX_get_issuer_fn) void;
pub extern fn X509_STORE_get_get_issuer(ctx: ?*X509_STORE) X509_STORE_CTX_get_issuer_fn;
pub extern fn X509_STORE_set_check_issued(ctx: ?*X509_STORE, check_issued: X509_STORE_CTX_check_issued_fn) void;
pub extern fn X509_STORE_get_check_issued(ctx: ?*X509_STORE) X509_STORE_CTX_check_issued_fn;
pub extern fn X509_STORE_set_check_revocation(ctx: ?*X509_STORE, check_revocation: X509_STORE_CTX_check_revocation_fn) void;
pub extern fn X509_STORE_get_check_revocation(ctx: ?*X509_STORE) X509_STORE_CTX_check_revocation_fn;
pub extern fn X509_STORE_set_get_crl(ctx: ?*X509_STORE, get_crl: X509_STORE_CTX_get_crl_fn) void;
pub extern fn X509_STORE_get_get_crl(ctx: ?*X509_STORE) X509_STORE_CTX_get_crl_fn;
pub extern fn X509_STORE_set_check_crl(ctx: ?*X509_STORE, check_crl: X509_STORE_CTX_check_crl_fn) void;
pub extern fn X509_STORE_get_check_crl(ctx: ?*X509_STORE) X509_STORE_CTX_check_crl_fn;
pub extern fn X509_STORE_set_cert_crl(ctx: ?*X509_STORE, cert_crl: X509_STORE_CTX_cert_crl_fn) void;
pub extern fn X509_STORE_get_cert_crl(ctx: ?*X509_STORE) X509_STORE_CTX_cert_crl_fn;
pub extern fn X509_STORE_set_lookup_certs(ctx: ?*X509_STORE, lookup_certs: X509_STORE_CTX_lookup_certs_fn) void;
pub extern fn X509_STORE_get_lookup_certs(ctx: ?*X509_STORE) X509_STORE_CTX_lookup_certs_fn;
pub extern fn X509_STORE_set_lookup_crls(ctx: ?*X509_STORE, lookup_crls: X509_STORE_CTX_lookup_crls_fn) void;
pub extern fn X509_STORE_get_lookup_crls(ctx: ?*X509_STORE) X509_STORE_CTX_lookup_crls_fn;
pub extern fn X509_STORE_set_cleanup(ctx: ?*X509_STORE, cleanup: X509_STORE_CTX_cleanup_fn) void;
pub extern fn X509_STORE_get_cleanup(ctx: ?*X509_STORE) X509_STORE_CTX_cleanup_fn;
pub extern fn X509_STORE_CTX_new() ?*X509_STORE_CTX;
pub extern fn X509_STORE_CTX_get1_issuer(issuer: [*c]?*X509, ctx: ?*X509_STORE_CTX, x: ?*X509) c_int;
pub extern fn X509_STORE_CTX_zero(ctx: ?*X509_STORE_CTX) void;
pub extern fn X509_STORE_CTX_free(ctx: ?*X509_STORE_CTX) void;
pub extern fn X509_STORE_CTX_init(ctx: ?*X509_STORE_CTX, store: ?*X509_STORE, x509: ?*X509, chain: ?*struct_stack_st_X509) c_int;
pub extern fn X509_STORE_CTX_set0_trusted_stack(ctx: ?*X509_STORE_CTX, sk: ?*struct_stack_st_X509) void;
pub extern fn X509_STORE_CTX_trusted_stack(ctx: ?*X509_STORE_CTX, sk: ?*struct_stack_st_X509) void;
pub extern fn X509_STORE_CTX_cleanup(ctx: ?*X509_STORE_CTX) void;
pub extern fn X509_STORE_CTX_get0_store(ctx: ?*X509_STORE_CTX) ?*X509_STORE;
pub extern fn X509_STORE_CTX_get0_cert(ctx: ?*X509_STORE_CTX) ?*X509;
pub extern fn X509_STORE_add_lookup(v: ?*X509_STORE, m: ?*X509_LOOKUP_METHOD) ?*X509_LOOKUP;
pub extern fn X509_LOOKUP_hash_dir() ?*X509_LOOKUP_METHOD;
// pub extern fn X509_LOOKUP_file() ?*X509_LOOKUP_METHOD;
pub extern fn X509_STORE_add_cert(ctx: ?*X509_STORE, x: ?*X509) c_int;
pub extern fn X509_STORE_add_crl(ctx: ?*X509_STORE, x: ?*X509_CRL) c_int;
pub extern fn X509_STORE_get_by_subject(vs: ?*X509_STORE_CTX, @"type": c_int, name: ?*X509_NAME, ret: ?*X509_OBJECT) c_int;
pub extern fn X509_LOOKUP_ctrl(ctx: ?*X509_LOOKUP, cmd: c_int, argc: [*c]const u8, argl: c_long, ret: [*c][*c]u8) c_int;
// pub extern fn X509_load_cert_file(ctx: ?*X509_LOOKUP, file: [*c]const u8, @"type": c_int) c_int;
// pub extern fn X509_load_crl_file(ctx: ?*X509_LOOKUP, file: [*c]const u8, @"type": c_int) c_int;
// pub extern fn X509_load_cert_crl_file(ctx: ?*X509_LOOKUP, file: [*c]const u8, @"type": c_int) c_int;
pub extern fn X509_LOOKUP_new(method: ?*X509_LOOKUP_METHOD) ?*X509_LOOKUP;
pub extern fn X509_LOOKUP_free(ctx: ?*X509_LOOKUP) void;
pub extern fn X509_LOOKUP_init(ctx: ?*X509_LOOKUP) c_int;
pub extern fn X509_LOOKUP_by_subject(ctx: ?*X509_LOOKUP, @"type": c_int, name: ?*X509_NAME, ret: ?*X509_OBJECT) c_int;
pub extern fn X509_LOOKUP_shutdown(ctx: ?*X509_LOOKUP) c_int;
// pub extern fn X509_STORE_load_locations(ctx: ?*X509_STORE, file: [*c]const u8, dir: [*c]const u8) c_int;
pub extern fn X509_STORE_set_default_paths(ctx: ?*X509_STORE) c_int;
pub extern fn X509_STORE_CTX_get_error(ctx: ?*X509_STORE_CTX) c_int;
pub extern fn X509_STORE_CTX_set_error(ctx: ?*X509_STORE_CTX, s: c_int) void;
pub extern fn X509_STORE_CTX_get_error_depth(ctx: ?*X509_STORE_CTX) c_int;
pub extern fn X509_STORE_CTX_get_current_cert(ctx: ?*X509_STORE_CTX) ?*X509;
pub extern fn X509_STORE_CTX_get0_current_issuer(ctx: ?*X509_STORE_CTX) ?*X509;
pub extern fn X509_STORE_CTX_get0_current_crl(ctx: ?*X509_STORE_CTX) ?*X509_CRL;
pub extern fn X509_STORE_CTX_get0_parent_ctx(ctx: ?*X509_STORE_CTX) ?*X509_STORE_CTX;
pub extern fn X509_STORE_CTX_get_chain(ctx: ?*X509_STORE_CTX) ?*struct_stack_st_X509;
pub extern fn X509_STORE_CTX_get0_chain(ctx: ?*X509_STORE_CTX) ?*struct_stack_st_X509;
pub extern fn X509_STORE_CTX_get1_chain(ctx: ?*X509_STORE_CTX) ?*struct_stack_st_X509;
pub extern fn X509_STORE_CTX_set_cert(c: ?*X509_STORE_CTX, x: ?*X509) void;
pub extern fn X509_STORE_CTX_set_chain(c: ?*X509_STORE_CTX, sk: ?*struct_stack_st_X509) void;
pub extern fn X509_STORE_CTX_get0_untrusted(ctx: ?*X509_STORE_CTX) ?*struct_stack_st_X509;
pub extern fn X509_STORE_CTX_set0_crls(c: ?*X509_STORE_CTX, sk: ?*struct_stack_st_X509_CRL) void;
pub extern fn X509_STORE_CTX_set_purpose(ctx: ?*X509_STORE_CTX, purpose: c_int) c_int;
pub extern fn X509_STORE_CTX_set_trust(ctx: ?*X509_STORE_CTX, trust: c_int) c_int;
pub extern fn X509_STORE_CTX_purpose_inherit(ctx: ?*X509_STORE_CTX, def_purpose: c_int, purpose: c_int, trust: c_int) c_int;
pub extern fn X509_STORE_CTX_set_flags(ctx: ?*X509_STORE_CTX, flags: c_ulong) void;
pub extern fn X509_STORE_CTX_set_time(ctx: ?*X509_STORE_CTX, flags: c_ulong, t: time_t) void;
pub extern fn X509_STORE_CTX_set_verify_cb(ctx: ?*X509_STORE_CTX, verify_cb: ?*const fn (c_int, ?*X509_STORE_CTX) callconv(.C) c_int) void;
pub extern fn X509_STORE_CTX_get0_param(ctx: ?*X509_STORE_CTX) ?*X509_VERIFY_PARAM;
pub extern fn X509_STORE_CTX_set0_param(ctx: ?*X509_STORE_CTX, param: ?*X509_VERIFY_PARAM) void;
pub extern fn X509_STORE_CTX_set_default(ctx: ?*X509_STORE_CTX, name: [*c]const u8) c_int;
pub extern fn X509_VERIFY_PARAM_new() ?*X509_VERIFY_PARAM;
pub extern fn X509_VERIFY_PARAM_free(param: ?*X509_VERIFY_PARAM) void;
pub extern fn X509_VERIFY_PARAM_inherit(to: ?*X509_VERIFY_PARAM, from: ?*const X509_VERIFY_PARAM) c_int;
pub extern fn X509_VERIFY_PARAM_set1(to: ?*X509_VERIFY_PARAM, from: ?*const X509_VERIFY_PARAM) c_int;
pub extern fn X509_VERIFY_PARAM_set1_name(param: ?*X509_VERIFY_PARAM, name: [*c]const u8) c_int;
pub extern fn X509_VERIFY_PARAM_set_flags(param: ?*X509_VERIFY_PARAM, flags: c_ulong) c_int;
pub extern fn X509_VERIFY_PARAM_clear_flags(param: ?*X509_VERIFY_PARAM, flags: c_ulong) c_int;
pub extern fn X509_VERIFY_PARAM_get_flags(param: ?*X509_VERIFY_PARAM) c_ulong;
pub extern fn X509_VERIFY_PARAM_set_purpose(param: ?*X509_VERIFY_PARAM, purpose: c_int) c_int;
pub extern fn X509_VERIFY_PARAM_set_trust(param: ?*X509_VERIFY_PARAM, trust: c_int) c_int;
pub extern fn X509_VERIFY_PARAM_set_depth(param: ?*X509_VERIFY_PARAM, depth: c_int) void;
pub extern fn X509_VERIFY_PARAM_set_time(param: ?*X509_VERIFY_PARAM, t: time_t) void;
pub extern fn X509_VERIFY_PARAM_add0_policy(param: ?*X509_VERIFY_PARAM, policy: ?*ASN1_OBJECT) c_int;
pub extern fn X509_VERIFY_PARAM_set1_policies(param: ?*X509_VERIFY_PARAM, policies: ?*const struct_stack_st_ASN1_OBJECT) c_int;
pub extern fn X509_VERIFY_PARAM_set1_host(param: ?*X509_VERIFY_PARAM, name: [*c]const u8, namelen: usize) c_int;
pub extern fn X509_VERIFY_PARAM_add1_host(param: ?*X509_VERIFY_PARAM, name: [*c]const u8, namelen: usize) c_int;
pub extern fn X509_VERIFY_PARAM_set_hostflags(param: ?*X509_VERIFY_PARAM, flags: c_uint) void;
pub extern fn X509_VERIFY_PARAM_get0_peername(?*X509_VERIFY_PARAM) [*c]u8;
pub extern fn X509_VERIFY_PARAM_set1_email(param: ?*X509_VERIFY_PARAM, email: [*c]const u8, emaillen: usize) c_int;
pub extern fn X509_VERIFY_PARAM_set1_ip(param: ?*X509_VERIFY_PARAM, ip: [*c]const u8, iplen: usize) c_int;
pub extern fn X509_VERIFY_PARAM_set1_ip_asc(param: ?*X509_VERIFY_PARAM, ipasc: [*c]const u8) c_int;
pub extern fn X509_VERIFY_PARAM_get_depth(param: ?*const X509_VERIFY_PARAM) c_int;
pub extern fn X509_VERIFY_PARAM_get0_name(param: ?*const X509_VERIFY_PARAM) [*c]const u8;
pub extern fn X509_VERIFY_PARAM_add0_table(param: ?*X509_VERIFY_PARAM) c_int;
pub extern fn X509_VERIFY_PARAM_get_count() c_int;
pub extern fn X509_VERIFY_PARAM_get0(id: c_int) ?*const X509_VERIFY_PARAM;
pub extern fn X509_VERIFY_PARAM_lookup(name: [*c]const u8) ?*const X509_VERIFY_PARAM;
pub extern fn X509_VERIFY_PARAM_table_cleanup() void;
pub extern fn OPENSSL_malloc(size: usize) ?*anyopaque;
pub extern fn OPENSSL_free(ptr: ?*anyopaque) void;
pub extern fn OPENSSL_realloc(ptr: ?*anyopaque, new_size: usize) ?*anyopaque;
pub extern fn OPENSSL_cleanse(ptr: ?*anyopaque, len: usize) void;
pub extern fn CRYPTO_memcmp(a: ?*const anyopaque, b: ?*const anyopaque, len: usize) c_int;
pub extern fn OPENSSL_hash32(ptr: ?*const anyopaque, len: usize) u32;
pub extern fn OPENSSL_strhash(s: [*c]const u8) u32;
pub extern fn OPENSSL_strdup(s: [*c]const u8) [*c]u8;
pub extern fn OPENSSL_strnlen(s: [*c]const u8, len: usize) usize;
pub extern fn OPENSSL_tolower(c: c_int) c_int;
pub extern fn OPENSSL_strcasecmp(a: [*c]const u8, b: [*c]const u8) c_int;
pub extern fn OPENSSL_strncasecmp(a: [*c]const u8, b: [*c]const u8, n: usize) c_int;
pub extern fn BIO_snprintf(buf: [*c]u8, n: usize, format: [*c]const u8, ...) c_int;
pub extern fn BIO_vsnprintf(buf: [*c]u8, n: usize, format: [*c]const u8, args: va_list) c_int;
pub extern fn OPENSSL_strndup(str: [*c]const u8, size: usize) [*c]u8;
pub extern fn OPENSSL_memdup(data: ?*const anyopaque, size: usize) ?*anyopaque;
pub extern fn OPENSSL_strlcpy(dst: [*c]u8, src: [*c]const u8, dst_size: usize) usize;
pub extern fn OPENSSL_strlcat(dst: [*c]u8, src: [*c]const u8, dst_size: usize) usize;
// pub extern fn CRYPTO_malloc(size: usize, file: [*c]const u8, line: c_int) ?*anyopaque;
// pub extern fn CRYPTO_realloc(ptr: ?*anyopaque, new_size: usize, file: [*c]const u8, line: c_int) ?*anyopaque;
// pub extern fn CRYPTO_free(ptr: ?*anyopaque, file: [*c]const u8, line: c_int) void;
pub extern fn OPENSSL_clear_free(ptr: ?*anyopaque, len: usize) void;
pub extern fn CRYPTO_secure_malloc_init(size: usize, min_size: usize) c_int;
pub extern fn CRYPTO_secure_malloc_initialized() c_int;
pub extern fn CRYPTO_secure_used() usize;
pub extern fn OPENSSL_secure_malloc(size: usize) ?*anyopaque;
pub extern fn OPENSSL_secure_clear_free(ptr: ?*anyopaque, len: usize) void;
pub extern fn CRYPTO_library_init() void;
pub extern fn CRYPTO_is_confidential_build() c_int;
pub extern fn CRYPTO_has_asm() c_int;
pub extern fn BORINGSSL_self_test() c_int;
pub extern fn BORINGSSL_integrity_test() c_int;
pub extern fn CRYPTO_pre_sandbox_init() void;
pub extern fn FIPS_mode() c_int;
pub const fips_counter_evp_aes_128_gcm: c_int = 0;
pub const fips_counter_evp_aes_256_gcm: c_int = 1;
pub const fips_counter_evp_aes_128_ctr: c_int = 2;
pub const fips_counter_evp_aes_256_ctr: c_int = 3;
pub const fips_counter_max: c_int = 3;
pub const enum_fips_counter_t = c_uint;
pub extern fn FIPS_read_counter(counter: enum_fips_counter_t) usize;
pub extern fn OpenSSL_version(which: c_int) [*c]const u8;
pub extern fn SSLeay_version(which: c_int) [*c]const u8;
pub extern fn SSLeay() c_ulong;
pub extern fn OpenSSL_version_num() c_ulong;
pub extern fn CRYPTO_malloc_init() c_int;
pub extern fn OPENSSL_malloc_init() c_int;
pub extern fn ENGINE_load_builtin_engines() void;
pub extern fn ENGINE_register_all_complete() c_int;
pub extern fn OPENSSL_load_builtin_modules() void;
pub extern fn OPENSSL_init_crypto(opts: u64, settings: ?*const OPENSSL_INIT_SETTINGS) c_int;
pub extern fn OPENSSL_cleanup() void;
pub extern fn FIPS_mode_set(on: c_int) c_int;
pub extern fn FIPS_module_name() [*c]const u8;
pub extern fn FIPS_version() u32;
pub extern fn FIPS_query_algorithm_status(algorithm: [*c]const u8) c_int;
pub const pem_password_cb = fn ([*c]u8, c_int, c_int, ?*anyopaque) callconv(.C) c_int;
pub extern fn PEM_get_EVP_CIPHER_INFO(header: [*c]u8, cipher: [*c]EVP_CIPHER_INFO) c_int;
pub extern fn PEM_do_header(cipher: [*c]EVP_CIPHER_INFO, data: [*c]u8, len: [*c]c_long, callback: ?*const pem_password_cb, u: ?*anyopaque) c_int;
pub extern fn PEM_read_bio(bp: [*c]BIO, name: [*c][*c]u8, header: [*c][*c]u8, data: [*c][*c]u8, len: [*c]c_long) c_int;
pub extern fn PEM_write_bio(bp: [*c]BIO, name: [*c]const u8, hdr: [*c]const u8, data: [*c]const u8, len: c_long) c_int;
pub extern fn PEM_bytes_read_bio(pdata: [*c][*c]u8, plen: [*c]c_long, pnm: [*c][*c]u8, name: [*c]const u8, bp: [*c]BIO, cb: ?*const pem_password_cb, u: ?*anyopaque) c_int;
pub extern fn PEM_ASN1_read_bio(d2i: ?*const d2i_of_void, name: [*c]const u8, bp: [*c]BIO, x: [*c]?*anyopaque, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*anyopaque;
pub extern fn PEM_ASN1_write_bio(i2d: ?*const i2d_of_void, name: [*c]const u8, bp: [*c]BIO, x: ?*anyopaque, enc: ?*const EVP_CIPHER, kstr: [*c]u8, klen: c_int, cb: ?*const pem_password_cb, u: ?*anyopaque) c_int;
pub extern fn PEM_X509_INFO_read_bio(bp: [*c]BIO, sk: ?*struct_stack_st_X509_INFO, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*struct_stack_st_X509_INFO;
// pub extern fn PEM_read(fp: [*c]FILE, name: [*c][*c]u8, header: [*c][*c]u8, data: [*c][*c]u8, len: [*c]c_long) c_int;
// pub extern fn PEM_write(fp: [*c]FILE, name: [*c]const u8, hdr: [*c]const u8, data: [*c]const u8, len: c_long) c_int;
// pub extern fn PEM_ASN1_read(d2i: ?*const d2i_of_void, name: [*c]const u8, fp: [*c]FILE, x: [*c]?*anyopaque, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*anyopaque;
// pub extern fn PEM_ASN1_write(i2d: ?*const i2d_of_void, name: [*c]const u8, fp: [*c]FILE, x: ?*anyopaque, enc: ?*const EVP_CIPHER, kstr: [*c]u8, klen: c_int, callback: ?*const pem_password_cb, u: ?*anyopaque) c_int;
// pub extern fn PEM_X509_INFO_read(fp: [*c]FILE, sk: ?*struct_stack_st_X509_INFO, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*struct_stack_st_X509_INFO;
pub extern fn PEM_def_callback(buf: [*c]u8, size: c_int, rwflag: c_int, userdata: ?*anyopaque) c_int;
pub extern fn PEM_proc_type(buf: [*c]u8, @"type": c_int) void;
pub extern fn PEM_dek_info(buf: [*c]u8, @"type": [*c]const u8, len: c_int, str: [*c]u8) void;
pub extern fn PEM_read_bio_X509(bp: [*c]BIO, x: [*c]?*X509, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*X509;
// pub extern fn PEM_read_X509(fp: [*c]FILE, x: [*c]?*X509, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*X509;
pub extern fn PEM_write_bio_X509(bp: [*c]BIO, x: ?*X509) c_int;
// pub extern fn PEM_write_X509(fp: [*c]FILE, x: ?*X509) c_int;
pub extern fn PEM_read_bio_X509_AUX(bp: [*c]BIO, x: [*c]?*X509, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*X509;
// pub extern fn PEM_read_X509_AUX(fp: [*c]FILE, x: [*c]?*X509, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*X509;
pub extern fn PEM_write_bio_X509_AUX(bp: [*c]BIO, x: ?*X509) c_int;
// pub extern fn PEM_write_X509_AUX(fp: [*c]FILE, x: ?*X509) c_int;
pub extern fn PEM_read_bio_X509_REQ(bp: [*c]BIO, x: [*c]?*X509_REQ, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*X509_REQ;
// pub extern fn PEM_read_X509_REQ(fp: [*c]FILE, x: [*c]?*X509_REQ, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*X509_REQ;
pub extern fn PEM_write_bio_X509_REQ(bp: [*c]BIO, x: ?*X509_REQ) c_int;
// pub extern fn PEM_write_X509_REQ(fp: [*c]FILE, x: ?*X509_REQ) c_int;
pub extern fn PEM_write_bio_X509_REQ_NEW(bp: [*c]BIO, x: ?*X509_REQ) c_int;
// pub extern fn PEM_write_X509_REQ_NEW(fp: [*c]FILE, x: ?*X509_REQ) c_int;
pub extern fn PEM_read_bio_X509_CRL(bp: [*c]BIO, x: [*c]?*X509_CRL, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*X509_CRL;
// pub extern fn PEM_read_X509_CRL(fp: [*c]FILE, x: [*c]?*X509_CRL, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*X509_CRL;
pub extern fn PEM_write_bio_X509_CRL(bp: [*c]BIO, x: ?*X509_CRL) c_int;
// pub extern fn PEM_write_X509_CRL(fp: [*c]FILE, x: ?*X509_CRL) c_int;
pub extern fn PEM_read_bio_PKCS7(bp: [*c]BIO, x: [*c][*c]PKCS7, cb: ?*const pem_password_cb, u: ?*anyopaque) [*c]PKCS7;
// pub extern fn PEM_read_PKCS7(fp: [*c]FILE, x: [*c][*c]PKCS7, cb: ?*const pem_password_cb, u: ?*anyopaque) [*c]PKCS7;
pub extern fn PEM_write_bio_PKCS7(bp: [*c]BIO, x: [*c]PKCS7) c_int;
// pub extern fn PEM_write_PKCS7(fp: [*c]FILE, x: [*c]PKCS7) c_int;
pub extern fn PEM_read_bio_PKCS8(bp: [*c]BIO, x: [*c]?*X509_SIG, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*X509_SIG;
// pub extern fn PEM_read_PKCS8(fp: [*c]FILE, x: [*c]?*X509_SIG, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*X509_SIG;
pub extern fn PEM_write_bio_PKCS8(bp: [*c]BIO, x: ?*X509_SIG) c_int;
// pub extern fn PEM_write_PKCS8(fp: [*c]FILE, x: ?*X509_SIG) c_int;
pub extern fn PEM_read_bio_PKCS8_PRIV_KEY_INFO(bp: [*c]BIO, x: [*c]?*PKCS8_PRIV_KEY_INFO, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*PKCS8_PRIV_KEY_INFO;
// pub extern fn PEM_read_PKCS8_PRIV_KEY_INFO(fp: [*c]FILE, x: [*c]?*PKCS8_PRIV_KEY_INFO, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*PKCS8_PRIV_KEY_INFO;
pub extern fn PEM_write_bio_PKCS8_PRIV_KEY_INFO(bp: [*c]BIO, x: ?*PKCS8_PRIV_KEY_INFO) c_int;
// pub extern fn PEM_write_PKCS8_PRIV_KEY_INFO(fp: [*c]FILE, x: ?*PKCS8_PRIV_KEY_INFO) c_int;
pub extern fn PEM_read_bio_RSAPrivateKey(bp: [*c]BIO, x: [*c]?*RSA, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*RSA;
// pub extern fn PEM_read_RSAPrivateKey(fp: [*c]FILE, x: [*c]?*RSA, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*RSA;
pub extern fn PEM_write_bio_RSAPrivateKey(bp: [*c]BIO, x: ?*RSA, enc: ?*const EVP_CIPHER, kstr: [*c]u8, klen: c_int, cb: ?*const pem_password_cb, u: ?*anyopaque) c_int;
// pub extern fn PEM_write_RSAPrivateKey(fp: [*c]FILE, x: ?*RSA, enc: ?*const EVP_CIPHER, kstr: [*c]u8, klen: c_int, cb: ?*const pem_password_cb, u: ?*anyopaque) c_int;
pub extern fn PEM_read_bio_RSAPublicKey(bp: [*c]BIO, x: [*c]?*RSA, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*RSA;
// pub extern fn PEM_read_RSAPublicKey(fp: [*c]FILE, x: [*c]?*RSA, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*RSA;
pub extern fn PEM_write_bio_RSAPublicKey(bp: [*c]BIO, x: ?*const RSA) c_int;
// pub extern fn PEM_write_RSAPublicKey(fp: [*c]FILE, x: ?*const RSA) c_int;
pub extern fn PEM_read_bio_RSA_PUBKEY(bp: [*c]BIO, x: [*c]?*RSA, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*RSA;
// pub extern fn PEM_read_RSA_PUBKEY(fp: [*c]FILE, x: [*c]?*RSA, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*RSA;
pub extern fn PEM_write_bio_RSA_PUBKEY(bp: [*c]BIO, x: ?*RSA) c_int;
// pub extern fn PEM_write_RSA_PUBKEY(fp: [*c]FILE, x: ?*RSA) c_int;
pub extern fn PEM_read_bio_DSAPrivateKey(bp: [*c]BIO, x: [*c][*c]DSA, cb: ?*const pem_password_cb, u: ?*anyopaque) [*c]DSA;
// pub extern fn PEM_read_DSAPrivateKey(fp: [*c]FILE, x: [*c][*c]DSA, cb: ?*const pem_password_cb, u: ?*anyopaque) [*c]DSA;
pub extern fn PEM_write_bio_DSAPrivateKey(bp: [*c]BIO, x: [*c]DSA, enc: ?*const EVP_CIPHER, kstr: [*c]u8, klen: c_int, cb: ?*const pem_password_cb, u: ?*anyopaque) c_int;
// pub extern fn PEM_write_DSAPrivateKey(fp: [*c]FILE, x: [*c]DSA, enc: ?*const EVP_CIPHER, kstr: [*c]u8, klen: c_int, cb: ?*const pem_password_cb, u: ?*anyopaque) c_int;
pub extern fn PEM_read_bio_DSA_PUBKEY(bp: [*c]BIO, x: [*c][*c]DSA, cb: ?*const pem_password_cb, u: ?*anyopaque) [*c]DSA;
// pub extern fn PEM_read_DSA_PUBKEY(fp: [*c]FILE, x: [*c][*c]DSA, cb: ?*const pem_password_cb, u: ?*anyopaque) [*c]DSA;
pub extern fn PEM_write_bio_DSA_PUBKEY(bp: [*c]BIO, x: [*c]DSA) c_int;
// pub extern fn PEM_write_DSA_PUBKEY(fp: [*c]FILE, x: [*c]DSA) c_int;
pub extern fn PEM_read_bio_DSAparams(bp: [*c]BIO, x: [*c][*c]DSA, cb: ?*const pem_password_cb, u: ?*anyopaque) [*c]DSA;
// pub extern fn PEM_read_DSAparams(fp: [*c]FILE, x: [*c][*c]DSA, cb: ?*const pem_password_cb, u: ?*anyopaque) [*c]DSA;
pub extern fn PEM_write_bio_DSAparams(bp: [*c]BIO, x: [*c]const DSA) c_int;
// pub extern fn PEM_write_DSAparams(fp: [*c]FILE, x: [*c]const DSA) c_int;
pub extern fn PEM_read_bio_ECPrivateKey(bp: [*c]BIO, x: [*c]?*EC_KEY, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*EC_KEY;
// pub extern fn PEM_read_ECPrivateKey(fp: [*c]FILE, x: [*c]?*EC_KEY, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*EC_KEY;
pub extern fn PEM_write_bio_ECPrivateKey(bp: [*c]BIO, x: ?*EC_KEY, enc: ?*const EVP_CIPHER, kstr: [*c]u8, klen: c_int, cb: ?*const pem_password_cb, u: ?*anyopaque) c_int;
// pub extern fn PEM_write_ECPrivateKey(fp: [*c]FILE, x: ?*EC_KEY, enc: ?*const EVP_CIPHER, kstr: [*c]u8, klen: c_int, cb: ?*const pem_password_cb, u: ?*anyopaque) c_int;
pub extern fn PEM_read_bio_EC_PUBKEY(bp: [*c]BIO, x: [*c]?*EC_KEY, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*EC_KEY;
// pub extern fn PEM_read_EC_PUBKEY(fp: [*c]FILE, x: [*c]?*EC_KEY, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*EC_KEY;
pub extern fn PEM_write_bio_EC_PUBKEY(bp: [*c]BIO, x: ?*EC_KEY) c_int;
// pub extern fn PEM_write_EC_PUBKEY(fp: [*c]FILE, x: ?*EC_KEY) c_int;
pub extern fn PEM_read_bio_DHparams(bp: [*c]BIO, x: [*c]?*DH, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*DH;
// pub extern fn PEM_read_DHparams(fp: [*c]FILE, x: [*c]?*DH, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*DH;
pub extern fn PEM_write_bio_DHparams(bp: [*c]BIO, x: ?*const DH) c_int;
// pub extern fn PEM_write_DHparams(fp: [*c]FILE, x: ?*const DH) c_int;
pub extern fn PEM_read_bio_PrivateKey(bp: [*c]BIO, x: [*c][*c]EVP_PKEY, cb: ?*const pem_password_cb, u: ?*anyopaque) [*c]EVP_PKEY;
// pub extern fn PEM_read_PrivateKey(fp: [*c]FILE, x: [*c][*c]EVP_PKEY, cb: ?*const pem_password_cb, u: ?*anyopaque) [*c]EVP_PKEY;
pub extern fn PEM_write_bio_PrivateKey(bp: [*c]BIO, x: [*c]EVP_PKEY, enc: ?*const EVP_CIPHER, kstr: [*c]u8, klen: c_int, cb: ?*const pem_password_cb, u: ?*anyopaque) c_int;
// pub extern fn PEM_write_PrivateKey(fp: [*c]FILE, x: [*c]EVP_PKEY, enc: ?*const EVP_CIPHER, kstr: [*c]u8, klen: c_int, cb: ?*const pem_password_cb, u: ?*anyopaque) c_int;
pub extern fn PEM_read_bio_PUBKEY(bp: [*c]BIO, x: [*c][*c]EVP_PKEY, cb: ?*const pem_password_cb, u: ?*anyopaque) [*c]EVP_PKEY;
// pub extern fn PEM_read_PUBKEY(fp: [*c]FILE, x: [*c][*c]EVP_PKEY, cb: ?*const pem_password_cb, u: ?*anyopaque) [*c]EVP_PKEY;
pub extern fn PEM_write_bio_PUBKEY(bp: [*c]BIO, x: [*c]EVP_PKEY) c_int;
// pub extern fn PEM_write_PUBKEY(fp: [*c]FILE, x: [*c]EVP_PKEY) c_int;
pub extern fn PEM_write_bio_PKCS8PrivateKey_nid(bp: [*c]BIO, x: [*c]EVP_PKEY, nid: c_int, kstr: [*c]u8, klen: c_int, cb: ?*const pem_password_cb, u: ?*anyopaque) c_int;
pub extern fn PEM_write_bio_PKCS8PrivateKey([*c]BIO, [*c]EVP_PKEY, ?*const EVP_CIPHER, [*c]u8, c_int, ?*const pem_password_cb, ?*anyopaque) c_int;
pub extern fn i2d_PKCS8PrivateKey_bio(bp: [*c]BIO, x: [*c]EVP_PKEY, enc: ?*const EVP_CIPHER, kstr: [*c]u8, klen: c_int, cb: ?*const pem_password_cb, u: ?*anyopaque) c_int;
pub extern fn i2d_PKCS8PrivateKey_nid_bio(bp: [*c]BIO, x: [*c]EVP_PKEY, nid: c_int, kstr: [*c]u8, klen: c_int, cb: ?*const pem_password_cb, u: ?*anyopaque) c_int;
pub extern fn d2i_PKCS8PrivateKey_bio(bp: [*c]BIO, x: [*c][*c]EVP_PKEY, cb: ?*const pem_password_cb, u: ?*anyopaque) [*c]EVP_PKEY;
// pub extern fn i2d_PKCS8PrivateKey_fp(fp: [*c]FILE, x: [*c]EVP_PKEY, enc: ?*const EVP_CIPHER, kstr: [*c]u8, klen: c_int, cb: ?*const pem_password_cb, u: ?*anyopaque) c_int;
// pub extern fn i2d_PKCS8PrivateKey_nid_fp(fp: [*c]FILE, x: [*c]EVP_PKEY, nid: c_int, kstr: [*c]u8, klen: c_int, cb: ?*const pem_password_cb, u: ?*anyopaque) c_int;
// pub extern fn PEM_write_PKCS8PrivateKey_nid(fp: [*c]FILE, x: [*c]EVP_PKEY, nid: c_int, kstr: [*c]u8, klen: c_int, cb: ?*const pem_password_cb, u: ?*anyopaque) c_int;
// pub extern fn d2i_PKCS8PrivateKey_fp(fp: [*c]FILE, x: [*c][*c]EVP_PKEY, cb: ?*const pem_password_cb, u: ?*anyopaque) [*c]EVP_PKEY;
// pub extern fn PEM_write_PKCS8PrivateKey(fp: [*c]FILE, x: [*c]EVP_PKEY, enc: ?*const EVP_CIPHER, kstr: [*c]u8, klen: c_int, cd: ?*const pem_password_cb, u: ?*anyopaque) c_int;

pub extern fn HMAC(evp_md: *const EVP_MD, key: *const anyopaque, key_len: usize, data: [*]const u8, data_len: usize, out: [*]u8, out_len: *c_uint) ?[*]u8;
pub extern fn HMAC_CTX_init(ctx: [*c]HMAC_CTX) void;
pub extern fn HMAC_CTX_new() [*c]HMAC_CTX;
pub extern fn HMAC_CTX_cleanup(ctx: [*c]HMAC_CTX) void;
pub extern fn HMAC_CTX_cleanse(ctx: [*c]HMAC_CTX) void;
pub extern fn HMAC_CTX_free(ctx: [*c]HMAC_CTX) void;
pub extern fn HMAC_Init_ex(ctx: [*c]HMAC_CTX, key: ?*const anyopaque, key_len: usize, md: ?*const EVP_MD, impl: ?*ENGINE) c_int;
pub extern fn HMAC_Update(ctx: [*c]HMAC_CTX, data: [*c]const u8, data_len: usize) c_int;
pub extern fn HMAC_Final(ctx: [*c]HMAC_CTX, out: [*c]u8, out_len: [*c]c_uint) c_int;
pub extern fn HMAC_size(ctx: [*c]const HMAC_CTX) usize;
pub extern fn HMAC_CTX_get_md(ctx: [*c]const HMAC_CTX) ?*const EVP_MD;
pub extern fn HMAC_CTX_copy_ex(dest: [*c]HMAC_CTX, src: [*c]const HMAC_CTX) c_int;
pub extern fn HMAC_CTX_reset(ctx: [*c]HMAC_CTX) void;
pub extern fn HMAC_Init(ctx: [*c]HMAC_CTX, key: ?*const anyopaque, key_len: c_int, md: ?*const EVP_MD) c_int;
pub extern fn HMAC_CTX_copy(dest: [*c]HMAC_CTX, src: [*c]const HMAC_CTX) c_int;
pub extern fn TLS_method() ?*const SSL_METHOD;
pub extern fn DTLS_method() ?*const SSL_METHOD;
pub extern fn TLS_with_buffers_method() ?*const SSL_METHOD;
pub extern fn DTLS_with_buffers_method() ?*const SSL_METHOD;
pub extern fn SSL_CTX_new(method: ?*const SSL_METHOD) ?*SSL_CTX;
pub extern fn SSL_CTX_up_ref(ctx: ?*SSL_CTX) c_int;
pub extern fn SSL_CTX_free(ctx: ?*SSL_CTX) void;
pub extern fn SSL_free(ssl: ?*SSL) void;
pub extern fn SSL_get_SSL_CTX(ssl: ?*const SSL) ?*SSL_CTX;
pub extern fn SSL_set_connect_state(ssl: ?*SSL) void;
pub extern fn SSL_set_accept_state(ssl: ?*SSL) void;
pub extern fn SSL_is_server(ssl: ?*const SSL) c_int;
pub extern fn SSL_is_dtls(ssl: ?*const SSL) c_int;
pub extern fn SSL_set_bio(ssl: ?*SSL, rbio: [*c]BIO, wbio: [*c]BIO) void;
pub extern fn SSL_set0_rbio(ssl: ?*SSL, rbio: [*c]BIO) void;
pub extern fn SSL_set0_wbio(ssl: ?*SSL, wbio: [*c]BIO) void;
pub extern fn SSL_get_rbio(ssl: ?*const SSL) [*c]BIO;
pub extern fn SSL_get_wbio(ssl: ?*const SSL) [*c]BIO;
pub extern fn SSL_get_fd(ssl: ?*const SSL) c_int;
pub extern fn SSL_get_rfd(ssl: ?*const SSL) c_int;
pub extern fn SSL_get_wfd(ssl: ?*const SSL) c_int;
pub extern fn SSL_set_fd(ssl: ?*SSL, fd: c_int) c_int;
pub extern fn SSL_set_rfd(ssl: ?*SSL, fd: c_int) c_int;
pub extern fn SSL_set_wfd(ssl: ?*SSL, fd: c_int) c_int;
pub extern fn SSL_do_handshake(ssl: ?*SSL) c_int;
pub extern fn SSL_connect(ssl: ?*SSL) c_int;
pub extern fn SSL_accept(ssl: ?*SSL) c_int;
pub extern fn SSL_read(ssl: ?*SSL, buf: ?*anyopaque, num: c_int) c_int;
pub extern fn SSL_peek(ssl: ?*SSL, buf: ?*anyopaque, num: c_int) c_int;
pub extern fn SSL_pending(ssl: ?*const SSL) c_int;
pub extern fn SSL_has_pending(ssl: ?*const SSL) c_int;
pub extern fn SSL_write(ssl: ?*SSL, buf: ?*const anyopaque, num: c_int) c_int;
pub extern fn SSL_key_update(ssl: ?*SSL, request_type: c_int) c_int;
pub extern fn SSL_shutdown(ssl: ?*SSL) c_int;
pub extern fn SSL_CTX_set_quiet_shutdown(ctx: ?*SSL_CTX, mode: c_int) void;
pub extern fn SSL_CTX_get_quiet_shutdown(ctx: ?*const SSL_CTX) c_int;
pub extern fn SSL_set_quiet_shutdown(ssl: ?*SSL, mode: c_int) void;
pub extern fn SSL_get_quiet_shutdown(ssl: ?*const SSL) c_int;
pub extern fn SSL_get_error(ssl: ?*const SSL, ret_code: c_int) c_int;
pub extern fn SSL_error_description(err: c_int) [*c]const u8;
pub extern fn SSL_set_mtu(ssl: ?*SSL, mtu: c_uint) c_int;
pub extern fn DTLSv1_set_initial_timeout_duration(ssl: ?*SSL, duration_ms: c_uint) void;
pub extern fn DTLSv1_get_timeout(ssl: ?*const SSL, out: [*c]struct_timeval) c_int;
pub extern fn DTLSv1_handle_timeout(ssl: ?*SSL) c_int;
pub extern fn SSL_CTX_set_min_proto_version(ctx: ?*SSL_CTX, version: u16) c_int;
pub extern fn SSL_CTX_set_max_proto_version(ctx: ?*SSL_CTX, version: u16) c_int;
pub extern fn SSL_CTX_get_min_proto_version(ctx: ?*const SSL_CTX) u16;
pub extern fn SSL_CTX_get_max_proto_version(ctx: ?*const SSL_CTX) u16;
pub extern fn SSL_set_min_proto_version(ssl: ?*SSL, version: u16) c_int;
pub extern fn SSL_set_max_proto_version(ssl: ?*SSL, version: u16) c_int;
pub extern fn SSL_get_min_proto_version(ssl: ?*const SSL) u16;
pub extern fn SSL_get_max_proto_version(ssl: ?*const SSL) u16;
pub extern fn SSL_version(ssl: ?*const SSL) c_int;
pub extern fn SSL_CTX_set_options(ctx: ?*SSL_CTX, options: u32) u32;
pub extern fn SSL_CTX_clear_options(ctx: ?*SSL_CTX, options: u32) u32;
pub extern fn SSL_CTX_get_options(ctx: ?*const SSL_CTX) u32;
pub extern fn SSL_set_options(ssl: ?*SSL, options: u32) u32;
pub extern fn SSL_clear_options(ssl: ?*SSL, options: u32) u32;
pub extern fn SSL_get_options(ssl: ?*const SSL) u32;
pub extern fn SSL_CTX_set_mode(ctx: ?*SSL_CTX, mode: u32) u32;
pub extern fn SSL_CTX_clear_mode(ctx: ?*SSL_CTX, mode: u32) u32;
pub extern fn SSL_CTX_get_mode(ctx: ?*const SSL_CTX) u32;
pub extern fn SSL_set_mode(ssl: ?*SSL, mode: u32) u32;
pub extern fn SSL_clear_mode(ssl: ?*SSL, mode: u32) u32;
pub extern fn SSL_get_mode(ssl: ?*const SSL) u32;
pub extern fn SSL_CTX_set0_buffer_pool(ctx: ?*SSL_CTX, pool: ?*CRYPTO_BUFFER_POOL) void;
pub extern fn SSL_CTX_use_certificate(ctx: ?*SSL_CTX, x509: ?*X509) c_int;
pub extern fn SSL_use_certificate(ssl: ?*SSL, x509: ?*X509) c_int;
pub extern fn SSL_CTX_use_PrivateKey(ctx: ?*SSL_CTX, pkey: [*c]EVP_PKEY) c_int;
pub extern fn SSL_use_PrivateKey(ssl: ?*SSL, pkey: [*c]EVP_PKEY) c_int;
pub extern fn SSL_CTX_set0_chain(ctx: ?*SSL_CTX, chain: ?*struct_stack_st_X509) c_int;
pub extern fn SSL_CTX_set1_chain(ctx: ?*SSL_CTX, chain: ?*struct_stack_st_X509) c_int;
pub extern fn SSL_set0_chain(ssl: ?*SSL, chain: ?*struct_stack_st_X509) c_int;
pub extern fn SSL_set1_chain(ssl: ?*SSL, chain: ?*struct_stack_st_X509) c_int;
pub extern fn SSL_CTX_add0_chain_cert(ctx: ?*SSL_CTX, x509: ?*X509) c_int;
pub extern fn SSL_CTX_add1_chain_cert(ctx: ?*SSL_CTX, x509: ?*X509) c_int;
pub extern fn SSL_add0_chain_cert(ssl: ?*SSL, x509: ?*X509) c_int;
pub extern fn SSL_CTX_add_extra_chain_cert(ctx: ?*SSL_CTX, x509: ?*X509) c_int;
pub extern fn SSL_add1_chain_cert(ssl: ?*SSL, x509: ?*X509) c_int;
pub extern fn SSL_CTX_clear_chain_certs(ctx: ?*SSL_CTX) c_int;
pub extern fn SSL_CTX_clear_extra_chain_certs(ctx: ?*SSL_CTX) c_int;
pub extern fn SSL_clear_chain_certs(ssl: ?*SSL) c_int;
pub extern fn SSL_CTX_set_cert_cb(ctx: ?*SSL_CTX, cb: ?*const fn (?*SSL, ?*anyopaque) callconv(.C) c_int, arg: ?*anyopaque) void;
pub extern fn SSL_set_cert_cb(ssl: ?*SSL, cb: ?*const fn (?*SSL, ?*anyopaque) callconv(.C) c_int, arg: ?*anyopaque) void;
pub extern fn SSL_get0_certificate_types(ssl: ?*const SSL, out_types: [*c][*c]const u8) usize;
pub extern fn SSL_get0_peer_verify_algorithms(ssl: ?*const SSL, out_sigalgs: [*c][*c]const u16) usize;
pub extern fn SSL_get0_peer_delegation_algorithms(ssl: ?*const SSL, out_sigalgs: [*c][*c]const u16) usize;
pub extern fn SSL_certs_clear(ssl: ?*SSL) void;
pub extern fn SSL_CTX_check_private_key(ctx: ?*const SSL_CTX) c_int;
pub extern fn SSL_check_private_key(ssl: ?*const SSL) c_int;
pub extern fn SSL_CTX_get0_certificate(ctx: ?*const SSL_CTX) ?*X509;
pub extern fn SSL_get_certificate(ssl: ?*const SSL) ?*X509;
pub extern fn SSL_CTX_get0_privatekey(ctx: ?*const SSL_CTX) [*c]EVP_PKEY;
pub extern fn SSL_get_privatekey(ssl: ?*const SSL) [*c]EVP_PKEY;
pub extern fn SSL_CTX_get0_chain_certs(ctx: ?*const SSL_CTX, out_chain: [*c]?*struct_stack_st_X509) c_int;
pub extern fn SSL_CTX_get_extra_chain_certs(ctx: ?*const SSL_CTX, out_chain: [*c]?*struct_stack_st_X509) c_int;
pub extern fn SSL_get0_chain_certs(ssl: ?*const SSL, out_chain: [*c]?*struct_stack_st_X509) c_int;
pub extern fn SSL_CTX_set_signed_cert_timestamp_list(ctx: ?*SSL_CTX, list: [*c]const u8, list_len: usize) c_int;
pub extern fn SSL_set_signed_cert_timestamp_list(ctx: ?*SSL, list: [*c]const u8, list_len: usize) c_int;
pub extern fn SSL_CTX_set_ocsp_response(ctx: ?*SSL_CTX, response: [*c]const u8, response_len: usize) c_int;
pub extern fn SSL_set_ocsp_response(ssl: ?*SSL, response: [*c]const u8, response_len: usize) c_int;
pub extern fn SSL_get_signature_algorithm_name(sigalg: u16, include_curve: c_int) [*c]const u8;
pub extern fn SSL_get_signature_algorithm_key_type(sigalg: u16) c_int;
pub extern fn SSL_get_signature_algorithm_digest(sigalg: u16) ?*const EVP_MD;
pub extern fn SSL_is_signature_algorithm_rsa_pss(sigalg: u16) c_int;
pub extern fn SSL_CTX_set_signing_algorithm_prefs(ctx: ?*SSL_CTX, prefs: [*c]const u16, num_prefs: usize) c_int;
pub extern fn SSL_set_signing_algorithm_prefs(ssl: ?*SSL, prefs: [*c]const u16, num_prefs: usize) c_int;
pub extern fn SSL_CTX_set_chain_and_key(ctx: ?*SSL_CTX, certs: [*c]const ?*CRYPTO_BUFFER, num_certs: usize, privkey: [*c]EVP_PKEY, privkey_method: [*c]const SSL_PRIVATE_KEY_METHOD) c_int;
pub extern fn SSL_set_chain_and_key(ssl: ?*SSL, certs: [*c]const ?*CRYPTO_BUFFER, num_certs: usize, privkey: [*c]EVP_PKEY, privkey_method: [*c]const SSL_PRIVATE_KEY_METHOD) c_int;
pub extern fn SSL_CTX_get0_chain(ctx: ?*const SSL_CTX) ?*const struct_stack_st_CRYPTO_BUFFER;
pub extern fn SSL_CTX_use_RSAPrivateKey(ctx: ?*SSL_CTX, rsa: ?*RSA) c_int;
pub extern fn SSL_use_RSAPrivateKey(ssl: ?*SSL, rsa: ?*RSA) c_int;
pub extern fn SSL_CTX_use_certificate_ASN1(ctx: ?*SSL_CTX, der_len: usize, der: [*c]const u8) c_int;
pub extern fn SSL_use_certificate_ASN1(ssl: ?*SSL, der: [*c]const u8, der_len: usize) c_int;
pub extern fn SSL_CTX_use_PrivateKey_ASN1(pk: c_int, ctx: ?*SSL_CTX, der: [*c]const u8, der_len: usize) c_int;
pub extern fn SSL_use_PrivateKey_ASN1(@"type": c_int, ssl: ?*SSL, der: [*c]const u8, der_len: usize) c_int;
pub extern fn SSL_CTX_use_RSAPrivateKey_ASN1(ctx: ?*SSL_CTX, der: [*c]const u8, der_len: usize) c_int;
pub extern fn SSL_use_RSAPrivateKey_ASN1(ssl: ?*SSL, der: [*c]const u8, der_len: usize) c_int;
// pub extern fn SSL_CTX_use_RSAPrivateKey_file(ctx: ?*SSL_CTX, file: [*c]const u8, @"type": c_int) c_int;
// pub extern fn SSL_use_RSAPrivateKey_file(ssl: ?*SSL, file: [*c]const u8, @"type": c_int) c_int;
// pub extern fn SSL_CTX_use_certificate_file(ctx: ?*SSL_CTX, file: [*c]const u8, @"type": c_int) c_int;
// pub extern fn SSL_use_certificate_file(ssl: ?*SSL, file: [*c]const u8, @"type": c_int) c_int;
// pub extern fn SSL_CTX_use_PrivateKey_file(ctx: ?*SSL_CTX, file: [*c]const u8, @"type": c_int) c_int;
// pub extern fn SSL_use_PrivateKey_file(ssl: ?*SSL, file: [*c]const u8, @"type": c_int) c_int;
// pub extern fn SSL_CTX_use_certificate_chain_file(ctx: ?*SSL_CTX, file: [*c]const u8) c_int;
pub extern fn SSL_CTX_set_default_passwd_cb(ctx: ?*SSL_CTX, cb: ?*const pem_password_cb) void;
pub extern fn SSL_CTX_get_default_passwd_cb(ctx: ?*const SSL_CTX) ?*const pem_password_cb;
pub extern fn SSL_CTX_set_default_passwd_cb_userdata(ctx: ?*SSL_CTX, data: ?*anyopaque) void;
pub extern fn SSL_CTX_get_default_passwd_cb_userdata(ctx: ?*const SSL_CTX) ?*anyopaque;
pub extern fn SSL_set_private_key_method(ssl: ?*SSL, key_method: [*c]const SSL_PRIVATE_KEY_METHOD) void;
pub extern fn SSL_CTX_set_private_key_method(ctx: ?*SSL_CTX, key_method: [*c]const SSL_PRIVATE_KEY_METHOD) void;
pub extern fn SSL_can_release_private_key(ssl: ?*const SSL) c_int;
pub const struct_stack_st_SSL_CIPHER = opaque {};
pub const sk_SSL_CIPHER_free_func = ?*const fn (?*const SSL_CIPHER) callconv(.C) void;
pub const sk_SSL_CIPHER_copy_func = ?*const fn (?*const SSL_CIPHER) callconv(.C) ?*const SSL_CIPHER;
pub const sk_SSL_CIPHER_cmp_func = ?*const fn ([*c]?*const SSL_CIPHER, [*c]?*const SSL_CIPHER) callconv(.C) c_int;
pub fn sk_SSL_CIPHER_call_free_func(arg_free_func: OPENSSL_sk_free_func, arg_ptr: ?*anyopaque) callconv(.C) void {
    const free_func = arg_free_func;
    const ptr = arg_ptr;
    @as(sk_SSL_CIPHER_free_func, @ptrCast(@alignCast(free_func))).?(@as(?*const SSL_CIPHER, @ptrCast(ptr)));
}
pub fn sk_SSL_CIPHER_call_copy_func(arg_copy_func: OPENSSL_sk_copy_func, arg_ptr: ?*anyopaque) callconv(.C) ?*anyopaque {
    const copy_func = arg_copy_func;
    const ptr = arg_ptr;
    return @as(?*anyopaque, @ptrCast(@volatileCast(@constCast(@as(sk_SSL_CIPHER_copy_func, @ptrCast(@alignCast(copy_func))).?(@as(?*const SSL_CIPHER, @ptrCast(ptr)))))));
}
pub fn sk_SSL_CIPHER_call_cmp_func(arg_cmp_func: OPENSSL_sk_cmp_func, arg_a: [*c]const ?*const anyopaque, arg_b: [*c]const ?*const anyopaque) callconv(.C) c_int {
    const cmp_func = arg_cmp_func;
    const a = arg_a;
    const b = arg_b;
    var a_ptr: ?*const SSL_CIPHER = @as(?*const SSL_CIPHER, @ptrCast(a.*));
    var b_ptr: ?*const SSL_CIPHER = @as(?*const SSL_CIPHER, @ptrCast(b.*));
    return @as(sk_SSL_CIPHER_cmp_func, @ptrCast(@alignCast(cmp_func))).?(&a_ptr, &b_ptr);
}
pub fn sk_SSL_CIPHER_new(arg_comp: sk_SSL_CIPHER_cmp_func) callconv(.C) ?*struct_stack_st_SSL_CIPHER {
    const comp = arg_comp;
    return @as(?*struct_stack_st_SSL_CIPHER, @ptrCast(sk_new(@as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp))))));
}
pub fn sk_SSL_CIPHER_new_null() callconv(.C) ?*struct_stack_st_SSL_CIPHER {
    return @as(?*struct_stack_st_SSL_CIPHER, @ptrCast(sk_new_null()));
}
pub fn sk_SSL_CIPHER_num(arg_sk: ?*const struct_stack_st_SSL_CIPHER) callconv(.C) usize {
    const sk = arg_sk;
    return sk_num(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_SSL_CIPHER_zero(arg_sk: ?*struct_stack_st_SSL_CIPHER) callconv(.C) void {
    const sk = arg_sk;
    sk_zero(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_SSL_CIPHER_value(arg_sk: ?*const struct_stack_st_SSL_CIPHER, arg_i: usize) callconv(.C) ?*const SSL_CIPHER {
    const sk = arg_sk;
    const i = arg_i;
    return @as(?*const SSL_CIPHER, @ptrCast(sk_value(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), i)));
}
pub fn sk_SSL_CIPHER_set(arg_sk: ?*struct_stack_st_SSL_CIPHER, arg_i: usize, arg_p: ?*const SSL_CIPHER) callconv(.C) ?*const SSL_CIPHER {
    const sk = arg_sk;
    const i = arg_i;
    const p = arg_p;
    return @as(?*const SSL_CIPHER, @ptrCast(sk_set(@as([*c]_STACK, @ptrCast(@alignCast(sk))), i, @as(?*anyopaque, @ptrCast(@volatileCast(@constCast(p)))))));
}
pub fn sk_SSL_CIPHER_free(arg_sk: ?*struct_stack_st_SSL_CIPHER) callconv(.C) void {
    const sk = arg_sk;
    sk_free(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_SSL_CIPHER_pop_free(arg_sk: ?*struct_stack_st_SSL_CIPHER, arg_free_func: sk_SSL_CIPHER_free_func) callconv(.C) void {
    const sk = arg_sk;
    const free_func = arg_free_func;
    sk_pop_free_ex(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_SSL_CIPHER_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))));
}
pub fn sk_SSL_CIPHER_insert(arg_sk: ?*struct_stack_st_SSL_CIPHER, arg_p: ?*const SSL_CIPHER, arg_where: usize) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    const where = arg_where;
    return sk_insert(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(@volatileCast(@constCast(p)))), where);
}
pub fn sk_SSL_CIPHER_delete(arg_sk: ?*struct_stack_st_SSL_CIPHER, arg_where: usize) callconv(.C) ?*const SSL_CIPHER {
    const sk = arg_sk;
    const where = arg_where;
    return @as(?*const SSL_CIPHER, @ptrCast(sk_delete(@as([*c]_STACK, @ptrCast(@alignCast(sk))), where)));
}
pub fn sk_SSL_CIPHER_delete_ptr(arg_sk: ?*struct_stack_st_SSL_CIPHER, arg_p: ?*const SSL_CIPHER) callconv(.C) ?*const SSL_CIPHER {
    const sk = arg_sk;
    const p = arg_p;
    return @as(?*const SSL_CIPHER, @ptrCast(sk_delete_ptr(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*const anyopaque, @ptrCast(p)))));
}
pub fn sk_SSL_CIPHER_find(arg_sk: ?*const struct_stack_st_SSL_CIPHER, arg_out_index: [*c]usize, arg_p: ?*const SSL_CIPHER) callconv(.C) c_int {
    const sk = arg_sk;
    const out_index = arg_out_index;
    const p = arg_p;
    return sk_find(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), out_index, @as(?*const anyopaque, @ptrCast(p)), &sk_SSL_CIPHER_call_cmp_func);
}
pub fn sk_SSL_CIPHER_shift(arg_sk: ?*struct_stack_st_SSL_CIPHER) callconv(.C) ?*const SSL_CIPHER {
    const sk = arg_sk;
    return @as(?*const SSL_CIPHER, @ptrCast(sk_shift(@as([*c]_STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_SSL_CIPHER_push(arg_sk: ?*struct_stack_st_SSL_CIPHER, arg_p: ?*const SSL_CIPHER) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    return sk_push(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(@volatileCast(@constCast(p)))));
}
pub fn sk_SSL_CIPHER_pop(arg_sk: ?*struct_stack_st_SSL_CIPHER) callconv(.C) ?*const SSL_CIPHER {
    const sk = arg_sk;
    return @as(?*const SSL_CIPHER, @ptrCast(sk_pop(@as([*c]_STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_SSL_CIPHER_dup(arg_sk: ?*const struct_stack_st_SSL_CIPHER) callconv(.C) ?*struct_stack_st_SSL_CIPHER {
    const sk = arg_sk;
    return @as(?*struct_stack_st_SSL_CIPHER, @ptrCast(sk_dup(@as([*c]const _STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_SSL_CIPHER_sort(arg_sk: ?*struct_stack_st_SSL_CIPHER) callconv(.C) void {
    const sk = arg_sk;
    sk_sort(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_SSL_CIPHER_call_cmp_func);
}
pub fn sk_SSL_CIPHER_is_sorted(arg_sk: ?*const struct_stack_st_SSL_CIPHER) callconv(.C) c_int {
    const sk = arg_sk;
    return sk_is_sorted(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_SSL_CIPHER_set_cmp_func(arg_sk: ?*struct_stack_st_SSL_CIPHER, arg_comp: sk_SSL_CIPHER_cmp_func) callconv(.C) sk_SSL_CIPHER_cmp_func {
    const sk = arg_sk;
    const comp = arg_comp;
    return @as(sk_SSL_CIPHER_cmp_func, @ptrCast(@alignCast(sk_set_cmp_func(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp)))))));
}
pub fn sk_SSL_CIPHER_deep_copy(arg_sk: ?*const struct_stack_st_SSL_CIPHER, arg_copy_func: sk_SSL_CIPHER_copy_func, arg_free_func: sk_SSL_CIPHER_free_func) callconv(.C) ?*struct_stack_st_SSL_CIPHER {
    const sk = arg_sk;
    const copy_func = arg_copy_func;
    const free_func = arg_free_func;
    return @as(?*struct_stack_st_SSL_CIPHER, @ptrCast(sk_deep_copy(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), &sk_SSL_CIPHER_call_copy_func, @as(OPENSSL_sk_copy_func, @ptrCast(@alignCast(copy_func))), &sk_SSL_CIPHER_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))))));
}
pub extern fn SSL_get_cipher_by_value(value: u16) ?*const SSL_CIPHER;
pub extern fn SSL_CIPHER_get_id(cipher: ?*const SSL_CIPHER) u32;
pub extern fn SSL_CIPHER_get_protocol_id(cipher: ?*const SSL_CIPHER) u16;
pub extern fn SSL_CIPHER_is_aead(cipher: ?*const SSL_CIPHER) c_int;
pub extern fn SSL_CIPHER_is_block_cipher(cipher: ?*const SSL_CIPHER) c_int;
pub extern fn SSL_CIPHER_get_cipher_nid(cipher: ?*const SSL_CIPHER) c_int;
pub extern fn SSL_CIPHER_get_digest_nid(cipher: ?*const SSL_CIPHER) c_int;
pub extern fn SSL_CIPHER_get_kx_nid(cipher: ?*const SSL_CIPHER) c_int;
pub extern fn SSL_CIPHER_get_auth_nid(cipher: ?*const SSL_CIPHER) c_int;
pub extern fn SSL_CIPHER_get_prf_nid(cipher: ?*const SSL_CIPHER) c_int;
pub extern fn SSL_CIPHER_get_min_version(cipher: ?*const SSL_CIPHER) u16;
pub extern fn SSL_CIPHER_get_max_version(cipher: ?*const SSL_CIPHER) u16;
pub extern fn SSL_CIPHER_standard_name(cipher: ?*const SSL_CIPHER) [*c]const u8;
pub extern fn SSL_CIPHER_get_name(cipher: ?*const SSL_CIPHER) [*c]const u8;
pub extern fn SSL_CIPHER_get_kx_name(cipher: ?*const SSL_CIPHER) [*c]const u8;
pub extern fn SSL_CIPHER_get_bits(cipher: ?*const SSL_CIPHER, out_alg_bits: [*c]c_int) c_int;
pub extern fn SSL_CTX_set_strict_cipher_list(ctx: ?*SSL_CTX, str: [*c]const u8) c_int;
pub extern fn SSL_CTX_set_cipher_list(ctx: ?*SSL_CTX, str: [*c]const u8) c_int;
pub extern fn SSL_set_strict_cipher_list(ssl: ?*SSL, str: [*c]const u8) c_int;
pub extern fn SSL_set_cipher_list(ssl: ?*SSL, str: [*c]const u8) c_int;
pub extern fn SSL_CTX_get_ciphers(ctx: ?*const SSL_CTX) ?*struct_stack_st_SSL_CIPHER;
pub extern fn SSL_CTX_cipher_in_group(ctx: ?*const SSL_CTX, i: usize) c_int;
pub extern fn SSL_get_ciphers(ssl: ?*const SSL) ?*struct_stack_st_SSL_CIPHER;
pub extern fn SSL_is_init_finished(ssl: ?*const SSL) c_int;
pub extern fn SSL_in_init(ssl: ?*const SSL) c_int;
pub extern fn SSL_in_false_start(ssl: ?*const SSL) c_int;
pub extern fn SSL_get_peer_certificate(ssl: ?*const SSL) ?*X509;
pub extern fn SSL_get_peer_cert_chain(ssl: ?*const SSL) ?*struct_stack_st_X509;
pub extern fn SSL_get_peer_full_cert_chain(ssl: ?*const SSL) ?*struct_stack_st_X509;
pub extern fn SSL_get0_peer_certificates(ssl: ?*const SSL) ?*const struct_stack_st_CRYPTO_BUFFER;
pub extern fn SSL_get0_signed_cert_timestamp_list(ssl: ?*const SSL, out: [*c][*c]const u8, out_len: [*c]usize) void;
pub extern fn SSL_get0_ocsp_response(ssl: ?*const SSL, out: [*c][*c]const u8, out_len: [*c]usize) void;
pub extern fn SSL_get_tls_unique(ssl: ?*const SSL, out: [*c]u8, out_len: [*c]usize, max_out: usize) c_int;
pub extern fn SSL_get_extms_support(ssl: ?*const SSL) c_int;
pub extern fn SSL_get_current_cipher(ssl: ?*const SSL) ?*const SSL_CIPHER;
pub extern fn SSL_session_reused(ssl: ?*const SSL) c_int;
pub extern fn SSL_get_secure_renegotiation_support(ssl: ?*const SSL) c_int;
pub extern fn SSL_export_keying_material(ssl: ?*SSL, out: [*c]u8, out_len: usize, label: [*c]const u8, label_len: usize, context: [*c]const u8, context_len: usize, use_context: c_int) c_int;
pub extern fn PEM_read_bio_SSL_SESSION(bp: [*c]BIO, x: [*c]?*SSL_SESSION, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*SSL_SESSION;
// pub extern fn PEM_read_SSL_SESSION(fp: [*c]FILE, x: [*c]?*SSL_SESSION, cb: ?*const pem_password_cb, u: ?*anyopaque) ?*SSL_SESSION;
pub extern fn PEM_write_bio_SSL_SESSION(bp: [*c]BIO, x: ?*SSL_SESSION) c_int;
// pub extern fn PEM_write_SSL_SESSION(fp: [*c]FILE, x: ?*SSL_SESSION) c_int;
pub extern fn SSL_SESSION_new(ctx: ?*const SSL_CTX) ?*SSL_SESSION;
pub extern fn SSL_SESSION_up_ref(session: ?*SSL_SESSION) c_int;
pub extern fn SSL_SESSION_free(session: ?*SSL_SESSION) void;
pub extern fn SSL_SESSION_to_bytes(in: ?*const SSL_SESSION, out_data: [*c][*c]u8, out_len: [*c]usize) c_int;
pub extern fn SSL_SESSION_to_bytes_for_ticket(in: ?*const SSL_SESSION, out_data: [*c][*c]u8, out_len: [*c]usize) c_int;
pub extern fn SSL_SESSION_from_bytes(in: [*c]const u8, in_len: usize, ctx: ?*const SSL_CTX) ?*SSL_SESSION;
pub extern fn SSL_SESSION_get_version(session: ?*const SSL_SESSION) [*c]const u8;
pub extern fn SSL_SESSION_get_protocol_version(session: ?*const SSL_SESSION) u16;
pub extern fn SSL_SESSION_set_protocol_version(session: ?*SSL_SESSION, version: u16) c_int;
pub extern fn SSL_SESSION_get_id(session: ?*const SSL_SESSION, out_len: [*c]c_uint) [*c]const u8;
pub extern fn SSL_SESSION_set1_id(session: ?*SSL_SESSION, sid: [*c]const u8, sid_len: usize) c_int;
pub extern fn SSL_SESSION_get_time(session: ?*const SSL_SESSION) u64;
pub extern fn SSL_SESSION_get_timeout(session: ?*const SSL_SESSION) u32;
pub extern fn SSL_SESSION_get0_peer(session: ?*const SSL_SESSION) ?*X509;
pub extern fn SSL_SESSION_get0_peer_certificates(session: ?*const SSL_SESSION) ?*const struct_stack_st_CRYPTO_BUFFER;
pub extern fn SSL_SESSION_get0_signed_cert_timestamp_list(session: ?*const SSL_SESSION, out: [*c][*c]const u8, out_len: [*c]usize) void;
pub extern fn SSL_SESSION_get0_ocsp_response(session: ?*const SSL_SESSION, out: [*c][*c]const u8, out_len: [*c]usize) void;
pub extern fn SSL_SESSION_get_master_key(session: ?*const SSL_SESSION, out: [*c]u8, max_out: usize) usize;
pub extern fn SSL_SESSION_set_time(session: ?*SSL_SESSION, time: u64) u64;
pub extern fn SSL_SESSION_set_timeout(session: ?*SSL_SESSION, timeout: u32) u32;
pub extern fn SSL_SESSION_get0_id_context(session: ?*const SSL_SESSION, out_len: [*c]c_uint) [*c]const u8;
pub extern fn SSL_SESSION_set1_id_context(session: ?*SSL_SESSION, sid_ctx: [*c]const u8, sid_ctx_len: usize) c_int;
pub extern fn SSL_SESSION_should_be_single_use(session: ?*const SSL_SESSION) c_int;
pub extern fn SSL_SESSION_is_resumable(session: ?*const SSL_SESSION) c_int;
pub extern fn SSL_SESSION_has_ticket(session: ?*const SSL_SESSION) c_int;
pub extern fn SSL_SESSION_get0_ticket(session: ?*const SSL_SESSION, out_ticket: [*c][*c]const u8, out_len: [*c]usize) void;
pub extern fn SSL_SESSION_set_ticket(session: ?*SSL_SESSION, ticket: [*c]const u8, ticket_len: usize) c_int;
pub extern fn SSL_SESSION_get_ticket_lifetime_hint(session: ?*const SSL_SESSION) u32;
pub extern fn SSL_SESSION_get0_cipher(session: ?*const SSL_SESSION) ?*const SSL_CIPHER;
pub extern fn SSL_SESSION_has_peer_sha256(session: ?*const SSL_SESSION) c_int;
pub extern fn SSL_SESSION_get0_peer_sha256(session: ?*const SSL_SESSION, out_ptr: [*c][*c]const u8, out_len: [*c]usize) void;
pub extern fn SSL_CTX_set_session_cache_mode(ctx: ?*SSL_CTX, mode: c_int) c_int;
pub extern fn SSL_CTX_get_session_cache_mode(ctx: ?*const SSL_CTX) c_int;
pub extern fn SSL_set_session(ssl: ?*SSL, session: ?*SSL_SESSION) c_int;
pub extern fn SSL_CTX_set_timeout(ctx: ?*SSL_CTX, timeout: u32) u32;
pub extern fn SSL_CTX_set_session_psk_dhe_timeout(ctx: ?*SSL_CTX, timeout: u32) void;
pub extern fn SSL_CTX_get_timeout(ctx: ?*const SSL_CTX) u32;
pub extern fn SSL_CTX_set_session_id_context(ctx: ?*SSL_CTX, sid_ctx: [*c]const u8, sid_ctx_len: usize) c_int;
pub extern fn SSL_set_session_id_context(ssl: ?*SSL, sid_ctx: [*c]const u8, sid_ctx_len: usize) c_int;
pub extern fn SSL_get0_session_id_context(ssl: ?*const SSL, out_len: [*c]usize) [*c]const u8;
pub extern fn SSL_CTX_sess_set_cache_size(ctx: ?*SSL_CTX, size: c_ulong) c_ulong;
pub extern fn SSL_CTX_sess_get_cache_size(ctx: ?*const SSL_CTX) c_ulong;
pub extern fn SSL_CTX_sess_number(ctx: ?*const SSL_CTX) usize;
pub extern fn SSL_CTX_add_session(ctx: ?*SSL_CTX, session: ?*SSL_SESSION) c_int;
pub extern fn SSL_CTX_remove_session(ctx: ?*SSL_CTX, session: ?*SSL_SESSION) c_int;
pub extern fn SSL_CTX_flush_sessions(ctx: ?*SSL_CTX, time: u64) void;
pub extern fn SSL_CTX_sess_set_new_cb(ctx: ?*SSL_CTX, new_session_cb: ?*const fn (?*SSL, ?*SSL_SESSION) callconv(.C) c_int) void;
pub extern fn SSL_CTX_sess_get_new_cb(ctx: ?*SSL_CTX) ?*const fn (?*SSL, ?*SSL_SESSION) callconv(.C) c_int;
pub extern fn SSL_CTX_sess_set_remove_cb(ctx: ?*SSL_CTX, remove_session_cb: ?*const fn (?*SSL_CTX, ?*SSL_SESSION) callconv(.C) void) void;
pub extern fn SSL_CTX_sess_get_remove_cb(ctx: ?*SSL_CTX) ?*const fn (?*SSL_CTX, ?*SSL_SESSION) callconv(.C) void;
pub extern fn SSL_CTX_sess_set_get_cb(ctx: ?*SSL_CTX, get_session_cb: ?*const fn (?*SSL, [*c]const u8, c_int, [*c]c_int) callconv(.C) ?*SSL_SESSION) void;
pub extern fn SSL_CTX_sess_get_get_cb(ctx: ?*SSL_CTX) ?*const fn (?*SSL, [*c]const u8, c_int, [*c]c_int) callconv(.C) ?*SSL_SESSION;
pub extern fn SSL_magic_pending_session_ptr() ?*SSL_SESSION;
pub extern fn SSL_CTX_get_tlsext_ticket_keys(ctx: ?*SSL_CTX, out: ?*anyopaque, len: usize) c_int;
pub extern fn SSL_CTX_set_tlsext_ticket_keys(ctx: ?*SSL_CTX, in: ?*const anyopaque, len: usize) c_int;
pub extern fn SSL_CTX_set_tlsext_ticket_key_cb(ctx: ?*SSL_CTX, callback: ?*const fn (?*SSL, [*c]u8, [*c]u8, [*c]EVP_CIPHER_CTX, [*c]HMAC_CTX, c_int) callconv(.C) c_int) c_int;
pub extern fn SSL_CTX_set_ticket_aead_method(ctx: ?*SSL_CTX, aead_method: [*c]const SSL_TICKET_AEAD_METHOD) void;
pub extern fn SSL_process_tls13_new_session_ticket(ssl: ?*SSL, buf: [*c]const u8, buf_len: usize) ?*SSL_SESSION;
pub extern fn SSL_CTX_set_num_tickets(ctx: ?*SSL_CTX, num_tickets: usize) c_int;
pub extern fn SSL_CTX_get_num_tickets(ctx: ?*const SSL_CTX) usize;
pub extern fn SSL_CTX_set1_curves(ctx: ?*SSL_CTX, curves: [*c]const c_int, curves_len: usize) c_int;
pub extern fn SSL_set1_curves(ssl: ?*SSL, curves: [*c]const c_int, curves_len: usize) c_int;
pub extern fn SSL_CTX_set1_curves_list(ctx: ?*SSL_CTX, curves: [*c]const u8) c_int;
pub extern fn SSL_set1_curves_list(ssl: ?*SSL, curves: [*c]const u8) c_int;
pub extern fn SSL_get_curve_id(ssl: ?*const SSL) u16;
pub extern fn SSL_get_curve_name(curve_id: u16) [*c]const u8;
pub extern fn SSL_CTX_set1_groups(ctx: ?*SSL_CTX, groups: [*c]const c_int, groups_len: usize) c_int;
pub extern fn SSL_set1_groups(ssl: ?*SSL, groups: [*c]const c_int, groups_len: usize) c_int;
pub extern fn SSL_CTX_set1_groups_list(ctx: ?*SSL_CTX, groups: [*c]const u8) c_int;
pub extern fn SSL_set1_groups_list(ssl: ?*SSL, groups: [*c]const u8) c_int;
pub extern fn SSL_CTX_set_verify(ctx: ?*SSL_CTX, mode: c_int, callback: ?*const fn (c_int, ?*X509_STORE_CTX) callconv(.C) c_int) void;
pub extern fn SSL_set_verify(ssl: ?*SSL, mode: c_int, callback: ?*const fn (c_int, ?*X509_STORE_CTX) callconv(.C) c_int) void;
pub const ssl_verify_ok: c_int = 0;
pub const ssl_verify_invalid: c_int = 1;
pub const ssl_verify_retry: c_int = 2;
pub extern fn SSL_set_custom_verify(ssl: ?*SSL, mode: c_int, callback: ?*const fn (?*SSL, [*c]u8) callconv(.C) enum_ssl_verify_result_t) void;
pub extern fn SSL_CTX_get_verify_mode(ctx: ?*const SSL_CTX) c_int;
pub extern fn SSL_get_verify_mode(ssl: ?*const SSL) c_int;
pub extern fn SSL_CTX_get_verify_callback(ctx: ?*const SSL_CTX) ?*const fn (c_int, ?*X509_STORE_CTX) callconv(.C) c_int;
pub extern fn SSL_get_verify_callback(ssl: ?*const SSL) ?*const fn (c_int, ?*X509_STORE_CTX) callconv(.C) c_int;
pub extern fn SSL_set1_host(ssl: ?*SSL, hostname: [*c]const u8) c_int;
pub extern fn SSL_CTX_set_verify_depth(ctx: ?*SSL_CTX, depth: c_int) void;
pub extern fn SSL_set_verify_depth(ssl: ?*SSL, depth: c_int) void;
pub extern fn SSL_CTX_get_verify_depth(ctx: ?*const SSL_CTX) c_int;
pub extern fn SSL_get_verify_depth(ssl: ?*const SSL) c_int;
pub extern fn SSL_CTX_set1_param(ctx: ?*SSL_CTX, param: ?*const X509_VERIFY_PARAM) c_int;
pub extern fn SSL_set1_param(ssl: ?*SSL, param: ?*const X509_VERIFY_PARAM) c_int;
pub extern fn SSL_CTX_get0_param(ctx: ?*SSL_CTX) ?*X509_VERIFY_PARAM;
pub extern fn SSL_get0_param(ssl: ?*SSL) ?*X509_VERIFY_PARAM;
pub extern fn SSL_CTX_set_purpose(ctx: ?*SSL_CTX, purpose: c_int) c_int;
pub extern fn SSL_set_purpose(ssl: ?*SSL, purpose: c_int) c_int;
pub extern fn SSL_CTX_set_trust(ctx: ?*SSL_CTX, trust: c_int) c_int;
pub extern fn SSL_set_trust(ssl: ?*SSL, trust: c_int) c_int;
pub extern fn SSL_CTX_set_cert_store(ctx: ?*SSL_CTX, store: ?*X509_STORE) void;
pub extern fn SSL_CTX_get_cert_store(ctx: ?*const SSL_CTX) ?*X509_STORE;
pub extern fn SSL_CTX_set_default_verify_paths(ctx: ?*SSL_CTX) c_int;
// pub extern fn SSL_CTX_load_verify_locations(ctx: ?*SSL_CTX, ca_file: [*c]const u8, ca_dir: [*c]const u8) c_int;
pub extern fn SSL_get_verify_result(ssl: ?*const SSL) c_long;
pub extern fn SSL_alert_from_verify_result(result: c_long) c_int;
pub extern fn SSL_get_ex_data_X509_STORE_CTX_idx() c_int;
pub extern fn SSL_CTX_set_cert_verify_callback(ctx: ?*SSL_CTX, callback: ?*const fn (?*X509_STORE_CTX, ?*anyopaque) callconv(.C) c_int, arg: ?*anyopaque) void;
pub extern fn SSL_enable_signed_cert_timestamps(ssl: ?*SSL) void;
pub extern fn SSL_CTX_enable_signed_cert_timestamps(ctx: ?*SSL_CTX) void;
pub extern fn SSL_enable_ocsp_stapling(ssl: ?*SSL) void;
pub extern fn SSL_CTX_enable_ocsp_stapling(ctx: ?*SSL_CTX) void;
pub extern fn SSL_CTX_set0_verify_cert_store(ctx: ?*SSL_CTX, store: ?*X509_STORE) c_int;
pub extern fn SSL_CTX_set1_verify_cert_store(ctx: ?*SSL_CTX, store: ?*X509_STORE) c_int;
pub extern fn SSL_set0_verify_cert_store(ssl: ?*SSL, store: ?*X509_STORE) c_int;
pub extern fn SSL_set1_verify_cert_store(ssl: ?*SSL, store: ?*X509_STORE) c_int;
pub extern fn SSL_CTX_set_verify_algorithm_prefs(ctx: ?*SSL_CTX, prefs: [*c]const u16, num_prefs: usize) c_int;
pub extern fn SSL_set_verify_algorithm_prefs(ssl: ?*SSL, prefs: [*c]const u16, num_prefs: usize) c_int;
pub extern fn SSL_set_hostflags(ssl: ?*SSL, flags: c_uint) void;
pub extern fn SSL_set_client_CA_list(ssl: ?*SSL, name_list: ?*struct_stack_st_X509_NAME) void;
pub extern fn SSL_CTX_set_client_CA_list(ctx: ?*SSL_CTX, name_list: ?*struct_stack_st_X509_NAME) void;
pub extern fn SSL_set0_client_CAs(ssl: ?*SSL, name_list: ?*struct_stack_st_CRYPTO_BUFFER) void;
pub extern fn SSL_CTX_set0_client_CAs(ctx: ?*SSL_CTX, name_list: ?*struct_stack_st_CRYPTO_BUFFER) void;
pub extern fn SSL_get_client_CA_list(ssl: ?*const SSL) ?*struct_stack_st_X509_NAME;
pub extern fn SSL_get0_server_requested_CAs(ssl: ?*const SSL) ?*const struct_stack_st_CRYPTO_BUFFER;
pub extern fn SSL_CTX_get_client_CA_list(ctx: ?*const SSL_CTX) ?*struct_stack_st_X509_NAME;
pub extern fn SSL_add_client_CA(ssl: ?*SSL, x509: ?*X509) c_int;
pub extern fn SSL_CTX_add_client_CA(ctx: ?*SSL_CTX, x509: ?*X509) c_int;
// pub extern fn SSL_load_client_CA_file(file: [*c]const u8) ?*struct_stack_st_X509_NAME;
pub extern fn SSL_dup_CA_list(list: ?*struct_stack_st_X509_NAME) ?*struct_stack_st_X509_NAME;
// pub extern fn SSL_add_file_cert_subjects_to_stack(out: ?*struct_stack_st_X509_NAME, file: [*c]const u8) c_int;
pub extern fn SSL_add_bio_cert_subjects_to_stack(out: ?*struct_stack_st_X509_NAME, bio: [*c]BIO) c_int;
pub extern fn SSL_set_tlsext_host_name(ssl: ?*SSL, name: [*c]const u8) c_int;
pub extern fn SSL_get_servername(ssl: ?*const SSL, @"type": c_int) [*c]const u8;
pub extern fn SSL_get_servername_type(ssl: ?*const SSL) c_int;
pub extern fn SSL_CTX_set_tlsext_servername_callback(ctx: ?*SSL_CTX, callback: ?*const fn (?*SSL, [*c]c_int, ?*anyopaque) callconv(.C) c_int) c_int;
pub extern fn SSL_CTX_set_tlsext_servername_arg(ctx: ?*SSL_CTX, arg: ?*anyopaque) c_int;
pub extern fn SSL_set_SSL_CTX(ssl: ?*SSL, ctx: ?*SSL_CTX) ?*SSL_CTX;
pub extern fn SSL_CTX_set_alpn_protos(ctx: ?*SSL_CTX, protos: [*c]const u8, protos_len: usize) c_int;
pub extern fn SSL_set_alpn_protos(ssl: ?*SSL, protos: [*c]const u8, protos_len: usize) c_int;
pub extern fn SSL_CTX_set_alpn_select_cb(ctx: ?*SSL_CTX, cb: ?*const fn (?*SSL, [*c][*c]const u8, [*c]u8, [*c]const u8, c_uint, ?*anyopaque) callconv(.C) c_int, arg: ?*anyopaque) void;
pub extern fn SSL_get0_alpn_selected(ssl: ?*const SSL, out_data: [*c][*c]const u8, out_len: [*c]c_uint) void;
pub extern fn SSL_CTX_set_allow_unknown_alpn_protos(ctx: ?*SSL_CTX, enabled: c_int) void;
pub extern fn SSL_add_application_settings(ssl: ?*SSL, proto: [*c]const u8, proto_len: usize, settings: [*c]const u8, settings_len: usize) c_int;
pub extern fn SSL_get0_peer_application_settings(ssl: ?*const SSL, out_data: [*c][*c]const u8, out_len: [*c]usize) void;
pub extern fn SSL_has_application_settings(ssl: ?*const SSL) c_int;
pub const ssl_cert_compression_func_t = ?*const fn (?*SSL, ?*CBB, [*c]const u8, usize) callconv(.C) c_int;
pub const ssl_cert_decompression_func_t = ?*const fn (?*SSL, [*c]?*CRYPTO_BUFFER, usize, [*c]const u8, usize) callconv(.C) c_int;
pub extern fn SSL_CTX_add_cert_compression_alg(ctx: ?*SSL_CTX, alg_id: u16, compress: ssl_cert_compression_func_t, decompress: ssl_cert_decompression_func_t) c_int;
pub extern fn SSL_CTX_set_next_protos_advertised_cb(ctx: ?*SSL_CTX, cb: ?*const fn (?*SSL, [*c][*c]const u8, [*c]c_uint, ?*anyopaque) callconv(.C) c_int, arg: ?*anyopaque) void;
pub extern fn SSL_CTX_set_next_proto_select_cb(ctx: ?*SSL_CTX, cb: ?*const fn (?*SSL, [*c][*c]u8, [*c]u8, [*c]const u8, c_uint, ?*anyopaque) callconv(.C) c_int, arg: ?*anyopaque) void;
pub extern fn SSL_get0_next_proto_negotiated(ssl: ?*const SSL, out_data: [*c][*c]const u8, out_len: [*c]c_uint) void;
pub extern fn SSL_select_next_proto(out: [*c][*c]u8, out_len: [*c]u8, peer: [*c]const u8, peer_len: c_uint, supported: [*c]const u8, supported_len: c_uint) c_int;
pub extern fn SSL_CTX_set_tls_channel_id_enabled(ctx: ?*SSL_CTX, enabled: c_int) void;
pub extern fn SSL_set_tls_channel_id_enabled(ssl: ?*SSL, enabled: c_int) void;
pub extern fn SSL_CTX_set1_tls_channel_id(ctx: ?*SSL_CTX, private_key: [*c]EVP_PKEY) c_int;
pub extern fn SSL_set1_tls_channel_id(ssl: ?*SSL, private_key: [*c]EVP_PKEY) c_int;
pub extern fn SSL_get_tls_channel_id(ssl: ?*SSL, out: [*c]u8, max_out: usize) usize;
pub const struct_stack_st_SRTP_PROTECTION_PROFILE = opaque {};
pub const sk_SRTP_PROTECTION_PROFILE_free_func = ?*const fn ([*c]const SRTP_PROTECTION_PROFILE) callconv(.C) void;
pub const sk_SRTP_PROTECTION_PROFILE_copy_func = ?*const fn ([*c]const SRTP_PROTECTION_PROFILE) callconv(.C) [*c]const SRTP_PROTECTION_PROFILE;
pub const sk_SRTP_PROTECTION_PROFILE_cmp_func = ?*const fn ([*c][*c]const SRTP_PROTECTION_PROFILE, [*c][*c]const SRTP_PROTECTION_PROFILE) callconv(.C) c_int;
pub fn sk_SRTP_PROTECTION_PROFILE_call_free_func(arg_free_func: OPENSSL_sk_free_func, arg_ptr: ?*anyopaque) callconv(.C) void {
    const free_func = arg_free_func;
    const ptr = arg_ptr;
    @as(sk_SRTP_PROTECTION_PROFILE_free_func, @ptrCast(@alignCast(free_func))).?(@as([*c]const SRTP_PROTECTION_PROFILE, @ptrCast(@alignCast(ptr))));
}
pub fn sk_SRTP_PROTECTION_PROFILE_call_copy_func(arg_copy_func: OPENSSL_sk_copy_func, arg_ptr: ?*anyopaque) callconv(.C) ?*anyopaque {
    const copy_func = arg_copy_func;
    const ptr = arg_ptr;
    return @as(?*anyopaque, @ptrCast(@volatileCast(@constCast(@as(sk_SRTP_PROTECTION_PROFILE_copy_func, @ptrCast(@alignCast(copy_func))).?(@as([*c]const SRTP_PROTECTION_PROFILE, @ptrCast(@alignCast(ptr))))))));
}
pub fn sk_SRTP_PROTECTION_PROFILE_call_cmp_func(arg_cmp_func: OPENSSL_sk_cmp_func, arg_a: [*c]const ?*const anyopaque, arg_b: [*c]const ?*const anyopaque) callconv(.C) c_int {
    const cmp_func = arg_cmp_func;
    const a = arg_a;
    const b = arg_b;
    var a_ptr: [*c]const SRTP_PROTECTION_PROFILE = @as([*c]const SRTP_PROTECTION_PROFILE, @ptrCast(@alignCast(a.*)));
    var b_ptr: [*c]const SRTP_PROTECTION_PROFILE = @as([*c]const SRTP_PROTECTION_PROFILE, @ptrCast(@alignCast(b.*)));
    return @as(sk_SRTP_PROTECTION_PROFILE_cmp_func, @ptrCast(@alignCast(cmp_func))).?(&a_ptr, &b_ptr);
}
pub fn sk_SRTP_PROTECTION_PROFILE_new(arg_comp: sk_SRTP_PROTECTION_PROFILE_cmp_func) callconv(.C) ?*struct_stack_st_SRTP_PROTECTION_PROFILE {
    const comp = arg_comp;
    return @as(?*struct_stack_st_SRTP_PROTECTION_PROFILE, @ptrCast(sk_new(@as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp))))));
}
pub fn sk_SRTP_PROTECTION_PROFILE_new_null() callconv(.C) ?*struct_stack_st_SRTP_PROTECTION_PROFILE {
    return @as(?*struct_stack_st_SRTP_PROTECTION_PROFILE, @ptrCast(sk_new_null()));
}
pub fn sk_SRTP_PROTECTION_PROFILE_num(arg_sk: ?*const struct_stack_st_SRTP_PROTECTION_PROFILE) callconv(.C) usize {
    const sk = arg_sk;
    return sk_num(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_SRTP_PROTECTION_PROFILE_zero(arg_sk: ?*struct_stack_st_SRTP_PROTECTION_PROFILE) callconv(.C) void {
    const sk = arg_sk;
    sk_zero(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_SRTP_PROTECTION_PROFILE_value(arg_sk: ?*const struct_stack_st_SRTP_PROTECTION_PROFILE, arg_i: usize) callconv(.C) [*c]const SRTP_PROTECTION_PROFILE {
    const sk = arg_sk;
    const i = arg_i;
    return @as([*c]const SRTP_PROTECTION_PROFILE, @ptrCast(@alignCast(sk_value(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), i))));
}
pub fn sk_SRTP_PROTECTION_PROFILE_set(arg_sk: ?*struct_stack_st_SRTP_PROTECTION_PROFILE, arg_i: usize, arg_p: [*c]const SRTP_PROTECTION_PROFILE) callconv(.C) [*c]const SRTP_PROTECTION_PROFILE {
    const sk = arg_sk;
    const i = arg_i;
    const p = arg_p;
    return @as([*c]const SRTP_PROTECTION_PROFILE, @ptrCast(@alignCast(sk_set(@as([*c]_STACK, @ptrCast(@alignCast(sk))), i, @as(?*anyopaque, @ptrCast(@volatileCast(@constCast(p))))))));
}
pub fn sk_SRTP_PROTECTION_PROFILE_free(arg_sk: ?*struct_stack_st_SRTP_PROTECTION_PROFILE) callconv(.C) void {
    const sk = arg_sk;
    sk_free(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_SRTP_PROTECTION_PROFILE_pop_free(arg_sk: ?*struct_stack_st_SRTP_PROTECTION_PROFILE, arg_free_func: sk_SRTP_PROTECTION_PROFILE_free_func) callconv(.C) void {
    const sk = arg_sk;
    const free_func = arg_free_func;
    sk_pop_free_ex(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_SRTP_PROTECTION_PROFILE_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))));
}
pub fn sk_SRTP_PROTECTION_PROFILE_insert(arg_sk: ?*struct_stack_st_SRTP_PROTECTION_PROFILE, arg_p: [*c]const SRTP_PROTECTION_PROFILE, arg_where: usize) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    const where = arg_where;
    return sk_insert(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(@volatileCast(@constCast(p)))), where);
}
pub fn sk_SRTP_PROTECTION_PROFILE_delete(arg_sk: ?*struct_stack_st_SRTP_PROTECTION_PROFILE, arg_where: usize) callconv(.C) [*c]const SRTP_PROTECTION_PROFILE {
    const sk = arg_sk;
    const where = arg_where;
    return @as([*c]const SRTP_PROTECTION_PROFILE, @ptrCast(@alignCast(sk_delete(@as([*c]_STACK, @ptrCast(@alignCast(sk))), where))));
}
pub fn sk_SRTP_PROTECTION_PROFILE_delete_ptr(arg_sk: ?*struct_stack_st_SRTP_PROTECTION_PROFILE, arg_p: [*c]const SRTP_PROTECTION_PROFILE) callconv(.C) [*c]const SRTP_PROTECTION_PROFILE {
    const sk = arg_sk;
    const p = arg_p;
    return @as([*c]const SRTP_PROTECTION_PROFILE, @ptrCast(@alignCast(sk_delete_ptr(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*const anyopaque, @ptrCast(p))))));
}
pub fn sk_SRTP_PROTECTION_PROFILE_find(arg_sk: ?*const struct_stack_st_SRTP_PROTECTION_PROFILE, arg_out_index: [*c]usize, arg_p: [*c]const SRTP_PROTECTION_PROFILE) callconv(.C) c_int {
    const sk = arg_sk;
    const out_index = arg_out_index;
    const p = arg_p;
    return sk_find(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), out_index, @as(?*const anyopaque, @ptrCast(p)), &sk_SRTP_PROTECTION_PROFILE_call_cmp_func);
}
pub fn sk_SRTP_PROTECTION_PROFILE_shift(arg_sk: ?*struct_stack_st_SRTP_PROTECTION_PROFILE) callconv(.C) [*c]const SRTP_PROTECTION_PROFILE {
    const sk = arg_sk;
    return @as([*c]const SRTP_PROTECTION_PROFILE, @ptrCast(@alignCast(sk_shift(@as([*c]_STACK, @ptrCast(@alignCast(sk)))))));
}
pub fn sk_SRTP_PROTECTION_PROFILE_push(arg_sk: ?*struct_stack_st_SRTP_PROTECTION_PROFILE, arg_p: [*c]const SRTP_PROTECTION_PROFILE) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    return sk_push(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(@volatileCast(@constCast(p)))));
}
pub fn sk_SRTP_PROTECTION_PROFILE_pop(arg_sk: ?*struct_stack_st_SRTP_PROTECTION_PROFILE) callconv(.C) [*c]const SRTP_PROTECTION_PROFILE {
    const sk = arg_sk;
    return @as([*c]const SRTP_PROTECTION_PROFILE, @ptrCast(@alignCast(sk_pop(@as([*c]_STACK, @ptrCast(@alignCast(sk)))))));
}
pub fn sk_SRTP_PROTECTION_PROFILE_dup(arg_sk: ?*const struct_stack_st_SRTP_PROTECTION_PROFILE) callconv(.C) ?*struct_stack_st_SRTP_PROTECTION_PROFILE {
    const sk = arg_sk;
    return @as(?*struct_stack_st_SRTP_PROTECTION_PROFILE, @ptrCast(sk_dup(@as([*c]const _STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_SRTP_PROTECTION_PROFILE_sort(arg_sk: ?*struct_stack_st_SRTP_PROTECTION_PROFILE) callconv(.C) void {
    const sk = arg_sk;
    sk_sort(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_SRTP_PROTECTION_PROFILE_call_cmp_func);
}
pub fn sk_SRTP_PROTECTION_PROFILE_is_sorted(arg_sk: ?*const struct_stack_st_SRTP_PROTECTION_PROFILE) callconv(.C) c_int {
    const sk = arg_sk;
    return sk_is_sorted(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_SRTP_PROTECTION_PROFILE_set_cmp_func(arg_sk: ?*struct_stack_st_SRTP_PROTECTION_PROFILE, arg_comp: sk_SRTP_PROTECTION_PROFILE_cmp_func) callconv(.C) sk_SRTP_PROTECTION_PROFILE_cmp_func {
    const sk = arg_sk;
    const comp = arg_comp;
    return @as(sk_SRTP_PROTECTION_PROFILE_cmp_func, @ptrCast(@alignCast(sk_set_cmp_func(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp)))))));
}
pub fn sk_SRTP_PROTECTION_PROFILE_deep_copy(arg_sk: ?*const struct_stack_st_SRTP_PROTECTION_PROFILE, arg_copy_func: sk_SRTP_PROTECTION_PROFILE_copy_func, arg_free_func: sk_SRTP_PROTECTION_PROFILE_free_func) callconv(.C) ?*struct_stack_st_SRTP_PROTECTION_PROFILE {
    const sk = arg_sk;
    const copy_func = arg_copy_func;
    const free_func = arg_free_func;
    return @as(?*struct_stack_st_SRTP_PROTECTION_PROFILE, @ptrCast(sk_deep_copy(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), &sk_SRTP_PROTECTION_PROFILE_call_copy_func, @as(OPENSSL_sk_copy_func, @ptrCast(@alignCast(copy_func))), &sk_SRTP_PROTECTION_PROFILE_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))))));
}
// pub extern fn SSL_CTX_set_srtp_profiles(ctx: ?*SSL_CTX, profiles: [*c]const u8) c_int;
// pub extern fn SSL_set_srtp_profiles(ssl: ?*SSL, profiles: [*c]const u8) c_int;
// pub extern fn SSL_get_srtp_profiles(ssl: ?*const SSL) ?*const struct_stack_st_SRTP_PROTECTION_PROFILE;
// pub extern fn SSL_get_selected_srtp_profile(ssl: ?*SSL) [*c]const SRTP_PROTECTION_PROFILE;
pub extern fn SSL_CTX_set_psk_client_callback(ctx: ?*SSL_CTX, cb: ?*const fn (?*SSL, [*c]const u8, [*c]u8, c_uint, [*c]u8, c_uint) callconv(.C) c_uint) void;
pub extern fn SSL_set_psk_client_callback(ssl: ?*SSL, cb: ?*const fn (?*SSL, [*c]const u8, [*c]u8, c_uint, [*c]u8, c_uint) callconv(.C) c_uint) void;
pub extern fn SSL_CTX_set_psk_server_callback(ctx: ?*SSL_CTX, cb: ?*const fn (?*SSL, [*c]const u8, [*c]u8, c_uint) callconv(.C) c_uint) void;
pub extern fn SSL_set_psk_server_callback(ssl: ?*SSL, cb: ?*const fn (?*SSL, [*c]const u8, [*c]u8, c_uint) callconv(.C) c_uint) void;
pub extern fn SSL_CTX_use_psk_identity_hint(ctx: ?*SSL_CTX, identity_hint: [*c]const u8) c_int;
pub extern fn SSL_use_psk_identity_hint(ssl: ?*SSL, identity_hint: [*c]const u8) c_int;
pub extern fn SSL_get_psk_identity_hint(ssl: ?*const SSL) [*c]const u8;
pub extern fn SSL_get_psk_identity(ssl: ?*const SSL) [*c]const u8;
pub extern fn SSL_set1_delegated_credential(ssl: ?*SSL, dc: ?*CRYPTO_BUFFER, pkey: [*c]EVP_PKEY, key_method: [*c]const SSL_PRIVATE_KEY_METHOD) c_int;
pub extern fn SSL_delegated_credential_used(ssl: ?*const SSL) c_int;
pub extern fn SSL_quic_max_handshake_flight_len(ssl: ?*const SSL, level: enum_ssl_encryption_level_t) usize;
pub extern fn SSL_quic_read_level(ssl: ?*const SSL) enum_ssl_encryption_level_t;
pub extern fn SSL_quic_write_level(ssl: ?*const SSL) enum_ssl_encryption_level_t;
pub extern fn SSL_provide_quic_data(ssl: ?*SSL, level: enum_ssl_encryption_level_t, data: [*c]const u8, len: usize) c_int;
pub extern fn SSL_process_quic_post_handshake(ssl: ?*SSL) c_int;
pub extern fn SSL_CTX_set_quic_method(ctx: ?*SSL_CTX, quic_method: [*c]const SSL_QUIC_METHOD) c_int;
pub extern fn SSL_set_quic_method(ssl: ?*SSL, quic_method: [*c]const SSL_QUIC_METHOD) c_int;
pub extern fn SSL_set_quic_transport_params(ssl: ?*SSL, params: [*c]const u8, params_len: usize) c_int;
pub extern fn SSL_get_peer_quic_transport_params(ssl: ?*const SSL, out_params: [*c][*c]const u8, out_params_len: [*c]usize) void;
pub extern fn SSL_set_quic_use_legacy_codepoint(ssl: ?*SSL, use_legacy: c_int) void;
pub extern fn SSL_set_quic_early_data_context(ssl: ?*SSL, context: [*c]const u8, context_len: usize) c_int;
pub extern fn SSL_CTX_set_early_data_enabled(ctx: ?*SSL_CTX, enabled: c_int) void;
pub extern fn SSL_set_early_data_enabled(ssl: ?*SSL, enabled: c_int) void;
pub extern fn SSL_in_early_data(ssl: ?*const SSL) c_int;
pub extern fn SSL_SESSION_early_data_capable(session: ?*const SSL_SESSION) c_int;
pub extern fn SSL_SESSION_copy_without_early_data(session: ?*SSL_SESSION) ?*SSL_SESSION;
pub extern fn SSL_early_data_accepted(ssl: ?*const SSL) c_int;
pub extern fn SSL_reset_early_data_reject(ssl: ?*SSL) void;
pub extern fn SSL_get_ticket_age_skew(ssl: ?*const SSL) i32;
pub const ssl_early_data_unknown: c_int = 0;
pub const ssl_early_data_disabled: c_int = 1;
pub const ssl_early_data_accepted: c_int = 2;
pub const ssl_early_data_protocol_version: c_int = 3;
pub const ssl_early_data_peer_declined: c_int = 4;
pub const ssl_early_data_no_session_offered: c_int = 5;
pub const ssl_early_data_session_not_resumed: c_int = 6;
pub const ssl_early_data_unsupported_for_session: c_int = 7;
pub const ssl_early_data_hello_retry_request: c_int = 8;
pub const ssl_early_data_alpn_mismatch: c_int = 9;
pub const ssl_early_data_channel_id: c_int = 10;
pub const ssl_early_data_ticket_age_skew: c_int = 12;
pub const ssl_early_data_quic_parameter_mismatch: c_int = 13;
pub const ssl_early_data_alps_mismatch: c_int = 14;
pub const ssl_early_data_reason_max_value: c_int = 14;
pub const enum_ssl_early_data_reason_t = c_uint;
pub extern fn SSL_get_early_data_reason(ssl: ?*const SSL) enum_ssl_early_data_reason_t;
pub extern fn SSL_early_data_reason_string(reason: enum_ssl_early_data_reason_t) [*c]const u8;
pub extern fn SSL_set_enable_ech_grease(ssl: ?*SSL, enable: c_int) void;
pub extern fn SSL_set1_ech_config_list(ssl: ?*SSL, ech_config_list: [*c]const u8, ech_config_list_len: usize) c_int;
pub extern fn SSL_get0_ech_name_override(ssl: ?*const SSL, out_name: [*c][*c]const u8, out_name_len: [*c]usize) void;
pub extern fn SSL_get0_ech_retry_configs(ssl: ?*const SSL, out_retry_configs: [*c][*c]const u8, out_retry_configs_len: [*c]usize) void;
pub extern fn SSL_marshal_ech_config(out: [*c][*c]u8, out_len: [*c]usize, config_id: u8, key: ?*const EVP_HPKE_KEY, public_name: [*c]const u8, max_name_len: usize) c_int;
pub extern fn SSL_ECH_KEYS_new() ?*SSL_ECH_KEYS;
pub extern fn SSL_ECH_KEYS_up_ref(keys: ?*SSL_ECH_KEYS) void;
pub extern fn SSL_ECH_KEYS_free(keys: ?*SSL_ECH_KEYS) void;
pub extern fn SSL_ECH_KEYS_add(keys: ?*SSL_ECH_KEYS, is_retry_config: c_int, ech_config: [*c]const u8, ech_config_len: usize, key: ?*const EVP_HPKE_KEY) c_int;
pub extern fn SSL_ECH_KEYS_has_duplicate_config_id(keys: ?*const SSL_ECH_KEYS) c_int;
pub extern fn SSL_ECH_KEYS_marshal_retry_configs(keys: ?*const SSL_ECH_KEYS, out: [*c][*c]u8, out_len: [*c]usize) c_int;
pub extern fn SSL_CTX_set1_ech_keys(ctx: ?*SSL_CTX, keys: ?*SSL_ECH_KEYS) c_int;
pub extern fn SSL_ech_accepted(ssl: ?*const SSL) c_int;
pub extern fn SSL_alert_type_string_long(value: c_int) [*c]const u8;
pub extern fn SSL_alert_desc_string_long(value: c_int) [*c]const u8;
pub extern fn SSL_send_fatal_alert(ssl: ?*SSL, alert: u8) c_int;
pub extern fn SSL_set_ex_data(ssl: ?*SSL, idx: c_int, data: ?*anyopaque) c_int;
pub extern fn SSL_get_ex_data(ssl: ?*const SSL, idx: c_int) ?*anyopaque;
pub extern fn SSL_get_ex_new_index(argl: c_long, argp: ?*anyopaque, unused: [*c]CRYPTO_EX_unused, dup_unused: ?*const CRYPTO_EX_dup, free_func: ?*const CRYPTO_EX_free) c_int;
pub extern fn SSL_SESSION_set_ex_data(session: ?*SSL_SESSION, idx: c_int, data: ?*anyopaque) c_int;
pub extern fn SSL_SESSION_get_ex_data(session: ?*const SSL_SESSION, idx: c_int) ?*anyopaque;
pub extern fn SSL_SESSION_get_ex_new_index(argl: c_long, argp: ?*anyopaque, unused: [*c]CRYPTO_EX_unused, dup_unused: ?*const CRYPTO_EX_dup, free_func: ?*const CRYPTO_EX_free) c_int;
pub extern fn SSL_CTX_set_ex_data(ctx: ?*SSL_CTX, idx: c_int, data: ?*anyopaque) c_int;
pub extern fn SSL_CTX_get_ex_data(ctx: ?*const SSL_CTX, idx: c_int) ?*anyopaque;
pub extern fn SSL_CTX_get_ex_new_index(argl: c_long, argp: ?*anyopaque, unused: [*c]CRYPTO_EX_unused, dup_unused: ?*const CRYPTO_EX_dup, free_func: ?*const CRYPTO_EX_free) c_int;
pub extern fn SSL_get_ivs(ssl: ?*const SSL, out_read_iv: [*c][*c]const u8, out_write_iv: [*c][*c]const u8, out_iv_len: [*c]usize) c_int;
pub extern fn SSL_get_key_block_len(ssl: ?*const SSL) usize;
pub extern fn SSL_generate_key_block(ssl: ?*const SSL, out: [*c]u8, out_len: usize) c_int;
pub extern fn SSL_get_read_sequence(ssl: ?*const SSL) u64;
pub extern fn SSL_get_write_sequence(ssl: ?*const SSL) u64;
pub extern fn SSL_CTX_set_record_protocol_version(ctx: ?*SSL_CTX, version: c_int) c_int;
pub extern fn SSL_serialize_capabilities(ssl: ?*const SSL, out: ?*CBB) c_int;
pub extern fn SSL_request_handshake_hints(ssl: ?*SSL, client_hello: [*c]const u8, client_hello_len: usize, capabilities: [*c]const u8, capabilities_len: usize) c_int;
pub extern fn SSL_serialize_handshake_hints(ssl: ?*const SSL, out: ?*CBB) c_int;
pub extern fn SSL_set_handshake_hints(ssl: ?*SSL, hints: [*c]const u8, hints_len: usize) c_int;
pub extern fn SSL_CTX_set_msg_callback(ctx: ?*SSL_CTX, cb: ?*const fn (c_int, c_int, c_int, ?*const anyopaque, usize, ?*SSL, ?*anyopaque) callconv(.C) void) void;
pub extern fn SSL_CTX_set_msg_callback_arg(ctx: ?*SSL_CTX, arg: ?*anyopaque) void;
pub extern fn SSL_set_msg_callback(ssl: ?*SSL, cb: ?*const fn (c_int, c_int, c_int, ?*const anyopaque, usize, ?*SSL, ?*anyopaque) callconv(.C) void) void;
pub extern fn SSL_set_msg_callback_arg(ssl: ?*SSL, arg: ?*anyopaque) void;
pub extern fn SSL_CTX_set_keylog_callback(ctx: ?*SSL_CTX, cb: ?*const fn (?*const SSL, [*c]const u8) callconv(.C) void) void;
pub extern fn SSL_CTX_get_keylog_callback(ctx: ?*const SSL_CTX) ?*const fn (?*const SSL, [*c]const u8) callconv(.C) void;
pub extern fn SSL_CTX_set_current_time_cb(ctx: ?*SSL_CTX, cb: ?*const fn (?*const SSL, [*c]struct_timeval) callconv(.C) void) void;
pub extern fn SSL_set_shed_handshake_config(ssl: ?*SSL, enable: c_int) void;
pub const ssl_renegotiate_never: c_int = 0;
pub const ssl_renegotiate_once: c_int = 1;
pub const ssl_renegotiate_freely: c_int = 2;
pub const ssl_renegotiate_ignore: c_int = 3;
pub const ssl_renegotiate_explicit: c_int = 4;
pub const enum_ssl_renegotiate_mode_t = c_uint;
pub extern fn SSL_set_renegotiate_mode(ssl: ?*SSL, mode: enum_ssl_renegotiate_mode_t) void;
pub extern fn SSL_renegotiate(ssl: ?*SSL) c_int;
pub extern fn SSL_renegotiate_pending(ssl: ?*SSL) c_int;
pub extern fn SSL_total_renegotiations(ssl: ?*const SSL) c_int;
pub extern fn SSL_CTX_get_max_cert_list(ctx: ?*const SSL_CTX) usize;
pub extern fn SSL_CTX_set_max_cert_list(ctx: ?*SSL_CTX, max_cert_list: usize) void;
pub extern fn SSL_get_max_cert_list(ssl: ?*const SSL) usize;
pub extern fn SSL_set_max_cert_list(ssl: ?*SSL, max_cert_list: usize) void;
pub extern fn SSL_CTX_set_max_send_fragment(ctx: ?*SSL_CTX, max_send_fragment: usize) c_int;
pub extern fn SSL_set_max_send_fragment(ssl: ?*SSL, max_send_fragment: usize) c_int;
pub const ssl_select_cert_success: c_int = 1;
pub const ssl_select_cert_retry: c_int = 0;
pub const ssl_select_cert_error: c_int = -1;
pub const enum_ssl_select_cert_result_t = c_int;
pub extern fn SSL_early_callback_ctx_extension_get(client_hello: [*c]const SSL_CLIENT_HELLO, extension_type: u16, out_data: [*c][*c]const u8, out_len: [*c]usize) c_int;
pub extern fn SSL_CTX_set_select_certificate_cb(ctx: ?*SSL_CTX, cb: ?*const fn ([*c]const SSL_CLIENT_HELLO) callconv(.C) enum_ssl_select_cert_result_t) void;
pub extern fn SSL_CTX_set_dos_protection_cb(ctx: ?*SSL_CTX, cb: ?*const fn ([*c]const SSL_CLIENT_HELLO) callconv(.C) c_int) void;
pub extern fn SSL_CTX_set_reverify_on_resume(ctx: ?*SSL_CTX, enabled: c_int) void;
pub extern fn SSL_set_enforce_rsa_key_usage(ssl: ?*SSL, enabled: c_int) void;
pub extern fn SSL_was_key_usage_invalid(ssl: ?*const SSL) c_int;
pub extern fn SSL_CTX_set_info_callback(ctx: ?*SSL_CTX, cb: ?*const fn (?*const SSL, c_int, c_int) callconv(.C) void) void;
pub extern fn SSL_CTX_get_info_callback(ctx: ?*SSL_CTX) ?*const fn (?*const SSL, c_int, c_int) callconv(.C) void;
pub extern fn SSL_set_info_callback(ssl: ?*SSL, cb: ?*const fn (?*const SSL, c_int, c_int) callconv(.C) void) void;
pub extern fn SSL_get_info_callback(ssl: ?*const SSL) ?*const fn (?*const SSL, c_int, c_int) callconv(.C) void;
pub extern fn SSL_state_string_long(ssl: ?*const SSL) [*c]const u8;
pub extern fn SSL_get_shutdown(ssl: ?*const SSL) c_int;
pub extern fn SSL_get_peer_signature_algorithm(ssl: ?*const SSL) u16;
pub extern fn SSL_get_client_random(ssl: ?*const SSL, out: [*c]u8, max_out: usize) usize;
pub extern fn SSL_get_server_random(ssl: ?*const SSL, out: [*c]u8, max_out: usize) usize;
pub extern fn SSL_get_pending_cipher(ssl: ?*const SSL) ?*const SSL_CIPHER;
pub extern fn SSL_set_retain_only_sha256_of_client_certs(ssl: ?*SSL, enable: c_int) void;
pub extern fn SSL_CTX_set_retain_only_sha256_of_client_certs(ctx: ?*SSL_CTX, enable: c_int) void;
pub extern fn SSL_CTX_set_grease_enabled(ctx: ?*SSL_CTX, enabled: c_int) void;
pub extern fn SSL_CTX_set_permute_extensions(ctx: ?*SSL_CTX, enabled: c_int) void;
pub extern fn SSL_set_permute_extensions(ssl: ?*SSL, enabled: c_int) void;
pub extern fn SSL_max_seal_overhead(ssl: ?*const SSL) usize;
pub extern fn SSL_CTX_set_false_start_allowed_without_alpn(ctx: ?*SSL_CTX, allowed: c_int) void;
pub extern fn SSL_used_hello_retry_request(ssl: ?*const SSL) c_int;
pub extern fn SSL_set_jdk11_workaround(ssl: ?*SSL, enable: c_int) void;
pub extern fn SSL_library_init() c_int;
pub extern fn SSL_CIPHER_description(cipher: ?*const SSL_CIPHER, buf: [*c]u8, len: c_int) [*c]const u8;
pub extern fn SSL_CIPHER_get_version(cipher: ?*const SSL_CIPHER) [*c]const u8;
pub extern fn SSL_CIPHER_get_rfc_name(cipher: ?*const SSL_CIPHER) [*c]u8;
pub const COMP_METHOD = anyopaque;
pub const struct_ssl_comp_st = extern struct {
    id: c_int,
    name: [*c]const u8,
    method: [*c]u8,
};
pub const SSL_COMP = struct_ssl_comp_st;
pub const struct_stack_st_SSL_COMP = opaque {};
pub extern fn SSL_COMP_get_compression_methods() ?*struct_stack_st_SSL_COMP;
pub extern fn SSL_COMP_add_compression_method(id: c_int, cm: ?*COMP_METHOD) c_int;
pub extern fn SSL_COMP_get_name(comp: ?*const COMP_METHOD) [*c]const u8;
pub extern fn SSL_COMP_get0_name(comp: [*c]const SSL_COMP) [*c]const u8;
pub extern fn SSL_COMP_get_id(comp: [*c]const SSL_COMP) c_int;
pub extern fn SSL_COMP_free_compression_methods() void;
pub extern fn SSLv23_method() ?*const SSL_METHOD;
pub extern fn TLSv1_method() ?*const SSL_METHOD;
pub extern fn TLSv1_1_method() ?*const SSL_METHOD;
pub extern fn TLSv1_2_method() ?*const SSL_METHOD;
pub extern fn DTLSv1_method() ?*const SSL_METHOD;
pub extern fn DTLSv1_2_method() ?*const SSL_METHOD;
pub extern fn TLS_server_method() ?*const SSL_METHOD;
pub extern fn TLS_client_method() ?*const SSL_METHOD;
pub extern fn SSLv23_server_method() ?*const SSL_METHOD;
pub extern fn SSLv23_client_method() ?*const SSL_METHOD;
pub extern fn TLSv1_server_method() ?*const SSL_METHOD;
pub extern fn TLSv1_client_method() ?*const SSL_METHOD;
pub extern fn TLSv1_1_server_method() ?*const SSL_METHOD;
pub extern fn TLSv1_1_client_method() ?*const SSL_METHOD;
pub extern fn TLSv1_2_server_method() ?*const SSL_METHOD;
pub extern fn TLSv1_2_client_method() ?*const SSL_METHOD;
pub extern fn DTLS_server_method() ?*const SSL_METHOD;
pub extern fn DTLS_client_method() ?*const SSL_METHOD;
pub extern fn DTLSv1_server_method() ?*const SSL_METHOD;
pub extern fn DTLSv1_client_method() ?*const SSL_METHOD;
pub extern fn DTLSv1_2_server_method() ?*const SSL_METHOD;
pub extern fn DTLSv1_2_client_method() ?*const SSL_METHOD;
pub extern fn SSL_clear(ssl: ?*SSL) c_int;
pub extern fn SSL_CTX_set_tmp_rsa_callback(ctx: ?*SSL_CTX, cb: ?*const fn (?*SSL, c_int, c_int) callconv(.C) ?*RSA) void;
pub extern fn SSL_set_tmp_rsa_callback(ssl: ?*SSL, cb: ?*const fn (?*SSL, c_int, c_int) callconv(.C) ?*RSA) void;
pub extern fn SSL_CTX_sess_connect(ctx: ?*const SSL_CTX) c_int;
pub extern fn SSL_CTX_sess_connect_good(ctx: ?*const SSL_CTX) c_int;
pub extern fn SSL_CTX_sess_connect_renegotiate(ctx: ?*const SSL_CTX) c_int;
pub extern fn SSL_CTX_sess_accept(ctx: ?*const SSL_CTX) c_int;
pub extern fn SSL_CTX_sess_accept_renegotiate(ctx: ?*const SSL_CTX) c_int;
pub extern fn SSL_CTX_sess_accept_good(ctx: ?*const SSL_CTX) c_int;
pub extern fn SSL_CTX_sess_hits(ctx: ?*const SSL_CTX) c_int;
pub extern fn SSL_CTX_sess_cb_hits(ctx: ?*const SSL_CTX) c_int;
pub extern fn SSL_CTX_sess_misses(ctx: ?*const SSL_CTX) c_int;
pub extern fn SSL_CTX_sess_timeouts(ctx: ?*const SSL_CTX) c_int;
pub extern fn SSL_CTX_sess_cache_full(ctx: ?*const SSL_CTX) c_int;
pub extern fn SSL_cutthrough_complete(ssl: ?*const SSL) c_int;
pub extern fn SSL_num_renegotiations(ssl: ?*const SSL) c_int;
pub extern fn SSL_CTX_need_tmp_RSA(ctx: ?*const SSL_CTX) c_int;
pub extern fn SSL_need_tmp_RSA(ssl: ?*const SSL) c_int;
pub extern fn SSL_CTX_set_tmp_rsa(ctx: ?*SSL_CTX, rsa: ?*const RSA) c_int;
pub extern fn SSL_set_tmp_rsa(ssl: ?*SSL, rsa: ?*const RSA) c_int;
pub extern fn SSL_CTX_get_read_ahead(ctx: ?*const SSL_CTX) c_int;
pub extern fn SSL_CTX_set_read_ahead(ctx: ?*SSL_CTX, yes: c_int) c_int;
pub extern fn SSL_get_read_ahead(ssl: ?*const SSL) c_int;
pub extern fn SSL_set_read_ahead(ssl: ?*SSL, yes: c_int) c_int;
pub extern fn SSL_set_state(ssl: ?*SSL, state: c_int) void;
pub extern fn SSL_get_shared_ciphers(ssl: ?*const SSL, buf: [*c]u8, len: c_int) [*c]u8;
pub extern fn SSL_get_shared_sigalgs(ssl: ?*SSL, idx: c_int, psign: [*c]c_int, phash: [*c]c_int, psignandhash: [*c]c_int, rsig: [*c]u8, rhash: [*c]u8) c_int;
pub extern fn i2d_SSL_SESSION(in: ?*SSL_SESSION, pp: [*c][*c]u8) c_int;
pub extern fn d2i_SSL_SESSION(a: [*c]?*SSL_SESSION, pp: [*c][*c]const u8, length: c_long) ?*SSL_SESSION;
pub extern fn i2d_SSL_SESSION_bio(bio: [*c]BIO, session: ?*const SSL_SESSION) c_int;
pub extern fn d2i_SSL_SESSION_bio(bio: [*c]BIO, out: [*c]?*SSL_SESSION) ?*SSL_SESSION;
pub extern fn ERR_load_SSL_strings() void;
pub extern fn SSL_load_error_strings() void;
// pub extern fn SSL_CTX_set_tlsext_use_srtp(ctx: ?*SSL_CTX, profiles: [*c]const u8) c_int;
// pub extern fn SSL_set_tlsext_use_srtp(ssl: ?*SSL, profiles: [*c]const u8) c_int;
pub extern fn SSL_get_current_compression(ssl: ?*SSL) ?*const COMP_METHOD;
pub extern fn SSL_get_current_expansion(ssl: ?*SSL) ?*const COMP_METHOD;
pub extern fn SSL_get_server_tmp_key(ssl: ?*SSL, out_key: [*c][*c]EVP_PKEY) c_int;
pub extern fn SSL_CTX_set_tmp_dh(ctx: ?*SSL_CTX, dh: ?*const DH) c_int;
pub extern fn SSL_set_tmp_dh(ssl: ?*SSL, dh: ?*const DH) c_int;
pub extern fn SSL_CTX_set_tmp_dh_callback(ctx: ?*SSL_CTX, cb: ?*const fn (?*SSL, c_int, c_int) callconv(.C) ?*DH) void;
pub extern fn SSL_set_tmp_dh_callback(ssl: ?*SSL, cb: ?*const fn (?*SSL, c_int, c_int) callconv(.C) ?*DH) void;
pub extern fn SSL_CTX_set1_sigalgs(ctx: ?*SSL_CTX, values: [*c]const c_int, num_values: usize) c_int;
pub extern fn SSL_set1_sigalgs(ssl: ?*SSL, values: [*c]const c_int, num_values: usize) c_int;
pub extern fn SSL_CTX_set1_sigalgs_list(ctx: ?*SSL_CTX, str: [*c]const u8) c_int;
pub extern fn SSL_set1_sigalgs_list(ssl: ?*SSL, str: [*c]const u8) c_int;
pub const sk_SSL_COMP_free_func = ?*const fn ([*c]SSL_COMP) callconv(.C) void;
pub const sk_SSL_COMP_copy_func = ?*const fn ([*c]SSL_COMP) callconv(.C) [*c]SSL_COMP;
pub const sk_SSL_COMP_cmp_func = ?*const fn ([*c][*c]const SSL_COMP, [*c][*c]const SSL_COMP) callconv(.C) c_int;
pub fn sk_SSL_COMP_call_free_func(arg_free_func: OPENSSL_sk_free_func, arg_ptr: ?*anyopaque) callconv(.C) void {
    const free_func = arg_free_func;
    const ptr = arg_ptr;
    @as(sk_SSL_COMP_free_func, @ptrCast(@alignCast(free_func))).?(@as([*c]SSL_COMP, @ptrCast(@alignCast(ptr))));
}
pub fn sk_SSL_COMP_call_copy_func(arg_copy_func: OPENSSL_sk_copy_func, arg_ptr: ?*anyopaque) callconv(.C) ?*anyopaque {
    const copy_func = arg_copy_func;
    const ptr = arg_ptr;
    return @as(?*anyopaque, @ptrCast(@as(sk_SSL_COMP_copy_func, @ptrCast(@alignCast(copy_func))).?(@as([*c]SSL_COMP, @ptrCast(@alignCast(ptr))))));
}
pub fn sk_SSL_COMP_call_cmp_func(arg_cmp_func: OPENSSL_sk_cmp_func, arg_a: [*c]const ?*const anyopaque, arg_b: [*c]const ?*const anyopaque) callconv(.C) c_int {
    const cmp_func = arg_cmp_func;
    const a = arg_a;
    const b = arg_b;
    var a_ptr: [*c]const SSL_COMP = @as([*c]const SSL_COMP, @ptrCast(@alignCast(a.*)));
    var b_ptr: [*c]const SSL_COMP = @as([*c]const SSL_COMP, @ptrCast(@alignCast(b.*)));
    return @as(sk_SSL_COMP_cmp_func, @ptrCast(@alignCast(cmp_func))).?(&a_ptr, &b_ptr);
}
pub fn sk_SSL_COMP_new(arg_comp: sk_SSL_COMP_cmp_func) callconv(.C) ?*struct_stack_st_SSL_COMP {
    const comp = arg_comp;
    return @as(?*struct_stack_st_SSL_COMP, @ptrCast(sk_new(@as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp))))));
}
pub fn sk_SSL_COMP_new_null() callconv(.C) ?*struct_stack_st_SSL_COMP {
    return @as(?*struct_stack_st_SSL_COMP, @ptrCast(sk_new_null()));
}
pub fn sk_SSL_COMP_num(arg_sk: ?*const struct_stack_st_SSL_COMP) callconv(.C) usize {
    const sk = arg_sk;
    return sk_num(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_SSL_COMP_zero(arg_sk: ?*struct_stack_st_SSL_COMP) callconv(.C) void {
    const sk = arg_sk;
    sk_zero(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_SSL_COMP_value(arg_sk: ?*const struct_stack_st_SSL_COMP, arg_i: usize) callconv(.C) [*c]SSL_COMP {
    const sk = arg_sk;
    const i = arg_i;
    return @as([*c]SSL_COMP, @ptrCast(@alignCast(sk_value(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), i))));
}
pub fn sk_SSL_COMP_set(arg_sk: ?*struct_stack_st_SSL_COMP, arg_i: usize, arg_p: [*c]SSL_COMP) callconv(.C) [*c]SSL_COMP {
    const sk = arg_sk;
    const i = arg_i;
    const p = arg_p;
    return @as([*c]SSL_COMP, @ptrCast(@alignCast(sk_set(@as([*c]_STACK, @ptrCast(@alignCast(sk))), i, @as(?*anyopaque, @ptrCast(p))))));
}
pub fn sk_SSL_COMP_free(arg_sk: ?*struct_stack_st_SSL_COMP) callconv(.C) void {
    const sk = arg_sk;
    sk_free(@as([*c]_STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_SSL_COMP_pop_free(arg_sk: ?*struct_stack_st_SSL_COMP, arg_free_func: sk_SSL_COMP_free_func) callconv(.C) void {
    const sk = arg_sk;
    const free_func = arg_free_func;
    sk_pop_free_ex(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_SSL_COMP_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))));
}
pub fn sk_SSL_COMP_insert(arg_sk: ?*struct_stack_st_SSL_COMP, arg_p: [*c]SSL_COMP, arg_where: usize) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    const where = arg_where;
    return sk_insert(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)), where);
}
pub fn sk_SSL_COMP_delete(arg_sk: ?*struct_stack_st_SSL_COMP, arg_where: usize) callconv(.C) [*c]SSL_COMP {
    const sk = arg_sk;
    const where = arg_where;
    return @as([*c]SSL_COMP, @ptrCast(@alignCast(sk_delete(@as([*c]_STACK, @ptrCast(@alignCast(sk))), where))));
}
pub fn sk_SSL_COMP_delete_ptr(arg_sk: ?*struct_stack_st_SSL_COMP, arg_p: [*c]const SSL_COMP) callconv(.C) [*c]SSL_COMP {
    const sk = arg_sk;
    const p = arg_p;
    return @as([*c]SSL_COMP, @ptrCast(@alignCast(sk_delete_ptr(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*const anyopaque, @ptrCast(p))))));
}
pub fn sk_SSL_COMP_find(arg_sk: ?*const struct_stack_st_SSL_COMP, arg_out_index: [*c]usize, arg_p: [*c]const SSL_COMP) callconv(.C) c_int {
    const sk = arg_sk;
    const out_index = arg_out_index;
    const p = arg_p;
    return sk_find(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), out_index, @as(?*const anyopaque, @ptrCast(p)), &sk_SSL_COMP_call_cmp_func);
}
pub fn sk_SSL_COMP_shift(arg_sk: ?*struct_stack_st_SSL_COMP) callconv(.C) [*c]SSL_COMP {
    const sk = arg_sk;
    return @as([*c]SSL_COMP, @ptrCast(@alignCast(sk_shift(@as([*c]_STACK, @ptrCast(@alignCast(sk)))))));
}
pub fn sk_SSL_COMP_push(arg_sk: ?*struct_stack_st_SSL_COMP, arg_p: [*c]SSL_COMP) callconv(.C) usize {
    const sk = arg_sk;
    const p = arg_p;
    return sk_push(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(?*anyopaque, @ptrCast(p)));
}
pub fn sk_SSL_COMP_pop(arg_sk: ?*struct_stack_st_SSL_COMP) callconv(.C) [*c]SSL_COMP {
    const sk = arg_sk;
    return @as([*c]SSL_COMP, @ptrCast(@alignCast(sk_pop(@as([*c]_STACK, @ptrCast(@alignCast(sk)))))));
}
pub fn sk_SSL_COMP_dup(arg_sk: ?*const struct_stack_st_SSL_COMP) callconv(.C) ?*struct_stack_st_SSL_COMP {
    const sk = arg_sk;
    return @as(?*struct_stack_st_SSL_COMP, @ptrCast(sk_dup(@as([*c]const _STACK, @ptrCast(@alignCast(sk))))));
}
pub fn sk_SSL_COMP_sort(arg_sk: ?*struct_stack_st_SSL_COMP) callconv(.C) void {
    const sk = arg_sk;
    sk_sort(@as([*c]_STACK, @ptrCast(@alignCast(sk))), &sk_SSL_COMP_call_cmp_func);
}
pub fn sk_SSL_COMP_is_sorted(arg_sk: ?*const struct_stack_st_SSL_COMP) callconv(.C) c_int {
    const sk = arg_sk;
    return sk_is_sorted(@as([*c]const _STACK, @ptrCast(@alignCast(sk))));
}
pub fn sk_SSL_COMP_set_cmp_func(arg_sk: ?*struct_stack_st_SSL_COMP, arg_comp: sk_SSL_COMP_cmp_func) callconv(.C) sk_SSL_COMP_cmp_func {
    const sk = arg_sk;
    const comp = arg_comp;
    return @as(sk_SSL_COMP_cmp_func, @ptrCast(@alignCast(sk_set_cmp_func(@as([*c]_STACK, @ptrCast(@alignCast(sk))), @as(OPENSSL_sk_cmp_func, @ptrCast(@alignCast(comp)))))));
}
pub fn sk_SSL_COMP_deep_copy(arg_sk: ?*const struct_stack_st_SSL_COMP, arg_copy_func: sk_SSL_COMP_copy_func, arg_free_func: sk_SSL_COMP_free_func) callconv(.C) ?*struct_stack_st_SSL_COMP {
    const sk = arg_sk;
    const copy_func = arg_copy_func;
    const free_func = arg_free_func;
    return @as(?*struct_stack_st_SSL_COMP, @ptrCast(sk_deep_copy(@as([*c]const _STACK, @ptrCast(@alignCast(sk))), &sk_SSL_COMP_call_copy_func, @as(OPENSSL_sk_copy_func, @ptrCast(@alignCast(copy_func))), &sk_SSL_COMP_call_free_func, @as(OPENSSL_sk_free_func, @ptrCast(@alignCast(free_func))))));
}
pub extern fn SSL_cache_hit(ssl: ?*SSL) c_int;
pub extern fn SSL_get_default_timeout(ssl: ?*const SSL) c_long;
pub extern fn SSL_get_version(ssl: ?*const SSL) [*c]const u8;
pub extern fn SSL_get_cipher_list(ssl: ?*const SSL, n: c_int) [*c]const u8;
pub extern fn SSL_CTX_set_client_cert_cb(ctx: ?*SSL_CTX, cb: ?*const fn (?*SSL, [*c]?*X509, [*c][*c]EVP_PKEY) callconv(.C) c_int) void;
pub extern fn SSL_want(ssl: ?*const SSL) c_int;
pub extern fn SSL_get_finished(ssl: ?*const SSL, buf: ?*anyopaque, count: usize) usize;
pub extern fn SSL_get_peer_finished(ssl: ?*const SSL, buf: ?*anyopaque, count: usize) usize;
pub extern fn SSL_alert_type_string(value: c_int) [*c]const u8;
pub extern fn SSL_alert_desc_string(value: c_int) [*c]const u8;
pub extern fn SSL_state_string(ssl: ?*const SSL) [*c]const u8;
pub const struct_ssl_conf_ctx_st = opaque {};
pub const SSL_CONF_CTX = struct_ssl_conf_ctx_st;
pub extern fn SSL_state(ssl: ?*const SSL) c_int;
pub extern fn SSL_set_shutdown(ssl: ?*SSL, mode: c_int) void;
pub extern fn SSL_CTX_set_tmp_ecdh(ctx: ?*SSL_CTX, ec_key: ?*const EC_KEY) c_int;
pub extern fn SSL_set_tmp_ecdh(ssl: ?*SSL, ec_key: ?*const EC_KEY) c_int;
pub extern fn SSL_add_dir_cert_subjects_to_stack(out: ?*struct_stack_st_X509_NAME, dir: [*c]const u8) c_int;
pub extern fn SSL_CTX_enable_tls_channel_id(ctx: ?*SSL_CTX) c_int;
pub extern fn SSL_enable_tls_channel_id(ssl: ?*SSL) c_int;
pub extern fn BIO_f_ssl() [*c]const BIO_METHOD;
pub extern fn BIO_set_ssl(bio: [*c]BIO, ssl: ?*SSL, take_owership: c_int) c_long;
pub extern fn SSL_get_session(ssl: ?*const SSL) ?*SSL_SESSION;
pub extern fn SSL_get1_session(ssl: ?*SSL) ?*SSL_SESSION;
pub extern fn OPENSSL_init_ssl(opts: u64, settings: ?*const OPENSSL_INIT_SETTINGS) c_int;
pub extern fn SSL_set_tlsext_status_type(ssl: ?*SSL, @"type": c_int) c_int;
pub extern fn SSL_get_tlsext_status_type(ssl: ?*const SSL) c_int;
pub extern fn SSL_set_tlsext_status_ocsp_resp(ssl: ?*SSL, resp: [*c]u8, resp_len: usize) c_int;
pub extern fn SSL_get_tlsext_status_ocsp_resp(ssl: ?*const SSL, out: [*c][*c]const u8) usize;
pub extern fn SSL_CTX_set_tlsext_status_cb(ctx: ?*SSL_CTX, callback: ?*const fn (?*SSL, ?*anyopaque) callconv(.C) c_int) c_int;
pub extern fn SSL_CTX_set_tlsext_status_arg(ctx: ?*SSL_CTX, arg: ?*anyopaque) c_int;
pub extern fn SSL_CIPHER_get_value(cipher: ?*const SSL_CIPHER) u16;
pub const ssl_compliance_policy_fips_202205: c_int = 0;
pub const enum_ssl_compliance_policy_t = c_uint;
pub extern fn SSL_CTX_set_compliance_policy(ctx: ?*SSL_CTX, policy: enum_ssl_compliance_policy_t) c_int;
pub extern fn SSL_set_compliance_policy(ssl: ?*SSL, policy: enum_ssl_compliance_policy_t) c_int;
pub const OPENSSL_HEADER_OPENSSLCONF_H = "";
pub const OPENSSL_NO_ASYNC = "";
pub const OPENSSL_NO_BF = "";
pub const OPENSSL_NO_BLAKE2 = "";
pub const OPENSSL_NO_BUF_FREELISTS = "";
pub const OPENSSL_NO_CAMELLIA = "";
pub const OPENSSL_NO_CAPIENG = "";
pub const OPENSSL_NO_CAST = "";
pub const OPENSSL_NO_CMS = "";
pub const OPENSSL_NO_COMP = "";
pub const OPENSSL_NO_CT = "";
pub const OPENSSL_NO_DANE = "";
pub const OPENSSL_NO_DEPRECATED = "";
pub const OPENSSL_NO_DGRAM = "";
pub const OPENSSL_NO_DYNAMIC_ENGINE = "";
pub const OPENSSL_NO_EC_NISTP_64_GCC_128 = "";
pub const OPENSSL_NO_EC2M = "";
pub const OPENSSL_NO_EGD = "";
pub const OPENSSL_NO_ENGINE = "";
pub const OPENSSL_NO_GMP = "";
pub const OPENSSL_NO_GOST = "";
pub const OPENSSL_NO_HEARTBEATS = "";
pub const OPENSSL_NO_HW = "";
pub const OPENSSL_NO_IDEA = "";
pub const OPENSSL_NO_JPAKE = "";
pub const OPENSSL_NO_KRB5 = "";
pub const OPENSSL_NO_MD2 = "";
pub const OPENSSL_NO_MDC2 = "";
pub const OPENSSL_NO_OCB = "";
pub const OPENSSL_NO_OCSP = "";
pub const OPENSSL_NO_RC2 = "";
pub const OPENSSL_NO_RC5 = "";
pub const OPENSSL_NO_RFC3779 = "";
pub const OPENSSL_NO_RIPEMD = "";
pub const OPENSSL_NO_RMD160 = "";
pub const OPENSSL_NO_SCTP = "";
pub const OPENSSL_NO_SEED = "";
pub const OPENSSL_NO_SM2 = "";
pub const OPENSSL_NO_SM3 = "";
pub const OPENSSL_NO_SM4 = "";
pub const OPENSSL_NO_SRP = "";
pub const OPENSSL_NO_SSL_TRACE = "";
pub const OPENSSL_NO_SSL2 = "";
pub const OPENSSL_NO_SSL3 = "";
pub const OPENSSL_NO_SSL3_METHOD = "";
pub const OPENSSL_NO_STATIC_ENGINE = "";
pub const OPENSSL_NO_STORE = "";
pub const OPENSSL_NO_WHIRLPOOL = "";
pub const OPENSSL_64_BIT = "";
pub const OPENSSL_AARCH64 = "";
pub const OPENSSL_APPLE = "";
pub const OPENSSL_MACOS = "";
pub const OPENSSL_THREADS = "";
pub const OPENSSL_IS_BORINGSSL = "";
pub const OPENSSL_VERSION_NUMBER = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x1010107f, .hex);
pub const SSLEAY_VERSION_NUMBER = OPENSSL_VERSION_NUMBER;
pub const BORINGSSL_API_VERSION = @as(c_int, 18);
pub const OPENSSL_EXPORT = "";
pub const BORINGSSL_ENUM_INT = "";
pub const BORINGSSL_NO_CXX = "";
pub const OPENSSL_HEADER_BIO_H = "";
pub const _STDIO_H_ = "";
pub const __STDIO_H_ = "";
pub const __TYPES_H_ = "";
pub const _FORTIFY_SOURCE = @as(c_int, 2);
pub const _VA_LIST_T = "";
pub const _SYS_STDIO_H_ = "";
pub const RENAME_SECLUDE = @as(c_int, 0x00000001);
pub const RENAME_SWAP = @as(c_int, 0x00000002);
pub const RENAME_EXCL = @as(c_int, 0x00000004);
pub const RENAME_RESERVED1 = @as(c_int, 0x00000008);
pub const RENAME_NOFOLLOW_ANY = @as(c_int, 0x00000010);
pub const _FSTDIO = "";
pub const __SLBF = @as(c_int, 0x0001);
pub const __SNBF = @as(c_int, 0x0002);
pub const __SRD = @as(c_int, 0x0004);
pub const __SWR = @as(c_int, 0x0008);
pub const __SRW = @as(c_int, 0x0010);
pub const __SEOF = @as(c_int, 0x0020);
pub const __SERR = @as(c_int, 0x0040);
pub const __SMBF = @as(c_int, 0x0080);
pub const __SAPP = @as(c_int, 0x0100);
pub const __SSTR = @as(c_int, 0x0200);
pub const __SOPT = @as(c_int, 0x0400);
pub const __SNPT = @as(c_int, 0x0800);
pub const __SOFF = @as(c_int, 0x1000);
pub const __SMOD = @as(c_int, 0x2000);
pub const __SALC = @as(c_int, 0x4000);
pub const __SIGN = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x8000, .hex);
pub const _IOFBF = @as(c_int, 0);
pub const _IOLBF = @as(c_int, 1);
pub const _IONBF = @as(c_int, 2);
pub const BUFSIZ = @as(c_int, 1024);
pub const EOF = -@as(c_int, 1);
pub const FOPEN_MAX = @as(c_int, 20);
pub const FILENAME_MAX = @as(c_int, 1024);
pub const P_tmpdir = "/var/tmp/";
pub const L_tmpnam = @as(c_int, 1024);
pub const TMP_MAX = @import("std").zig.c_translation.promoteIntLiteral(c_int, 308915776, .decimal);
pub const SEEK_SET = @as(c_int, 0);
pub const SEEK_CUR = @as(c_int, 1);
pub const SEEK_END = @as(c_int, 2);
pub const L_ctermid = @as(c_int, 1024);
pub const _CTERMID_H_ = "";
pub const _SECURE__STDIO_H_ = "";
pub const _SECURE__COMMON_H_ = "";
pub const _USE_FORTIFY_LEVEL = @as(c_int, 2);
pub const OPENSSL_HEADER_BUFFER_H = "";
pub const OPENSSL_HEADER_ERR_H = "";
pub inline fn ERR_GET_LIB(packed_error: anytype) c_int {
    return @import("std").zig.c_translation.cast(c_int, (packed_error >> @as(c_int, 24)) & @as(c_int, 0xff));
}
pub inline fn ERR_GET_REASON(packed_error: anytype) c_int {
    return @import("std").zig.c_translation.cast(c_int, packed_error & @as(c_int, 0xfff));
}
pub const ERR_FLAG_STRING = @as(c_int, 1);
pub const ERR_FLAG_MALLOCED = @as(c_int, 2);
pub const ERR_R_SYS_LIB = ERR_LIB_SYS;
pub const ERR_R_BN_LIB = ERR_LIB_BN;
pub const ERR_R_RSA_LIB = ERR_LIB_RSA;
pub const ERR_R_DH_LIB = ERR_LIB_DH;
pub const ERR_R_EVP_LIB = ERR_LIB_EVP;
pub const ERR_R_BUF_LIB = ERR_LIB_BUF;
pub const ERR_R_OBJ_LIB = ERR_LIB_OBJ;
pub const ERR_R_PEM_LIB = ERR_LIB_PEM;
pub const ERR_R_DSA_LIB = ERR_LIB_DSA;
pub const ERR_R_X509_LIB = ERR_LIB_X509;
pub const ERR_R_ASN1_LIB = ERR_LIB_ASN1;
pub const ERR_R_CONF_LIB = ERR_LIB_CONF;
pub const ERR_R_CRYPTO_LIB = ERR_LIB_CRYPTO;
pub const ERR_R_EC_LIB = ERR_LIB_EC;
pub const ERR_R_SSL_LIB = ERR_LIB_SSL;
pub const ERR_R_BIO_LIB = ERR_LIB_BIO;
pub const ERR_R_PKCS7_LIB = ERR_LIB_PKCS7;
pub const ERR_R_PKCS8_LIB = ERR_LIB_PKCS8;
pub const ERR_R_X509V3_LIB = ERR_LIB_X509V3;
pub const ERR_R_RAND_LIB = ERR_LIB_RAND;
pub const ERR_R_ENGINE_LIB = ERR_LIB_ENGINE;
pub const ERR_R_OCSP_LIB = ERR_LIB_OCSP;
pub const ERR_R_UI_LIB = ERR_LIB_UI;
pub const ERR_R_COMP_LIB = ERR_LIB_COMP;
pub const ERR_R_ECDSA_LIB = ERR_LIB_ECDSA;
pub const ERR_R_ECDH_LIB = ERR_LIB_ECDH;
pub const ERR_R_HMAC_LIB = ERR_LIB_HMAC;
pub const ERR_R_USER_LIB = ERR_LIB_USER;
pub const ERR_R_DIGEST_LIB = ERR_LIB_DIGEST;
pub const ERR_R_CIPHER_LIB = ERR_LIB_CIPHER;
pub const ERR_R_HKDF_LIB = ERR_LIB_HKDF;
pub const ERR_R_TRUST_TOKEN_LIB = ERR_LIB_TRUST_TOKEN;
pub const ERR_R_FATAL = @as(c_int, 64);
pub const ERR_R_MALLOC_FAILURE = @as(c_int, 1) | ERR_R_FATAL;
pub const ERR_R_SHOULD_NOT_HAVE_BEEN_CALLED = @as(c_int, 2) | ERR_R_FATAL;
pub const ERR_R_PASSED_NULL_PARAMETER = @as(c_int, 3) | ERR_R_FATAL;
pub const ERR_R_INTERNAL_ERROR = @as(c_int, 4) | ERR_R_FATAL;
pub const ERR_R_OVERFLOW = @as(c_int, 5) | ERR_R_FATAL;
pub const ERR_ERROR_STRING_BUF_LEN = @as(c_int, 120);
pub inline fn ERR_GET_FUNC(packed_error: anytype) @TypeOf(@as(c_int, 0)) {
    _ = @TypeOf(packed_error);
    return @as(c_int, 0);
}
pub const ERR_TXT_STRING = ERR_FLAG_STRING;
pub const ERR_TXT_MALLOCED = ERR_FLAG_MALLOCED;
pub const ERR_NUM_ERRORS = @as(c_int, 16);
pub inline fn ERR_PACK(lib: anytype, reason: anytype) @TypeOf(((@import("std").zig.c_translation.cast(u32, lib) & @as(c_int, 0xff)) << @as(c_int, 24)) | (@import("std").zig.c_translation.cast(u32, reason) & @as(c_int, 0xfff))) {
    return ((@import("std").zig.c_translation.cast(u32, lib) & @as(c_int, 0xff)) << @as(c_int, 24)) | (@import("std").zig.c_translation.cast(u32, reason) & @as(c_int, 0xfff));
}
pub const OPENSSL_HEADER_EX_DATA_H = "";
pub const OPENSSL_HEADER_STACK_H = "";
pub inline fn DEFINE_STACK_OF(@"type": anytype) @TypeOf(DEFINE_NAMED_STACK_OF(@"type", @"type")) {
    return DEFINE_NAMED_STACK_OF(@"type", @"type");
}
pub const OPENSSL_HEADER_THREAD_H = "";
pub const CRYPTO_LOCK = @as(c_int, 1);
pub const CRYPTO_UNLOCK = @as(c_int, 2);
pub const CRYPTO_READ = @as(c_int, 4);
pub const CRYPTO_WRITE = @as(c_int, 8);
pub const BIO_RR_CONNECT = @as(c_int, 0x02);
pub const BIO_RR_ACCEPT = @as(c_int, 0x03);
pub const BIO_CB_FREE = @as(c_int, 0x01);
pub const BIO_CB_READ = @as(c_int, 0x02);
pub const BIO_CB_WRITE = @as(c_int, 0x03);
pub const BIO_CB_PUTS = @as(c_int, 0x04);
pub const BIO_CB_GETS = @as(c_int, 0x05);
pub const BIO_CB_CTRL = @as(c_int, 0x06);
pub const BIO_CB_RETURN = @as(c_int, 0x80);
pub const BIO_NOCLOSE = @as(c_int, 0);
pub const BIO_CLOSE = @as(c_int, 1);
pub const BIO_CTRL_DGRAM_QUERY_MTU = @as(c_int, 40);
pub const BIO_CTRL_DGRAM_SET_MTU = @as(c_int, 42);
pub const BIO_CTRL_DGRAM_MTU_EXCEEDED = @as(c_int, 43);
pub const BIO_CTRL_DGRAM_GET_PEER = @as(c_int, 46);
pub const BIO_CTRL_DGRAM_GET_FALLBACK_MTU = @as(c_int, 47);
pub const BIO_CTRL_RESET = @as(c_int, 1);
pub const BIO_CTRL_EOF = @as(c_int, 2);
pub const BIO_CTRL_INFO = @as(c_int, 3);
pub const BIO_CTRL_GET_CLOSE = @as(c_int, 8);
pub const BIO_CTRL_SET_CLOSE = @as(c_int, 9);
pub const BIO_CTRL_PENDING = @as(c_int, 10);
pub const BIO_CTRL_FLUSH = @as(c_int, 11);
pub const BIO_CTRL_WPENDING = @as(c_int, 13);
pub const BIO_CTRL_SET_CALLBACK = @as(c_int, 14);
pub const BIO_CTRL_GET_CALLBACK = @as(c_int, 15);
pub const BIO_CTRL_SET = @as(c_int, 4);
pub const BIO_CTRL_GET = @as(c_int, 5);
pub const BIO_CTRL_PUSH = @as(c_int, 6);
pub const BIO_CTRL_POP = @as(c_int, 7);
pub const BIO_CTRL_DUP = @as(c_int, 12);
pub const BIO_CTRL_SET_FILENAME = @as(c_int, 30);
pub const BIO_FLAGS_READ = @as(c_int, 0x01);
pub const BIO_FLAGS_WRITE = @as(c_int, 0x02);
pub const BIO_FLAGS_IO_SPECIAL = @as(c_int, 0x04);
pub const BIO_FLAGS_RWS = (BIO_FLAGS_READ | BIO_FLAGS_WRITE) | BIO_FLAGS_IO_SPECIAL;
pub const BIO_FLAGS_SHOULD_RETRY = @as(c_int, 0x08);
pub const BIO_FLAGS_BASE64_NO_NL = @as(c_int, 0x100);
pub const BIO_FLAGS_MEM_RDONLY = @as(c_int, 0x200);
pub const BIO_TYPE_NONE = @as(c_int, 0);
pub const BIO_TYPE_MEM = @as(c_int, 1) | @as(c_int, 0x0400);
pub const BIO_TYPE_FILE = @as(c_int, 2) | @as(c_int, 0x0400);
pub const BIO_TYPE_FD = (@as(c_int, 4) | @as(c_int, 0x0400)) | @as(c_int, 0x0100);
pub const BIO_TYPE_SOCKET = (@as(c_int, 5) | @as(c_int, 0x0400)) | @as(c_int, 0x0100);
pub const BIO_TYPE_NULL = @as(c_int, 6) | @as(c_int, 0x0400);
pub const BIO_TYPE_SSL = @as(c_int, 7) | @as(c_int, 0x0200);
pub const BIO_TYPE_MD = @as(c_int, 8) | @as(c_int, 0x0200);
pub const BIO_TYPE_BUFFER = @as(c_int, 9) | @as(c_int, 0x0200);
pub const BIO_TYPE_CIPHER = @as(c_int, 10) | @as(c_int, 0x0200);
pub const BIO_TYPE_BASE64 = @as(c_int, 11) | @as(c_int, 0x0200);
pub const BIO_TYPE_CONNECT = (@as(c_int, 12) | @as(c_int, 0x0400)) | @as(c_int, 0x0100);
pub const BIO_TYPE_ACCEPT = (@as(c_int, 13) | @as(c_int, 0x0400)) | @as(c_int, 0x0100);
pub const BIO_TYPE_PROXY_CLIENT = @as(c_int, 14) | @as(c_int, 0x0200);
pub const BIO_TYPE_PROXY_SERVER = @as(c_int, 15) | @as(c_int, 0x0200);
pub const BIO_TYPE_NBIO_TEST = @as(c_int, 16) | @as(c_int, 0x0200);
pub const BIO_TYPE_NULL_FILTER = @as(c_int, 17) | @as(c_int, 0x0200);
pub const BIO_TYPE_BER = @as(c_int, 18) | @as(c_int, 0x0200);
pub const BIO_TYPE_BIO = @as(c_int, 19) | @as(c_int, 0x0400);
pub const BIO_TYPE_LINEBUFFER = @as(c_int, 20) | @as(c_int, 0x0200);
pub const BIO_TYPE_DGRAM = (@as(c_int, 21) | @as(c_int, 0x0400)) | @as(c_int, 0x0100);
pub const BIO_TYPE_ASN1 = @as(c_int, 22) | @as(c_int, 0x0200);
pub const BIO_TYPE_COMP = @as(c_int, 23) | @as(c_int, 0x0200);
pub const BIO_TYPE_DESCRIPTOR = @as(c_int, 0x0100);
pub const BIO_TYPE_FILTER = @as(c_int, 0x0200);
pub const BIO_TYPE_SOURCE_SINK = @as(c_int, 0x0400);
pub const BIO_TYPE_START = @as(c_int, 128);
pub const BIO_C_SET_CONNECT = @as(c_int, 100);
pub const BIO_C_DO_STATE_MACHINE = @as(c_int, 101);
pub const BIO_C_SET_NBIO = @as(c_int, 102);
pub const BIO_C_SET_PROXY_PARAM = @as(c_int, 103);
pub const BIO_C_SET_FD = @as(c_int, 104);
pub const BIO_C_GET_FD = @as(c_int, 105);
pub const BIO_C_SET_FILE_PTR = @as(c_int, 106);
pub const BIO_C_GET_FILE_PTR = @as(c_int, 107);
pub const BIO_C_SET_FILENAME = @as(c_int, 108);
pub const BIO_C_SET_SSL = @as(c_int, 109);
pub const BIO_C_GET_SSL = @as(c_int, 110);
pub const BIO_C_SET_MD = @as(c_int, 111);
pub const BIO_C_GET_MD = @as(c_int, 112);
pub const BIO_C_GET_CIPHER_STATUS = @as(c_int, 113);
pub const BIO_C_SET_BUF_MEM = @as(c_int, 114);
pub const BIO_C_GET_BUF_MEM_PTR = @as(c_int, 115);
pub const BIO_C_GET_BUFF_NUM_LINES = @as(c_int, 116);
pub const BIO_C_SET_BUFF_SIZE = @as(c_int, 117);
pub const BIO_C_SET_ACCEPT = @as(c_int, 118);
pub const BIO_C_SSL_MODE = @as(c_int, 119);
pub const BIO_C_GET_MD_CTX = @as(c_int, 120);
pub const BIO_C_GET_PROXY_PARAM = @as(c_int, 121);
pub const BIO_C_SET_BUFF_READ_DATA = @as(c_int, 122);
pub const BIO_C_GET_ACCEPT = @as(c_int, 124);
pub const BIO_C_SET_SSL_RENEGOTIATE_BYTES = @as(c_int, 125);
pub const BIO_C_GET_SSL_NUM_RENEGOTIATES = @as(c_int, 126);
pub const BIO_C_SET_SSL_RENEGOTIATE_TIMEOUT = @as(c_int, 127);
pub const BIO_C_FILE_SEEK = @as(c_int, 128);
pub const BIO_C_GET_CIPHER_CTX = @as(c_int, 129);
pub const BIO_C_SET_BUF_MEM_EOF_RETURN = @as(c_int, 130);
pub const BIO_C_SET_BIND_MODE = @as(c_int, 131);
pub const BIO_C_GET_BIND_MODE = @as(c_int, 132);
pub const BIO_C_FILE_TELL = @as(c_int, 133);
pub const BIO_C_GET_SOCKS = @as(c_int, 134);
pub const BIO_C_SET_SOCKS = @as(c_int, 135);
pub const BIO_C_SET_WRITE_BUF_SIZE = @as(c_int, 136);
pub const BIO_C_GET_WRITE_BUF_SIZE = @as(c_int, 137);
pub const BIO_C_GET_WRITE_GUARANTEE = @as(c_int, 140);
pub const BIO_C_GET_READ_REQUEST = @as(c_int, 141);
pub const BIO_C_SHUTDOWN_WR = @as(c_int, 142);
pub const BIO_C_NREAD0 = @as(c_int, 143);
pub const BIO_C_NREAD = @as(c_int, 144);
pub const BIO_C_NWRITE0 = @as(c_int, 145);
pub const BIO_C_NWRITE = @as(c_int, 146);
pub const BIO_C_RESET_READ_REQUEST = @as(c_int, 147);
pub const BIO_C_SET_MD_CTX = @as(c_int, 148);
pub const BIO_C_SET_PREFIX = @as(c_int, 149);
pub const BIO_C_GET_PREFIX = @as(c_int, 150);
pub const BIO_C_SET_SUFFIX = @as(c_int, 151);
pub const BIO_C_GET_SUFFIX = @as(c_int, 152);
pub const BIO_C_SET_EX_ARG = @as(c_int, 153);
pub const BIO_C_GET_EX_ARG = @as(c_int, 154);
pub const BIO_R_BAD_FOPEN_MODE = @as(c_int, 100);
pub const BIO_R_BROKEN_PIPE = @as(c_int, 101);
pub const BIO_R_CONNECT_ERROR = @as(c_int, 102);
pub const BIO_R_ERROR_SETTING_NBIO = @as(c_int, 103);
pub const BIO_R_INVALID_ARGUMENT = @as(c_int, 104);
pub const BIO_R_IN_USE = @as(c_int, 105);
pub const BIO_R_KEEPALIVE = @as(c_int, 106);
pub const BIO_R_NBIO_CONNECT_ERROR = @as(c_int, 107);
pub const BIO_R_NO_HOSTNAME_SPECIFIED = @as(c_int, 108);
pub const BIO_R_NO_PORT_SPECIFIED = @as(c_int, 109);
pub const BIO_R_NO_SUCH_FILE = @as(c_int, 110);
pub const BIO_R_NULL_PARAMETER = @as(c_int, 111);
pub const BIO_R_SYS_LIB = @as(c_int, 112);
pub const BIO_R_UNABLE_TO_CREATE_SOCKET = @as(c_int, 113);
pub const BIO_R_UNINITIALIZED = @as(c_int, 114);
pub const BIO_R_UNSUPPORTED_METHOD = @as(c_int, 115);
pub const BIO_R_WRITE_TO_READ_ONLY_BIO = @as(c_int, 116);
pub const OPENSSL_HEADER_PEM_H = "";
pub const OPENSSL_HEADER_BASE64_H = "";
pub const OPENSSL_HEADER_CIPHER_H = "";
pub const EVP_CIPH_STREAM_CIPHER = @as(c_int, 0x0);
pub const EVP_CIPH_ECB_MODE = @as(c_int, 0x1);
pub const EVP_CIPH_CBC_MODE = @as(c_int, 0x2);
pub const EVP_CIPH_CFB_MODE = @as(c_int, 0x3);
pub const EVP_CIPH_OFB_MODE = @as(c_int, 0x4);
pub const EVP_CIPH_CTR_MODE = @as(c_int, 0x5);
pub const EVP_CIPH_GCM_MODE = @as(c_int, 0x6);
pub const EVP_CIPH_XTS_MODE = @as(c_int, 0x7);
pub const EVP_CIPH_VARIABLE_LENGTH = @as(c_int, 0x40);
pub const EVP_CIPH_ALWAYS_CALL_INIT = @as(c_int, 0x80);
pub const EVP_CIPH_CUSTOM_IV = @as(c_int, 0x100);
pub const EVP_CIPH_CTRL_INIT = @as(c_int, 0x200);
pub const EVP_CIPH_FLAG_CUSTOM_CIPHER = @as(c_int, 0x400);
pub const EVP_CIPH_FLAG_AEAD_CIPHER = @as(c_int, 0x800);
pub const EVP_CIPH_CUSTOM_COPY = @as(c_int, 0x1000);
pub const EVP_CIPH_FLAG_NON_FIPS_ALLOW = @as(c_int, 0);
pub const EVP_CIPH_CCM_MODE = -@as(c_int, 1);
pub const EVP_CIPH_OCB_MODE = -@as(c_int, 2);
pub const EVP_CIPH_WRAP_MODE = -@as(c_int, 3);
pub const EVP_CIPHER_CTX_FLAG_WRAP_ALLOW = @as(c_int, 0);
pub const EVP_CIPH_NO_PADDING = @as(c_int, 0x800);
pub const EVP_CTRL_INIT = @as(c_int, 0x0);
pub const EVP_CTRL_SET_KEY_LENGTH = @as(c_int, 0x1);
pub const EVP_CTRL_GET_RC2_KEY_BITS = @as(c_int, 0x2);
pub const EVP_CTRL_SET_RC2_KEY_BITS = @as(c_int, 0x3);
pub const EVP_CTRL_GET_RC5_ROUNDS = @as(c_int, 0x4);
pub const EVP_CTRL_SET_RC5_ROUNDS = @as(c_int, 0x5);
pub const EVP_CTRL_RAND_KEY = @as(c_int, 0x6);
pub const EVP_CTRL_PBE_PRF_NID = @as(c_int, 0x7);
pub const EVP_CTRL_COPY = @as(c_int, 0x8);
pub const EVP_CTRL_AEAD_SET_IVLEN = @as(c_int, 0x9);
pub const EVP_CTRL_AEAD_GET_TAG = @as(c_int, 0x10);
pub const EVP_CTRL_AEAD_SET_TAG = @as(c_int, 0x11);
pub const EVP_CTRL_AEAD_SET_IV_FIXED = @as(c_int, 0x12);
pub const EVP_CTRL_GCM_IV_GEN = @as(c_int, 0x13);
pub const EVP_CTRL_AEAD_SET_MAC_KEY = @as(c_int, 0x17);
pub const EVP_CTRL_GCM_SET_IV_INV = @as(c_int, 0x18);
pub const EVP_GCM_TLS_FIXED_IV_LEN = @as(c_int, 4);
pub const EVP_GCM_TLS_EXPLICIT_IV_LEN = @as(c_int, 8);
pub const EVP_GCM_TLS_TAG_LEN = @as(c_int, 16);
pub const EVP_CTRL_GCM_SET_IVLEN = EVP_CTRL_AEAD_SET_IVLEN;
pub const EVP_CTRL_GCM_GET_TAG = EVP_CTRL_AEAD_GET_TAG;
pub const EVP_CTRL_GCM_SET_TAG = EVP_CTRL_AEAD_SET_TAG;
pub const EVP_CTRL_GCM_SET_IV_FIXED = EVP_CTRL_AEAD_SET_IV_FIXED;
pub const EVP_MAX_KEY_LENGTH = @as(c_int, 64);
pub const EVP_MAX_IV_LENGTH = @as(c_int, 16);
pub const EVP_MAX_BLOCK_LENGTH = @as(c_int, 32);
pub const CIPHER_R_AES_KEY_SETUP_FAILED = @as(c_int, 100);
pub const CIPHER_R_BAD_DECRYPT = @as(c_int, 101);
pub const CIPHER_R_BAD_KEY_LENGTH = @as(c_int, 102);
pub const CIPHER_R_BUFFER_TOO_SMALL = @as(c_int, 103);
pub const CIPHER_R_CTRL_NOT_IMPLEMENTED = @as(c_int, 104);
pub const CIPHER_R_CTRL_OPERATION_NOT_IMPLEMENTED = @as(c_int, 105);
pub const CIPHER_R_DATA_NOT_MULTIPLE_OF_BLOCK_LENGTH = @as(c_int, 106);
pub const CIPHER_R_INITIALIZATION_ERROR = @as(c_int, 107);
pub const CIPHER_R_INPUT_NOT_INITIALIZED = @as(c_int, 108);
pub const CIPHER_R_INVALID_AD_SIZE = @as(c_int, 109);
pub const CIPHER_R_INVALID_KEY_LENGTH = @as(c_int, 110);
pub const CIPHER_R_INVALID_NONCE_SIZE = @as(c_int, 111);
pub const CIPHER_R_INVALID_OPERATION = @as(c_int, 112);
pub const CIPHER_R_IV_TOO_LARGE = @as(c_int, 113);
pub const CIPHER_R_NO_CIPHER_SET = @as(c_int, 114);
pub const CIPHER_R_OUTPUT_ALIASES_INPUT = @as(c_int, 115);
pub const CIPHER_R_TAG_TOO_LARGE = @as(c_int, 116);
pub const CIPHER_R_TOO_LARGE = @as(c_int, 117);
pub const CIPHER_R_UNSUPPORTED_AD_SIZE = @as(c_int, 118);
pub const CIPHER_R_UNSUPPORTED_INPUT_SIZE = @as(c_int, 119);
pub const CIPHER_R_UNSUPPORTED_KEY_SIZE = @as(c_int, 120);
pub const CIPHER_R_UNSUPPORTED_NONCE_SIZE = @as(c_int, 121);
pub const CIPHER_R_UNSUPPORTED_TAG_SIZE = @as(c_int, 122);
pub const CIPHER_R_WRONG_FINAL_BLOCK_LENGTH = @as(c_int, 123);
pub const CIPHER_R_NO_DIRECTION_SET = @as(c_int, 124);
pub const CIPHER_R_INVALID_NONCE = @as(c_int, 125);
pub const OPENSSL_HEADER_DIGEST_H = "";
pub const EVP_MAX_MD_SIZE = @as(c_int, 64);
pub const EVP_MAX_MD_BLOCK_SIZE = @as(c_int, 128);
pub const EVP_MD_FLAG_PKEY_DIGEST = @as(c_int, 1);
pub const EVP_MD_FLAG_DIGALGID_ABSENT = @as(c_int, 2);
pub const EVP_MD_FLAG_XOF = @as(c_int, 4);
pub const EVP_MD_CTX_FLAG_NON_FIPS_ALLOW = @as(c_int, 0);
pub const DIGEST_R_INPUT_NOT_INITIALIZED = @as(c_int, 100);
pub const DIGEST_R_DECODE_ERROR = @as(c_int, 101);
pub const DIGEST_R_UNKNOWN_HASH = @as(c_int, 102);
pub const OPENSSL_HEADER_EVP_H = "";
pub const OPENSSL_HEADER_EVP_ERRORS_H = "";
pub const EVP_R_BUFFER_TOO_SMALL = @as(c_int, 100);
pub const EVP_R_COMMAND_NOT_SUPPORTED = @as(c_int, 101);
pub const EVP_R_DECODE_ERROR = @as(c_int, 102);
pub const EVP_R_DIFFERENT_KEY_TYPES = @as(c_int, 103);
pub const EVP_R_DIFFERENT_PARAMETERS = @as(c_int, 104);
pub const EVP_R_ENCODE_ERROR = @as(c_int, 105);
pub const EVP_R_EXPECTING_AN_EC_KEY_KEY = @as(c_int, 106);
pub const EVP_R_EXPECTING_AN_RSA_KEY = @as(c_int, 107);
pub const EVP_R_EXPECTING_A_DSA_KEY = @as(c_int, 108);
pub const EVP_R_ILLEGAL_OR_UNSUPPORTED_PADDING_MODE = @as(c_int, 109);
pub const EVP_R_INVALID_DIGEST_LENGTH = @as(c_int, 110);
pub const EVP_R_INVALID_DIGEST_TYPE = @as(c_int, 111);
pub const EVP_R_INVALID_KEYBITS = @as(c_int, 112);
pub const EVP_R_INVALID_MGF1_MD = @as(c_int, 113);
pub const EVP_R_INVALID_OPERATION = @as(c_int, 114);
pub const EVP_R_INVALID_PADDING_MODE = @as(c_int, 115);
pub const EVP_R_INVALID_PSS_SALTLEN = @as(c_int, 116);
pub const EVP_R_KEYS_NOT_SET = @as(c_int, 117);
pub const EVP_R_MISSING_PARAMETERS = @as(c_int, 118);
pub const EVP_R_NO_DEFAULT_DIGEST = @as(c_int, 119);
pub const EVP_R_NO_KEY_SET = @as(c_int, 120);
pub const EVP_R_NO_MDC2_SUPPORT = @as(c_int, 121);
pub const EVP_R_NO_NID_FOR_CURVE = @as(c_int, 122);
pub const EVP_R_NO_OPERATION_SET = @as(c_int, 123);
pub const EVP_R_NO_PARAMETERS_SET = @as(c_int, 124);
pub const EVP_R_OPERATION_NOT_SUPPORTED_FOR_THIS_KEYTYPE = @as(c_int, 125);
pub const EVP_R_OPERATON_NOT_INITIALIZED = @as(c_int, 126);
pub const EVP_R_UNKNOWN_PUBLIC_KEY_TYPE = @as(c_int, 127);
pub const EVP_R_UNSUPPORTED_ALGORITHM = @as(c_int, 128);
pub const EVP_R_UNSUPPORTED_PUBLIC_KEY_TYPE = @as(c_int, 129);
pub const EVP_R_NOT_A_PRIVATE_KEY = @as(c_int, 130);
pub const EVP_R_INVALID_SIGNATURE = @as(c_int, 131);
pub const EVP_R_MEMORY_LIMIT_EXCEEDED = @as(c_int, 132);
pub const EVP_R_INVALID_PARAMETERS = @as(c_int, 133);
pub const EVP_R_INVALID_PEER_KEY = @as(c_int, 134);
pub const EVP_R_NOT_XOF_OR_INVALID_LENGTH = @as(c_int, 135);
pub const EVP_R_EMPTY_PSK = @as(c_int, 136);
pub const EVP_R_INVALID_BUFFER_SIZE = @as(c_int, 137);
pub const OPENSSL_HEADER_AEAD_H = "";
pub const EVP_AEAD_MAX_KEY_LENGTH = @as(c_int, 80);
pub const EVP_AEAD_MAX_NONCE_LENGTH = @as(c_int, 24);
pub const EVP_AEAD_MAX_OVERHEAD = @as(c_int, 64);
pub const EVP_AEAD_DEFAULT_TAG_LENGTH = @as(c_int, 0);
pub const OPENSSL_HEADER_NID_H = "";
pub const SN_undef = "UNDEF";
pub const LN_undef = "undefined";
pub const NID_undef = @as(c_int, 0);
pub const OBJ_undef = @as(c_long, 0);
pub const SN_rsadsi = "rsadsi";
pub const LN_rsadsi = "RSA Data Security, Inc.";
pub const NID_rsadsi = @as(c_int, 1);
pub const OBJ_rsadsi = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    break :blk @as(c_long, 113549);
};
pub const SN_pkcs = "pkcs";
pub const LN_pkcs = "RSA Data Security, Inc. PKCS";
pub const NID_pkcs = @as(c_int, 2);
pub const OBJ_pkcs = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    break :blk @as(c_long, 1);
};
pub const SN_md2 = "MD2";
pub const LN_md2 = "md2";
pub const NID_md2 = @as(c_int, 3);
pub const OBJ_md2 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 2);
};
pub const SN_md5 = "MD5";
pub const LN_md5 = "md5";
pub const NID_md5 = @as(c_int, 4);
pub const OBJ_md5 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 5);
};
pub const SN_rc4 = "RC4";
pub const LN_rc4 = "rc4";
pub const NID_rc4 = @as(c_int, 5);
pub const OBJ_rc4 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 4);
};
pub const LN_rsaEncryption = "rsaEncryption";
pub const NID_rsaEncryption = @as(c_int, 6);
pub const OBJ_rsaEncryption = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 1);
};
pub const SN_md2WithRSAEncryption = "RSA-MD2";
pub const LN_md2WithRSAEncryption = "md2WithRSAEncryption";
pub const NID_md2WithRSAEncryption = @as(c_int, 7);
pub const OBJ_md2WithRSAEncryption = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 2);
};
pub const SN_md5WithRSAEncryption = "RSA-MD5";
pub const LN_md5WithRSAEncryption = "md5WithRSAEncryption";
pub const NID_md5WithRSAEncryption = @as(c_int, 8);
pub const OBJ_md5WithRSAEncryption = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 4);
};
pub const SN_pbeWithMD2AndDES_CBC = "PBE-MD2-DES";
pub const LN_pbeWithMD2AndDES_CBC = "pbeWithMD2AndDES-CBC";
pub const NID_pbeWithMD2AndDES_CBC = @as(c_int, 9);
pub const OBJ_pbeWithMD2AndDES_CBC = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    break :blk @as(c_long, 1);
};
pub const SN_pbeWithMD5AndDES_CBC = "PBE-MD5-DES";
pub const LN_pbeWithMD5AndDES_CBC = "pbeWithMD5AndDES-CBC";
pub const NID_pbeWithMD5AndDES_CBC = @as(c_int, 10);
pub const OBJ_pbeWithMD5AndDES_CBC = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    break :blk @as(c_long, 3);
};
pub const SN_X500 = "X500";
pub const LN_X500 = "directory services (X.500)";
pub const NID_X500 = @as(c_int, 11);
pub const OBJ_X500 = blk: {
    _ = @as(c_long, 2);
    break :blk @as(c_long, 5);
};
pub const SN_X509 = "X509";
pub const NID_X509 = @as(c_int, 12);
pub const OBJ_X509 = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    break :blk @as(c_long, 4);
};
pub const SN_commonName = "CN";
pub const LN_commonName = "commonName";
pub const NID_commonName = @as(c_int, 13);
pub const OBJ_commonName = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 3);
};
pub const SN_countryName = "C";
pub const LN_countryName = "countryName";
pub const NID_countryName = @as(c_int, 14);
pub const OBJ_countryName = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 6);
};
pub const SN_localityName = "L";
pub const LN_localityName = "localityName";
pub const NID_localityName = @as(c_int, 15);
pub const OBJ_localityName = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 7);
};
pub const SN_stateOrProvinceName = "ST";
pub const LN_stateOrProvinceName = "stateOrProvinceName";
pub const NID_stateOrProvinceName = @as(c_int, 16);
pub const OBJ_stateOrProvinceName = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 8);
};
pub const SN_organizationName = "O";
pub const LN_organizationName = "organizationName";
pub const NID_organizationName = @as(c_int, 17);
pub const OBJ_organizationName = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 10);
};
pub const SN_organizationalUnitName = "OU";
pub const LN_organizationalUnitName = "organizationalUnitName";
pub const NID_organizationalUnitName = @as(c_int, 18);
pub const OBJ_organizationalUnitName = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 11);
};
pub const SN_rsa = "RSA";
pub const LN_rsa = "rsa";
pub const NID_rsa = @as(c_int, 19);
pub const OBJ_rsa = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 8);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 1);
};
pub const SN_pkcs7 = "pkcs7";
pub const NID_pkcs7 = @as(c_int, 20);
pub const OBJ_pkcs7 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 7);
};
pub const LN_pkcs7_data = "pkcs7-data";
pub const NID_pkcs7_data = @as(c_int, 21);
pub const OBJ_pkcs7_data = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 1);
};
pub const LN_pkcs7_signed = "pkcs7-signedData";
pub const NID_pkcs7_signed = @as(c_int, 22);
pub const OBJ_pkcs7_signed = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 2);
};
pub const LN_pkcs7_enveloped = "pkcs7-envelopedData";
pub const NID_pkcs7_enveloped = @as(c_int, 23);
pub const OBJ_pkcs7_enveloped = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 3);
};
pub const LN_pkcs7_signedAndEnveloped = "pkcs7-signedAndEnvelopedData";
pub const NID_pkcs7_signedAndEnveloped = @as(c_int, 24);
pub const OBJ_pkcs7_signedAndEnveloped = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 4);
};
pub const LN_pkcs7_digest = "pkcs7-digestData";
pub const NID_pkcs7_digest = @as(c_int, 25);
pub const OBJ_pkcs7_digest = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 5);
};
pub const LN_pkcs7_encrypted = "pkcs7-encryptedData";
pub const NID_pkcs7_encrypted = @as(c_int, 26);
pub const OBJ_pkcs7_encrypted = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 6);
};
pub const SN_pkcs3 = "pkcs3";
pub const NID_pkcs3 = @as(c_int, 27);
pub const OBJ_pkcs3 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 3);
};
pub const LN_dhKeyAgreement = "dhKeyAgreement";
pub const NID_dhKeyAgreement = @as(c_int, 28);
pub const OBJ_dhKeyAgreement = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 1);
};
pub const SN_des_ecb = "DES-ECB";
pub const LN_des_ecb = "des-ecb";
pub const NID_des_ecb = @as(c_int, 29);
pub const OBJ_des_ecb = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 14);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 6);
};
pub const SN_des_cfb64 = "DES-CFB";
pub const LN_des_cfb64 = "des-cfb";
pub const NID_des_cfb64 = @as(c_int, 30);
pub const OBJ_des_cfb64 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 14);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 9);
};
pub const SN_des_cbc = "DES-CBC";
pub const LN_des_cbc = "des-cbc";
pub const NID_des_cbc = @as(c_int, 31);
pub const OBJ_des_cbc = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 14);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 7);
};
pub const SN_des_ede_ecb = "DES-EDE";
pub const LN_des_ede_ecb = "des-ede";
pub const NID_des_ede_ecb = @as(c_int, 32);
pub const OBJ_des_ede_ecb = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 14);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 17);
};
pub const SN_des_ede3_ecb = "DES-EDE3";
pub const LN_des_ede3_ecb = "des-ede3";
pub const NID_des_ede3_ecb = @as(c_int, 33);
pub const SN_idea_cbc = "IDEA-CBC";
pub const LN_idea_cbc = "idea-cbc";
pub const NID_idea_cbc = @as(c_int, 34);
pub const OBJ_idea_cbc = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    _ = @as(c_long, 188);
    _ = @as(c_long, 7);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 2);
};
pub const SN_idea_cfb64 = "IDEA-CFB";
pub const LN_idea_cfb64 = "idea-cfb";
pub const NID_idea_cfb64 = @as(c_int, 35);
pub const SN_idea_ecb = "IDEA-ECB";
pub const LN_idea_ecb = "idea-ecb";
pub const NID_idea_ecb = @as(c_int, 36);
pub const SN_rc2_cbc = "RC2-CBC";
pub const LN_rc2_cbc = "rc2-cbc";
pub const NID_rc2_cbc = @as(c_int, 37);
pub const OBJ_rc2_cbc = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 2);
};
pub const SN_rc2_ecb = "RC2-ECB";
pub const LN_rc2_ecb = "rc2-ecb";
pub const NID_rc2_ecb = @as(c_int, 38);
pub const SN_rc2_cfb64 = "RC2-CFB";
pub const LN_rc2_cfb64 = "rc2-cfb";
pub const NID_rc2_cfb64 = @as(c_int, 39);
pub const SN_rc2_ofb64 = "RC2-OFB";
pub const LN_rc2_ofb64 = "rc2-ofb";
pub const NID_rc2_ofb64 = @as(c_int, 40);
pub const SN_sha = "SHA";
pub const LN_sha = "sha";
pub const NID_sha = @as(c_int, 41);
pub const OBJ_sha = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 14);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 18);
};
pub const SN_shaWithRSAEncryption = "RSA-SHA";
pub const LN_shaWithRSAEncryption = "shaWithRSAEncryption";
pub const NID_shaWithRSAEncryption = @as(c_int, 42);
pub const OBJ_shaWithRSAEncryption = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 14);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 15);
};
pub const SN_des_ede_cbc = "DES-EDE-CBC";
pub const LN_des_ede_cbc = "des-ede-cbc";
pub const NID_des_ede_cbc = @as(c_int, 43);
pub const SN_des_ede3_cbc = "DES-EDE3-CBC";
pub const LN_des_ede3_cbc = "des-ede3-cbc";
pub const NID_des_ede3_cbc = @as(c_int, 44);
pub const OBJ_des_ede3_cbc = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 7);
};
pub const SN_des_ofb64 = "DES-OFB";
pub const LN_des_ofb64 = "des-ofb";
pub const NID_des_ofb64 = @as(c_int, 45);
pub const OBJ_des_ofb64 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 14);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 8);
};
pub const SN_idea_ofb64 = "IDEA-OFB";
pub const LN_idea_ofb64 = "idea-ofb";
pub const NID_idea_ofb64 = @as(c_int, 46);
pub const SN_pkcs9 = "pkcs9";
pub const NID_pkcs9 = @as(c_int, 47);
pub const OBJ_pkcs9 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 9);
};
pub const LN_pkcs9_emailAddress = "emailAddress";
pub const NID_pkcs9_emailAddress = @as(c_int, 48);
pub const OBJ_pkcs9_emailAddress = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    break :blk @as(c_long, 1);
};
pub const LN_pkcs9_unstructuredName = "unstructuredName";
pub const NID_pkcs9_unstructuredName = @as(c_int, 49);
pub const OBJ_pkcs9_unstructuredName = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    break :blk @as(c_long, 2);
};
pub const LN_pkcs9_contentType = "contentType";
pub const NID_pkcs9_contentType = @as(c_int, 50);
pub const OBJ_pkcs9_contentType = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    break :blk @as(c_long, 3);
};
pub const LN_pkcs9_messageDigest = "messageDigest";
pub const NID_pkcs9_messageDigest = @as(c_int, 51);
pub const OBJ_pkcs9_messageDigest = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    break :blk @as(c_long, 4);
};
pub const LN_pkcs9_signingTime = "signingTime";
pub const NID_pkcs9_signingTime = @as(c_int, 52);
pub const OBJ_pkcs9_signingTime = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    break :blk @as(c_long, 5);
};
pub const LN_pkcs9_countersignature = "countersignature";
pub const NID_pkcs9_countersignature = @as(c_int, 53);
pub const OBJ_pkcs9_countersignature = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    break :blk @as(c_long, 6);
};
pub const LN_pkcs9_challengePassword = "challengePassword";
pub const NID_pkcs9_challengePassword = @as(c_int, 54);
pub const OBJ_pkcs9_challengePassword = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    break :blk @as(c_long, 7);
};
pub const LN_pkcs9_unstructuredAddress = "unstructuredAddress";
pub const NID_pkcs9_unstructuredAddress = @as(c_int, 55);
pub const OBJ_pkcs9_unstructuredAddress = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    break :blk @as(c_long, 8);
};
pub const LN_pkcs9_extCertAttributes = "extendedCertificateAttributes";
pub const NID_pkcs9_extCertAttributes = @as(c_int, 56);
pub const OBJ_pkcs9_extCertAttributes = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    break :blk @as(c_long, 9);
};
pub const SN_netscape = "Netscape";
pub const LN_netscape = "Netscape Communications Corp.";
pub const NID_netscape = @as(c_int, 57);
pub const OBJ_netscape = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 113730);
};
pub const SN_netscape_cert_extension = "nsCertExt";
pub const LN_netscape_cert_extension = "Netscape Certificate Extension";
pub const NID_netscape_cert_extension = @as(c_int, 58);
pub const OBJ_netscape_cert_extension = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 113730);
    break :blk @as(c_long, 1);
};
pub const SN_netscape_data_type = "nsDataType";
pub const LN_netscape_data_type = "Netscape Data Type";
pub const NID_netscape_data_type = @as(c_int, 59);
pub const OBJ_netscape_data_type = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 113730);
    break :blk @as(c_long, 2);
};
pub const SN_des_ede_cfb64 = "DES-EDE-CFB";
pub const LN_des_ede_cfb64 = "des-ede-cfb";
pub const NID_des_ede_cfb64 = @as(c_int, 60);
pub const SN_des_ede3_cfb64 = "DES-EDE3-CFB";
pub const LN_des_ede3_cfb64 = "des-ede3-cfb";
pub const NID_des_ede3_cfb64 = @as(c_int, 61);
pub const SN_des_ede_ofb64 = "DES-EDE-OFB";
pub const LN_des_ede_ofb64 = "des-ede-ofb";
pub const NID_des_ede_ofb64 = @as(c_int, 62);
pub const SN_des_ede3_ofb64 = "DES-EDE3-OFB";
pub const LN_des_ede3_ofb64 = "des-ede3-ofb";
pub const NID_des_ede3_ofb64 = @as(c_int, 63);
pub const SN_sha1 = "SHA1";
pub const LN_sha1 = "sha1";
pub const NID_sha1 = @as(c_int, 64);
pub const OBJ_sha1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 14);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 26);
};
pub const SN_sha1WithRSAEncryption = "RSA-SHA1";
pub const LN_sha1WithRSAEncryption = "sha1WithRSAEncryption";
pub const NID_sha1WithRSAEncryption = @as(c_int, 65);
pub const OBJ_sha1WithRSAEncryption = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 5);
};
pub const SN_dsaWithSHA = "DSA-SHA";
pub const LN_dsaWithSHA = "dsaWithSHA";
pub const NID_dsaWithSHA = @as(c_int, 66);
pub const OBJ_dsaWithSHA = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 14);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 13);
};
pub const SN_dsa_2 = "DSA-old";
pub const LN_dsa_2 = "dsaEncryption-old";
pub const NID_dsa_2 = @as(c_int, 67);
pub const OBJ_dsa_2 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 14);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 12);
};
pub const SN_pbeWithSHA1AndRC2_CBC = "PBE-SHA1-RC2-64";
pub const LN_pbeWithSHA1AndRC2_CBC = "pbeWithSHA1AndRC2-CBC";
pub const NID_pbeWithSHA1AndRC2_CBC = @as(c_int, 68);
pub const OBJ_pbeWithSHA1AndRC2_CBC = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    break :blk @as(c_long, 11);
};
pub const LN_id_pbkdf2 = "PBKDF2";
pub const NID_id_pbkdf2 = @as(c_int, 69);
pub const OBJ_id_pbkdf2 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    break :blk @as(c_long, 12);
};
pub const SN_dsaWithSHA1_2 = "DSA-SHA1-old";
pub const LN_dsaWithSHA1_2 = "dsaWithSHA1-old";
pub const NID_dsaWithSHA1_2 = @as(c_int, 70);
pub const OBJ_dsaWithSHA1_2 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 14);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 27);
};
pub const SN_netscape_cert_type = "nsCertType";
pub const LN_netscape_cert_type = "Netscape Cert Type";
pub const NID_netscape_cert_type = @as(c_int, 71);
pub const OBJ_netscape_cert_type = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 113730);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 1);
};
pub const SN_netscape_base_url = "nsBaseUrl";
pub const LN_netscape_base_url = "Netscape Base Url";
pub const NID_netscape_base_url = @as(c_int, 72);
pub const OBJ_netscape_base_url = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 113730);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 2);
};
pub const SN_netscape_revocation_url = "nsRevocationUrl";
pub const LN_netscape_revocation_url = "Netscape Revocation Url";
pub const NID_netscape_revocation_url = @as(c_int, 73);
pub const OBJ_netscape_revocation_url = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 113730);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 3);
};
pub const SN_netscape_ca_revocation_url = "nsCaRevocationUrl";
pub const LN_netscape_ca_revocation_url = "Netscape CA Revocation Url";
pub const NID_netscape_ca_revocation_url = @as(c_int, 74);
pub const OBJ_netscape_ca_revocation_url = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 113730);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 4);
};
pub const SN_netscape_renewal_url = "nsRenewalUrl";
pub const LN_netscape_renewal_url = "Netscape Renewal Url";
pub const NID_netscape_renewal_url = @as(c_int, 75);
pub const OBJ_netscape_renewal_url = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 113730);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 7);
};
pub const SN_netscape_ca_policy_url = "nsCaPolicyUrl";
pub const LN_netscape_ca_policy_url = "Netscape CA Policy Url";
pub const NID_netscape_ca_policy_url = @as(c_int, 76);
pub const OBJ_netscape_ca_policy_url = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 113730);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 8);
};
pub const SN_netscape_ssl_server_name = "nsSslServerName";
pub const LN_netscape_ssl_server_name = "Netscape SSL Server Name";
pub const NID_netscape_ssl_server_name = @as(c_int, 77);
pub const OBJ_netscape_ssl_server_name = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 113730);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 12);
};
pub const SN_netscape_comment = "nsComment";
pub const LN_netscape_comment = "Netscape Comment";
pub const NID_netscape_comment = @as(c_int, 78);
pub const OBJ_netscape_comment = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 113730);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 13);
};
pub const SN_netscape_cert_sequence = "nsCertSequence";
pub const LN_netscape_cert_sequence = "Netscape Certificate Sequence";
pub const NID_netscape_cert_sequence = @as(c_int, 79);
pub const OBJ_netscape_cert_sequence = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 113730);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 5);
};
pub const SN_desx_cbc = "DESX-CBC";
pub const LN_desx_cbc = "desx-cbc";
pub const NID_desx_cbc = @as(c_int, 80);
pub const SN_id_ce = "id-ce";
pub const NID_id_ce = @as(c_int, 81);
pub const OBJ_id_ce = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    break :blk @as(c_long, 29);
};
pub const SN_subject_key_identifier = "subjectKeyIdentifier";
pub const LN_subject_key_identifier = "X509v3 Subject Key Identifier";
pub const NID_subject_key_identifier = @as(c_int, 82);
pub const OBJ_subject_key_identifier = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 29);
    break :blk @as(c_long, 14);
};
pub const SN_key_usage = "keyUsage";
pub const LN_key_usage = "X509v3 Key Usage";
pub const NID_key_usage = @as(c_int, 83);
pub const OBJ_key_usage = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 29);
    break :blk @as(c_long, 15);
};
pub const SN_private_key_usage_period = "privateKeyUsagePeriod";
pub const LN_private_key_usage_period = "X509v3 Private Key Usage Period";
pub const NID_private_key_usage_period = @as(c_int, 84);
pub const OBJ_private_key_usage_period = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 29);
    break :blk @as(c_long, 16);
};
pub const SN_subject_alt_name = "subjectAltName";
pub const LN_subject_alt_name = "X509v3 Subject Alternative Name";
pub const NID_subject_alt_name = @as(c_int, 85);
pub const OBJ_subject_alt_name = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 29);
    break :blk @as(c_long, 17);
};
pub const SN_issuer_alt_name = "issuerAltName";
pub const LN_issuer_alt_name = "X509v3 Issuer Alternative Name";
pub const NID_issuer_alt_name = @as(c_int, 86);
pub const OBJ_issuer_alt_name = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 29);
    break :blk @as(c_long, 18);
};
pub const SN_basic_constraints = "basicConstraints";
pub const LN_basic_constraints = "X509v3 Basic Constraints";
pub const NID_basic_constraints = @as(c_int, 87);
pub const OBJ_basic_constraints = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 29);
    break :blk @as(c_long, 19);
};
pub const SN_crl_number = "crlNumber";
pub const LN_crl_number = "X509v3 CRL Number";
pub const NID_crl_number = @as(c_int, 88);
pub const OBJ_crl_number = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 29);
    break :blk @as(c_long, 20);
};
pub const SN_certificate_policies = "certificatePolicies";
pub const LN_certificate_policies = "X509v3 Certificate Policies";
pub const NID_certificate_policies = @as(c_int, 89);
pub const OBJ_certificate_policies = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 29);
    break :blk @as(c_long, 32);
};
pub const SN_authority_key_identifier = "authorityKeyIdentifier";
pub const LN_authority_key_identifier = "X509v3 Authority Key Identifier";
pub const NID_authority_key_identifier = @as(c_int, 90);
pub const OBJ_authority_key_identifier = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 29);
    break :blk @as(c_long, 35);
};
pub const SN_bf_cbc = "BF-CBC";
pub const LN_bf_cbc = "bf-cbc";
pub const NID_bf_cbc = @as(c_int, 91);
pub const OBJ_bf_cbc = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    _ = @as(c_long, 3029);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 2);
};
pub const SN_bf_ecb = "BF-ECB";
pub const LN_bf_ecb = "bf-ecb";
pub const NID_bf_ecb = @as(c_int, 92);
pub const SN_bf_cfb64 = "BF-CFB";
pub const LN_bf_cfb64 = "bf-cfb";
pub const NID_bf_cfb64 = @as(c_int, 93);
pub const SN_bf_ofb64 = "BF-OFB";
pub const LN_bf_ofb64 = "bf-ofb";
pub const NID_bf_ofb64 = @as(c_int, 94);
pub const SN_mdc2 = "MDC2";
pub const LN_mdc2 = "mdc2";
pub const NID_mdc2 = @as(c_int, 95);
pub const OBJ_mdc2 = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 8);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 101);
};
pub const SN_mdc2WithRSA = "RSA-MDC2";
pub const LN_mdc2WithRSA = "mdc2WithRSA";
pub const NID_mdc2WithRSA = @as(c_int, 96);
pub const OBJ_mdc2WithRSA = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 8);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 100);
};
pub const SN_rc4_40 = "RC4-40";
pub const LN_rc4_40 = "rc4-40";
pub const NID_rc4_40 = @as(c_int, 97);
pub const SN_rc2_40_cbc = "RC2-40-CBC";
pub const LN_rc2_40_cbc = "rc2-40-cbc";
pub const NID_rc2_40_cbc = @as(c_int, 98);
pub const SN_givenName = "GN";
pub const LN_givenName = "givenName";
pub const NID_givenName = @as(c_int, 99);
pub const OBJ_givenName = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 42);
};
pub const SN_surname = "SN";
pub const LN_surname = "surname";
pub const NID_surname = @as(c_int, 100);
pub const OBJ_surname = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 4);
};
pub const SN_initials = "initials";
pub const LN_initials = "initials";
pub const NID_initials = @as(c_int, 101);
pub const OBJ_initials = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 43);
};
pub const SN_crl_distribution_points = "crlDistributionPoints";
pub const LN_crl_distribution_points = "X509v3 CRL Distribution Points";
pub const NID_crl_distribution_points = @as(c_int, 103);
pub const OBJ_crl_distribution_points = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 29);
    break :blk @as(c_long, 31);
};
pub const SN_md5WithRSA = "RSA-NP-MD5";
pub const LN_md5WithRSA = "md5WithRSA";
pub const NID_md5WithRSA = @as(c_int, 104);
pub const OBJ_md5WithRSA = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 14);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 3);
};
pub const LN_serialNumber = "serialNumber";
pub const NID_serialNumber = @as(c_int, 105);
pub const OBJ_serialNumber = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 5);
};
pub const SN_title = "title";
pub const LN_title = "title";
pub const NID_title = @as(c_int, 106);
pub const OBJ_title = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 12);
};
pub const LN_description = "description";
pub const NID_description = @as(c_int, 107);
pub const OBJ_description = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 13);
};
pub const SN_cast5_cbc = "CAST5-CBC";
pub const LN_cast5_cbc = "cast5-cbc";
pub const NID_cast5_cbc = @as(c_int, 108);
pub const OBJ_cast5_cbc = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113533);
    _ = @as(c_long, 7);
    _ = @as(c_long, 66);
    break :blk @as(c_long, 10);
};
pub const SN_cast5_ecb = "CAST5-ECB";
pub const LN_cast5_ecb = "cast5-ecb";
pub const NID_cast5_ecb = @as(c_int, 109);
pub const SN_cast5_cfb64 = "CAST5-CFB";
pub const LN_cast5_cfb64 = "cast5-cfb";
pub const NID_cast5_cfb64 = @as(c_int, 110);
pub const SN_cast5_ofb64 = "CAST5-OFB";
pub const LN_cast5_ofb64 = "cast5-ofb";
pub const NID_cast5_ofb64 = @as(c_int, 111);
pub const LN_pbeWithMD5AndCast5_CBC = "pbeWithMD5AndCast5CBC";
pub const NID_pbeWithMD5AndCast5_CBC = @as(c_int, 112);
pub const OBJ_pbeWithMD5AndCast5_CBC = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113533);
    _ = @as(c_long, 7);
    _ = @as(c_long, 66);
    break :blk @as(c_long, 12);
};
pub const SN_dsaWithSHA1 = "DSA-SHA1";
pub const LN_dsaWithSHA1 = "dsaWithSHA1";
pub const NID_dsaWithSHA1 = @as(c_int, 113);
pub const OBJ_dsaWithSHA1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10040);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 3);
};
pub const SN_md5_sha1 = "MD5-SHA1";
pub const LN_md5_sha1 = "md5-sha1";
pub const NID_md5_sha1 = @as(c_int, 114);
pub const SN_sha1WithRSA = "RSA-SHA1-2";
pub const LN_sha1WithRSA = "sha1WithRSA";
pub const NID_sha1WithRSA = @as(c_int, 115);
pub const OBJ_sha1WithRSA = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 14);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 29);
};
pub const SN_dsa = "DSA";
pub const LN_dsa = "dsaEncryption";
pub const NID_dsa = @as(c_int, 116);
pub const OBJ_dsa = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10040);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 1);
};
pub const SN_ripemd160 = "RIPEMD160";
pub const LN_ripemd160 = "ripemd160";
pub const NID_ripemd160 = @as(c_int, 117);
pub const OBJ_ripemd160 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 36);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 1);
};
pub const SN_ripemd160WithRSA = "RSA-RIPEMD160";
pub const LN_ripemd160WithRSA = "ripemd160WithRSA";
pub const NID_ripemd160WithRSA = @as(c_int, 119);
pub const OBJ_ripemd160WithRSA = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 36);
    _ = @as(c_long, 3);
    _ = @as(c_long, 3);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 2);
};
pub const SN_rc5_cbc = "RC5-CBC";
pub const LN_rc5_cbc = "rc5-cbc";
pub const NID_rc5_cbc = @as(c_int, 120);
pub const OBJ_rc5_cbc = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 8);
};
pub const SN_rc5_ecb = "RC5-ECB";
pub const LN_rc5_ecb = "rc5-ecb";
pub const NID_rc5_ecb = @as(c_int, 121);
pub const SN_rc5_cfb64 = "RC5-CFB";
pub const LN_rc5_cfb64 = "rc5-cfb";
pub const NID_rc5_cfb64 = @as(c_int, 122);
pub const SN_rc5_ofb64 = "RC5-OFB";
pub const LN_rc5_ofb64 = "rc5-ofb";
pub const NID_rc5_ofb64 = @as(c_int, 123);
pub const SN_zlib_compression = "ZLIB";
pub const LN_zlib_compression = "zlib compression";
pub const NID_zlib_compression = @as(c_int, 125);
pub const OBJ_zlib_compression = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 8);
};
pub const SN_ext_key_usage = "extendedKeyUsage";
pub const LN_ext_key_usage = "X509v3 Extended Key Usage";
pub const NID_ext_key_usage = @as(c_int, 126);
pub const OBJ_ext_key_usage = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 29);
    break :blk @as(c_long, 37);
};
pub const SN_id_pkix = "PKIX";
pub const NID_id_pkix = @as(c_int, 127);
pub const OBJ_id_pkix = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    break :blk @as(c_long, 7);
};
pub const SN_id_kp = "id-kp";
pub const NID_id_kp = @as(c_int, 128);
pub const OBJ_id_kp = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 3);
};
pub const SN_server_auth = "serverAuth";
pub const LN_server_auth = "TLS Web Server Authentication";
pub const NID_server_auth = @as(c_int, 129);
pub const OBJ_server_auth = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 1);
};
pub const SN_client_auth = "clientAuth";
pub const LN_client_auth = "TLS Web Client Authentication";
pub const NID_client_auth = @as(c_int, 130);
pub const OBJ_client_auth = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 2);
};
pub const SN_code_sign = "codeSigning";
pub const LN_code_sign = "Code Signing";
pub const NID_code_sign = @as(c_int, 131);
pub const OBJ_code_sign = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 3);
};
pub const SN_email_protect = "emailProtection";
pub const LN_email_protect = "E-mail Protection";
pub const NID_email_protect = @as(c_int, 132);
pub const OBJ_email_protect = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 4);
};
pub const SN_time_stamp = "timeStamping";
pub const LN_time_stamp = "Time Stamping";
pub const NID_time_stamp = @as(c_int, 133);
pub const OBJ_time_stamp = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 8);
};
pub const SN_ms_code_ind = "msCodeInd";
pub const LN_ms_code_ind = "Microsoft Individual Code Signing";
pub const NID_ms_code_ind = @as(c_int, 134);
pub const OBJ_ms_code_ind = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    _ = @as(c_long, 311);
    _ = @as(c_long, 2);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 21);
};
pub const SN_ms_code_com = "msCodeCom";
pub const LN_ms_code_com = "Microsoft Commercial Code Signing";
pub const NID_ms_code_com = @as(c_int, 135);
pub const OBJ_ms_code_com = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    _ = @as(c_long, 311);
    _ = @as(c_long, 2);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 22);
};
pub const SN_ms_ctl_sign = "msCTLSign";
pub const LN_ms_ctl_sign = "Microsoft Trust List Signing";
pub const NID_ms_ctl_sign = @as(c_int, 136);
pub const OBJ_ms_ctl_sign = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    _ = @as(c_long, 311);
    _ = @as(c_long, 10);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 1);
};
pub const SN_ms_sgc = "msSGC";
pub const LN_ms_sgc = "Microsoft Server Gated Crypto";
pub const NID_ms_sgc = @as(c_int, 137);
pub const OBJ_ms_sgc = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    _ = @as(c_long, 311);
    _ = @as(c_long, 10);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 3);
};
pub const SN_ms_efs = "msEFS";
pub const LN_ms_efs = "Microsoft Encrypted File System";
pub const NID_ms_efs = @as(c_int, 138);
pub const OBJ_ms_efs = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    _ = @as(c_long, 311);
    _ = @as(c_long, 10);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 4);
};
pub const SN_ns_sgc = "nsSGC";
pub const LN_ns_sgc = "Netscape Server Gated Crypto";
pub const NID_ns_sgc = @as(c_int, 139);
pub const OBJ_ns_sgc = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 113730);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 1);
};
pub const SN_delta_crl = "deltaCRL";
pub const LN_delta_crl = "X509v3 Delta CRL Indicator";
pub const NID_delta_crl = @as(c_int, 140);
pub const OBJ_delta_crl = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 29);
    break :blk @as(c_long, 27);
};
pub const SN_crl_reason = "CRLReason";
pub const LN_crl_reason = "X509v3 CRL Reason Code";
pub const NID_crl_reason = @as(c_int, 141);
pub const OBJ_crl_reason = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 29);
    break :blk @as(c_long, 21);
};
pub const SN_invalidity_date = "invalidityDate";
pub const LN_invalidity_date = "Invalidity Date";
pub const NID_invalidity_date = @as(c_int, 142);
pub const OBJ_invalidity_date = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 29);
    break :blk @as(c_long, 24);
};
pub const SN_sxnet = "SXNetID";
pub const LN_sxnet = "Strong Extranet ID";
pub const NID_sxnet = @as(c_int, 143);
pub const OBJ_sxnet = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 101);
    _ = @as(c_long, 1);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 1);
};
pub const SN_pbe_WithSHA1And128BitRC4 = "PBE-SHA1-RC4-128";
pub const LN_pbe_WithSHA1And128BitRC4 = "pbeWithSHA1And128BitRC4";
pub const NID_pbe_WithSHA1And128BitRC4 = @as(c_int, 144);
pub const OBJ_pbe_WithSHA1And128BitRC4 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 12);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 1);
};
pub const SN_pbe_WithSHA1And40BitRC4 = "PBE-SHA1-RC4-40";
pub const LN_pbe_WithSHA1And40BitRC4 = "pbeWithSHA1And40BitRC4";
pub const NID_pbe_WithSHA1And40BitRC4 = @as(c_int, 145);
pub const OBJ_pbe_WithSHA1And40BitRC4 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 12);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 2);
};
pub const SN_pbe_WithSHA1And3_Key_TripleDES_CBC = "PBE-SHA1-3DES";
pub const LN_pbe_WithSHA1And3_Key_TripleDES_CBC = "pbeWithSHA1And3-KeyTripleDES-CBC";
pub const NID_pbe_WithSHA1And3_Key_TripleDES_CBC = @as(c_int, 146);
pub const OBJ_pbe_WithSHA1And3_Key_TripleDES_CBC = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 12);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 3);
};
pub const SN_pbe_WithSHA1And2_Key_TripleDES_CBC = "PBE-SHA1-2DES";
pub const LN_pbe_WithSHA1And2_Key_TripleDES_CBC = "pbeWithSHA1And2-KeyTripleDES-CBC";
pub const NID_pbe_WithSHA1And2_Key_TripleDES_CBC = @as(c_int, 147);
pub const OBJ_pbe_WithSHA1And2_Key_TripleDES_CBC = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 12);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 4);
};
pub const SN_pbe_WithSHA1And128BitRC2_CBC = "PBE-SHA1-RC2-128";
pub const LN_pbe_WithSHA1And128BitRC2_CBC = "pbeWithSHA1And128BitRC2-CBC";
pub const NID_pbe_WithSHA1And128BitRC2_CBC = @as(c_int, 148);
pub const OBJ_pbe_WithSHA1And128BitRC2_CBC = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 12);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 5);
};
pub const SN_pbe_WithSHA1And40BitRC2_CBC = "PBE-SHA1-RC2-40";
pub const LN_pbe_WithSHA1And40BitRC2_CBC = "pbeWithSHA1And40BitRC2-CBC";
pub const NID_pbe_WithSHA1And40BitRC2_CBC = @as(c_int, 149);
pub const OBJ_pbe_WithSHA1And40BitRC2_CBC = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 12);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 6);
};
pub const LN_keyBag = "keyBag";
pub const NID_keyBag = @as(c_int, 150);
pub const OBJ_keyBag = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 12);
    _ = @as(c_long, 10);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 1);
};
pub const LN_pkcs8ShroudedKeyBag = "pkcs8ShroudedKeyBag";
pub const NID_pkcs8ShroudedKeyBag = @as(c_int, 151);
pub const OBJ_pkcs8ShroudedKeyBag = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 12);
    _ = @as(c_long, 10);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 2);
};
pub const LN_certBag = "certBag";
pub const NID_certBag = @as(c_int, 152);
pub const OBJ_certBag = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 12);
    _ = @as(c_long, 10);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 3);
};
pub const LN_crlBag = "crlBag";
pub const NID_crlBag = @as(c_int, 153);
pub const OBJ_crlBag = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 12);
    _ = @as(c_long, 10);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 4);
};
pub const LN_secretBag = "secretBag";
pub const NID_secretBag = @as(c_int, 154);
pub const OBJ_secretBag = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 12);
    _ = @as(c_long, 10);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 5);
};
pub const LN_safeContentsBag = "safeContentsBag";
pub const NID_safeContentsBag = @as(c_int, 155);
pub const OBJ_safeContentsBag = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 12);
    _ = @as(c_long, 10);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 6);
};
pub const LN_friendlyName = "friendlyName";
pub const NID_friendlyName = @as(c_int, 156);
pub const OBJ_friendlyName = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    break :blk @as(c_long, 20);
};
pub const LN_localKeyID = "localKeyID";
pub const NID_localKeyID = @as(c_int, 157);
pub const OBJ_localKeyID = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    break :blk @as(c_long, 21);
};
pub const LN_x509Certificate = "x509Certificate";
pub const NID_x509Certificate = @as(c_int, 158);
pub const OBJ_x509Certificate = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 22);
    break :blk @as(c_long, 1);
};
pub const LN_sdsiCertificate = "sdsiCertificate";
pub const NID_sdsiCertificate = @as(c_int, 159);
pub const OBJ_sdsiCertificate = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 22);
    break :blk @as(c_long, 2);
};
pub const LN_x509Crl = "x509Crl";
pub const NID_x509Crl = @as(c_int, 160);
pub const OBJ_x509Crl = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 23);
    break :blk @as(c_long, 1);
};
pub const LN_pbes2 = "PBES2";
pub const NID_pbes2 = @as(c_int, 161);
pub const OBJ_pbes2 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    break :blk @as(c_long, 13);
};
pub const LN_pbmac1 = "PBMAC1";
pub const NID_pbmac1 = @as(c_int, 162);
pub const OBJ_pbmac1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    break :blk @as(c_long, 14);
};
pub const LN_hmacWithSHA1 = "hmacWithSHA1";
pub const NID_hmacWithSHA1 = @as(c_int, 163);
pub const OBJ_hmacWithSHA1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 7);
};
pub const SN_id_qt_cps = "id-qt-cps";
pub const LN_id_qt_cps = "Policy Qualifier CPS";
pub const NID_id_qt_cps = @as(c_int, 164);
pub const OBJ_id_qt_cps = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 1);
};
pub const SN_id_qt_unotice = "id-qt-unotice";
pub const LN_id_qt_unotice = "Policy Qualifier User Notice";
pub const NID_id_qt_unotice = @as(c_int, 165);
pub const OBJ_id_qt_unotice = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 2);
};
pub const SN_rc2_64_cbc = "RC2-64-CBC";
pub const LN_rc2_64_cbc = "rc2-64-cbc";
pub const NID_rc2_64_cbc = @as(c_int, 166);
pub const SN_SMIMECapabilities = "SMIME-CAPS";
pub const LN_SMIMECapabilities = "S/MIME Capabilities";
pub const NID_SMIMECapabilities = @as(c_int, 167);
pub const OBJ_SMIMECapabilities = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    break :blk @as(c_long, 15);
};
pub const SN_pbeWithMD2AndRC2_CBC = "PBE-MD2-RC2-64";
pub const LN_pbeWithMD2AndRC2_CBC = "pbeWithMD2AndRC2-CBC";
pub const NID_pbeWithMD2AndRC2_CBC = @as(c_int, 168);
pub const OBJ_pbeWithMD2AndRC2_CBC = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    break :blk @as(c_long, 4);
};
pub const SN_pbeWithMD5AndRC2_CBC = "PBE-MD5-RC2-64";
pub const LN_pbeWithMD5AndRC2_CBC = "pbeWithMD5AndRC2-CBC";
pub const NID_pbeWithMD5AndRC2_CBC = @as(c_int, 169);
pub const OBJ_pbeWithMD5AndRC2_CBC = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    break :blk @as(c_long, 6);
};
pub const SN_pbeWithSHA1AndDES_CBC = "PBE-SHA1-DES";
pub const LN_pbeWithSHA1AndDES_CBC = "pbeWithSHA1AndDES-CBC";
pub const NID_pbeWithSHA1AndDES_CBC = @as(c_int, 170);
pub const OBJ_pbeWithSHA1AndDES_CBC = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    break :blk @as(c_long, 10);
};
pub const SN_ms_ext_req = "msExtReq";
pub const LN_ms_ext_req = "Microsoft Extension Request";
pub const NID_ms_ext_req = @as(c_int, 171);
pub const OBJ_ms_ext_req = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    _ = @as(c_long, 311);
    _ = @as(c_long, 2);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 14);
};
pub const SN_ext_req = "extReq";
pub const LN_ext_req = "Extension Request";
pub const NID_ext_req = @as(c_int, 172);
pub const OBJ_ext_req = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    break :blk @as(c_long, 14);
};
pub const SN_name = "name";
pub const LN_name = "name";
pub const NID_name = @as(c_int, 173);
pub const OBJ_name = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 41);
};
pub const SN_dnQualifier = "dnQualifier";
pub const LN_dnQualifier = "dnQualifier";
pub const NID_dnQualifier = @as(c_int, 174);
pub const OBJ_dnQualifier = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 46);
};
pub const SN_id_pe = "id-pe";
pub const NID_id_pe = @as(c_int, 175);
pub const OBJ_id_pe = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 1);
};
pub const SN_id_ad = "id-ad";
pub const NID_id_ad = @as(c_int, 176);
pub const OBJ_id_ad = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 48);
};
pub const SN_info_access = "authorityInfoAccess";
pub const LN_info_access = "Authority Information Access";
pub const NID_info_access = @as(c_int, 177);
pub const OBJ_info_access = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 1);
};
pub const SN_ad_OCSP = "OCSP";
pub const LN_ad_OCSP = "OCSP";
pub const NID_ad_OCSP = @as(c_int, 178);
pub const OBJ_ad_OCSP = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 48);
    break :blk @as(c_long, 1);
};
pub const SN_ad_ca_issuers = "caIssuers";
pub const LN_ad_ca_issuers = "CA Issuers";
pub const NID_ad_ca_issuers = @as(c_int, 179);
pub const OBJ_ad_ca_issuers = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 48);
    break :blk @as(c_long, 2);
};
pub const SN_OCSP_sign = "OCSPSigning";
pub const LN_OCSP_sign = "OCSP Signing";
pub const NID_OCSP_sign = @as(c_int, 180);
pub const OBJ_OCSP_sign = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 9);
};
pub const SN_iso = "ISO";
pub const LN_iso = "iso";
pub const NID_iso = @as(c_int, 181);
pub const OBJ_iso = @as(c_long, 1);
pub const SN_member_body = "member-body";
pub const LN_member_body = "ISO Member Body";
pub const NID_member_body = @as(c_int, 182);
pub const OBJ_member_body = blk: {
    _ = @as(c_long, 1);
    break :blk @as(c_long, 2);
};
pub const SN_ISO_US = "ISO-US";
pub const LN_ISO_US = "ISO US Member Body";
pub const NID_ISO_US = @as(c_int, 183);
pub const OBJ_ISO_US = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 840);
};
pub const SN_X9_57 = "X9-57";
pub const LN_X9_57 = "X9.57";
pub const NID_X9_57 = @as(c_int, 184);
pub const OBJ_X9_57 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    break :blk @as(c_long, 10040);
};
pub const SN_X9cm = "X9cm";
pub const LN_X9cm = "X9.57 CM ?";
pub const NID_X9cm = @as(c_int, 185);
pub const OBJ_X9cm = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10040);
    break :blk @as(c_long, 4);
};
pub const SN_pkcs1 = "pkcs1";
pub const NID_pkcs1 = @as(c_int, 186);
pub const OBJ_pkcs1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 1);
};
pub const SN_pkcs5 = "pkcs5";
pub const NID_pkcs5 = @as(c_int, 187);
pub const OBJ_pkcs5 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 5);
};
pub const SN_SMIME = "SMIME";
pub const LN_SMIME = "S/MIME";
pub const NID_SMIME = @as(c_int, 188);
pub const OBJ_SMIME = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    break :blk @as(c_long, 16);
};
pub const SN_id_smime_mod = "id-smime-mod";
pub const NID_id_smime_mod = @as(c_int, 189);
pub const OBJ_id_smime_mod = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    break :blk @as(c_long, 0);
};
pub const SN_id_smime_ct = "id-smime-ct";
pub const NID_id_smime_ct = @as(c_int, 190);
pub const OBJ_id_smime_ct = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    break :blk @as(c_long, 1);
};
pub const SN_id_smime_aa = "id-smime-aa";
pub const NID_id_smime_aa = @as(c_int, 191);
pub const OBJ_id_smime_aa = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    break :blk @as(c_long, 2);
};
pub const SN_id_smime_alg = "id-smime-alg";
pub const NID_id_smime_alg = @as(c_int, 192);
pub const OBJ_id_smime_alg = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    break :blk @as(c_long, 3);
};
pub const SN_id_smime_cd = "id-smime-cd";
pub const NID_id_smime_cd = @as(c_int, 193);
pub const OBJ_id_smime_cd = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    break :blk @as(c_long, 4);
};
pub const SN_id_smime_spq = "id-smime-spq";
pub const NID_id_smime_spq = @as(c_int, 194);
pub const OBJ_id_smime_spq = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    break :blk @as(c_long, 5);
};
pub const SN_id_smime_cti = "id-smime-cti";
pub const NID_id_smime_cti = @as(c_int, 195);
pub const OBJ_id_smime_cti = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    break :blk @as(c_long, 6);
};
pub const SN_id_smime_mod_cms = "id-smime-mod-cms";
pub const NID_id_smime_mod_cms = @as(c_int, 196);
pub const OBJ_id_smime_mod_cms = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 1);
};
pub const SN_id_smime_mod_ess = "id-smime-mod-ess";
pub const NID_id_smime_mod_ess = @as(c_int, 197);
pub const OBJ_id_smime_mod_ess = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 2);
};
pub const SN_id_smime_mod_oid = "id-smime-mod-oid";
pub const NID_id_smime_mod_oid = @as(c_int, 198);
pub const OBJ_id_smime_mod_oid = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 3);
};
pub const SN_id_smime_mod_msg_v3 = "id-smime-mod-msg-v3";
pub const NID_id_smime_mod_msg_v3 = @as(c_int, 199);
pub const OBJ_id_smime_mod_msg_v3 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 4);
};
pub const SN_id_smime_mod_ets_eSignature_88 = "id-smime-mod-ets-eSignature-88";
pub const NID_id_smime_mod_ets_eSignature_88 = @as(c_int, 200);
pub const OBJ_id_smime_mod_ets_eSignature_88 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 5);
};
pub const SN_id_smime_mod_ets_eSignature_97 = "id-smime-mod-ets-eSignature-97";
pub const NID_id_smime_mod_ets_eSignature_97 = @as(c_int, 201);
pub const OBJ_id_smime_mod_ets_eSignature_97 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 6);
};
pub const SN_id_smime_mod_ets_eSigPolicy_88 = "id-smime-mod-ets-eSigPolicy-88";
pub const NID_id_smime_mod_ets_eSigPolicy_88 = @as(c_int, 202);
pub const OBJ_id_smime_mod_ets_eSigPolicy_88 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 7);
};
pub const SN_id_smime_mod_ets_eSigPolicy_97 = "id-smime-mod-ets-eSigPolicy-97";
pub const NID_id_smime_mod_ets_eSigPolicy_97 = @as(c_int, 203);
pub const OBJ_id_smime_mod_ets_eSigPolicy_97 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 8);
};
pub const SN_id_smime_ct_receipt = "id-smime-ct-receipt";
pub const NID_id_smime_ct_receipt = @as(c_int, 204);
pub const OBJ_id_smime_ct_receipt = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 1);
};
pub const SN_id_smime_ct_authData = "id-smime-ct-authData";
pub const NID_id_smime_ct_authData = @as(c_int, 205);
pub const OBJ_id_smime_ct_authData = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 2);
};
pub const SN_id_smime_ct_publishCert = "id-smime-ct-publishCert";
pub const NID_id_smime_ct_publishCert = @as(c_int, 206);
pub const OBJ_id_smime_ct_publishCert = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 3);
};
pub const SN_id_smime_ct_TSTInfo = "id-smime-ct-TSTInfo";
pub const NID_id_smime_ct_TSTInfo = @as(c_int, 207);
pub const OBJ_id_smime_ct_TSTInfo = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 4);
};
pub const SN_id_smime_ct_TDTInfo = "id-smime-ct-TDTInfo";
pub const NID_id_smime_ct_TDTInfo = @as(c_int, 208);
pub const OBJ_id_smime_ct_TDTInfo = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 5);
};
pub const SN_id_smime_ct_contentInfo = "id-smime-ct-contentInfo";
pub const NID_id_smime_ct_contentInfo = @as(c_int, 209);
pub const OBJ_id_smime_ct_contentInfo = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 6);
};
pub const SN_id_smime_ct_DVCSRequestData = "id-smime-ct-DVCSRequestData";
pub const NID_id_smime_ct_DVCSRequestData = @as(c_int, 210);
pub const OBJ_id_smime_ct_DVCSRequestData = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 7);
};
pub const SN_id_smime_ct_DVCSResponseData = "id-smime-ct-DVCSResponseData";
pub const NID_id_smime_ct_DVCSResponseData = @as(c_int, 211);
pub const OBJ_id_smime_ct_DVCSResponseData = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 8);
};
pub const SN_id_smime_aa_receiptRequest = "id-smime-aa-receiptRequest";
pub const NID_id_smime_aa_receiptRequest = @as(c_int, 212);
pub const OBJ_id_smime_aa_receiptRequest = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 1);
};
pub const SN_id_smime_aa_securityLabel = "id-smime-aa-securityLabel";
pub const NID_id_smime_aa_securityLabel = @as(c_int, 213);
pub const OBJ_id_smime_aa_securityLabel = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 2);
};
pub const SN_id_smime_aa_mlExpandHistory = "id-smime-aa-mlExpandHistory";
pub const NID_id_smime_aa_mlExpandHistory = @as(c_int, 214);
pub const OBJ_id_smime_aa_mlExpandHistory = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 3);
};
pub const SN_id_smime_aa_contentHint = "id-smime-aa-contentHint";
pub const NID_id_smime_aa_contentHint = @as(c_int, 215);
pub const OBJ_id_smime_aa_contentHint = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 4);
};
pub const SN_id_smime_aa_msgSigDigest = "id-smime-aa-msgSigDigest";
pub const NID_id_smime_aa_msgSigDigest = @as(c_int, 216);
pub const OBJ_id_smime_aa_msgSigDigest = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 5);
};
pub const SN_id_smime_aa_encapContentType = "id-smime-aa-encapContentType";
pub const NID_id_smime_aa_encapContentType = @as(c_int, 217);
pub const OBJ_id_smime_aa_encapContentType = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 6);
};
pub const SN_id_smime_aa_contentIdentifier = "id-smime-aa-contentIdentifier";
pub const NID_id_smime_aa_contentIdentifier = @as(c_int, 218);
pub const OBJ_id_smime_aa_contentIdentifier = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 7);
};
pub const SN_id_smime_aa_macValue = "id-smime-aa-macValue";
pub const NID_id_smime_aa_macValue = @as(c_int, 219);
pub const OBJ_id_smime_aa_macValue = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 8);
};
pub const SN_id_smime_aa_equivalentLabels = "id-smime-aa-equivalentLabels";
pub const NID_id_smime_aa_equivalentLabels = @as(c_int, 220);
pub const OBJ_id_smime_aa_equivalentLabels = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 9);
};
pub const SN_id_smime_aa_contentReference = "id-smime-aa-contentReference";
pub const NID_id_smime_aa_contentReference = @as(c_int, 221);
pub const OBJ_id_smime_aa_contentReference = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 10);
};
pub const SN_id_smime_aa_encrypKeyPref = "id-smime-aa-encrypKeyPref";
pub const NID_id_smime_aa_encrypKeyPref = @as(c_int, 222);
pub const OBJ_id_smime_aa_encrypKeyPref = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 11);
};
pub const SN_id_smime_aa_signingCertificate = "id-smime-aa-signingCertificate";
pub const NID_id_smime_aa_signingCertificate = @as(c_int, 223);
pub const OBJ_id_smime_aa_signingCertificate = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 12);
};
pub const SN_id_smime_aa_smimeEncryptCerts = "id-smime-aa-smimeEncryptCerts";
pub const NID_id_smime_aa_smimeEncryptCerts = @as(c_int, 224);
pub const OBJ_id_smime_aa_smimeEncryptCerts = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 13);
};
pub const SN_id_smime_aa_timeStampToken = "id-smime-aa-timeStampToken";
pub const NID_id_smime_aa_timeStampToken = @as(c_int, 225);
pub const OBJ_id_smime_aa_timeStampToken = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 14);
};
pub const SN_id_smime_aa_ets_sigPolicyId = "id-smime-aa-ets-sigPolicyId";
pub const NID_id_smime_aa_ets_sigPolicyId = @as(c_int, 226);
pub const OBJ_id_smime_aa_ets_sigPolicyId = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 15);
};
pub const SN_id_smime_aa_ets_commitmentType = "id-smime-aa-ets-commitmentType";
pub const NID_id_smime_aa_ets_commitmentType = @as(c_int, 227);
pub const OBJ_id_smime_aa_ets_commitmentType = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 16);
};
pub const SN_id_smime_aa_ets_signerLocation = "id-smime-aa-ets-signerLocation";
pub const NID_id_smime_aa_ets_signerLocation = @as(c_int, 228);
pub const OBJ_id_smime_aa_ets_signerLocation = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 17);
};
pub const SN_id_smime_aa_ets_signerAttr = "id-smime-aa-ets-signerAttr";
pub const NID_id_smime_aa_ets_signerAttr = @as(c_int, 229);
pub const OBJ_id_smime_aa_ets_signerAttr = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 18);
};
pub const SN_id_smime_aa_ets_otherSigCert = "id-smime-aa-ets-otherSigCert";
pub const NID_id_smime_aa_ets_otherSigCert = @as(c_int, 230);
pub const OBJ_id_smime_aa_ets_otherSigCert = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 19);
};
pub const SN_id_smime_aa_ets_contentTimestamp = "id-smime-aa-ets-contentTimestamp";
pub const NID_id_smime_aa_ets_contentTimestamp = @as(c_int, 231);
pub const OBJ_id_smime_aa_ets_contentTimestamp = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 20);
};
pub const SN_id_smime_aa_ets_CertificateRefs = "id-smime-aa-ets-CertificateRefs";
pub const NID_id_smime_aa_ets_CertificateRefs = @as(c_int, 232);
pub const OBJ_id_smime_aa_ets_CertificateRefs = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 21);
};
pub const SN_id_smime_aa_ets_RevocationRefs = "id-smime-aa-ets-RevocationRefs";
pub const NID_id_smime_aa_ets_RevocationRefs = @as(c_int, 233);
pub const OBJ_id_smime_aa_ets_RevocationRefs = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 22);
};
pub const SN_id_smime_aa_ets_certValues = "id-smime-aa-ets-certValues";
pub const NID_id_smime_aa_ets_certValues = @as(c_int, 234);
pub const OBJ_id_smime_aa_ets_certValues = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 23);
};
pub const SN_id_smime_aa_ets_revocationValues = "id-smime-aa-ets-revocationValues";
pub const NID_id_smime_aa_ets_revocationValues = @as(c_int, 235);
pub const OBJ_id_smime_aa_ets_revocationValues = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 24);
};
pub const SN_id_smime_aa_ets_escTimeStamp = "id-smime-aa-ets-escTimeStamp";
pub const NID_id_smime_aa_ets_escTimeStamp = @as(c_int, 236);
pub const OBJ_id_smime_aa_ets_escTimeStamp = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 25);
};
pub const SN_id_smime_aa_ets_certCRLTimestamp = "id-smime-aa-ets-certCRLTimestamp";
pub const NID_id_smime_aa_ets_certCRLTimestamp = @as(c_int, 237);
pub const OBJ_id_smime_aa_ets_certCRLTimestamp = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 26);
};
pub const SN_id_smime_aa_ets_archiveTimeStamp = "id-smime-aa-ets-archiveTimeStamp";
pub const NID_id_smime_aa_ets_archiveTimeStamp = @as(c_int, 238);
pub const OBJ_id_smime_aa_ets_archiveTimeStamp = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 27);
};
pub const SN_id_smime_aa_signatureType = "id-smime-aa-signatureType";
pub const NID_id_smime_aa_signatureType = @as(c_int, 239);
pub const OBJ_id_smime_aa_signatureType = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 28);
};
pub const SN_id_smime_aa_dvcs_dvc = "id-smime-aa-dvcs-dvc";
pub const NID_id_smime_aa_dvcs_dvc = @as(c_int, 240);
pub const OBJ_id_smime_aa_dvcs_dvc = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 29);
};
pub const SN_id_smime_alg_ESDHwith3DES = "id-smime-alg-ESDHwith3DES";
pub const NID_id_smime_alg_ESDHwith3DES = @as(c_int, 241);
pub const OBJ_id_smime_alg_ESDHwith3DES = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 1);
};
pub const SN_id_smime_alg_ESDHwithRC2 = "id-smime-alg-ESDHwithRC2";
pub const NID_id_smime_alg_ESDHwithRC2 = @as(c_int, 242);
pub const OBJ_id_smime_alg_ESDHwithRC2 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 2);
};
pub const SN_id_smime_alg_3DESwrap = "id-smime-alg-3DESwrap";
pub const NID_id_smime_alg_3DESwrap = @as(c_int, 243);
pub const OBJ_id_smime_alg_3DESwrap = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 3);
};
pub const SN_id_smime_alg_RC2wrap = "id-smime-alg-RC2wrap";
pub const NID_id_smime_alg_RC2wrap = @as(c_int, 244);
pub const OBJ_id_smime_alg_RC2wrap = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 4);
};
pub const SN_id_smime_alg_ESDH = "id-smime-alg-ESDH";
pub const NID_id_smime_alg_ESDH = @as(c_int, 245);
pub const OBJ_id_smime_alg_ESDH = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 5);
};
pub const SN_id_smime_alg_CMS3DESwrap = "id-smime-alg-CMS3DESwrap";
pub const NID_id_smime_alg_CMS3DESwrap = @as(c_int, 246);
pub const OBJ_id_smime_alg_CMS3DESwrap = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 6);
};
pub const SN_id_smime_alg_CMSRC2wrap = "id-smime-alg-CMSRC2wrap";
pub const NID_id_smime_alg_CMSRC2wrap = @as(c_int, 247);
pub const OBJ_id_smime_alg_CMSRC2wrap = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 7);
};
pub const SN_id_smime_cd_ldap = "id-smime-cd-ldap";
pub const NID_id_smime_cd_ldap = @as(c_int, 248);
pub const OBJ_id_smime_cd_ldap = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 1);
};
pub const SN_id_smime_spq_ets_sqt_uri = "id-smime-spq-ets-sqt-uri";
pub const NID_id_smime_spq_ets_sqt_uri = @as(c_int, 249);
pub const OBJ_id_smime_spq_ets_sqt_uri = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 5);
    break :blk @as(c_long, 1);
};
pub const SN_id_smime_spq_ets_sqt_unotice = "id-smime-spq-ets-sqt-unotice";
pub const NID_id_smime_spq_ets_sqt_unotice = @as(c_int, 250);
pub const OBJ_id_smime_spq_ets_sqt_unotice = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 5);
    break :blk @as(c_long, 2);
};
pub const SN_id_smime_cti_ets_proofOfOrigin = "id-smime-cti-ets-proofOfOrigin";
pub const NID_id_smime_cti_ets_proofOfOrigin = @as(c_int, 251);
pub const OBJ_id_smime_cti_ets_proofOfOrigin = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 6);
    break :blk @as(c_long, 1);
};
pub const SN_id_smime_cti_ets_proofOfReceipt = "id-smime-cti-ets-proofOfReceipt";
pub const NID_id_smime_cti_ets_proofOfReceipt = @as(c_int, 252);
pub const OBJ_id_smime_cti_ets_proofOfReceipt = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 6);
    break :blk @as(c_long, 2);
};
pub const SN_id_smime_cti_ets_proofOfDelivery = "id-smime-cti-ets-proofOfDelivery";
pub const NID_id_smime_cti_ets_proofOfDelivery = @as(c_int, 253);
pub const OBJ_id_smime_cti_ets_proofOfDelivery = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 6);
    break :blk @as(c_long, 3);
};
pub const SN_id_smime_cti_ets_proofOfSender = "id-smime-cti-ets-proofOfSender";
pub const NID_id_smime_cti_ets_proofOfSender = @as(c_int, 254);
pub const OBJ_id_smime_cti_ets_proofOfSender = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 6);
    break :blk @as(c_long, 4);
};
pub const SN_id_smime_cti_ets_proofOfApproval = "id-smime-cti-ets-proofOfApproval";
pub const NID_id_smime_cti_ets_proofOfApproval = @as(c_int, 255);
pub const OBJ_id_smime_cti_ets_proofOfApproval = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 6);
    break :blk @as(c_long, 5);
};
pub const SN_id_smime_cti_ets_proofOfCreation = "id-smime-cti-ets-proofOfCreation";
pub const NID_id_smime_cti_ets_proofOfCreation = @as(c_int, 256);
pub const OBJ_id_smime_cti_ets_proofOfCreation = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 6);
    break :blk @as(c_long, 6);
};
pub const SN_md4 = "MD4";
pub const LN_md4 = "md4";
pub const NID_md4 = @as(c_int, 257);
pub const OBJ_md4 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 4);
};
pub const SN_id_pkix_mod = "id-pkix-mod";
pub const NID_id_pkix_mod = @as(c_int, 258);
pub const OBJ_id_pkix_mod = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 0);
};
pub const SN_id_qt = "id-qt";
pub const NID_id_qt = @as(c_int, 259);
pub const OBJ_id_qt = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 2);
};
pub const SN_id_it = "id-it";
pub const NID_id_it = @as(c_int, 260);
pub const OBJ_id_it = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 4);
};
pub const SN_id_pkip = "id-pkip";
pub const NID_id_pkip = @as(c_int, 261);
pub const OBJ_id_pkip = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 5);
};
pub const SN_id_alg = "id-alg";
pub const NID_id_alg = @as(c_int, 262);
pub const OBJ_id_alg = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 6);
};
pub const SN_id_cmc = "id-cmc";
pub const NID_id_cmc = @as(c_int, 263);
pub const OBJ_id_cmc = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 7);
};
pub const SN_id_on = "id-on";
pub const NID_id_on = @as(c_int, 264);
pub const OBJ_id_on = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 8);
};
pub const SN_id_pda = "id-pda";
pub const NID_id_pda = @as(c_int, 265);
pub const OBJ_id_pda = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 9);
};
pub const SN_id_aca = "id-aca";
pub const NID_id_aca = @as(c_int, 266);
pub const OBJ_id_aca = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 10);
};
pub const SN_id_qcs = "id-qcs";
pub const NID_id_qcs = @as(c_int, 267);
pub const OBJ_id_qcs = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 11);
};
pub const SN_id_cct = "id-cct";
pub const NID_id_cct = @as(c_int, 268);
pub const OBJ_id_cct = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 12);
};
pub const SN_id_pkix1_explicit_88 = "id-pkix1-explicit-88";
pub const NID_id_pkix1_explicit_88 = @as(c_int, 269);
pub const OBJ_id_pkix1_explicit_88 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 1);
};
pub const SN_id_pkix1_implicit_88 = "id-pkix1-implicit-88";
pub const NID_id_pkix1_implicit_88 = @as(c_int, 270);
pub const OBJ_id_pkix1_implicit_88 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 2);
};
pub const SN_id_pkix1_explicit_93 = "id-pkix1-explicit-93";
pub const NID_id_pkix1_explicit_93 = @as(c_int, 271);
pub const OBJ_id_pkix1_explicit_93 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 3);
};
pub const SN_id_pkix1_implicit_93 = "id-pkix1-implicit-93";
pub const NID_id_pkix1_implicit_93 = @as(c_int, 272);
pub const OBJ_id_pkix1_implicit_93 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 4);
};
pub const SN_id_mod_crmf = "id-mod-crmf";
pub const NID_id_mod_crmf = @as(c_int, 273);
pub const OBJ_id_mod_crmf = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 5);
};
pub const SN_id_mod_cmc = "id-mod-cmc";
pub const NID_id_mod_cmc = @as(c_int, 274);
pub const OBJ_id_mod_cmc = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 6);
};
pub const SN_id_mod_kea_profile_88 = "id-mod-kea-profile-88";
pub const NID_id_mod_kea_profile_88 = @as(c_int, 275);
pub const OBJ_id_mod_kea_profile_88 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 7);
};
pub const SN_id_mod_kea_profile_93 = "id-mod-kea-profile-93";
pub const NID_id_mod_kea_profile_93 = @as(c_int, 276);
pub const OBJ_id_mod_kea_profile_93 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 8);
};
pub const SN_id_mod_cmp = "id-mod-cmp";
pub const NID_id_mod_cmp = @as(c_int, 277);
pub const OBJ_id_mod_cmp = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 9);
};
pub const SN_id_mod_qualified_cert_88 = "id-mod-qualified-cert-88";
pub const NID_id_mod_qualified_cert_88 = @as(c_int, 278);
pub const OBJ_id_mod_qualified_cert_88 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 10);
};
pub const SN_id_mod_qualified_cert_93 = "id-mod-qualified-cert-93";
pub const NID_id_mod_qualified_cert_93 = @as(c_int, 279);
pub const OBJ_id_mod_qualified_cert_93 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 11);
};
pub const SN_id_mod_attribute_cert = "id-mod-attribute-cert";
pub const NID_id_mod_attribute_cert = @as(c_int, 280);
pub const OBJ_id_mod_attribute_cert = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 12);
};
pub const SN_id_mod_timestamp_protocol = "id-mod-timestamp-protocol";
pub const NID_id_mod_timestamp_protocol = @as(c_int, 281);
pub const OBJ_id_mod_timestamp_protocol = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 13);
};
pub const SN_id_mod_ocsp = "id-mod-ocsp";
pub const NID_id_mod_ocsp = @as(c_int, 282);
pub const OBJ_id_mod_ocsp = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 14);
};
pub const SN_id_mod_dvcs = "id-mod-dvcs";
pub const NID_id_mod_dvcs = @as(c_int, 283);
pub const OBJ_id_mod_dvcs = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 15);
};
pub const SN_id_mod_cmp2000 = "id-mod-cmp2000";
pub const NID_id_mod_cmp2000 = @as(c_int, 284);
pub const OBJ_id_mod_cmp2000 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 16);
};
pub const SN_biometricInfo = "biometricInfo";
pub const LN_biometricInfo = "Biometric Info";
pub const NID_biometricInfo = @as(c_int, 285);
pub const OBJ_biometricInfo = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 2);
};
pub const SN_qcStatements = "qcStatements";
pub const NID_qcStatements = @as(c_int, 286);
pub const OBJ_qcStatements = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 3);
};
pub const SN_ac_auditEntity = "ac-auditEntity";
pub const NID_ac_auditEntity = @as(c_int, 287);
pub const OBJ_ac_auditEntity = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 4);
};
pub const SN_ac_targeting = "ac-targeting";
pub const NID_ac_targeting = @as(c_int, 288);
pub const OBJ_ac_targeting = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 5);
};
pub const SN_aaControls = "aaControls";
pub const NID_aaControls = @as(c_int, 289);
pub const OBJ_aaControls = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 6);
};
pub const SN_sbgp_ipAddrBlock = "sbgp-ipAddrBlock";
pub const NID_sbgp_ipAddrBlock = @as(c_int, 290);
pub const OBJ_sbgp_ipAddrBlock = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 7);
};
pub const SN_sbgp_autonomousSysNum = "sbgp-autonomousSysNum";
pub const NID_sbgp_autonomousSysNum = @as(c_int, 291);
pub const OBJ_sbgp_autonomousSysNum = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 8);
};
pub const SN_sbgp_routerIdentifier = "sbgp-routerIdentifier";
pub const NID_sbgp_routerIdentifier = @as(c_int, 292);
pub const OBJ_sbgp_routerIdentifier = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 9);
};
pub const SN_textNotice = "textNotice";
pub const NID_textNotice = @as(c_int, 293);
pub const OBJ_textNotice = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 3);
};
pub const SN_ipsecEndSystem = "ipsecEndSystem";
pub const LN_ipsecEndSystem = "IPSec End System";
pub const NID_ipsecEndSystem = @as(c_int, 294);
pub const OBJ_ipsecEndSystem = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 5);
};
pub const SN_ipsecTunnel = "ipsecTunnel";
pub const LN_ipsecTunnel = "IPSec Tunnel";
pub const NID_ipsecTunnel = @as(c_int, 295);
pub const OBJ_ipsecTunnel = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 6);
};
pub const SN_ipsecUser = "ipsecUser";
pub const LN_ipsecUser = "IPSec User";
pub const NID_ipsecUser = @as(c_int, 296);
pub const OBJ_ipsecUser = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 7);
};
pub const SN_dvcs = "DVCS";
pub const LN_dvcs = "dvcs";
pub const NID_dvcs = @as(c_int, 297);
pub const OBJ_dvcs = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 10);
};
pub const SN_id_it_caProtEncCert = "id-it-caProtEncCert";
pub const NID_id_it_caProtEncCert = @as(c_int, 298);
pub const OBJ_id_it_caProtEncCert = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 1);
};
pub const SN_id_it_signKeyPairTypes = "id-it-signKeyPairTypes";
pub const NID_id_it_signKeyPairTypes = @as(c_int, 299);
pub const OBJ_id_it_signKeyPairTypes = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 2);
};
pub const SN_id_it_encKeyPairTypes = "id-it-encKeyPairTypes";
pub const NID_id_it_encKeyPairTypes = @as(c_int, 300);
pub const OBJ_id_it_encKeyPairTypes = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 3);
};
pub const SN_id_it_preferredSymmAlg = "id-it-preferredSymmAlg";
pub const NID_id_it_preferredSymmAlg = @as(c_int, 301);
pub const OBJ_id_it_preferredSymmAlg = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 4);
};
pub const SN_id_it_caKeyUpdateInfo = "id-it-caKeyUpdateInfo";
pub const NID_id_it_caKeyUpdateInfo = @as(c_int, 302);
pub const OBJ_id_it_caKeyUpdateInfo = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 5);
};
pub const SN_id_it_currentCRL = "id-it-currentCRL";
pub const NID_id_it_currentCRL = @as(c_int, 303);
pub const OBJ_id_it_currentCRL = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 6);
};
pub const SN_id_it_unsupportedOIDs = "id-it-unsupportedOIDs";
pub const NID_id_it_unsupportedOIDs = @as(c_int, 304);
pub const OBJ_id_it_unsupportedOIDs = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 7);
};
pub const SN_id_it_subscriptionRequest = "id-it-subscriptionRequest";
pub const NID_id_it_subscriptionRequest = @as(c_int, 305);
pub const OBJ_id_it_subscriptionRequest = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 8);
};
pub const SN_id_it_subscriptionResponse = "id-it-subscriptionResponse";
pub const NID_id_it_subscriptionResponse = @as(c_int, 306);
pub const OBJ_id_it_subscriptionResponse = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 9);
};
pub const SN_id_it_keyPairParamReq = "id-it-keyPairParamReq";
pub const NID_id_it_keyPairParamReq = @as(c_int, 307);
pub const OBJ_id_it_keyPairParamReq = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 10);
};
pub const SN_id_it_keyPairParamRep = "id-it-keyPairParamRep";
pub const NID_id_it_keyPairParamRep = @as(c_int, 308);
pub const OBJ_id_it_keyPairParamRep = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 11);
};
pub const SN_id_it_revPassphrase = "id-it-revPassphrase";
pub const NID_id_it_revPassphrase = @as(c_int, 309);
pub const OBJ_id_it_revPassphrase = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 12);
};
pub const SN_id_it_implicitConfirm = "id-it-implicitConfirm";
pub const NID_id_it_implicitConfirm = @as(c_int, 310);
pub const OBJ_id_it_implicitConfirm = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 13);
};
pub const SN_id_it_confirmWaitTime = "id-it-confirmWaitTime";
pub const NID_id_it_confirmWaitTime = @as(c_int, 311);
pub const OBJ_id_it_confirmWaitTime = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 14);
};
pub const SN_id_it_origPKIMessage = "id-it-origPKIMessage";
pub const NID_id_it_origPKIMessage = @as(c_int, 312);
pub const OBJ_id_it_origPKIMessage = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 15);
};
pub const SN_id_regCtrl = "id-regCtrl";
pub const NID_id_regCtrl = @as(c_int, 313);
pub const OBJ_id_regCtrl = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 5);
    break :blk @as(c_long, 1);
};
pub const SN_id_regInfo = "id-regInfo";
pub const NID_id_regInfo = @as(c_int, 314);
pub const OBJ_id_regInfo = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 5);
    break :blk @as(c_long, 2);
};
pub const SN_id_regCtrl_regToken = "id-regCtrl-regToken";
pub const NID_id_regCtrl_regToken = @as(c_int, 315);
pub const OBJ_id_regCtrl_regToken = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 5);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 1);
};
pub const SN_id_regCtrl_authenticator = "id-regCtrl-authenticator";
pub const NID_id_regCtrl_authenticator = @as(c_int, 316);
pub const OBJ_id_regCtrl_authenticator = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 5);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 2);
};
pub const SN_id_regCtrl_pkiPublicationInfo = "id-regCtrl-pkiPublicationInfo";
pub const NID_id_regCtrl_pkiPublicationInfo = @as(c_int, 317);
pub const OBJ_id_regCtrl_pkiPublicationInfo = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 5);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 3);
};
pub const SN_id_regCtrl_pkiArchiveOptions = "id-regCtrl-pkiArchiveOptions";
pub const NID_id_regCtrl_pkiArchiveOptions = @as(c_int, 318);
pub const OBJ_id_regCtrl_pkiArchiveOptions = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 5);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 4);
};
pub const SN_id_regCtrl_oldCertID = "id-regCtrl-oldCertID";
pub const NID_id_regCtrl_oldCertID = @as(c_int, 319);
pub const OBJ_id_regCtrl_oldCertID = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 5);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 5);
};
pub const SN_id_regCtrl_protocolEncrKey = "id-regCtrl-protocolEncrKey";
pub const NID_id_regCtrl_protocolEncrKey = @as(c_int, 320);
pub const OBJ_id_regCtrl_protocolEncrKey = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 5);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 6);
};
pub const SN_id_regInfo_utf8Pairs = "id-regInfo-utf8Pairs";
pub const NID_id_regInfo_utf8Pairs = @as(c_int, 321);
pub const OBJ_id_regInfo_utf8Pairs = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 5);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 1);
};
pub const SN_id_regInfo_certReq = "id-regInfo-certReq";
pub const NID_id_regInfo_certReq = @as(c_int, 322);
pub const OBJ_id_regInfo_certReq = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 5);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 2);
};
pub const SN_id_alg_des40 = "id-alg-des40";
pub const NID_id_alg_des40 = @as(c_int, 323);
pub const OBJ_id_alg_des40 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 6);
    break :blk @as(c_long, 1);
};
pub const SN_id_alg_noSignature = "id-alg-noSignature";
pub const NID_id_alg_noSignature = @as(c_int, 324);
pub const OBJ_id_alg_noSignature = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 6);
    break :blk @as(c_long, 2);
};
pub const SN_id_alg_dh_sig_hmac_sha1 = "id-alg-dh-sig-hmac-sha1";
pub const NID_id_alg_dh_sig_hmac_sha1 = @as(c_int, 325);
pub const OBJ_id_alg_dh_sig_hmac_sha1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 6);
    break :blk @as(c_long, 3);
};
pub const SN_id_alg_dh_pop = "id-alg-dh-pop";
pub const NID_id_alg_dh_pop = @as(c_int, 326);
pub const OBJ_id_alg_dh_pop = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 6);
    break :blk @as(c_long, 4);
};
pub const SN_id_cmc_statusInfo = "id-cmc-statusInfo";
pub const NID_id_cmc_statusInfo = @as(c_int, 327);
pub const OBJ_id_cmc_statusInfo = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 1);
};
pub const SN_id_cmc_identification = "id-cmc-identification";
pub const NID_id_cmc_identification = @as(c_int, 328);
pub const OBJ_id_cmc_identification = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 2);
};
pub const SN_id_cmc_identityProof = "id-cmc-identityProof";
pub const NID_id_cmc_identityProof = @as(c_int, 329);
pub const OBJ_id_cmc_identityProof = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 3);
};
pub const SN_id_cmc_dataReturn = "id-cmc-dataReturn";
pub const NID_id_cmc_dataReturn = @as(c_int, 330);
pub const OBJ_id_cmc_dataReturn = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 4);
};
pub const SN_id_cmc_transactionId = "id-cmc-transactionId";
pub const NID_id_cmc_transactionId = @as(c_int, 331);
pub const OBJ_id_cmc_transactionId = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 5);
};
pub const SN_id_cmc_senderNonce = "id-cmc-senderNonce";
pub const NID_id_cmc_senderNonce = @as(c_int, 332);
pub const OBJ_id_cmc_senderNonce = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 6);
};
pub const SN_id_cmc_recipientNonce = "id-cmc-recipientNonce";
pub const NID_id_cmc_recipientNonce = @as(c_int, 333);
pub const OBJ_id_cmc_recipientNonce = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 7);
};
pub const SN_id_cmc_addExtensions = "id-cmc-addExtensions";
pub const NID_id_cmc_addExtensions = @as(c_int, 334);
pub const OBJ_id_cmc_addExtensions = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 8);
};
pub const SN_id_cmc_encryptedPOP = "id-cmc-encryptedPOP";
pub const NID_id_cmc_encryptedPOP = @as(c_int, 335);
pub const OBJ_id_cmc_encryptedPOP = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 9);
};
pub const SN_id_cmc_decryptedPOP = "id-cmc-decryptedPOP";
pub const NID_id_cmc_decryptedPOP = @as(c_int, 336);
pub const OBJ_id_cmc_decryptedPOP = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 10);
};
pub const SN_id_cmc_lraPOPWitness = "id-cmc-lraPOPWitness";
pub const NID_id_cmc_lraPOPWitness = @as(c_int, 337);
pub const OBJ_id_cmc_lraPOPWitness = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 11);
};
pub const SN_id_cmc_getCert = "id-cmc-getCert";
pub const NID_id_cmc_getCert = @as(c_int, 338);
pub const OBJ_id_cmc_getCert = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 15);
};
pub const SN_id_cmc_getCRL = "id-cmc-getCRL";
pub const NID_id_cmc_getCRL = @as(c_int, 339);
pub const OBJ_id_cmc_getCRL = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 16);
};
pub const SN_id_cmc_revokeRequest = "id-cmc-revokeRequest";
pub const NID_id_cmc_revokeRequest = @as(c_int, 340);
pub const OBJ_id_cmc_revokeRequest = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 17);
};
pub const SN_id_cmc_regInfo = "id-cmc-regInfo";
pub const NID_id_cmc_regInfo = @as(c_int, 341);
pub const OBJ_id_cmc_regInfo = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 18);
};
pub const SN_id_cmc_responseInfo = "id-cmc-responseInfo";
pub const NID_id_cmc_responseInfo = @as(c_int, 342);
pub const OBJ_id_cmc_responseInfo = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 19);
};
pub const SN_id_cmc_queryPending = "id-cmc-queryPending";
pub const NID_id_cmc_queryPending = @as(c_int, 343);
pub const OBJ_id_cmc_queryPending = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 21);
};
pub const SN_id_cmc_popLinkRandom = "id-cmc-popLinkRandom";
pub const NID_id_cmc_popLinkRandom = @as(c_int, 344);
pub const OBJ_id_cmc_popLinkRandom = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 22);
};
pub const SN_id_cmc_popLinkWitness = "id-cmc-popLinkWitness";
pub const NID_id_cmc_popLinkWitness = @as(c_int, 345);
pub const OBJ_id_cmc_popLinkWitness = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 23);
};
pub const SN_id_cmc_confirmCertAcceptance = "id-cmc-confirmCertAcceptance";
pub const NID_id_cmc_confirmCertAcceptance = @as(c_int, 346);
pub const OBJ_id_cmc_confirmCertAcceptance = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 24);
};
pub const SN_id_on_personalData = "id-on-personalData";
pub const NID_id_on_personalData = @as(c_int, 347);
pub const OBJ_id_on_personalData = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 8);
    break :blk @as(c_long, 1);
};
pub const SN_id_pda_dateOfBirth = "id-pda-dateOfBirth";
pub const NID_id_pda_dateOfBirth = @as(c_int, 348);
pub const OBJ_id_pda_dateOfBirth = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 9);
    break :blk @as(c_long, 1);
};
pub const SN_id_pda_placeOfBirth = "id-pda-placeOfBirth";
pub const NID_id_pda_placeOfBirth = @as(c_int, 349);
pub const OBJ_id_pda_placeOfBirth = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 9);
    break :blk @as(c_long, 2);
};
pub const SN_id_pda_gender = "id-pda-gender";
pub const NID_id_pda_gender = @as(c_int, 351);
pub const OBJ_id_pda_gender = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 9);
    break :blk @as(c_long, 3);
};
pub const SN_id_pda_countryOfCitizenship = "id-pda-countryOfCitizenship";
pub const NID_id_pda_countryOfCitizenship = @as(c_int, 352);
pub const OBJ_id_pda_countryOfCitizenship = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 9);
    break :blk @as(c_long, 4);
};
pub const SN_id_pda_countryOfResidence = "id-pda-countryOfResidence";
pub const NID_id_pda_countryOfResidence = @as(c_int, 353);
pub const OBJ_id_pda_countryOfResidence = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 9);
    break :blk @as(c_long, 5);
};
pub const SN_id_aca_authenticationInfo = "id-aca-authenticationInfo";
pub const NID_id_aca_authenticationInfo = @as(c_int, 354);
pub const OBJ_id_aca_authenticationInfo = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 10);
    break :blk @as(c_long, 1);
};
pub const SN_id_aca_accessIdentity = "id-aca-accessIdentity";
pub const NID_id_aca_accessIdentity = @as(c_int, 355);
pub const OBJ_id_aca_accessIdentity = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 10);
    break :blk @as(c_long, 2);
};
pub const SN_id_aca_chargingIdentity = "id-aca-chargingIdentity";
pub const NID_id_aca_chargingIdentity = @as(c_int, 356);
pub const OBJ_id_aca_chargingIdentity = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 10);
    break :blk @as(c_long, 3);
};
pub const SN_id_aca_group = "id-aca-group";
pub const NID_id_aca_group = @as(c_int, 357);
pub const OBJ_id_aca_group = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 10);
    break :blk @as(c_long, 4);
};
pub const SN_id_aca_role = "id-aca-role";
pub const NID_id_aca_role = @as(c_int, 358);
pub const OBJ_id_aca_role = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 10);
    break :blk @as(c_long, 5);
};
pub const SN_id_qcs_pkixQCSyntax_v1 = "id-qcs-pkixQCSyntax-v1";
pub const NID_id_qcs_pkixQCSyntax_v1 = @as(c_int, 359);
pub const OBJ_id_qcs_pkixQCSyntax_v1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 11);
    break :blk @as(c_long, 1);
};
pub const SN_id_cct_crs = "id-cct-crs";
pub const NID_id_cct_crs = @as(c_int, 360);
pub const OBJ_id_cct_crs = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 12);
    break :blk @as(c_long, 1);
};
pub const SN_id_cct_PKIData = "id-cct-PKIData";
pub const NID_id_cct_PKIData = @as(c_int, 361);
pub const OBJ_id_cct_PKIData = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 12);
    break :blk @as(c_long, 2);
};
pub const SN_id_cct_PKIResponse = "id-cct-PKIResponse";
pub const NID_id_cct_PKIResponse = @as(c_int, 362);
pub const OBJ_id_cct_PKIResponse = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 12);
    break :blk @as(c_long, 3);
};
pub const SN_ad_timeStamping = "ad_timestamping";
pub const LN_ad_timeStamping = "AD Time Stamping";
pub const NID_ad_timeStamping = @as(c_int, 363);
pub const OBJ_ad_timeStamping = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 48);
    break :blk @as(c_long, 3);
};
pub const SN_ad_dvcs = "AD_DVCS";
pub const LN_ad_dvcs = "ad dvcs";
pub const NID_ad_dvcs = @as(c_int, 364);
pub const OBJ_ad_dvcs = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 48);
    break :blk @as(c_long, 4);
};
pub const SN_id_pkix_OCSP_basic = "basicOCSPResponse";
pub const LN_id_pkix_OCSP_basic = "Basic OCSP Response";
pub const NID_id_pkix_OCSP_basic = @as(c_int, 365);
pub const OBJ_id_pkix_OCSP_basic = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 48);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 1);
};
pub const SN_id_pkix_OCSP_Nonce = "Nonce";
pub const LN_id_pkix_OCSP_Nonce = "OCSP Nonce";
pub const NID_id_pkix_OCSP_Nonce = @as(c_int, 366);
pub const OBJ_id_pkix_OCSP_Nonce = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 48);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 2);
};
pub const SN_id_pkix_OCSP_CrlID = "CrlID";
pub const LN_id_pkix_OCSP_CrlID = "OCSP CRL ID";
pub const NID_id_pkix_OCSP_CrlID = @as(c_int, 367);
pub const OBJ_id_pkix_OCSP_CrlID = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 48);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 3);
};
pub const SN_id_pkix_OCSP_acceptableResponses = "acceptableResponses";
pub const LN_id_pkix_OCSP_acceptableResponses = "Acceptable OCSP Responses";
pub const NID_id_pkix_OCSP_acceptableResponses = @as(c_int, 368);
pub const OBJ_id_pkix_OCSP_acceptableResponses = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 48);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 4);
};
pub const SN_id_pkix_OCSP_noCheck = "noCheck";
pub const LN_id_pkix_OCSP_noCheck = "OCSP No Check";
pub const NID_id_pkix_OCSP_noCheck = @as(c_int, 369);
pub const OBJ_id_pkix_OCSP_noCheck = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 48);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 5);
};
pub const SN_id_pkix_OCSP_archiveCutoff = "archiveCutoff";
pub const LN_id_pkix_OCSP_archiveCutoff = "OCSP Archive Cutoff";
pub const NID_id_pkix_OCSP_archiveCutoff = @as(c_int, 370);
pub const OBJ_id_pkix_OCSP_archiveCutoff = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 48);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 6);
};
pub const SN_id_pkix_OCSP_serviceLocator = "serviceLocator";
pub const LN_id_pkix_OCSP_serviceLocator = "OCSP Service Locator";
pub const NID_id_pkix_OCSP_serviceLocator = @as(c_int, 371);
pub const OBJ_id_pkix_OCSP_serviceLocator = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 48);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 7);
};
pub const SN_id_pkix_OCSP_extendedStatus = "extendedStatus";
pub const LN_id_pkix_OCSP_extendedStatus = "Extended OCSP Status";
pub const NID_id_pkix_OCSP_extendedStatus = @as(c_int, 372);
pub const OBJ_id_pkix_OCSP_extendedStatus = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 48);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 8);
};
pub const SN_id_pkix_OCSP_valid = "valid";
pub const NID_id_pkix_OCSP_valid = @as(c_int, 373);
pub const OBJ_id_pkix_OCSP_valid = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 48);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 9);
};
pub const SN_id_pkix_OCSP_path = "path";
pub const NID_id_pkix_OCSP_path = @as(c_int, 374);
pub const OBJ_id_pkix_OCSP_path = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 48);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 10);
};
pub const SN_id_pkix_OCSP_trustRoot = "trustRoot";
pub const LN_id_pkix_OCSP_trustRoot = "Trust Root";
pub const NID_id_pkix_OCSP_trustRoot = @as(c_int, 375);
pub const OBJ_id_pkix_OCSP_trustRoot = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 48);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 11);
};
pub const SN_algorithm = "algorithm";
pub const LN_algorithm = "algorithm";
pub const NID_algorithm = @as(c_int, 376);
pub const OBJ_algorithm = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 14);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 2);
};
pub const SN_rsaSignature = "rsaSignature";
pub const NID_rsaSignature = @as(c_int, 377);
pub const OBJ_rsaSignature = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 14);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 11);
};
pub const SN_X500algorithms = "X500algorithms";
pub const LN_X500algorithms = "directory services - algorithms";
pub const NID_X500algorithms = @as(c_int, 378);
pub const OBJ_X500algorithms = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    break :blk @as(c_long, 8);
};
pub const SN_org = "ORG";
pub const LN_org = "org";
pub const NID_org = @as(c_int, 379);
pub const OBJ_org = blk: {
    _ = @as(c_long, 1);
    break :blk @as(c_long, 3);
};
pub const SN_dod = "DOD";
pub const LN_dod = "dod";
pub const NID_dod = @as(c_int, 380);
pub const OBJ_dod = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 6);
};
pub const SN_iana = "IANA";
pub const LN_iana = "iana";
pub const NID_iana = @as(c_int, 381);
pub const OBJ_iana = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    break :blk @as(c_long, 1);
};
pub const SN_Directory = "directory";
pub const LN_Directory = "Directory";
pub const NID_Directory = @as(c_int, 382);
pub const OBJ_Directory = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 1);
};
pub const SN_Management = "mgmt";
pub const LN_Management = "Management";
pub const NID_Management = @as(c_int, 383);
pub const OBJ_Management = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 2);
};
pub const SN_Experimental = "experimental";
pub const LN_Experimental = "Experimental";
pub const NID_Experimental = @as(c_int, 384);
pub const OBJ_Experimental = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 3);
};
pub const SN_Private = "private";
pub const LN_Private = "Private";
pub const NID_Private = @as(c_int, 385);
pub const OBJ_Private = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 4);
};
pub const SN_Security = "security";
pub const LN_Security = "Security";
pub const NID_Security = @as(c_int, 386);
pub const OBJ_Security = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 5);
};
pub const SN_SNMPv2 = "snmpv2";
pub const LN_SNMPv2 = "SNMPv2";
pub const NID_SNMPv2 = @as(c_int, 387);
pub const OBJ_SNMPv2 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 6);
};
pub const LN_Mail = "Mail";
pub const NID_Mail = @as(c_int, 388);
pub const OBJ_Mail = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 7);
};
pub const SN_Enterprises = "enterprises";
pub const LN_Enterprises = "Enterprises";
pub const NID_Enterprises = @as(c_int, 389);
pub const OBJ_Enterprises = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 1);
};
pub const SN_dcObject = "dcobject";
pub const LN_dcObject = "dcObject";
pub const NID_dcObject = @as(c_int, 390);
pub const OBJ_dcObject = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1466);
    break :blk @as(c_long, 344);
};
pub const SN_domainComponent = "DC";
pub const LN_domainComponent = "domainComponent";
pub const NID_domainComponent = @as(c_int, 391);
pub const OBJ_domainComponent = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 25);
};
pub const SN_Domain = "domain";
pub const LN_Domain = "Domain";
pub const NID_Domain = @as(c_int, 392);
pub const OBJ_Domain = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 13);
};
pub const SN_selected_attribute_types = "selected-attribute-types";
pub const LN_selected_attribute_types = "Selected Attribute Types";
pub const NID_selected_attribute_types = @as(c_int, 394);
pub const OBJ_selected_attribute_types = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 5);
};
pub const SN_clearance = "clearance";
pub const NID_clearance = @as(c_int, 395);
pub const OBJ_clearance = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    break :blk @as(c_long, 55);
};
pub const SN_md4WithRSAEncryption = "RSA-MD4";
pub const LN_md4WithRSAEncryption = "md4WithRSAEncryption";
pub const NID_md4WithRSAEncryption = @as(c_int, 396);
pub const OBJ_md4WithRSAEncryption = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 3);
};
pub const SN_ac_proxying = "ac-proxying";
pub const NID_ac_proxying = @as(c_int, 397);
pub const OBJ_ac_proxying = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 10);
};
pub const SN_sinfo_access = "subjectInfoAccess";
pub const LN_sinfo_access = "Subject Information Access";
pub const NID_sinfo_access = @as(c_int, 398);
pub const OBJ_sinfo_access = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 11);
};
pub const SN_id_aca_encAttrs = "id-aca-encAttrs";
pub const NID_id_aca_encAttrs = @as(c_int, 399);
pub const OBJ_id_aca_encAttrs = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 10);
    break :blk @as(c_long, 6);
};
pub const SN_role = "role";
pub const LN_role = "role";
pub const NID_role = @as(c_int, 400);
pub const OBJ_role = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 72);
};
pub const SN_policy_constraints = "policyConstraints";
pub const LN_policy_constraints = "X509v3 Policy Constraints";
pub const NID_policy_constraints = @as(c_int, 401);
pub const OBJ_policy_constraints = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 29);
    break :blk @as(c_long, 36);
};
pub const SN_target_information = "targetInformation";
pub const LN_target_information = "X509v3 AC Targeting";
pub const NID_target_information = @as(c_int, 402);
pub const OBJ_target_information = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 29);
    break :blk @as(c_long, 55);
};
pub const SN_no_rev_avail = "noRevAvail";
pub const LN_no_rev_avail = "X509v3 No Revocation Available";
pub const NID_no_rev_avail = @as(c_int, 403);
pub const OBJ_no_rev_avail = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 29);
    break :blk @as(c_long, 56);
};
pub const SN_ansi_X9_62 = "ansi-X9-62";
pub const LN_ansi_X9_62 = "ANSI X9.62";
pub const NID_ansi_X9_62 = @as(c_int, 405);
pub const OBJ_ansi_X9_62 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    break :blk @as(c_long, 10045);
};
pub const SN_X9_62_prime_field = "prime-field";
pub const NID_X9_62_prime_field = @as(c_int, 406);
pub const OBJ_X9_62_prime_field = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 1);
};
pub const SN_X9_62_characteristic_two_field = "characteristic-two-field";
pub const NID_X9_62_characteristic_two_field = @as(c_int, 407);
pub const OBJ_X9_62_characteristic_two_field = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 2);
};
pub const SN_X9_62_id_ecPublicKey = "id-ecPublicKey";
pub const NID_X9_62_id_ecPublicKey = @as(c_int, 408);
pub const OBJ_X9_62_id_ecPublicKey = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 1);
};
pub const SN_X9_62_prime192v1 = "prime192v1";
pub const NID_X9_62_prime192v1 = @as(c_int, 409);
pub const OBJ_X9_62_prime192v1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 3);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 1);
};
pub const SN_X9_62_prime192v2 = "prime192v2";
pub const NID_X9_62_prime192v2 = @as(c_int, 410);
pub const OBJ_X9_62_prime192v2 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 3);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 2);
};
pub const SN_X9_62_prime192v3 = "prime192v3";
pub const NID_X9_62_prime192v3 = @as(c_int, 411);
pub const OBJ_X9_62_prime192v3 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 3);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 3);
};
pub const SN_X9_62_prime239v1 = "prime239v1";
pub const NID_X9_62_prime239v1 = @as(c_int, 412);
pub const OBJ_X9_62_prime239v1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 3);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 4);
};
pub const SN_X9_62_prime239v2 = "prime239v2";
pub const NID_X9_62_prime239v2 = @as(c_int, 413);
pub const OBJ_X9_62_prime239v2 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 3);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 5);
};
pub const SN_X9_62_prime239v3 = "prime239v3";
pub const NID_X9_62_prime239v3 = @as(c_int, 414);
pub const OBJ_X9_62_prime239v3 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 3);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 6);
};
pub const SN_X9_62_prime256v1 = "prime256v1";
pub const NID_X9_62_prime256v1 = @as(c_int, 415);
pub const OBJ_X9_62_prime256v1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 3);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 7);
};
pub const SN_ecdsa_with_SHA1 = "ecdsa-with-SHA1";
pub const NID_ecdsa_with_SHA1 = @as(c_int, 416);
pub const OBJ_ecdsa_with_SHA1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 1);
};
pub const SN_ms_csp_name = "CSPName";
pub const LN_ms_csp_name = "Microsoft CSP Name";
pub const NID_ms_csp_name = @as(c_int, 417);
pub const OBJ_ms_csp_name = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    _ = @as(c_long, 311);
    _ = @as(c_long, 17);
    break :blk @as(c_long, 1);
};
pub const SN_aes_128_ecb = "AES-128-ECB";
pub const LN_aes_128_ecb = "aes-128-ecb";
pub const NID_aes_128_ecb = @as(c_int, 418);
pub const OBJ_aes_128_ecb = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 1);
};
pub const SN_aes_128_cbc = "AES-128-CBC";
pub const LN_aes_128_cbc = "aes-128-cbc";
pub const NID_aes_128_cbc = @as(c_int, 419);
pub const OBJ_aes_128_cbc = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 2);
};
pub const SN_aes_128_ofb128 = "AES-128-OFB";
pub const LN_aes_128_ofb128 = "aes-128-ofb";
pub const NID_aes_128_ofb128 = @as(c_int, 420);
pub const OBJ_aes_128_ofb128 = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 3);
};
pub const SN_aes_128_cfb128 = "AES-128-CFB";
pub const LN_aes_128_cfb128 = "aes-128-cfb";
pub const NID_aes_128_cfb128 = @as(c_int, 421);
pub const OBJ_aes_128_cfb128 = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 4);
};
pub const SN_aes_192_ecb = "AES-192-ECB";
pub const LN_aes_192_ecb = "aes-192-ecb";
pub const NID_aes_192_ecb = @as(c_int, 422);
pub const OBJ_aes_192_ecb = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 21);
};
pub const SN_aes_192_cbc = "AES-192-CBC";
pub const LN_aes_192_cbc = "aes-192-cbc";
pub const NID_aes_192_cbc = @as(c_int, 423);
pub const OBJ_aes_192_cbc = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 22);
};
pub const SN_aes_192_ofb128 = "AES-192-OFB";
pub const LN_aes_192_ofb128 = "aes-192-ofb";
pub const NID_aes_192_ofb128 = @as(c_int, 424);
pub const OBJ_aes_192_ofb128 = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 23);
};
pub const SN_aes_192_cfb128 = "AES-192-CFB";
pub const LN_aes_192_cfb128 = "aes-192-cfb";
pub const NID_aes_192_cfb128 = @as(c_int, 425);
pub const OBJ_aes_192_cfb128 = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 24);
};
pub const SN_aes_256_ecb = "AES-256-ECB";
pub const LN_aes_256_ecb = "aes-256-ecb";
pub const NID_aes_256_ecb = @as(c_int, 426);
pub const OBJ_aes_256_ecb = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 41);
};
pub const SN_aes_256_cbc = "AES-256-CBC";
pub const LN_aes_256_cbc = "aes-256-cbc";
pub const NID_aes_256_cbc = @as(c_int, 427);
pub const OBJ_aes_256_cbc = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 42);
};
pub const SN_aes_256_ofb128 = "AES-256-OFB";
pub const LN_aes_256_ofb128 = "aes-256-ofb";
pub const NID_aes_256_ofb128 = @as(c_int, 428);
pub const OBJ_aes_256_ofb128 = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 43);
};
pub const SN_aes_256_cfb128 = "AES-256-CFB";
pub const LN_aes_256_cfb128 = "aes-256-cfb";
pub const NID_aes_256_cfb128 = @as(c_int, 429);
pub const OBJ_aes_256_cfb128 = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 44);
};
pub const SN_hold_instruction_code = "holdInstructionCode";
pub const LN_hold_instruction_code = "Hold Instruction Code";
pub const NID_hold_instruction_code = @as(c_int, 430);
pub const OBJ_hold_instruction_code = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 29);
    break :blk @as(c_long, 23);
};
pub const SN_hold_instruction_none = "holdInstructionNone";
pub const LN_hold_instruction_none = "Hold Instruction None";
pub const NID_hold_instruction_none = @as(c_int, 431);
pub const OBJ_hold_instruction_none = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10040);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 1);
};
pub const SN_hold_instruction_call_issuer = "holdInstructionCallIssuer";
pub const LN_hold_instruction_call_issuer = "Hold Instruction Call Issuer";
pub const NID_hold_instruction_call_issuer = @as(c_int, 432);
pub const OBJ_hold_instruction_call_issuer = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10040);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 2);
};
pub const SN_hold_instruction_reject = "holdInstructionReject";
pub const LN_hold_instruction_reject = "Hold Instruction Reject";
pub const NID_hold_instruction_reject = @as(c_int, 433);
pub const OBJ_hold_instruction_reject = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10040);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 3);
};
pub const SN_data = "data";
pub const NID_data = @as(c_int, 434);
pub const OBJ_data = blk: {
    _ = @as(c_long, 0);
    break :blk @as(c_long, 9);
};
pub const SN_pss = "pss";
pub const NID_pss = @as(c_int, 435);
pub const OBJ_pss = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    break :blk @as(c_long, 2342);
};
pub const SN_ucl = "ucl";
pub const NID_ucl = @as(c_int, 436);
pub const OBJ_ucl = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    break :blk @as(c_long, 19200300);
};
pub const SN_pilot = "pilot";
pub const NID_pilot = @as(c_int, 437);
pub const OBJ_pilot = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    break :blk @as(c_long, 100);
};
pub const LN_pilotAttributeType = "pilotAttributeType";
pub const NID_pilotAttributeType = @as(c_int, 438);
pub const OBJ_pilotAttributeType = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    break :blk @as(c_long, 1);
};
pub const LN_pilotAttributeSyntax = "pilotAttributeSyntax";
pub const NID_pilotAttributeSyntax = @as(c_int, 439);
pub const OBJ_pilotAttributeSyntax = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    break :blk @as(c_long, 3);
};
pub const LN_pilotObjectClass = "pilotObjectClass";
pub const NID_pilotObjectClass = @as(c_int, 440);
pub const OBJ_pilotObjectClass = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    break :blk @as(c_long, 4);
};
pub const LN_pilotGroups = "pilotGroups";
pub const NID_pilotGroups = @as(c_int, 441);
pub const OBJ_pilotGroups = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    break :blk @as(c_long, 10);
};
pub const LN_iA5StringSyntax = "iA5StringSyntax";
pub const NID_iA5StringSyntax = @as(c_int, 442);
pub const OBJ_iA5StringSyntax = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 4);
};
pub const LN_caseIgnoreIA5StringSyntax = "caseIgnoreIA5StringSyntax";
pub const NID_caseIgnoreIA5StringSyntax = @as(c_int, 443);
pub const OBJ_caseIgnoreIA5StringSyntax = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 5);
};
pub const LN_pilotObject = "pilotObject";
pub const NID_pilotObject = @as(c_int, 444);
pub const OBJ_pilotObject = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 3);
};
pub const LN_pilotPerson = "pilotPerson";
pub const NID_pilotPerson = @as(c_int, 445);
pub const OBJ_pilotPerson = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 4);
};
pub const SN_account = "account";
pub const NID_account = @as(c_int, 446);
pub const OBJ_account = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 5);
};
pub const SN_document = "document";
pub const NID_document = @as(c_int, 447);
pub const OBJ_document = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 6);
};
pub const SN_room = "room";
pub const NID_room = @as(c_int, 448);
pub const OBJ_room = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 7);
};
pub const LN_documentSeries = "documentSeries";
pub const NID_documentSeries = @as(c_int, 449);
pub const OBJ_documentSeries = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 9);
};
pub const LN_rFC822localPart = "rFC822localPart";
pub const NID_rFC822localPart = @as(c_int, 450);
pub const OBJ_rFC822localPart = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 14);
};
pub const LN_dNSDomain = "dNSDomain";
pub const NID_dNSDomain = @as(c_int, 451);
pub const OBJ_dNSDomain = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 15);
};
pub const LN_domainRelatedObject = "domainRelatedObject";
pub const NID_domainRelatedObject = @as(c_int, 452);
pub const OBJ_domainRelatedObject = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 17);
};
pub const LN_friendlyCountry = "friendlyCountry";
pub const NID_friendlyCountry = @as(c_int, 453);
pub const OBJ_friendlyCountry = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 18);
};
pub const LN_simpleSecurityObject = "simpleSecurityObject";
pub const NID_simpleSecurityObject = @as(c_int, 454);
pub const OBJ_simpleSecurityObject = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 19);
};
pub const LN_pilotOrganization = "pilotOrganization";
pub const NID_pilotOrganization = @as(c_int, 455);
pub const OBJ_pilotOrganization = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 20);
};
pub const LN_pilotDSA = "pilotDSA";
pub const NID_pilotDSA = @as(c_int, 456);
pub const OBJ_pilotDSA = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 21);
};
pub const LN_qualityLabelledData = "qualityLabelledData";
pub const NID_qualityLabelledData = @as(c_int, 457);
pub const OBJ_qualityLabelledData = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 22);
};
pub const SN_userId = "UID";
pub const LN_userId = "userId";
pub const NID_userId = @as(c_int, 458);
pub const OBJ_userId = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 1);
};
pub const LN_textEncodedORAddress = "textEncodedORAddress";
pub const NID_textEncodedORAddress = @as(c_int, 459);
pub const OBJ_textEncodedORAddress = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 2);
};
pub const SN_rfc822Mailbox = "mail";
pub const LN_rfc822Mailbox = "rfc822Mailbox";
pub const NID_rfc822Mailbox = @as(c_int, 460);
pub const OBJ_rfc822Mailbox = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 3);
};
pub const SN_info = "info";
pub const NID_info = @as(c_int, 461);
pub const OBJ_info = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 4);
};
pub const LN_favouriteDrink = "favouriteDrink";
pub const NID_favouriteDrink = @as(c_int, 462);
pub const OBJ_favouriteDrink = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 5);
};
pub const LN_roomNumber = "roomNumber";
pub const NID_roomNumber = @as(c_int, 463);
pub const OBJ_roomNumber = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 6);
};
pub const SN_photo = "photo";
pub const NID_photo = @as(c_int, 464);
pub const OBJ_photo = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 7);
};
pub const LN_userClass = "userClass";
pub const NID_userClass = @as(c_int, 465);
pub const OBJ_userClass = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 8);
};
pub const SN_host = "host";
pub const NID_host = @as(c_int, 466);
pub const OBJ_host = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 9);
};
pub const SN_manager = "manager";
pub const NID_manager = @as(c_int, 467);
pub const OBJ_manager = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 10);
};
pub const LN_documentIdentifier = "documentIdentifier";
pub const NID_documentIdentifier = @as(c_int, 468);
pub const OBJ_documentIdentifier = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 11);
};
pub const LN_documentTitle = "documentTitle";
pub const NID_documentTitle = @as(c_int, 469);
pub const OBJ_documentTitle = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 12);
};
pub const LN_documentVersion = "documentVersion";
pub const NID_documentVersion = @as(c_int, 470);
pub const OBJ_documentVersion = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 13);
};
pub const LN_documentAuthor = "documentAuthor";
pub const NID_documentAuthor = @as(c_int, 471);
pub const OBJ_documentAuthor = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 14);
};
pub const LN_documentLocation = "documentLocation";
pub const NID_documentLocation = @as(c_int, 472);
pub const OBJ_documentLocation = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 15);
};
pub const LN_homeTelephoneNumber = "homeTelephoneNumber";
pub const NID_homeTelephoneNumber = @as(c_int, 473);
pub const OBJ_homeTelephoneNumber = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 20);
};
pub const SN_secretary = "secretary";
pub const NID_secretary = @as(c_int, 474);
pub const OBJ_secretary = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 21);
};
pub const LN_otherMailbox = "otherMailbox";
pub const NID_otherMailbox = @as(c_int, 475);
pub const OBJ_otherMailbox = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 22);
};
pub const LN_lastModifiedTime = "lastModifiedTime";
pub const NID_lastModifiedTime = @as(c_int, 476);
pub const OBJ_lastModifiedTime = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 23);
};
pub const LN_lastModifiedBy = "lastModifiedBy";
pub const NID_lastModifiedBy = @as(c_int, 477);
pub const OBJ_lastModifiedBy = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 24);
};
pub const LN_aRecord = "aRecord";
pub const NID_aRecord = @as(c_int, 478);
pub const OBJ_aRecord = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 26);
};
pub const LN_pilotAttributeType27 = "pilotAttributeType27";
pub const NID_pilotAttributeType27 = @as(c_int, 479);
pub const OBJ_pilotAttributeType27 = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 27);
};
pub const LN_mXRecord = "mXRecord";
pub const NID_mXRecord = @as(c_int, 480);
pub const OBJ_mXRecord = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 28);
};
pub const LN_nSRecord = "nSRecord";
pub const NID_nSRecord = @as(c_int, 481);
pub const OBJ_nSRecord = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 29);
};
pub const LN_sOARecord = "sOARecord";
pub const NID_sOARecord = @as(c_int, 482);
pub const OBJ_sOARecord = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 30);
};
pub const LN_cNAMERecord = "cNAMERecord";
pub const NID_cNAMERecord = @as(c_int, 483);
pub const OBJ_cNAMERecord = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 31);
};
pub const LN_associatedDomain = "associatedDomain";
pub const NID_associatedDomain = @as(c_int, 484);
pub const OBJ_associatedDomain = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 37);
};
pub const LN_associatedName = "associatedName";
pub const NID_associatedName = @as(c_int, 485);
pub const OBJ_associatedName = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 38);
};
pub const LN_homePostalAddress = "homePostalAddress";
pub const NID_homePostalAddress = @as(c_int, 486);
pub const OBJ_homePostalAddress = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 39);
};
pub const LN_personalTitle = "personalTitle";
pub const NID_personalTitle = @as(c_int, 487);
pub const OBJ_personalTitle = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 40);
};
pub const LN_mobileTelephoneNumber = "mobileTelephoneNumber";
pub const NID_mobileTelephoneNumber = @as(c_int, 488);
pub const OBJ_mobileTelephoneNumber = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 41);
};
pub const LN_pagerTelephoneNumber = "pagerTelephoneNumber";
pub const NID_pagerTelephoneNumber = @as(c_int, 489);
pub const OBJ_pagerTelephoneNumber = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 42);
};
pub const LN_friendlyCountryName = "friendlyCountryName";
pub const NID_friendlyCountryName = @as(c_int, 490);
pub const OBJ_friendlyCountryName = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 43);
};
pub const LN_organizationalStatus = "organizationalStatus";
pub const NID_organizationalStatus = @as(c_int, 491);
pub const OBJ_organizationalStatus = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 45);
};
pub const LN_janetMailbox = "janetMailbox";
pub const NID_janetMailbox = @as(c_int, 492);
pub const OBJ_janetMailbox = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 46);
};
pub const LN_mailPreferenceOption = "mailPreferenceOption";
pub const NID_mailPreferenceOption = @as(c_int, 493);
pub const OBJ_mailPreferenceOption = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 47);
};
pub const LN_buildingName = "buildingName";
pub const NID_buildingName = @as(c_int, 494);
pub const OBJ_buildingName = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 48);
};
pub const LN_dSAQuality = "dSAQuality";
pub const NID_dSAQuality = @as(c_int, 495);
pub const OBJ_dSAQuality = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 49);
};
pub const LN_singleLevelQuality = "singleLevelQuality";
pub const NID_singleLevelQuality = @as(c_int, 496);
pub const OBJ_singleLevelQuality = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 50);
};
pub const LN_subtreeMinimumQuality = "subtreeMinimumQuality";
pub const NID_subtreeMinimumQuality = @as(c_int, 497);
pub const OBJ_subtreeMinimumQuality = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 51);
};
pub const LN_subtreeMaximumQuality = "subtreeMaximumQuality";
pub const NID_subtreeMaximumQuality = @as(c_int, 498);
pub const OBJ_subtreeMaximumQuality = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 52);
};
pub const LN_personalSignature = "personalSignature";
pub const NID_personalSignature = @as(c_int, 499);
pub const OBJ_personalSignature = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 53);
};
pub const LN_dITRedirect = "dITRedirect";
pub const NID_dITRedirect = @as(c_int, 500);
pub const OBJ_dITRedirect = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 54);
};
pub const SN_audio = "audio";
pub const NID_audio = @as(c_int, 501);
pub const OBJ_audio = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 55);
};
pub const LN_documentPublisher = "documentPublisher";
pub const NID_documentPublisher = @as(c_int, 502);
pub const OBJ_documentPublisher = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 9);
    _ = @as(c_long, 2342);
    _ = @as(c_long, 19200300);
    _ = @as(c_long, 100);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 56);
};
pub const LN_x500UniqueIdentifier = "x500UniqueIdentifier";
pub const NID_x500UniqueIdentifier = @as(c_int, 503);
pub const OBJ_x500UniqueIdentifier = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 45);
};
pub const SN_mime_mhs = "mime-mhs";
pub const LN_mime_mhs = "MIME MHS";
pub const NID_mime_mhs = @as(c_int, 504);
pub const OBJ_mime_mhs = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 1);
};
pub const SN_mime_mhs_headings = "mime-mhs-headings";
pub const LN_mime_mhs_headings = "mime-mhs-headings";
pub const NID_mime_mhs_headings = @as(c_int, 505);
pub const OBJ_mime_mhs_headings = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 7);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 1);
};
pub const SN_mime_mhs_bodies = "mime-mhs-bodies";
pub const LN_mime_mhs_bodies = "mime-mhs-bodies";
pub const NID_mime_mhs_bodies = @as(c_int, 506);
pub const OBJ_mime_mhs_bodies = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 7);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 2);
};
pub const SN_id_hex_partial_message = "id-hex-partial-message";
pub const LN_id_hex_partial_message = "id-hex-partial-message";
pub const NID_id_hex_partial_message = @as(c_int, 507);
pub const OBJ_id_hex_partial_message = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 7);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 1);
};
pub const SN_id_hex_multipart_message = "id-hex-multipart-message";
pub const LN_id_hex_multipart_message = "id-hex-multipart-message";
pub const NID_id_hex_multipart_message = @as(c_int, 508);
pub const OBJ_id_hex_multipart_message = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 7);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 2);
};
pub const LN_generationQualifier = "generationQualifier";
pub const NID_generationQualifier = @as(c_int, 509);
pub const OBJ_generationQualifier = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 44);
};
pub const LN_pseudonym = "pseudonym";
pub const NID_pseudonym = @as(c_int, 510);
pub const OBJ_pseudonym = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 65);
};
pub const SN_id_set = "id-set";
pub const LN_id_set = "Secure Electronic Transactions";
pub const NID_id_set = @as(c_int, 512);
pub const OBJ_id_set = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    break :blk @as(c_long, 42);
};
pub const SN_set_ctype = "set-ctype";
pub const LN_set_ctype = "content types";
pub const NID_set_ctype = @as(c_int, 513);
pub const OBJ_set_ctype = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    break :blk @as(c_long, 0);
};
pub const SN_set_msgExt = "set-msgExt";
pub const LN_set_msgExt = "message extensions";
pub const NID_set_msgExt = @as(c_int, 514);
pub const OBJ_set_msgExt = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    break :blk @as(c_long, 1);
};
pub const SN_set_attr = "set-attr";
pub const NID_set_attr = @as(c_int, 515);
pub const OBJ_set_attr = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    break :blk @as(c_long, 3);
};
pub const SN_set_policy = "set-policy";
pub const NID_set_policy = @as(c_int, 516);
pub const OBJ_set_policy = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    break :blk @as(c_long, 5);
};
pub const SN_set_certExt = "set-certExt";
pub const LN_set_certExt = "certificate extensions";
pub const NID_set_certExt = @as(c_int, 517);
pub const OBJ_set_certExt = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    break :blk @as(c_long, 7);
};
pub const SN_set_brand = "set-brand";
pub const NID_set_brand = @as(c_int, 518);
pub const OBJ_set_brand = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    break :blk @as(c_long, 8);
};
pub const SN_setct_PANData = "setct-PANData";
pub const NID_setct_PANData = @as(c_int, 519);
pub const OBJ_setct_PANData = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 0);
};
pub const SN_setct_PANToken = "setct-PANToken";
pub const NID_setct_PANToken = @as(c_int, 520);
pub const OBJ_setct_PANToken = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 1);
};
pub const SN_setct_PANOnly = "setct-PANOnly";
pub const NID_setct_PANOnly = @as(c_int, 521);
pub const OBJ_setct_PANOnly = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 2);
};
pub const SN_setct_OIData = "setct-OIData";
pub const NID_setct_OIData = @as(c_int, 522);
pub const OBJ_setct_OIData = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 3);
};
pub const SN_setct_PI = "setct-PI";
pub const NID_setct_PI = @as(c_int, 523);
pub const OBJ_setct_PI = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 4);
};
pub const SN_setct_PIData = "setct-PIData";
pub const NID_setct_PIData = @as(c_int, 524);
pub const OBJ_setct_PIData = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 5);
};
pub const SN_setct_PIDataUnsigned = "setct-PIDataUnsigned";
pub const NID_setct_PIDataUnsigned = @as(c_int, 525);
pub const OBJ_setct_PIDataUnsigned = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 6);
};
pub const SN_setct_HODInput = "setct-HODInput";
pub const NID_setct_HODInput = @as(c_int, 526);
pub const OBJ_setct_HODInput = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 7);
};
pub const SN_setct_AuthResBaggage = "setct-AuthResBaggage";
pub const NID_setct_AuthResBaggage = @as(c_int, 527);
pub const OBJ_setct_AuthResBaggage = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 8);
};
pub const SN_setct_AuthRevReqBaggage = "setct-AuthRevReqBaggage";
pub const NID_setct_AuthRevReqBaggage = @as(c_int, 528);
pub const OBJ_setct_AuthRevReqBaggage = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 9);
};
pub const SN_setct_AuthRevResBaggage = "setct-AuthRevResBaggage";
pub const NID_setct_AuthRevResBaggage = @as(c_int, 529);
pub const OBJ_setct_AuthRevResBaggage = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 10);
};
pub const SN_setct_CapTokenSeq = "setct-CapTokenSeq";
pub const NID_setct_CapTokenSeq = @as(c_int, 530);
pub const OBJ_setct_CapTokenSeq = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 11);
};
pub const SN_setct_PInitResData = "setct-PInitResData";
pub const NID_setct_PInitResData = @as(c_int, 531);
pub const OBJ_setct_PInitResData = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 12);
};
pub const SN_setct_PI_TBS = "setct-PI-TBS";
pub const NID_setct_PI_TBS = @as(c_int, 532);
pub const OBJ_setct_PI_TBS = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 13);
};
pub const SN_setct_PResData = "setct-PResData";
pub const NID_setct_PResData = @as(c_int, 533);
pub const OBJ_setct_PResData = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 14);
};
pub const SN_setct_AuthReqTBS = "setct-AuthReqTBS";
pub const NID_setct_AuthReqTBS = @as(c_int, 534);
pub const OBJ_setct_AuthReqTBS = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 16);
};
pub const SN_setct_AuthResTBS = "setct-AuthResTBS";
pub const NID_setct_AuthResTBS = @as(c_int, 535);
pub const OBJ_setct_AuthResTBS = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 17);
};
pub const SN_setct_AuthResTBSX = "setct-AuthResTBSX";
pub const NID_setct_AuthResTBSX = @as(c_int, 536);
pub const OBJ_setct_AuthResTBSX = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 18);
};
pub const SN_setct_AuthTokenTBS = "setct-AuthTokenTBS";
pub const NID_setct_AuthTokenTBS = @as(c_int, 537);
pub const OBJ_setct_AuthTokenTBS = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 19);
};
pub const SN_setct_CapTokenData = "setct-CapTokenData";
pub const NID_setct_CapTokenData = @as(c_int, 538);
pub const OBJ_setct_CapTokenData = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 20);
};
pub const SN_setct_CapTokenTBS = "setct-CapTokenTBS";
pub const NID_setct_CapTokenTBS = @as(c_int, 539);
pub const OBJ_setct_CapTokenTBS = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 21);
};
pub const SN_setct_AcqCardCodeMsg = "setct-AcqCardCodeMsg";
pub const NID_setct_AcqCardCodeMsg = @as(c_int, 540);
pub const OBJ_setct_AcqCardCodeMsg = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 22);
};
pub const SN_setct_AuthRevReqTBS = "setct-AuthRevReqTBS";
pub const NID_setct_AuthRevReqTBS = @as(c_int, 541);
pub const OBJ_setct_AuthRevReqTBS = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 23);
};
pub const SN_setct_AuthRevResData = "setct-AuthRevResData";
pub const NID_setct_AuthRevResData = @as(c_int, 542);
pub const OBJ_setct_AuthRevResData = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 24);
};
pub const SN_setct_AuthRevResTBS = "setct-AuthRevResTBS";
pub const NID_setct_AuthRevResTBS = @as(c_int, 543);
pub const OBJ_setct_AuthRevResTBS = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 25);
};
pub const SN_setct_CapReqTBS = "setct-CapReqTBS";
pub const NID_setct_CapReqTBS = @as(c_int, 544);
pub const OBJ_setct_CapReqTBS = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 26);
};
pub const SN_setct_CapReqTBSX = "setct-CapReqTBSX";
pub const NID_setct_CapReqTBSX = @as(c_int, 545);
pub const OBJ_setct_CapReqTBSX = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 27);
};
pub const SN_setct_CapResData = "setct-CapResData";
pub const NID_setct_CapResData = @as(c_int, 546);
pub const OBJ_setct_CapResData = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 28);
};
pub const SN_setct_CapRevReqTBS = "setct-CapRevReqTBS";
pub const NID_setct_CapRevReqTBS = @as(c_int, 547);
pub const OBJ_setct_CapRevReqTBS = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 29);
};
pub const SN_setct_CapRevReqTBSX = "setct-CapRevReqTBSX";
pub const NID_setct_CapRevReqTBSX = @as(c_int, 548);
pub const OBJ_setct_CapRevReqTBSX = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 30);
};
pub const SN_setct_CapRevResData = "setct-CapRevResData";
pub const NID_setct_CapRevResData = @as(c_int, 549);
pub const OBJ_setct_CapRevResData = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 31);
};
pub const SN_setct_CredReqTBS = "setct-CredReqTBS";
pub const NID_setct_CredReqTBS = @as(c_int, 550);
pub const OBJ_setct_CredReqTBS = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 32);
};
pub const SN_setct_CredReqTBSX = "setct-CredReqTBSX";
pub const NID_setct_CredReqTBSX = @as(c_int, 551);
pub const OBJ_setct_CredReqTBSX = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 33);
};
pub const SN_setct_CredResData = "setct-CredResData";
pub const NID_setct_CredResData = @as(c_int, 552);
pub const OBJ_setct_CredResData = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 34);
};
pub const SN_setct_CredRevReqTBS = "setct-CredRevReqTBS";
pub const NID_setct_CredRevReqTBS = @as(c_int, 553);
pub const OBJ_setct_CredRevReqTBS = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 35);
};
pub const SN_setct_CredRevReqTBSX = "setct-CredRevReqTBSX";
pub const NID_setct_CredRevReqTBSX = @as(c_int, 554);
pub const OBJ_setct_CredRevReqTBSX = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 36);
};
pub const SN_setct_CredRevResData = "setct-CredRevResData";
pub const NID_setct_CredRevResData = @as(c_int, 555);
pub const OBJ_setct_CredRevResData = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 37);
};
pub const SN_setct_PCertReqData = "setct-PCertReqData";
pub const NID_setct_PCertReqData = @as(c_int, 556);
pub const OBJ_setct_PCertReqData = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 38);
};
pub const SN_setct_PCertResTBS = "setct-PCertResTBS";
pub const NID_setct_PCertResTBS = @as(c_int, 557);
pub const OBJ_setct_PCertResTBS = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 39);
};
pub const SN_setct_BatchAdminReqData = "setct-BatchAdminReqData";
pub const NID_setct_BatchAdminReqData = @as(c_int, 558);
pub const OBJ_setct_BatchAdminReqData = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 40);
};
pub const SN_setct_BatchAdminResData = "setct-BatchAdminResData";
pub const NID_setct_BatchAdminResData = @as(c_int, 559);
pub const OBJ_setct_BatchAdminResData = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 41);
};
pub const SN_setct_CardCInitResTBS = "setct-CardCInitResTBS";
pub const NID_setct_CardCInitResTBS = @as(c_int, 560);
pub const OBJ_setct_CardCInitResTBS = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 42);
};
pub const SN_setct_MeAqCInitResTBS = "setct-MeAqCInitResTBS";
pub const NID_setct_MeAqCInitResTBS = @as(c_int, 561);
pub const OBJ_setct_MeAqCInitResTBS = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 43);
};
pub const SN_setct_RegFormResTBS = "setct-RegFormResTBS";
pub const NID_setct_RegFormResTBS = @as(c_int, 562);
pub const OBJ_setct_RegFormResTBS = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 44);
};
pub const SN_setct_CertReqData = "setct-CertReqData";
pub const NID_setct_CertReqData = @as(c_int, 563);
pub const OBJ_setct_CertReqData = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 45);
};
pub const SN_setct_CertReqTBS = "setct-CertReqTBS";
pub const NID_setct_CertReqTBS = @as(c_int, 564);
pub const OBJ_setct_CertReqTBS = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 46);
};
pub const SN_setct_CertResData = "setct-CertResData";
pub const NID_setct_CertResData = @as(c_int, 565);
pub const OBJ_setct_CertResData = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 47);
};
pub const SN_setct_CertInqReqTBS = "setct-CertInqReqTBS";
pub const NID_setct_CertInqReqTBS = @as(c_int, 566);
pub const OBJ_setct_CertInqReqTBS = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 48);
};
pub const SN_setct_ErrorTBS = "setct-ErrorTBS";
pub const NID_setct_ErrorTBS = @as(c_int, 567);
pub const OBJ_setct_ErrorTBS = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 49);
};
pub const SN_setct_PIDualSignedTBE = "setct-PIDualSignedTBE";
pub const NID_setct_PIDualSignedTBE = @as(c_int, 568);
pub const OBJ_setct_PIDualSignedTBE = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 50);
};
pub const SN_setct_PIUnsignedTBE = "setct-PIUnsignedTBE";
pub const NID_setct_PIUnsignedTBE = @as(c_int, 569);
pub const OBJ_setct_PIUnsignedTBE = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 51);
};
pub const SN_setct_AuthReqTBE = "setct-AuthReqTBE";
pub const NID_setct_AuthReqTBE = @as(c_int, 570);
pub const OBJ_setct_AuthReqTBE = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 52);
};
pub const SN_setct_AuthResTBE = "setct-AuthResTBE";
pub const NID_setct_AuthResTBE = @as(c_int, 571);
pub const OBJ_setct_AuthResTBE = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 53);
};
pub const SN_setct_AuthResTBEX = "setct-AuthResTBEX";
pub const NID_setct_AuthResTBEX = @as(c_int, 572);
pub const OBJ_setct_AuthResTBEX = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 54);
};
pub const SN_setct_AuthTokenTBE = "setct-AuthTokenTBE";
pub const NID_setct_AuthTokenTBE = @as(c_int, 573);
pub const OBJ_setct_AuthTokenTBE = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 55);
};
pub const SN_setct_CapTokenTBE = "setct-CapTokenTBE";
pub const NID_setct_CapTokenTBE = @as(c_int, 574);
pub const OBJ_setct_CapTokenTBE = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 56);
};
pub const SN_setct_CapTokenTBEX = "setct-CapTokenTBEX";
pub const NID_setct_CapTokenTBEX = @as(c_int, 575);
pub const OBJ_setct_CapTokenTBEX = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 57);
};
pub const SN_setct_AcqCardCodeMsgTBE = "setct-AcqCardCodeMsgTBE";
pub const NID_setct_AcqCardCodeMsgTBE = @as(c_int, 576);
pub const OBJ_setct_AcqCardCodeMsgTBE = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 58);
};
pub const SN_setct_AuthRevReqTBE = "setct-AuthRevReqTBE";
pub const NID_setct_AuthRevReqTBE = @as(c_int, 577);
pub const OBJ_setct_AuthRevReqTBE = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 59);
};
pub const SN_setct_AuthRevResTBE = "setct-AuthRevResTBE";
pub const NID_setct_AuthRevResTBE = @as(c_int, 578);
pub const OBJ_setct_AuthRevResTBE = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 60);
};
pub const SN_setct_AuthRevResTBEB = "setct-AuthRevResTBEB";
pub const NID_setct_AuthRevResTBEB = @as(c_int, 579);
pub const OBJ_setct_AuthRevResTBEB = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 61);
};
pub const SN_setct_CapReqTBE = "setct-CapReqTBE";
pub const NID_setct_CapReqTBE = @as(c_int, 580);
pub const OBJ_setct_CapReqTBE = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 62);
};
pub const SN_setct_CapReqTBEX = "setct-CapReqTBEX";
pub const NID_setct_CapReqTBEX = @as(c_int, 581);
pub const OBJ_setct_CapReqTBEX = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 63);
};
pub const SN_setct_CapResTBE = "setct-CapResTBE";
pub const NID_setct_CapResTBE = @as(c_int, 582);
pub const OBJ_setct_CapResTBE = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 64);
};
pub const SN_setct_CapRevReqTBE = "setct-CapRevReqTBE";
pub const NID_setct_CapRevReqTBE = @as(c_int, 583);
pub const OBJ_setct_CapRevReqTBE = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 65);
};
pub const SN_setct_CapRevReqTBEX = "setct-CapRevReqTBEX";
pub const NID_setct_CapRevReqTBEX = @as(c_int, 584);
pub const OBJ_setct_CapRevReqTBEX = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 66);
};
pub const SN_setct_CapRevResTBE = "setct-CapRevResTBE";
pub const NID_setct_CapRevResTBE = @as(c_int, 585);
pub const OBJ_setct_CapRevResTBE = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 67);
};
pub const SN_setct_CredReqTBE = "setct-CredReqTBE";
pub const NID_setct_CredReqTBE = @as(c_int, 586);
pub const OBJ_setct_CredReqTBE = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 68);
};
pub const SN_setct_CredReqTBEX = "setct-CredReqTBEX";
pub const NID_setct_CredReqTBEX = @as(c_int, 587);
pub const OBJ_setct_CredReqTBEX = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 69);
};
pub const SN_setct_CredResTBE = "setct-CredResTBE";
pub const NID_setct_CredResTBE = @as(c_int, 588);
pub const OBJ_setct_CredResTBE = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 70);
};
pub const SN_setct_CredRevReqTBE = "setct-CredRevReqTBE";
pub const NID_setct_CredRevReqTBE = @as(c_int, 589);
pub const OBJ_setct_CredRevReqTBE = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 71);
};
pub const SN_setct_CredRevReqTBEX = "setct-CredRevReqTBEX";
pub const NID_setct_CredRevReqTBEX = @as(c_int, 590);
pub const OBJ_setct_CredRevReqTBEX = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 72);
};
pub const SN_setct_CredRevResTBE = "setct-CredRevResTBE";
pub const NID_setct_CredRevResTBE = @as(c_int, 591);
pub const OBJ_setct_CredRevResTBE = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 73);
};
pub const SN_setct_BatchAdminReqTBE = "setct-BatchAdminReqTBE";
pub const NID_setct_BatchAdminReqTBE = @as(c_int, 592);
pub const OBJ_setct_BatchAdminReqTBE = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 74);
};
pub const SN_setct_BatchAdminResTBE = "setct-BatchAdminResTBE";
pub const NID_setct_BatchAdminResTBE = @as(c_int, 593);
pub const OBJ_setct_BatchAdminResTBE = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 75);
};
pub const SN_setct_RegFormReqTBE = "setct-RegFormReqTBE";
pub const NID_setct_RegFormReqTBE = @as(c_int, 594);
pub const OBJ_setct_RegFormReqTBE = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 76);
};
pub const SN_setct_CertReqTBE = "setct-CertReqTBE";
pub const NID_setct_CertReqTBE = @as(c_int, 595);
pub const OBJ_setct_CertReqTBE = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 77);
};
pub const SN_setct_CertReqTBEX = "setct-CertReqTBEX";
pub const NID_setct_CertReqTBEX = @as(c_int, 596);
pub const OBJ_setct_CertReqTBEX = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 78);
};
pub const SN_setct_CertResTBE = "setct-CertResTBE";
pub const NID_setct_CertResTBE = @as(c_int, 597);
pub const OBJ_setct_CertResTBE = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 79);
};
pub const SN_setct_CRLNotificationTBS = "setct-CRLNotificationTBS";
pub const NID_setct_CRLNotificationTBS = @as(c_int, 598);
pub const OBJ_setct_CRLNotificationTBS = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 80);
};
pub const SN_setct_CRLNotificationResTBS = "setct-CRLNotificationResTBS";
pub const NID_setct_CRLNotificationResTBS = @as(c_int, 599);
pub const OBJ_setct_CRLNotificationResTBS = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 81);
};
pub const SN_setct_BCIDistributionTBS = "setct-BCIDistributionTBS";
pub const NID_setct_BCIDistributionTBS = @as(c_int, 600);
pub const OBJ_setct_BCIDistributionTBS = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 82);
};
pub const SN_setext_genCrypt = "setext-genCrypt";
pub const LN_setext_genCrypt = "generic cryptogram";
pub const NID_setext_genCrypt = @as(c_int, 601);
pub const OBJ_setext_genCrypt = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 1);
};
pub const SN_setext_miAuth = "setext-miAuth";
pub const LN_setext_miAuth = "merchant initiated auth";
pub const NID_setext_miAuth = @as(c_int, 602);
pub const OBJ_setext_miAuth = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 3);
};
pub const SN_setext_pinSecure = "setext-pinSecure";
pub const NID_setext_pinSecure = @as(c_int, 603);
pub const OBJ_setext_pinSecure = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 4);
};
pub const SN_setext_pinAny = "setext-pinAny";
pub const NID_setext_pinAny = @as(c_int, 604);
pub const OBJ_setext_pinAny = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 5);
};
pub const SN_setext_track2 = "setext-track2";
pub const NID_setext_track2 = @as(c_int, 605);
pub const OBJ_setext_track2 = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 7);
};
pub const SN_setext_cv = "setext-cv";
pub const LN_setext_cv = "additional verification";
pub const NID_setext_cv = @as(c_int, 606);
pub const OBJ_setext_cv = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 8);
};
pub const SN_set_policy_root = "set-policy-root";
pub const NID_set_policy_root = @as(c_int, 607);
pub const OBJ_set_policy_root = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 5);
    break :blk @as(c_long, 0);
};
pub const SN_setCext_hashedRoot = "setCext-hashedRoot";
pub const NID_setCext_hashedRoot = @as(c_int, 608);
pub const OBJ_setCext_hashedRoot = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 0);
};
pub const SN_setCext_certType = "setCext-certType";
pub const NID_setCext_certType = @as(c_int, 609);
pub const OBJ_setCext_certType = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 1);
};
pub const SN_setCext_merchData = "setCext-merchData";
pub const NID_setCext_merchData = @as(c_int, 610);
pub const OBJ_setCext_merchData = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 2);
};
pub const SN_setCext_cCertRequired = "setCext-cCertRequired";
pub const NID_setCext_cCertRequired = @as(c_int, 611);
pub const OBJ_setCext_cCertRequired = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 3);
};
pub const SN_setCext_tunneling = "setCext-tunneling";
pub const NID_setCext_tunneling = @as(c_int, 612);
pub const OBJ_setCext_tunneling = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 4);
};
pub const SN_setCext_setExt = "setCext-setExt";
pub const NID_setCext_setExt = @as(c_int, 613);
pub const OBJ_setCext_setExt = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 5);
};
pub const SN_setCext_setQualf = "setCext-setQualf";
pub const NID_setCext_setQualf = @as(c_int, 614);
pub const OBJ_setCext_setQualf = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 6);
};
pub const SN_setCext_PGWYcapabilities = "setCext-PGWYcapabilities";
pub const NID_setCext_PGWYcapabilities = @as(c_int, 615);
pub const OBJ_setCext_PGWYcapabilities = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 7);
};
pub const SN_setCext_TokenIdentifier = "setCext-TokenIdentifier";
pub const NID_setCext_TokenIdentifier = @as(c_int, 616);
pub const OBJ_setCext_TokenIdentifier = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 8);
};
pub const SN_setCext_Track2Data = "setCext-Track2Data";
pub const NID_setCext_Track2Data = @as(c_int, 617);
pub const OBJ_setCext_Track2Data = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 9);
};
pub const SN_setCext_TokenType = "setCext-TokenType";
pub const NID_setCext_TokenType = @as(c_int, 618);
pub const OBJ_setCext_TokenType = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 10);
};
pub const SN_setCext_IssuerCapabilities = "setCext-IssuerCapabilities";
pub const NID_setCext_IssuerCapabilities = @as(c_int, 619);
pub const OBJ_setCext_IssuerCapabilities = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 11);
};
pub const SN_setAttr_Cert = "setAttr-Cert";
pub const NID_setAttr_Cert = @as(c_int, 620);
pub const OBJ_setAttr_Cert = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 0);
};
pub const SN_setAttr_PGWYcap = "setAttr-PGWYcap";
pub const LN_setAttr_PGWYcap = "payment gateway capabilities";
pub const NID_setAttr_PGWYcap = @as(c_int, 621);
pub const OBJ_setAttr_PGWYcap = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 1);
};
pub const SN_setAttr_TokenType = "setAttr-TokenType";
pub const NID_setAttr_TokenType = @as(c_int, 622);
pub const OBJ_setAttr_TokenType = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 2);
};
pub const SN_setAttr_IssCap = "setAttr-IssCap";
pub const LN_setAttr_IssCap = "issuer capabilities";
pub const NID_setAttr_IssCap = @as(c_int, 623);
pub const OBJ_setAttr_IssCap = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 3);
};
pub const SN_set_rootKeyThumb = "set-rootKeyThumb";
pub const NID_set_rootKeyThumb = @as(c_int, 624);
pub const OBJ_set_rootKeyThumb = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 3);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 0);
};
pub const SN_set_addPolicy = "set-addPolicy";
pub const NID_set_addPolicy = @as(c_int, 625);
pub const OBJ_set_addPolicy = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 3);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 1);
};
pub const SN_setAttr_Token_EMV = "setAttr-Token-EMV";
pub const NID_setAttr_Token_EMV = @as(c_int, 626);
pub const OBJ_setAttr_Token_EMV = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 1);
};
pub const SN_setAttr_Token_B0Prime = "setAttr-Token-B0Prime";
pub const NID_setAttr_Token_B0Prime = @as(c_int, 627);
pub const OBJ_setAttr_Token_B0Prime = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 2);
};
pub const SN_setAttr_IssCap_CVM = "setAttr-IssCap-CVM";
pub const NID_setAttr_IssCap_CVM = @as(c_int, 628);
pub const OBJ_setAttr_IssCap_CVM = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 3);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 3);
};
pub const SN_setAttr_IssCap_T2 = "setAttr-IssCap-T2";
pub const NID_setAttr_IssCap_T2 = @as(c_int, 629);
pub const OBJ_setAttr_IssCap_T2 = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 3);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 4);
};
pub const SN_setAttr_IssCap_Sig = "setAttr-IssCap-Sig";
pub const NID_setAttr_IssCap_Sig = @as(c_int, 630);
pub const OBJ_setAttr_IssCap_Sig = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 3);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 5);
};
pub const SN_setAttr_GenCryptgrm = "setAttr-GenCryptgrm";
pub const LN_setAttr_GenCryptgrm = "generate cryptogram";
pub const NID_setAttr_GenCryptgrm = @as(c_int, 631);
pub const OBJ_setAttr_GenCryptgrm = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 3);
    _ = @as(c_long, 3);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 1);
};
pub const SN_setAttr_T2Enc = "setAttr-T2Enc";
pub const LN_setAttr_T2Enc = "encrypted track 2";
pub const NID_setAttr_T2Enc = @as(c_int, 632);
pub const OBJ_setAttr_T2Enc = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 3);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 1);
};
pub const SN_setAttr_T2cleartxt = "setAttr-T2cleartxt";
pub const LN_setAttr_T2cleartxt = "cleartext track 2";
pub const NID_setAttr_T2cleartxt = @as(c_int, 633);
pub const OBJ_setAttr_T2cleartxt = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 3);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 2);
};
pub const SN_setAttr_TokICCsig = "setAttr-TokICCsig";
pub const LN_setAttr_TokICCsig = "ICC or token signature";
pub const NID_setAttr_TokICCsig = @as(c_int, 634);
pub const OBJ_setAttr_TokICCsig = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 3);
    _ = @as(c_long, 3);
    _ = @as(c_long, 5);
    break :blk @as(c_long, 1);
};
pub const SN_setAttr_SecDevSig = "setAttr-SecDevSig";
pub const LN_setAttr_SecDevSig = "secure device signature";
pub const NID_setAttr_SecDevSig = @as(c_int, 635);
pub const OBJ_setAttr_SecDevSig = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 3);
    _ = @as(c_long, 3);
    _ = @as(c_long, 5);
    break :blk @as(c_long, 2);
};
pub const SN_set_brand_IATA_ATA = "set-brand-IATA-ATA";
pub const NID_set_brand_IATA_ATA = @as(c_int, 636);
pub const OBJ_set_brand_IATA_ATA = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 8);
    break :blk @as(c_long, 1);
};
pub const SN_set_brand_Diners = "set-brand-Diners";
pub const NID_set_brand_Diners = @as(c_int, 637);
pub const OBJ_set_brand_Diners = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 8);
    break :blk @as(c_long, 30);
};
pub const SN_set_brand_AmericanExpress = "set-brand-AmericanExpress";
pub const NID_set_brand_AmericanExpress = @as(c_int, 638);
pub const OBJ_set_brand_AmericanExpress = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 8);
    break :blk @as(c_long, 34);
};
pub const SN_set_brand_JCB = "set-brand-JCB";
pub const NID_set_brand_JCB = @as(c_int, 639);
pub const OBJ_set_brand_JCB = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 8);
    break :blk @as(c_long, 35);
};
pub const SN_set_brand_Visa = "set-brand-Visa";
pub const NID_set_brand_Visa = @as(c_int, 640);
pub const OBJ_set_brand_Visa = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 8);
    break :blk @as(c_long, 4);
};
pub const SN_set_brand_MasterCard = "set-brand-MasterCard";
pub const NID_set_brand_MasterCard = @as(c_int, 641);
pub const OBJ_set_brand_MasterCard = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 8);
    break :blk @as(c_long, 5);
};
pub const SN_set_brand_Novus = "set-brand-Novus";
pub const NID_set_brand_Novus = @as(c_int, 642);
pub const OBJ_set_brand_Novus = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 42);
    _ = @as(c_long, 8);
    break :blk @as(c_long, 6011);
};
pub const SN_des_cdmf = "DES-CDMF";
pub const LN_des_cdmf = "des-cdmf";
pub const NID_des_cdmf = @as(c_int, 643);
pub const OBJ_des_cdmf = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 10);
};
pub const SN_rsaOAEPEncryptionSET = "rsaOAEPEncryptionSET";
pub const NID_rsaOAEPEncryptionSET = @as(c_int, 644);
pub const OBJ_rsaOAEPEncryptionSET = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 6);
};
pub const SN_itu_t = "ITU-T";
pub const LN_itu_t = "itu-t";
pub const NID_itu_t = @as(c_int, 645);
pub const OBJ_itu_t = @as(c_long, 0);
pub const SN_joint_iso_itu_t = "JOINT-ISO-ITU-T";
pub const LN_joint_iso_itu_t = "joint-iso-itu-t";
pub const NID_joint_iso_itu_t = @as(c_int, 646);
pub const OBJ_joint_iso_itu_t = @as(c_long, 2);
pub const SN_international_organizations = "international-organizations";
pub const LN_international_organizations = "International Organizations";
pub const NID_international_organizations = @as(c_int, 647);
pub const OBJ_international_organizations = blk: {
    _ = @as(c_long, 2);
    break :blk @as(c_long, 23);
};
pub const SN_ms_smartcard_login = "msSmartcardLogin";
pub const LN_ms_smartcard_login = "Microsoft Smartcardlogin";
pub const NID_ms_smartcard_login = @as(c_int, 648);
pub const OBJ_ms_smartcard_login = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    _ = @as(c_long, 311);
    _ = @as(c_long, 20);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 2);
};
pub const SN_ms_upn = "msUPN";
pub const LN_ms_upn = "Microsoft Universal Principal Name";
pub const NID_ms_upn = @as(c_int, 649);
pub const OBJ_ms_upn = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    _ = @as(c_long, 311);
    _ = @as(c_long, 20);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 3);
};
pub const SN_aes_128_cfb1 = "AES-128-CFB1";
pub const LN_aes_128_cfb1 = "aes-128-cfb1";
pub const NID_aes_128_cfb1 = @as(c_int, 650);
pub const SN_aes_192_cfb1 = "AES-192-CFB1";
pub const LN_aes_192_cfb1 = "aes-192-cfb1";
pub const NID_aes_192_cfb1 = @as(c_int, 651);
pub const SN_aes_256_cfb1 = "AES-256-CFB1";
pub const LN_aes_256_cfb1 = "aes-256-cfb1";
pub const NID_aes_256_cfb1 = @as(c_int, 652);
pub const SN_aes_128_cfb8 = "AES-128-CFB8";
pub const LN_aes_128_cfb8 = "aes-128-cfb8";
pub const NID_aes_128_cfb8 = @as(c_int, 653);
pub const SN_aes_192_cfb8 = "AES-192-CFB8";
pub const LN_aes_192_cfb8 = "aes-192-cfb8";
pub const NID_aes_192_cfb8 = @as(c_int, 654);
pub const SN_aes_256_cfb8 = "AES-256-CFB8";
pub const LN_aes_256_cfb8 = "aes-256-cfb8";
pub const NID_aes_256_cfb8 = @as(c_int, 655);
pub const SN_des_cfb1 = "DES-CFB1";
pub const LN_des_cfb1 = "des-cfb1";
pub const NID_des_cfb1 = @as(c_int, 656);
pub const SN_des_cfb8 = "DES-CFB8";
pub const LN_des_cfb8 = "des-cfb8";
pub const NID_des_cfb8 = @as(c_int, 657);
pub const SN_des_ede3_cfb1 = "DES-EDE3-CFB1";
pub const LN_des_ede3_cfb1 = "des-ede3-cfb1";
pub const NID_des_ede3_cfb1 = @as(c_int, 658);
pub const SN_des_ede3_cfb8 = "DES-EDE3-CFB8";
pub const LN_des_ede3_cfb8 = "des-ede3-cfb8";
pub const NID_des_ede3_cfb8 = @as(c_int, 659);
pub const SN_streetAddress = "street";
pub const LN_streetAddress = "streetAddress";
pub const NID_streetAddress = @as(c_int, 660);
pub const OBJ_streetAddress = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 9);
};
pub const LN_postalCode = "postalCode";
pub const NID_postalCode = @as(c_int, 661);
pub const OBJ_postalCode = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 17);
};
pub const SN_id_ppl = "id-ppl";
pub const NID_id_ppl = @as(c_int, 662);
pub const OBJ_id_ppl = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    break :blk @as(c_long, 21);
};
pub const SN_proxyCertInfo = "proxyCertInfo";
pub const LN_proxyCertInfo = "Proxy Certificate Information";
pub const NID_proxyCertInfo = @as(c_int, 663);
pub const OBJ_proxyCertInfo = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 14);
};
pub const SN_id_ppl_anyLanguage = "id-ppl-anyLanguage";
pub const LN_id_ppl_anyLanguage = "Any language";
pub const NID_id_ppl_anyLanguage = @as(c_int, 664);
pub const OBJ_id_ppl_anyLanguage = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 21);
    break :blk @as(c_long, 0);
};
pub const SN_id_ppl_inheritAll = "id-ppl-inheritAll";
pub const LN_id_ppl_inheritAll = "Inherit all";
pub const NID_id_ppl_inheritAll = @as(c_int, 665);
pub const OBJ_id_ppl_inheritAll = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 21);
    break :blk @as(c_long, 1);
};
pub const SN_name_constraints = "nameConstraints";
pub const LN_name_constraints = "X509v3 Name Constraints";
pub const NID_name_constraints = @as(c_int, 666);
pub const OBJ_name_constraints = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 29);
    break :blk @as(c_long, 30);
};
pub const SN_Independent = "id-ppl-independent";
pub const LN_Independent = "Independent";
pub const NID_Independent = @as(c_int, 667);
pub const OBJ_Independent = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 21);
    break :blk @as(c_long, 2);
};
pub const SN_sha256WithRSAEncryption = "RSA-SHA256";
pub const LN_sha256WithRSAEncryption = "sha256WithRSAEncryption";
pub const NID_sha256WithRSAEncryption = @as(c_int, 668);
pub const OBJ_sha256WithRSAEncryption = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 11);
};
pub const SN_sha384WithRSAEncryption = "RSA-SHA384";
pub const LN_sha384WithRSAEncryption = "sha384WithRSAEncryption";
pub const NID_sha384WithRSAEncryption = @as(c_int, 669);
pub const OBJ_sha384WithRSAEncryption = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 12);
};
pub const SN_sha512WithRSAEncryption = "RSA-SHA512";
pub const LN_sha512WithRSAEncryption = "sha512WithRSAEncryption";
pub const NID_sha512WithRSAEncryption = @as(c_int, 670);
pub const OBJ_sha512WithRSAEncryption = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 13);
};
pub const SN_sha224WithRSAEncryption = "RSA-SHA224";
pub const LN_sha224WithRSAEncryption = "sha224WithRSAEncryption";
pub const NID_sha224WithRSAEncryption = @as(c_int, 671);
pub const OBJ_sha224WithRSAEncryption = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 14);
};
pub const SN_sha256 = "SHA256";
pub const LN_sha256 = "sha256";
pub const NID_sha256 = @as(c_int, 672);
pub const OBJ_sha256 = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 1);
};
pub const SN_sha384 = "SHA384";
pub const LN_sha384 = "sha384";
pub const NID_sha384 = @as(c_int, 673);
pub const OBJ_sha384 = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 2);
};
pub const SN_sha512 = "SHA512";
pub const LN_sha512 = "sha512";
pub const NID_sha512 = @as(c_int, 674);
pub const OBJ_sha512 = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 3);
};
pub const SN_sha224 = "SHA224";
pub const LN_sha224 = "sha224";
pub const NID_sha224 = @as(c_int, 675);
pub const OBJ_sha224 = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 4);
};
pub const SN_identified_organization = "identified-organization";
pub const NID_identified_organization = @as(c_int, 676);
pub const OBJ_identified_organization = blk: {
    _ = @as(c_long, 1);
    break :blk @as(c_long, 3);
};
pub const SN_certicom_arc = "certicom-arc";
pub const NID_certicom_arc = @as(c_int, 677);
pub const OBJ_certicom_arc = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 132);
};
pub const SN_wap = "wap";
pub const NID_wap = @as(c_int, 678);
pub const OBJ_wap = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    break :blk @as(c_long, 43);
};
pub const SN_wap_wsg = "wap-wsg";
pub const NID_wap_wsg = @as(c_int, 679);
pub const OBJ_wap_wsg = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 43);
    break :blk @as(c_long, 1);
};
pub const SN_X9_62_id_characteristic_two_basis = "id-characteristic-two-basis";
pub const NID_X9_62_id_characteristic_two_basis = @as(c_int, 680);
pub const OBJ_X9_62_id_characteristic_two_basis = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 3);
};
pub const SN_X9_62_onBasis = "onBasis";
pub const NID_X9_62_onBasis = @as(c_int, 681);
pub const OBJ_X9_62_onBasis = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 1);
};
pub const SN_X9_62_tpBasis = "tpBasis";
pub const NID_X9_62_tpBasis = @as(c_int, 682);
pub const OBJ_X9_62_tpBasis = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 2);
};
pub const SN_X9_62_ppBasis = "ppBasis";
pub const NID_X9_62_ppBasis = @as(c_int, 683);
pub const OBJ_X9_62_ppBasis = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 3);
};
pub const SN_X9_62_c2pnb163v1 = "c2pnb163v1";
pub const NID_X9_62_c2pnb163v1 = @as(c_int, 684);
pub const OBJ_X9_62_c2pnb163v1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 3);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 1);
};
pub const SN_X9_62_c2pnb163v2 = "c2pnb163v2";
pub const NID_X9_62_c2pnb163v2 = @as(c_int, 685);
pub const OBJ_X9_62_c2pnb163v2 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 3);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 2);
};
pub const SN_X9_62_c2pnb163v3 = "c2pnb163v3";
pub const NID_X9_62_c2pnb163v3 = @as(c_int, 686);
pub const OBJ_X9_62_c2pnb163v3 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 3);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 3);
};
pub const SN_X9_62_c2pnb176v1 = "c2pnb176v1";
pub const NID_X9_62_c2pnb176v1 = @as(c_int, 687);
pub const OBJ_X9_62_c2pnb176v1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 3);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 4);
};
pub const SN_X9_62_c2tnb191v1 = "c2tnb191v1";
pub const NID_X9_62_c2tnb191v1 = @as(c_int, 688);
pub const OBJ_X9_62_c2tnb191v1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 3);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 5);
};
pub const SN_X9_62_c2tnb191v2 = "c2tnb191v2";
pub const NID_X9_62_c2tnb191v2 = @as(c_int, 689);
pub const OBJ_X9_62_c2tnb191v2 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 3);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 6);
};
pub const SN_X9_62_c2tnb191v3 = "c2tnb191v3";
pub const NID_X9_62_c2tnb191v3 = @as(c_int, 690);
pub const OBJ_X9_62_c2tnb191v3 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 3);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 7);
};
pub const SN_X9_62_c2onb191v4 = "c2onb191v4";
pub const NID_X9_62_c2onb191v4 = @as(c_int, 691);
pub const OBJ_X9_62_c2onb191v4 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 3);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 8);
};
pub const SN_X9_62_c2onb191v5 = "c2onb191v5";
pub const NID_X9_62_c2onb191v5 = @as(c_int, 692);
pub const OBJ_X9_62_c2onb191v5 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 3);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 9);
};
pub const SN_X9_62_c2pnb208w1 = "c2pnb208w1";
pub const NID_X9_62_c2pnb208w1 = @as(c_int, 693);
pub const OBJ_X9_62_c2pnb208w1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 3);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 10);
};
pub const SN_X9_62_c2tnb239v1 = "c2tnb239v1";
pub const NID_X9_62_c2tnb239v1 = @as(c_int, 694);
pub const OBJ_X9_62_c2tnb239v1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 3);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 11);
};
pub const SN_X9_62_c2tnb239v2 = "c2tnb239v2";
pub const NID_X9_62_c2tnb239v2 = @as(c_int, 695);
pub const OBJ_X9_62_c2tnb239v2 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 3);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 12);
};
pub const SN_X9_62_c2tnb239v3 = "c2tnb239v3";
pub const NID_X9_62_c2tnb239v3 = @as(c_int, 696);
pub const OBJ_X9_62_c2tnb239v3 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 3);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 13);
};
pub const SN_X9_62_c2onb239v4 = "c2onb239v4";
pub const NID_X9_62_c2onb239v4 = @as(c_int, 697);
pub const OBJ_X9_62_c2onb239v4 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 3);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 14);
};
pub const SN_X9_62_c2onb239v5 = "c2onb239v5";
pub const NID_X9_62_c2onb239v5 = @as(c_int, 698);
pub const OBJ_X9_62_c2onb239v5 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 3);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 15);
};
pub const SN_X9_62_c2pnb272w1 = "c2pnb272w1";
pub const NID_X9_62_c2pnb272w1 = @as(c_int, 699);
pub const OBJ_X9_62_c2pnb272w1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 3);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 16);
};
pub const SN_X9_62_c2pnb304w1 = "c2pnb304w1";
pub const NID_X9_62_c2pnb304w1 = @as(c_int, 700);
pub const OBJ_X9_62_c2pnb304w1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 3);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 17);
};
pub const SN_X9_62_c2tnb359v1 = "c2tnb359v1";
pub const NID_X9_62_c2tnb359v1 = @as(c_int, 701);
pub const OBJ_X9_62_c2tnb359v1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 3);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 18);
};
pub const SN_X9_62_c2pnb368w1 = "c2pnb368w1";
pub const NID_X9_62_c2pnb368w1 = @as(c_int, 702);
pub const OBJ_X9_62_c2pnb368w1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 3);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 19);
};
pub const SN_X9_62_c2tnb431r1 = "c2tnb431r1";
pub const NID_X9_62_c2tnb431r1 = @as(c_int, 703);
pub const OBJ_X9_62_c2tnb431r1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 3);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 20);
};
pub const SN_secp112r1 = "secp112r1";
pub const NID_secp112r1 = @as(c_int, 704);
pub const OBJ_secp112r1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 6);
};
pub const SN_secp112r2 = "secp112r2";
pub const NID_secp112r2 = @as(c_int, 705);
pub const OBJ_secp112r2 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 7);
};
pub const SN_secp128r1 = "secp128r1";
pub const NID_secp128r1 = @as(c_int, 706);
pub const OBJ_secp128r1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 28);
};
pub const SN_secp128r2 = "secp128r2";
pub const NID_secp128r2 = @as(c_int, 707);
pub const OBJ_secp128r2 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 29);
};
pub const SN_secp160k1 = "secp160k1";
pub const NID_secp160k1 = @as(c_int, 708);
pub const OBJ_secp160k1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 9);
};
pub const SN_secp160r1 = "secp160r1";
pub const NID_secp160r1 = @as(c_int, 709);
pub const OBJ_secp160r1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 8);
};
pub const SN_secp160r2 = "secp160r2";
pub const NID_secp160r2 = @as(c_int, 710);
pub const OBJ_secp160r2 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 30);
};
pub const SN_secp192k1 = "secp192k1";
pub const NID_secp192k1 = @as(c_int, 711);
pub const OBJ_secp192k1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 31);
};
pub const SN_secp224k1 = "secp224k1";
pub const NID_secp224k1 = @as(c_int, 712);
pub const OBJ_secp224k1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 32);
};
pub const SN_secp224r1 = "secp224r1";
pub const NID_secp224r1 = @as(c_int, 713);
pub const OBJ_secp224r1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 33);
};
pub const SN_secp256k1 = "secp256k1";
pub const NID_secp256k1 = @as(c_int, 714);
pub const OBJ_secp256k1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 10);
};
pub const SN_secp384r1 = "secp384r1";
pub const NID_secp384r1 = @as(c_int, 715);
pub const OBJ_secp384r1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 34);
};
pub const SN_secp521r1 = "secp521r1";
pub const NID_secp521r1 = @as(c_int, 716);
pub const OBJ_secp521r1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 35);
};
pub const SN_sect113r1 = "sect113r1";
pub const NID_sect113r1 = @as(c_int, 717);
pub const OBJ_sect113r1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 4);
};
pub const SN_sect113r2 = "sect113r2";
pub const NID_sect113r2 = @as(c_int, 718);
pub const OBJ_sect113r2 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 5);
};
pub const SN_sect131r1 = "sect131r1";
pub const NID_sect131r1 = @as(c_int, 719);
pub const OBJ_sect131r1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 22);
};
pub const SN_sect131r2 = "sect131r2";
pub const NID_sect131r2 = @as(c_int, 720);
pub const OBJ_sect131r2 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 23);
};
pub const SN_sect163k1 = "sect163k1";
pub const NID_sect163k1 = @as(c_int, 721);
pub const OBJ_sect163k1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 1);
};
pub const SN_sect163r1 = "sect163r1";
pub const NID_sect163r1 = @as(c_int, 722);
pub const OBJ_sect163r1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 2);
};
pub const SN_sect163r2 = "sect163r2";
pub const NID_sect163r2 = @as(c_int, 723);
pub const OBJ_sect163r2 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 15);
};
pub const SN_sect193r1 = "sect193r1";
pub const NID_sect193r1 = @as(c_int, 724);
pub const OBJ_sect193r1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 24);
};
pub const SN_sect193r2 = "sect193r2";
pub const NID_sect193r2 = @as(c_int, 725);
pub const OBJ_sect193r2 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 25);
};
pub const SN_sect233k1 = "sect233k1";
pub const NID_sect233k1 = @as(c_int, 726);
pub const OBJ_sect233k1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 26);
};
pub const SN_sect233r1 = "sect233r1";
pub const NID_sect233r1 = @as(c_int, 727);
pub const OBJ_sect233r1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 27);
};
pub const SN_sect239k1 = "sect239k1";
pub const NID_sect239k1 = @as(c_int, 728);
pub const OBJ_sect239k1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 3);
};
pub const SN_sect283k1 = "sect283k1";
pub const NID_sect283k1 = @as(c_int, 729);
pub const OBJ_sect283k1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 16);
};
pub const SN_sect283r1 = "sect283r1";
pub const NID_sect283r1 = @as(c_int, 730);
pub const OBJ_sect283r1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 17);
};
pub const SN_sect409k1 = "sect409k1";
pub const NID_sect409k1 = @as(c_int, 731);
pub const OBJ_sect409k1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 36);
};
pub const SN_sect409r1 = "sect409r1";
pub const NID_sect409r1 = @as(c_int, 732);
pub const OBJ_sect409r1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 37);
};
pub const SN_sect571k1 = "sect571k1";
pub const NID_sect571k1 = @as(c_int, 733);
pub const OBJ_sect571k1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 38);
};
pub const SN_sect571r1 = "sect571r1";
pub const NID_sect571r1 = @as(c_int, 734);
pub const OBJ_sect571r1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 39);
};
pub const SN_wap_wsg_idm_ecid_wtls1 = "wap-wsg-idm-ecid-wtls1";
pub const NID_wap_wsg_idm_ecid_wtls1 = @as(c_int, 735);
pub const OBJ_wap_wsg_idm_ecid_wtls1 = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 43);
    _ = @as(c_long, 1);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 1);
};
pub const SN_wap_wsg_idm_ecid_wtls3 = "wap-wsg-idm-ecid-wtls3";
pub const NID_wap_wsg_idm_ecid_wtls3 = @as(c_int, 736);
pub const OBJ_wap_wsg_idm_ecid_wtls3 = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 43);
    _ = @as(c_long, 1);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 3);
};
pub const SN_wap_wsg_idm_ecid_wtls4 = "wap-wsg-idm-ecid-wtls4";
pub const NID_wap_wsg_idm_ecid_wtls4 = @as(c_int, 737);
pub const OBJ_wap_wsg_idm_ecid_wtls4 = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 43);
    _ = @as(c_long, 1);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 4);
};
pub const SN_wap_wsg_idm_ecid_wtls5 = "wap-wsg-idm-ecid-wtls5";
pub const NID_wap_wsg_idm_ecid_wtls5 = @as(c_int, 738);
pub const OBJ_wap_wsg_idm_ecid_wtls5 = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 43);
    _ = @as(c_long, 1);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 5);
};
pub const SN_wap_wsg_idm_ecid_wtls6 = "wap-wsg-idm-ecid-wtls6";
pub const NID_wap_wsg_idm_ecid_wtls6 = @as(c_int, 739);
pub const OBJ_wap_wsg_idm_ecid_wtls6 = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 43);
    _ = @as(c_long, 1);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 6);
};
pub const SN_wap_wsg_idm_ecid_wtls7 = "wap-wsg-idm-ecid-wtls7";
pub const NID_wap_wsg_idm_ecid_wtls7 = @as(c_int, 740);
pub const OBJ_wap_wsg_idm_ecid_wtls7 = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 43);
    _ = @as(c_long, 1);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 7);
};
pub const SN_wap_wsg_idm_ecid_wtls8 = "wap-wsg-idm-ecid-wtls8";
pub const NID_wap_wsg_idm_ecid_wtls8 = @as(c_int, 741);
pub const OBJ_wap_wsg_idm_ecid_wtls8 = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 43);
    _ = @as(c_long, 1);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 8);
};
pub const SN_wap_wsg_idm_ecid_wtls9 = "wap-wsg-idm-ecid-wtls9";
pub const NID_wap_wsg_idm_ecid_wtls9 = @as(c_int, 742);
pub const OBJ_wap_wsg_idm_ecid_wtls9 = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 43);
    _ = @as(c_long, 1);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 9);
};
pub const SN_wap_wsg_idm_ecid_wtls10 = "wap-wsg-idm-ecid-wtls10";
pub const NID_wap_wsg_idm_ecid_wtls10 = @as(c_int, 743);
pub const OBJ_wap_wsg_idm_ecid_wtls10 = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 43);
    _ = @as(c_long, 1);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 10);
};
pub const SN_wap_wsg_idm_ecid_wtls11 = "wap-wsg-idm-ecid-wtls11";
pub const NID_wap_wsg_idm_ecid_wtls11 = @as(c_int, 744);
pub const OBJ_wap_wsg_idm_ecid_wtls11 = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 43);
    _ = @as(c_long, 1);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 11);
};
pub const SN_wap_wsg_idm_ecid_wtls12 = "wap-wsg-idm-ecid-wtls12";
pub const NID_wap_wsg_idm_ecid_wtls12 = @as(c_int, 745);
pub const OBJ_wap_wsg_idm_ecid_wtls12 = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 23);
    _ = @as(c_long, 43);
    _ = @as(c_long, 1);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 12);
};
pub const SN_any_policy = "anyPolicy";
pub const LN_any_policy = "X509v3 Any Policy";
pub const NID_any_policy = @as(c_int, 746);
pub const OBJ_any_policy = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 29);
    _ = @as(c_long, 32);
    break :blk @as(c_long, 0);
};
pub const SN_policy_mappings = "policyMappings";
pub const LN_policy_mappings = "X509v3 Policy Mappings";
pub const NID_policy_mappings = @as(c_int, 747);
pub const OBJ_policy_mappings = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 29);
    break :blk @as(c_long, 33);
};
pub const SN_inhibit_any_policy = "inhibitAnyPolicy";
pub const LN_inhibit_any_policy = "X509v3 Inhibit Any Policy";
pub const NID_inhibit_any_policy = @as(c_int, 748);
pub const OBJ_inhibit_any_policy = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 29);
    break :blk @as(c_long, 54);
};
pub const SN_ipsec3 = "Oakley-EC2N-3";
pub const LN_ipsec3 = "ipsec3";
pub const NID_ipsec3 = @as(c_int, 749);
pub const SN_ipsec4 = "Oakley-EC2N-4";
pub const LN_ipsec4 = "ipsec4";
pub const NID_ipsec4 = @as(c_int, 750);
pub const SN_camellia_128_cbc = "CAMELLIA-128-CBC";
pub const LN_camellia_128_cbc = "camellia-128-cbc";
pub const NID_camellia_128_cbc = @as(c_int, 751);
pub const OBJ_camellia_128_cbc = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 392);
    _ = @as(c_long, 200011);
    _ = @as(c_long, 61);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 2);
};
pub const SN_camellia_192_cbc = "CAMELLIA-192-CBC";
pub const LN_camellia_192_cbc = "camellia-192-cbc";
pub const NID_camellia_192_cbc = @as(c_int, 752);
pub const OBJ_camellia_192_cbc = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 392);
    _ = @as(c_long, 200011);
    _ = @as(c_long, 61);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 3);
};
pub const SN_camellia_256_cbc = "CAMELLIA-256-CBC";
pub const LN_camellia_256_cbc = "camellia-256-cbc";
pub const NID_camellia_256_cbc = @as(c_int, 753);
pub const OBJ_camellia_256_cbc = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 392);
    _ = @as(c_long, 200011);
    _ = @as(c_long, 61);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 4);
};
pub const SN_camellia_128_ecb = "CAMELLIA-128-ECB";
pub const LN_camellia_128_ecb = "camellia-128-ecb";
pub const NID_camellia_128_ecb = @as(c_int, 754);
pub const OBJ_camellia_128_ecb = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4401);
    _ = @as(c_long, 5);
    _ = @as(c_long, 3);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    break :blk @as(c_long, 1);
};
pub const SN_camellia_192_ecb = "CAMELLIA-192-ECB";
pub const LN_camellia_192_ecb = "camellia-192-ecb";
pub const NID_camellia_192_ecb = @as(c_int, 755);
pub const OBJ_camellia_192_ecb = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4401);
    _ = @as(c_long, 5);
    _ = @as(c_long, 3);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    break :blk @as(c_long, 21);
};
pub const SN_camellia_256_ecb = "CAMELLIA-256-ECB";
pub const LN_camellia_256_ecb = "camellia-256-ecb";
pub const NID_camellia_256_ecb = @as(c_int, 756);
pub const OBJ_camellia_256_ecb = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4401);
    _ = @as(c_long, 5);
    _ = @as(c_long, 3);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    break :blk @as(c_long, 41);
};
pub const SN_camellia_128_cfb128 = "CAMELLIA-128-CFB";
pub const LN_camellia_128_cfb128 = "camellia-128-cfb";
pub const NID_camellia_128_cfb128 = @as(c_int, 757);
pub const OBJ_camellia_128_cfb128 = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4401);
    _ = @as(c_long, 5);
    _ = @as(c_long, 3);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    break :blk @as(c_long, 4);
};
pub const SN_camellia_192_cfb128 = "CAMELLIA-192-CFB";
pub const LN_camellia_192_cfb128 = "camellia-192-cfb";
pub const NID_camellia_192_cfb128 = @as(c_int, 758);
pub const OBJ_camellia_192_cfb128 = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4401);
    _ = @as(c_long, 5);
    _ = @as(c_long, 3);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    break :blk @as(c_long, 24);
};
pub const SN_camellia_256_cfb128 = "CAMELLIA-256-CFB";
pub const LN_camellia_256_cfb128 = "camellia-256-cfb";
pub const NID_camellia_256_cfb128 = @as(c_int, 759);
pub const OBJ_camellia_256_cfb128 = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4401);
    _ = @as(c_long, 5);
    _ = @as(c_long, 3);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    break :blk @as(c_long, 44);
};
pub const SN_camellia_128_cfb1 = "CAMELLIA-128-CFB1";
pub const LN_camellia_128_cfb1 = "camellia-128-cfb1";
pub const NID_camellia_128_cfb1 = @as(c_int, 760);
pub const SN_camellia_192_cfb1 = "CAMELLIA-192-CFB1";
pub const LN_camellia_192_cfb1 = "camellia-192-cfb1";
pub const NID_camellia_192_cfb1 = @as(c_int, 761);
pub const SN_camellia_256_cfb1 = "CAMELLIA-256-CFB1";
pub const LN_camellia_256_cfb1 = "camellia-256-cfb1";
pub const NID_camellia_256_cfb1 = @as(c_int, 762);
pub const SN_camellia_128_cfb8 = "CAMELLIA-128-CFB8";
pub const LN_camellia_128_cfb8 = "camellia-128-cfb8";
pub const NID_camellia_128_cfb8 = @as(c_int, 763);
pub const SN_camellia_192_cfb8 = "CAMELLIA-192-CFB8";
pub const LN_camellia_192_cfb8 = "camellia-192-cfb8";
pub const NID_camellia_192_cfb8 = @as(c_int, 764);
pub const SN_camellia_256_cfb8 = "CAMELLIA-256-CFB8";
pub const LN_camellia_256_cfb8 = "camellia-256-cfb8";
pub const NID_camellia_256_cfb8 = @as(c_int, 765);
pub const SN_camellia_128_ofb128 = "CAMELLIA-128-OFB";
pub const LN_camellia_128_ofb128 = "camellia-128-ofb";
pub const NID_camellia_128_ofb128 = @as(c_int, 766);
pub const OBJ_camellia_128_ofb128 = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4401);
    _ = @as(c_long, 5);
    _ = @as(c_long, 3);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    break :blk @as(c_long, 3);
};
pub const SN_camellia_192_ofb128 = "CAMELLIA-192-OFB";
pub const LN_camellia_192_ofb128 = "camellia-192-ofb";
pub const NID_camellia_192_ofb128 = @as(c_int, 767);
pub const OBJ_camellia_192_ofb128 = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4401);
    _ = @as(c_long, 5);
    _ = @as(c_long, 3);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    break :blk @as(c_long, 23);
};
pub const SN_camellia_256_ofb128 = "CAMELLIA-256-OFB";
pub const LN_camellia_256_ofb128 = "camellia-256-ofb";
pub const NID_camellia_256_ofb128 = @as(c_int, 768);
pub const OBJ_camellia_256_ofb128 = blk: {
    _ = @as(c_long, 0);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4401);
    _ = @as(c_long, 5);
    _ = @as(c_long, 3);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    break :blk @as(c_long, 43);
};
pub const SN_subject_directory_attributes = "subjectDirectoryAttributes";
pub const LN_subject_directory_attributes = "X509v3 Subject Directory Attributes";
pub const NID_subject_directory_attributes = @as(c_int, 769);
pub const OBJ_subject_directory_attributes = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 29);
    break :blk @as(c_long, 9);
};
pub const SN_issuing_distribution_point = "issuingDistributionPoint";
pub const LN_issuing_distribution_point = "X509v3 Issuing Distribution Point";
pub const NID_issuing_distribution_point = @as(c_int, 770);
pub const OBJ_issuing_distribution_point = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 29);
    break :blk @as(c_long, 28);
};
pub const SN_certificate_issuer = "certificateIssuer";
pub const LN_certificate_issuer = "X509v3 Certificate Issuer";
pub const NID_certificate_issuer = @as(c_int, 771);
pub const OBJ_certificate_issuer = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 29);
    break :blk @as(c_long, 29);
};
pub const SN_kisa = "KISA";
pub const LN_kisa = "kisa";
pub const NID_kisa = @as(c_int, 773);
pub const OBJ_kisa = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 410);
    break :blk @as(c_long, 200004);
};
pub const SN_seed_ecb = "SEED-ECB";
pub const LN_seed_ecb = "seed-ecb";
pub const NID_seed_ecb = @as(c_int, 776);
pub const OBJ_seed_ecb = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 410);
    _ = @as(c_long, 200004);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 3);
};
pub const SN_seed_cbc = "SEED-CBC";
pub const LN_seed_cbc = "seed-cbc";
pub const NID_seed_cbc = @as(c_int, 777);
pub const OBJ_seed_cbc = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 410);
    _ = @as(c_long, 200004);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 4);
};
pub const SN_seed_ofb128 = "SEED-OFB";
pub const LN_seed_ofb128 = "seed-ofb";
pub const NID_seed_ofb128 = @as(c_int, 778);
pub const OBJ_seed_ofb128 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 410);
    _ = @as(c_long, 200004);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 6);
};
pub const SN_seed_cfb128 = "SEED-CFB";
pub const LN_seed_cfb128 = "seed-cfb";
pub const NID_seed_cfb128 = @as(c_int, 779);
pub const OBJ_seed_cfb128 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 410);
    _ = @as(c_long, 200004);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 5);
};
pub const SN_hmac_md5 = "HMAC-MD5";
pub const LN_hmac_md5 = "hmac-md5";
pub const NID_hmac_md5 = @as(c_int, 780);
pub const OBJ_hmac_md5 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 8);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 1);
};
pub const SN_hmac_sha1 = "HMAC-SHA1";
pub const LN_hmac_sha1 = "hmac-sha1";
pub const NID_hmac_sha1 = @as(c_int, 781);
pub const OBJ_hmac_sha1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 8);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 2);
};
pub const SN_id_PasswordBasedMAC = "id-PasswordBasedMAC";
pub const LN_id_PasswordBasedMAC = "password based MAC";
pub const NID_id_PasswordBasedMAC = @as(c_int, 782);
pub const OBJ_id_PasswordBasedMAC = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113533);
    _ = @as(c_long, 7);
    _ = @as(c_long, 66);
    break :blk @as(c_long, 13);
};
pub const SN_id_DHBasedMac = "id-DHBasedMac";
pub const LN_id_DHBasedMac = "Diffie-Hellman based MAC";
pub const NID_id_DHBasedMac = @as(c_int, 783);
pub const OBJ_id_DHBasedMac = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113533);
    _ = @as(c_long, 7);
    _ = @as(c_long, 66);
    break :blk @as(c_long, 30);
};
pub const SN_id_it_suppLangTags = "id-it-suppLangTags";
pub const NID_id_it_suppLangTags = @as(c_int, 784);
pub const OBJ_id_it_suppLangTags = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 16);
};
pub const SN_caRepository = "caRepository";
pub const LN_caRepository = "CA Repository";
pub const NID_caRepository = @as(c_int, 785);
pub const OBJ_caRepository = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 48);
    break :blk @as(c_long, 5);
};
pub const SN_id_smime_ct_compressedData = "id-smime-ct-compressedData";
pub const NID_id_smime_ct_compressedData = @as(c_int, 786);
pub const OBJ_id_smime_ct_compressedData = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 9);
};
pub const SN_id_ct_asciiTextWithCRLF = "id-ct-asciiTextWithCRLF";
pub const NID_id_ct_asciiTextWithCRLF = @as(c_int, 787);
pub const OBJ_id_ct_asciiTextWithCRLF = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 27);
};
pub const SN_id_aes128_wrap = "id-aes128-wrap";
pub const NID_id_aes128_wrap = @as(c_int, 788);
pub const OBJ_id_aes128_wrap = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 5);
};
pub const SN_id_aes192_wrap = "id-aes192-wrap";
pub const NID_id_aes192_wrap = @as(c_int, 789);
pub const OBJ_id_aes192_wrap = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 25);
};
pub const SN_id_aes256_wrap = "id-aes256-wrap";
pub const NID_id_aes256_wrap = @as(c_int, 790);
pub const OBJ_id_aes256_wrap = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 45);
};
pub const SN_ecdsa_with_Recommended = "ecdsa-with-Recommended";
pub const NID_ecdsa_with_Recommended = @as(c_int, 791);
pub const OBJ_ecdsa_with_Recommended = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 2);
};
pub const SN_ecdsa_with_Specified = "ecdsa-with-Specified";
pub const NID_ecdsa_with_Specified = @as(c_int, 792);
pub const OBJ_ecdsa_with_Specified = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 3);
};
pub const SN_ecdsa_with_SHA224 = "ecdsa-with-SHA224";
pub const NID_ecdsa_with_SHA224 = @as(c_int, 793);
pub const OBJ_ecdsa_with_SHA224 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 4);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 1);
};
pub const SN_ecdsa_with_SHA256 = "ecdsa-with-SHA256";
pub const NID_ecdsa_with_SHA256 = @as(c_int, 794);
pub const OBJ_ecdsa_with_SHA256 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 4);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 2);
};
pub const SN_ecdsa_with_SHA384 = "ecdsa-with-SHA384";
pub const NID_ecdsa_with_SHA384 = @as(c_int, 795);
pub const OBJ_ecdsa_with_SHA384 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 4);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 3);
};
pub const SN_ecdsa_with_SHA512 = "ecdsa-with-SHA512";
pub const NID_ecdsa_with_SHA512 = @as(c_int, 796);
pub const OBJ_ecdsa_with_SHA512 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10045);
    _ = @as(c_long, 4);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 4);
};
pub const LN_hmacWithMD5 = "hmacWithMD5";
pub const NID_hmacWithMD5 = @as(c_int, 797);
pub const OBJ_hmacWithMD5 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 6);
};
pub const LN_hmacWithSHA224 = "hmacWithSHA224";
pub const NID_hmacWithSHA224 = @as(c_int, 798);
pub const OBJ_hmacWithSHA224 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 8);
};
pub const LN_hmacWithSHA256 = "hmacWithSHA256";
pub const NID_hmacWithSHA256 = @as(c_int, 799);
pub const OBJ_hmacWithSHA256 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 9);
};
pub const LN_hmacWithSHA384 = "hmacWithSHA384";
pub const NID_hmacWithSHA384 = @as(c_int, 800);
pub const OBJ_hmacWithSHA384 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 10);
};
pub const LN_hmacWithSHA512 = "hmacWithSHA512";
pub const NID_hmacWithSHA512 = @as(c_int, 801);
pub const OBJ_hmacWithSHA512 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 11);
};
pub const SN_dsa_with_SHA224 = "dsa_with_SHA224";
pub const NID_dsa_with_SHA224 = @as(c_int, 802);
pub const OBJ_dsa_with_SHA224 = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 1);
};
pub const SN_dsa_with_SHA256 = "dsa_with_SHA256";
pub const NID_dsa_with_SHA256 = @as(c_int, 803);
pub const OBJ_dsa_with_SHA256 = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 2);
};
pub const SN_whirlpool = "whirlpool";
pub const NID_whirlpool = @as(c_int, 804);
pub const OBJ_whirlpool = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 0);
    _ = @as(c_long, 10118);
    _ = @as(c_long, 3);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 55);
};
pub const SN_cryptopro = "cryptopro";
pub const NID_cryptopro = @as(c_int, 805);
pub const OBJ_cryptopro = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 2);
};
pub const SN_cryptocom = "cryptocom";
pub const NID_cryptocom = @as(c_int, 806);
pub const OBJ_cryptocom = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 9);
};
pub const SN_id_GostR3411_94_with_GostR3410_2001 = "id-GostR3411-94-with-GostR3410-2001";
pub const LN_id_GostR3411_94_with_GostR3410_2001 = "GOST R 34.11-94 with GOST R 34.10-2001";
pub const NID_id_GostR3411_94_with_GostR3410_2001 = @as(c_int, 807);
pub const OBJ_id_GostR3411_94_with_GostR3410_2001 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 3);
};
pub const SN_id_GostR3411_94_with_GostR3410_94 = "id-GostR3411-94-with-GostR3410-94";
pub const LN_id_GostR3411_94_with_GostR3410_94 = "GOST R 34.11-94 with GOST R 34.10-94";
pub const NID_id_GostR3411_94_with_GostR3410_94 = @as(c_int, 808);
pub const OBJ_id_GostR3411_94_with_GostR3410_94 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 4);
};
pub const SN_id_GostR3411_94 = "md_gost94";
pub const LN_id_GostR3411_94 = "GOST R 34.11-94";
pub const NID_id_GostR3411_94 = @as(c_int, 809);
pub const OBJ_id_GostR3411_94 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 9);
};
pub const SN_id_HMACGostR3411_94 = "id-HMACGostR3411-94";
pub const LN_id_HMACGostR3411_94 = "HMAC GOST 34.11-94";
pub const NID_id_HMACGostR3411_94 = @as(c_int, 810);
pub const OBJ_id_HMACGostR3411_94 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 10);
};
pub const SN_id_GostR3410_2001 = "gost2001";
pub const LN_id_GostR3410_2001 = "GOST R 34.10-2001";
pub const NID_id_GostR3410_2001 = @as(c_int, 811);

pub const OBJ_id_GostR3410_2001 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 19);
};

pub const NID_id_GostR3410_2012_256 = @as(c_int, 979);
pub const NID_id_GostR3410_2012_512 = @as(c_int, 980);
pub const SN_id_GostR3410_94 = "gost94";
pub const LN_id_GostR3410_94 = "GOST R 34.10-94";
pub const NID_id_GostR3410_94 = @as(c_int, 812);
pub const OBJ_id_GostR3410_94 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 20);
};
pub const SN_id_Gost28147_89 = "gost89";
pub const LN_id_Gost28147_89 = "GOST 28147-89";
pub const NID_id_Gost28147_89 = @as(c_int, 813);
pub const OBJ_id_Gost28147_89 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 21);
};
pub const SN_gost89_cnt = "gost89-cnt";
pub const NID_gost89_cnt = @as(c_int, 814);
pub const SN_id_Gost28147_89_MAC = "gost-mac";
pub const LN_id_Gost28147_89_MAC = "GOST 28147-89 MAC";
pub const NID_id_Gost28147_89_MAC = @as(c_int, 815);
pub const OBJ_id_Gost28147_89_MAC = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 22);
};
pub const SN_id_GostR3411_94_prf = "prf-gostr3411-94";
pub const LN_id_GostR3411_94_prf = "GOST R 34.11-94 PRF";
pub const NID_id_GostR3411_94_prf = @as(c_int, 816);
pub const OBJ_id_GostR3411_94_prf = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 23);
};
pub const SN_id_GostR3410_2001DH = "id-GostR3410-2001DH";
pub const LN_id_GostR3410_2001DH = "GOST R 34.10-2001 DH";
pub const NID_id_GostR3410_2001DH = @as(c_int, 817);
pub const OBJ_id_GostR3410_2001DH = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 98);
};
pub const SN_id_GostR3410_94DH = "id-GostR3410-94DH";
pub const LN_id_GostR3410_94DH = "GOST R 34.10-94 DH";
pub const NID_id_GostR3410_94DH = @as(c_int, 818);
pub const OBJ_id_GostR3410_94DH = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 99);
};
pub const SN_id_Gost28147_89_CryptoPro_KeyMeshing = "id-Gost28147-89-CryptoPro-KeyMeshing";
pub const NID_id_Gost28147_89_CryptoPro_KeyMeshing = @as(c_int, 819);
pub const OBJ_id_Gost28147_89_CryptoPro_KeyMeshing = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 14);
    break :blk @as(c_long, 1);
};
pub const SN_id_Gost28147_89_None_KeyMeshing = "id-Gost28147-89-None-KeyMeshing";
pub const NID_id_Gost28147_89_None_KeyMeshing = @as(c_int, 820);
pub const OBJ_id_Gost28147_89_None_KeyMeshing = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 14);
    break :blk @as(c_long, 0);
};
pub const SN_id_GostR3411_94_TestParamSet = "id-GostR3411-94-TestParamSet";
pub const NID_id_GostR3411_94_TestParamSet = @as(c_int, 821);
pub const OBJ_id_GostR3411_94_TestParamSet = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 30);
    break :blk @as(c_long, 0);
};
pub const SN_id_GostR3411_94_CryptoProParamSet = "id-GostR3411-94-CryptoProParamSet";
pub const NID_id_GostR3411_94_CryptoProParamSet = @as(c_int, 822);
pub const OBJ_id_GostR3411_94_CryptoProParamSet = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 30);
    break :blk @as(c_long, 1);
};
pub const SN_id_Gost28147_89_TestParamSet = "id-Gost28147-89-TestParamSet";
pub const NID_id_Gost28147_89_TestParamSet = @as(c_int, 823);
pub const OBJ_id_Gost28147_89_TestParamSet = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 31);
    break :blk @as(c_long, 0);
};
pub const SN_id_Gost28147_89_CryptoPro_A_ParamSet = "id-Gost28147-89-CryptoPro-A-ParamSet";
pub const NID_id_Gost28147_89_CryptoPro_A_ParamSet = @as(c_int, 824);
pub const OBJ_id_Gost28147_89_CryptoPro_A_ParamSet = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 31);
    break :blk @as(c_long, 1);
};
pub const SN_id_Gost28147_89_CryptoPro_B_ParamSet = "id-Gost28147-89-CryptoPro-B-ParamSet";
pub const NID_id_Gost28147_89_CryptoPro_B_ParamSet = @as(c_int, 825);
pub const OBJ_id_Gost28147_89_CryptoPro_B_ParamSet = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 31);
    break :blk @as(c_long, 2);
};
pub const SN_id_Gost28147_89_CryptoPro_C_ParamSet = "id-Gost28147-89-CryptoPro-C-ParamSet";
pub const NID_id_Gost28147_89_CryptoPro_C_ParamSet = @as(c_int, 826);
pub const OBJ_id_Gost28147_89_CryptoPro_C_ParamSet = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 31);
    break :blk @as(c_long, 3);
};
pub const SN_id_Gost28147_89_CryptoPro_D_ParamSet = "id-Gost28147-89-CryptoPro-D-ParamSet";
pub const NID_id_Gost28147_89_CryptoPro_D_ParamSet = @as(c_int, 827);
pub const OBJ_id_Gost28147_89_CryptoPro_D_ParamSet = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 31);
    break :blk @as(c_long, 4);
};
pub const SN_id_Gost28147_89_CryptoPro_Oscar_1_1_ParamSet = "id-Gost28147-89-CryptoPro-Oscar-1-1-ParamSet";
pub const NID_id_Gost28147_89_CryptoPro_Oscar_1_1_ParamSet = @as(c_int, 828);
pub const OBJ_id_Gost28147_89_CryptoPro_Oscar_1_1_ParamSet = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 31);
    break :blk @as(c_long, 5);
};
pub const SN_id_Gost28147_89_CryptoPro_Oscar_1_0_ParamSet = "id-Gost28147-89-CryptoPro-Oscar-1-0-ParamSet";
pub const NID_id_Gost28147_89_CryptoPro_Oscar_1_0_ParamSet = @as(c_int, 829);
pub const OBJ_id_Gost28147_89_CryptoPro_Oscar_1_0_ParamSet = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 31);
    break :blk @as(c_long, 6);
};
pub const SN_id_Gost28147_89_CryptoPro_RIC_1_ParamSet = "id-Gost28147-89-CryptoPro-RIC-1-ParamSet";
pub const NID_id_Gost28147_89_CryptoPro_RIC_1_ParamSet = @as(c_int, 830);
pub const OBJ_id_Gost28147_89_CryptoPro_RIC_1_ParamSet = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 31);
    break :blk @as(c_long, 7);
};
pub const SN_id_GostR3410_94_TestParamSet = "id-GostR3410-94-TestParamSet";
pub const NID_id_GostR3410_94_TestParamSet = @as(c_int, 831);
pub const OBJ_id_GostR3410_94_TestParamSet = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 32);
    break :blk @as(c_long, 0);
};
pub const SN_id_GostR3410_94_CryptoPro_A_ParamSet = "id-GostR3410-94-CryptoPro-A-ParamSet";
pub const NID_id_GostR3410_94_CryptoPro_A_ParamSet = @as(c_int, 832);
pub const OBJ_id_GostR3410_94_CryptoPro_A_ParamSet = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 32);
    break :blk @as(c_long, 2);
};
pub const SN_id_GostR3410_94_CryptoPro_B_ParamSet = "id-GostR3410-94-CryptoPro-B-ParamSet";
pub const NID_id_GostR3410_94_CryptoPro_B_ParamSet = @as(c_int, 833);
pub const OBJ_id_GostR3410_94_CryptoPro_B_ParamSet = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 32);
    break :blk @as(c_long, 3);
};
pub const SN_id_GostR3410_94_CryptoPro_C_ParamSet = "id-GostR3410-94-CryptoPro-C-ParamSet";
pub const NID_id_GostR3410_94_CryptoPro_C_ParamSet = @as(c_int, 834);
pub const OBJ_id_GostR3410_94_CryptoPro_C_ParamSet = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 32);
    break :blk @as(c_long, 4);
};
pub const SN_id_GostR3410_94_CryptoPro_D_ParamSet = "id-GostR3410-94-CryptoPro-D-ParamSet";
pub const NID_id_GostR3410_94_CryptoPro_D_ParamSet = @as(c_int, 835);
pub const OBJ_id_GostR3410_94_CryptoPro_D_ParamSet = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 32);
    break :blk @as(c_long, 5);
};
pub const SN_id_GostR3410_94_CryptoPro_XchA_ParamSet = "id-GostR3410-94-CryptoPro-XchA-ParamSet";
pub const NID_id_GostR3410_94_CryptoPro_XchA_ParamSet = @as(c_int, 836);
pub const OBJ_id_GostR3410_94_CryptoPro_XchA_ParamSet = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 33);
    break :blk @as(c_long, 1);
};
pub const SN_id_GostR3410_94_CryptoPro_XchB_ParamSet = "id-GostR3410-94-CryptoPro-XchB-ParamSet";
pub const NID_id_GostR3410_94_CryptoPro_XchB_ParamSet = @as(c_int, 837);
pub const OBJ_id_GostR3410_94_CryptoPro_XchB_ParamSet = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 33);
    break :blk @as(c_long, 2);
};
pub const SN_id_GostR3410_94_CryptoPro_XchC_ParamSet = "id-GostR3410-94-CryptoPro-XchC-ParamSet";
pub const NID_id_GostR3410_94_CryptoPro_XchC_ParamSet = @as(c_int, 838);
pub const OBJ_id_GostR3410_94_CryptoPro_XchC_ParamSet = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 33);
    break :blk @as(c_long, 3);
};
pub const SN_id_GostR3410_2001_TestParamSet = "id-GostR3410-2001-TestParamSet";
pub const NID_id_GostR3410_2001_TestParamSet = @as(c_int, 839);
pub const OBJ_id_GostR3410_2001_TestParamSet = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 35);
    break :blk @as(c_long, 0);
};
pub const SN_id_GostR3410_2001_CryptoPro_A_ParamSet = "id-GostR3410-2001-CryptoPro-A-ParamSet";
pub const NID_id_GostR3410_2001_CryptoPro_A_ParamSet = @as(c_int, 840);
pub const OBJ_id_GostR3410_2001_CryptoPro_A_ParamSet = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 35);
    break :blk @as(c_long, 1);
};
pub const SN_id_GostR3410_2001_CryptoPro_B_ParamSet = "id-GostR3410-2001-CryptoPro-B-ParamSet";
pub const NID_id_GostR3410_2001_CryptoPro_B_ParamSet = @as(c_int, 841);
pub const OBJ_id_GostR3410_2001_CryptoPro_B_ParamSet = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 35);
    break :blk @as(c_long, 2);
};
pub const SN_id_GostR3410_2001_CryptoPro_C_ParamSet = "id-GostR3410-2001-CryptoPro-C-ParamSet";
pub const NID_id_GostR3410_2001_CryptoPro_C_ParamSet = @as(c_int, 842);
pub const OBJ_id_GostR3410_2001_CryptoPro_C_ParamSet = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 35);
    break :blk @as(c_long, 3);
};
pub const SN_id_GostR3410_2001_CryptoPro_XchA_ParamSet = "id-GostR3410-2001-CryptoPro-XchA-ParamSet";
pub const NID_id_GostR3410_2001_CryptoPro_XchA_ParamSet = @as(c_int, 843);
pub const OBJ_id_GostR3410_2001_CryptoPro_XchA_ParamSet = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 36);
    break :blk @as(c_long, 0);
};
pub const SN_id_GostR3410_2001_CryptoPro_XchB_ParamSet = "id-GostR3410-2001-CryptoPro-XchB-ParamSet";
pub const NID_id_GostR3410_2001_CryptoPro_XchB_ParamSet = @as(c_int, 844);
pub const OBJ_id_GostR3410_2001_CryptoPro_XchB_ParamSet = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 36);
    break :blk @as(c_long, 1);
};
pub const SN_id_GostR3410_94_a = "id-GostR3410-94-a";
pub const NID_id_GostR3410_94_a = @as(c_int, 845);
pub const OBJ_id_GostR3410_94_a = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 20);
    break :blk @as(c_long, 1);
};
pub const SN_id_GostR3410_94_aBis = "id-GostR3410-94-aBis";
pub const NID_id_GostR3410_94_aBis = @as(c_int, 846);
pub const OBJ_id_GostR3410_94_aBis = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 20);
    break :blk @as(c_long, 2);
};
pub const SN_id_GostR3410_94_b = "id-GostR3410-94-b";
pub const NID_id_GostR3410_94_b = @as(c_int, 847);
pub const OBJ_id_GostR3410_94_b = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 20);
    break :blk @as(c_long, 3);
};
pub const SN_id_GostR3410_94_bBis = "id-GostR3410-94-bBis";
pub const NID_id_GostR3410_94_bBis = @as(c_int, 848);
pub const OBJ_id_GostR3410_94_bBis = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 2);
    _ = @as(c_long, 20);
    break :blk @as(c_long, 4);
};
pub const SN_id_Gost28147_89_cc = "id-Gost28147-89-cc";
pub const LN_id_Gost28147_89_cc = "GOST 28147-89 Cryptocom ParamSet";
pub const NID_id_Gost28147_89_cc = @as(c_int, 849);
pub const OBJ_id_Gost28147_89_cc = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 9);
    _ = @as(c_long, 1);
    _ = @as(c_long, 6);
    break :blk @as(c_long, 1);
};
pub const SN_id_GostR3410_94_cc = "gost94cc";
pub const LN_id_GostR3410_94_cc = "GOST 34.10-94 Cryptocom";
pub const NID_id_GostR3410_94_cc = @as(c_int, 850);
pub const OBJ_id_GostR3410_94_cc = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 9);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    break :blk @as(c_long, 3);
};
pub const SN_id_GostR3410_2001_cc = "gost2001cc";
pub const LN_id_GostR3410_2001_cc = "GOST 34.10-2001 Cryptocom";
pub const NID_id_GostR3410_2001_cc = @as(c_int, 851);
pub const OBJ_id_GostR3410_2001_cc = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 9);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    break :blk @as(c_long, 4);
};
pub const SN_id_GostR3411_94_with_GostR3410_94_cc = "id-GostR3411-94-with-GostR3410-94-cc";
pub const LN_id_GostR3411_94_with_GostR3410_94_cc = "GOST R 34.11-94 with GOST R 34.10-94 Cryptocom";
pub const NID_id_GostR3411_94_with_GostR3410_94_cc = @as(c_int, 852);
pub const OBJ_id_GostR3411_94_with_GostR3410_94_cc = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 9);
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 3);
};
pub const SN_id_GostR3411_94_with_GostR3410_2001_cc = "id-GostR3411-94-with-GostR3410-2001-cc";
pub const LN_id_GostR3411_94_with_GostR3410_2001_cc = "GOST R 34.11-94 with GOST R 34.10-2001 Cryptocom";
pub const NID_id_GostR3411_94_with_GostR3410_2001_cc = @as(c_int, 853);
pub const OBJ_id_GostR3411_94_with_GostR3410_2001_cc = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 9);
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 4);
};
pub const SN_id_GostR3410_2001_ParamSet_cc = "id-GostR3410-2001-ParamSet-cc";
pub const LN_id_GostR3410_2001_ParamSet_cc = "GOST R 3410-2001 Parameter Set Cryptocom";
pub const NID_id_GostR3410_2001_ParamSet_cc = @as(c_int, 854);
pub const OBJ_id_GostR3410_2001_ParamSet_cc = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 643);
    _ = @as(c_long, 2);
    _ = @as(c_long, 9);
    _ = @as(c_long, 1);
    _ = @as(c_long, 8);
    break :blk @as(c_long, 1);
};
pub const SN_hmac = "HMAC";
pub const LN_hmac = "hmac";
pub const NID_hmac = @as(c_int, 855);
pub const SN_LocalKeySet = "LocalKeySet";
pub const LN_LocalKeySet = "Microsoft Local Key set";
pub const NID_LocalKeySet = @as(c_int, 856);
pub const OBJ_LocalKeySet = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    _ = @as(c_long, 311);
    _ = @as(c_long, 17);
    break :blk @as(c_long, 2);
};
pub const SN_freshest_crl = "freshestCRL";
pub const LN_freshest_crl = "X509v3 Freshest CRL";
pub const NID_freshest_crl = @as(c_int, 857);
pub const OBJ_freshest_crl = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 29);
    break :blk @as(c_long, 46);
};
pub const SN_id_on_permanentIdentifier = "id-on-permanentIdentifier";
pub const LN_id_on_permanentIdentifier = "Permanent Identifier";
pub const NID_id_on_permanentIdentifier = @as(c_int, 858);
pub const OBJ_id_on_permanentIdentifier = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 6);
    _ = @as(c_long, 1);
    _ = @as(c_long, 5);
    _ = @as(c_long, 5);
    _ = @as(c_long, 7);
    _ = @as(c_long, 8);
    break :blk @as(c_long, 3);
};
pub const LN_searchGuide = "searchGuide";
pub const NID_searchGuide = @as(c_int, 859);
pub const OBJ_searchGuide = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 14);
};
pub const LN_businessCategory = "businessCategory";
pub const NID_businessCategory = @as(c_int, 860);
pub const OBJ_businessCategory = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 15);
};
pub const LN_postalAddress = "postalAddress";
pub const NID_postalAddress = @as(c_int, 861);
pub const OBJ_postalAddress = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 16);
};
pub const LN_postOfficeBox = "postOfficeBox";
pub const NID_postOfficeBox = @as(c_int, 862);
pub const OBJ_postOfficeBox = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 18);
};
pub const LN_physicalDeliveryOfficeName = "physicalDeliveryOfficeName";
pub const NID_physicalDeliveryOfficeName = @as(c_int, 863);
pub const OBJ_physicalDeliveryOfficeName = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 19);
};
pub const LN_telephoneNumber = "telephoneNumber";
pub const NID_telephoneNumber = @as(c_int, 864);
pub const OBJ_telephoneNumber = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 20);
};
pub const LN_telexNumber = "telexNumber";
pub const NID_telexNumber = @as(c_int, 865);
pub const OBJ_telexNumber = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 21);
};
pub const LN_teletexTerminalIdentifier = "teletexTerminalIdentifier";
pub const NID_teletexTerminalIdentifier = @as(c_int, 866);
pub const OBJ_teletexTerminalIdentifier = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 22);
};
pub const LN_facsimileTelephoneNumber = "facsimileTelephoneNumber";
pub const NID_facsimileTelephoneNumber = @as(c_int, 867);
pub const OBJ_facsimileTelephoneNumber = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 23);
};
pub const LN_x121Address = "x121Address";
pub const NID_x121Address = @as(c_int, 868);
pub const OBJ_x121Address = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 24);
};
pub const LN_internationaliSDNNumber = "internationaliSDNNumber";
pub const NID_internationaliSDNNumber = @as(c_int, 869);
pub const OBJ_internationaliSDNNumber = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 25);
};
pub const LN_registeredAddress = "registeredAddress";
pub const NID_registeredAddress = @as(c_int, 870);
pub const OBJ_registeredAddress = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 26);
};
pub const LN_destinationIndicator = "destinationIndicator";
pub const NID_destinationIndicator = @as(c_int, 871);
pub const OBJ_destinationIndicator = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 27);
};
pub const LN_preferredDeliveryMethod = "preferredDeliveryMethod";
pub const NID_preferredDeliveryMethod = @as(c_int, 872);
pub const OBJ_preferredDeliveryMethod = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 28);
};
pub const LN_presentationAddress = "presentationAddress";
pub const NID_presentationAddress = @as(c_int, 873);
pub const OBJ_presentationAddress = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 29);
};
pub const LN_supportedApplicationContext = "supportedApplicationContext";
pub const NID_supportedApplicationContext = @as(c_int, 874);
pub const OBJ_supportedApplicationContext = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 30);
};
pub const SN_member = "member";
pub const NID_member = @as(c_int, 875);
pub const OBJ_member = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 31);
};
pub const SN_owner = "owner";
pub const NID_owner = @as(c_int, 876);
pub const OBJ_owner = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 32);
};
pub const LN_roleOccupant = "roleOccupant";
pub const NID_roleOccupant = @as(c_int, 877);
pub const OBJ_roleOccupant = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 33);
};
pub const SN_seeAlso = "seeAlso";
pub const NID_seeAlso = @as(c_int, 878);
pub const OBJ_seeAlso = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 34);
};
pub const LN_userPassword = "userPassword";
pub const NID_userPassword = @as(c_int, 879);
pub const OBJ_userPassword = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 35);
};
pub const LN_userCertificate = "userCertificate";
pub const NID_userCertificate = @as(c_int, 880);
pub const OBJ_userCertificate = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 36);
};
pub const LN_cACertificate = "cACertificate";
pub const NID_cACertificate = @as(c_int, 881);
pub const OBJ_cACertificate = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 37);
};
pub const LN_authorityRevocationList = "authorityRevocationList";
pub const NID_authorityRevocationList = @as(c_int, 882);
pub const OBJ_authorityRevocationList = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 38);
};
pub const LN_certificateRevocationList = "certificateRevocationList";
pub const NID_certificateRevocationList = @as(c_int, 883);
pub const OBJ_certificateRevocationList = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 39);
};
pub const LN_crossCertificatePair = "crossCertificatePair";
pub const NID_crossCertificatePair = @as(c_int, 884);
pub const OBJ_crossCertificatePair = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 40);
};
pub const LN_enhancedSearchGuide = "enhancedSearchGuide";
pub const NID_enhancedSearchGuide = @as(c_int, 885);
pub const OBJ_enhancedSearchGuide = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 47);
};
pub const LN_protocolInformation = "protocolInformation";
pub const NID_protocolInformation = @as(c_int, 886);
pub const OBJ_protocolInformation = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 48);
};
pub const LN_distinguishedName = "distinguishedName";
pub const NID_distinguishedName = @as(c_int, 887);
pub const OBJ_distinguishedName = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 49);
};
pub const LN_uniqueMember = "uniqueMember";
pub const NID_uniqueMember = @as(c_int, 888);
pub const OBJ_uniqueMember = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 50);
};
pub const LN_houseIdentifier = "houseIdentifier";
pub const NID_houseIdentifier = @as(c_int, 889);
pub const OBJ_houseIdentifier = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 51);
};
pub const LN_supportedAlgorithms = "supportedAlgorithms";
pub const NID_supportedAlgorithms = @as(c_int, 890);
pub const OBJ_supportedAlgorithms = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 52);
};
pub const LN_deltaRevocationList = "deltaRevocationList";
pub const NID_deltaRevocationList = @as(c_int, 891);
pub const OBJ_deltaRevocationList = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 53);
};
pub const SN_dmdName = "dmdName";
pub const NID_dmdName = @as(c_int, 892);
pub const OBJ_dmdName = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 4);
    break :blk @as(c_long, 54);
};
pub const SN_id_alg_PWRI_KEK = "id-alg-PWRI-KEK";
pub const NID_id_alg_PWRI_KEK = @as(c_int, 893);
pub const OBJ_id_alg_PWRI_KEK = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 9);
    _ = @as(c_long, 16);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 9);
};
pub const SN_cmac = "CMAC";
pub const LN_cmac = "cmac";
pub const NID_cmac = @as(c_int, 894);
pub const SN_aes_128_gcm = "id-aes128-GCM";
pub const LN_aes_128_gcm = "aes-128-gcm";
pub const NID_aes_128_gcm = @as(c_int, 895);
pub const OBJ_aes_128_gcm = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 6);
};
pub const SN_aes_128_ccm = "id-aes128-CCM";
pub const LN_aes_128_ccm = "aes-128-ccm";
pub const NID_aes_128_ccm = @as(c_int, 896);
pub const OBJ_aes_128_ccm = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 7);
};
pub const SN_id_aes128_wrap_pad = "id-aes128-wrap-pad";
pub const NID_id_aes128_wrap_pad = @as(c_int, 897);
pub const OBJ_id_aes128_wrap_pad = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 8);
};
pub const SN_aes_192_gcm = "id-aes192-GCM";
pub const LN_aes_192_gcm = "aes-192-gcm";
pub const NID_aes_192_gcm = @as(c_int, 898);
pub const OBJ_aes_192_gcm = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 26);
};
pub const SN_aes_192_ccm = "id-aes192-CCM";
pub const LN_aes_192_ccm = "aes-192-ccm";
pub const NID_aes_192_ccm = @as(c_int, 899);
pub const OBJ_aes_192_ccm = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 27);
};
pub const SN_id_aes192_wrap_pad = "id-aes192-wrap-pad";
pub const NID_id_aes192_wrap_pad = @as(c_int, 900);
pub const OBJ_id_aes192_wrap_pad = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 28);
};
pub const SN_aes_256_gcm = "id-aes256-GCM";
pub const LN_aes_256_gcm = "aes-256-gcm";
pub const NID_aes_256_gcm = @as(c_int, 901);
pub const OBJ_aes_256_gcm = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 46);
};
pub const SN_aes_256_ccm = "id-aes256-CCM";
pub const LN_aes_256_ccm = "aes-256-ccm";
pub const NID_aes_256_ccm = @as(c_int, 902);
pub const OBJ_aes_256_ccm = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 47);
};
pub const SN_id_aes256_wrap_pad = "id-aes256-wrap-pad";
pub const NID_id_aes256_wrap_pad = @as(c_int, 903);
pub const OBJ_id_aes256_wrap_pad = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 48);
};
pub const SN_aes_128_ctr = "AES-128-CTR";
pub const LN_aes_128_ctr = "aes-128-ctr";
pub const NID_aes_128_ctr = @as(c_int, 904);
pub const SN_aes_192_ctr = "AES-192-CTR";
pub const LN_aes_192_ctr = "aes-192-ctr";
pub const NID_aes_192_ctr = @as(c_int, 905);
pub const SN_aes_256_ctr = "AES-256-CTR";
pub const LN_aes_256_ctr = "aes-256-ctr";
pub const NID_aes_256_ctr = @as(c_int, 906);
pub const SN_id_camellia128_wrap = "id-camellia128-wrap";
pub const NID_id_camellia128_wrap = @as(c_int, 907);
pub const OBJ_id_camellia128_wrap = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 392);
    _ = @as(c_long, 200011);
    _ = @as(c_long, 61);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 2);
};
pub const SN_id_camellia192_wrap = "id-camellia192-wrap";
pub const NID_id_camellia192_wrap = @as(c_int, 908);
pub const OBJ_id_camellia192_wrap = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 392);
    _ = @as(c_long, 200011);
    _ = @as(c_long, 61);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 3);
};
pub const SN_id_camellia256_wrap = "id-camellia256-wrap";
pub const NID_id_camellia256_wrap = @as(c_int, 909);
pub const OBJ_id_camellia256_wrap = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 392);
    _ = @as(c_long, 200011);
    _ = @as(c_long, 61);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    break :blk @as(c_long, 4);
};
pub const SN_anyExtendedKeyUsage = "anyExtendedKeyUsage";
pub const LN_anyExtendedKeyUsage = "Any Extended Key Usage";
pub const NID_anyExtendedKeyUsage = @as(c_int, 910);
pub const OBJ_anyExtendedKeyUsage = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 5);
    _ = @as(c_long, 29);
    _ = @as(c_long, 37);
    break :blk @as(c_long, 0);
};
pub const SN_mgf1 = "MGF1";
pub const LN_mgf1 = "mgf1";
pub const NID_mgf1 = @as(c_int, 911);
pub const OBJ_mgf1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 8);
};
pub const SN_rsassaPss = "RSASSA-PSS";
pub const LN_rsassaPss = "rsassaPss";
pub const NID_rsassaPss = @as(c_int, 912);
pub const OBJ_rsassaPss = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 10);
};
pub const SN_aes_128_xts = "AES-128-XTS";
pub const LN_aes_128_xts = "aes-128-xts";
pub const NID_aes_128_xts = @as(c_int, 913);
pub const SN_aes_256_xts = "AES-256-XTS";
pub const LN_aes_256_xts = "aes-256-xts";
pub const NID_aes_256_xts = @as(c_int, 914);
pub const SN_rc4_hmac_md5 = "RC4-HMAC-MD5";
pub const LN_rc4_hmac_md5 = "rc4-hmac-md5";
pub const NID_rc4_hmac_md5 = @as(c_int, 915);
pub const SN_aes_128_cbc_hmac_sha1 = "AES-128-CBC-HMAC-SHA1";
pub const LN_aes_128_cbc_hmac_sha1 = "aes-128-cbc-hmac-sha1";
pub const NID_aes_128_cbc_hmac_sha1 = @as(c_int, 916);
pub const SN_aes_192_cbc_hmac_sha1 = "AES-192-CBC-HMAC-SHA1";
pub const LN_aes_192_cbc_hmac_sha1 = "aes-192-cbc-hmac-sha1";
pub const NID_aes_192_cbc_hmac_sha1 = @as(c_int, 917);
pub const SN_aes_256_cbc_hmac_sha1 = "AES-256-CBC-HMAC-SHA1";
pub const LN_aes_256_cbc_hmac_sha1 = "aes-256-cbc-hmac-sha1";
pub const NID_aes_256_cbc_hmac_sha1 = @as(c_int, 918);
pub const SN_rsaesOaep = "RSAES-OAEP";
pub const LN_rsaesOaep = "rsaesOaep";
pub const NID_rsaesOaep = @as(c_int, 919);
pub const OBJ_rsaesOaep = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 7);
};
pub const SN_dhpublicnumber = "dhpublicnumber";
pub const LN_dhpublicnumber = "X9.42 DH";
pub const NID_dhpublicnumber = @as(c_int, 920);
pub const OBJ_dhpublicnumber = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 10046);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 1);
};
pub const SN_brainpoolP160r1 = "brainpoolP160r1";
pub const NID_brainpoolP160r1 = @as(c_int, 921);
pub const OBJ_brainpoolP160r1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 36);
    _ = @as(c_long, 3);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    _ = @as(c_long, 8);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 1);
};
pub const SN_brainpoolP160t1 = "brainpoolP160t1";
pub const NID_brainpoolP160t1 = @as(c_int, 922);
pub const OBJ_brainpoolP160t1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 36);
    _ = @as(c_long, 3);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    _ = @as(c_long, 8);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 2);
};
pub const SN_brainpoolP192r1 = "brainpoolP192r1";
pub const NID_brainpoolP192r1 = @as(c_int, 923);
pub const OBJ_brainpoolP192r1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 36);
    _ = @as(c_long, 3);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    _ = @as(c_long, 8);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 3);
};
pub const SN_brainpoolP192t1 = "brainpoolP192t1";
pub const NID_brainpoolP192t1 = @as(c_int, 924);
pub const OBJ_brainpoolP192t1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 36);
    _ = @as(c_long, 3);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    _ = @as(c_long, 8);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 4);
};
pub const SN_brainpoolP224r1 = "brainpoolP224r1";
pub const NID_brainpoolP224r1 = @as(c_int, 925);
pub const OBJ_brainpoolP224r1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 36);
    _ = @as(c_long, 3);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    _ = @as(c_long, 8);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 5);
};
pub const SN_brainpoolP224t1 = "brainpoolP224t1";
pub const NID_brainpoolP224t1 = @as(c_int, 926);
pub const OBJ_brainpoolP224t1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 36);
    _ = @as(c_long, 3);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    _ = @as(c_long, 8);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 6);
};
pub const SN_brainpoolP256r1 = "brainpoolP256r1";
pub const NID_brainpoolP256r1 = @as(c_int, 927);
pub const OBJ_brainpoolP256r1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 36);
    _ = @as(c_long, 3);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    _ = @as(c_long, 8);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 7);
};
pub const SN_brainpoolP256t1 = "brainpoolP256t1";
pub const NID_brainpoolP256t1 = @as(c_int, 928);
pub const OBJ_brainpoolP256t1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 36);
    _ = @as(c_long, 3);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    _ = @as(c_long, 8);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 8);
};
pub const SN_brainpoolP320r1 = "brainpoolP320r1";
pub const NID_brainpoolP320r1 = @as(c_int, 929);
pub const OBJ_brainpoolP320r1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 36);
    _ = @as(c_long, 3);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    _ = @as(c_long, 8);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 9);
};
pub const SN_brainpoolP320t1 = "brainpoolP320t1";
pub const NID_brainpoolP320t1 = @as(c_int, 930);
pub const OBJ_brainpoolP320t1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 36);
    _ = @as(c_long, 3);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    _ = @as(c_long, 8);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 10);
};
pub const SN_brainpoolP384r1 = "brainpoolP384r1";
pub const NID_brainpoolP384r1 = @as(c_int, 931);
pub const OBJ_brainpoolP384r1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 36);
    _ = @as(c_long, 3);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    _ = @as(c_long, 8);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 11);
};
pub const SN_brainpoolP384t1 = "brainpoolP384t1";
pub const NID_brainpoolP384t1 = @as(c_int, 932);
pub const OBJ_brainpoolP384t1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 36);
    _ = @as(c_long, 3);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    _ = @as(c_long, 8);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 12);
};
pub const SN_brainpoolP512r1 = "brainpoolP512r1";
pub const NID_brainpoolP512r1 = @as(c_int, 933);
pub const OBJ_brainpoolP512r1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 36);
    _ = @as(c_long, 3);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    _ = @as(c_long, 8);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 13);
};
pub const SN_brainpoolP512t1 = "brainpoolP512t1";
pub const NID_brainpoolP512t1 = @as(c_int, 934);
pub const OBJ_brainpoolP512t1 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 36);
    _ = @as(c_long, 3);
    _ = @as(c_long, 3);
    _ = @as(c_long, 2);
    _ = @as(c_long, 8);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 14);
};
pub const SN_pSpecified = "PSPECIFIED";
pub const LN_pSpecified = "pSpecified";
pub const NID_pSpecified = @as(c_int, 935);
pub const OBJ_pSpecified = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 2);
    _ = @as(c_long, 840);
    _ = @as(c_long, 113549);
    _ = @as(c_long, 1);
    _ = @as(c_long, 1);
    break :blk @as(c_long, 9);
};
pub const SN_dhSinglePass_stdDH_sha1kdf_scheme = "dhSinglePass-stdDH-sha1kdf-scheme";
pub const NID_dhSinglePass_stdDH_sha1kdf_scheme = @as(c_int, 936);
pub const OBJ_dhSinglePass_stdDH_sha1kdf_scheme = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 133);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 63);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 2);
};
pub const SN_dhSinglePass_stdDH_sha224kdf_scheme = "dhSinglePass-stdDH-sha224kdf-scheme";
pub const NID_dhSinglePass_stdDH_sha224kdf_scheme = @as(c_int, 937);
pub const OBJ_dhSinglePass_stdDH_sha224kdf_scheme = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 1);
    _ = @as(c_long, 11);
    break :blk @as(c_long, 0);
};
pub const SN_dhSinglePass_stdDH_sha256kdf_scheme = "dhSinglePass-stdDH-sha256kdf-scheme";
pub const NID_dhSinglePass_stdDH_sha256kdf_scheme = @as(c_int, 938);
pub const OBJ_dhSinglePass_stdDH_sha256kdf_scheme = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 1);
    _ = @as(c_long, 11);
    break :blk @as(c_long, 1);
};
pub const SN_dhSinglePass_stdDH_sha384kdf_scheme = "dhSinglePass-stdDH-sha384kdf-scheme";
pub const NID_dhSinglePass_stdDH_sha384kdf_scheme = @as(c_int, 939);
pub const OBJ_dhSinglePass_stdDH_sha384kdf_scheme = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 1);
    _ = @as(c_long, 11);
    break :blk @as(c_long, 2);
};
pub const SN_dhSinglePass_stdDH_sha512kdf_scheme = "dhSinglePass-stdDH-sha512kdf-scheme";
pub const NID_dhSinglePass_stdDH_sha512kdf_scheme = @as(c_int, 940);
pub const OBJ_dhSinglePass_stdDH_sha512kdf_scheme = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 1);
    _ = @as(c_long, 11);
    break :blk @as(c_long, 3);
};
pub const SN_dhSinglePass_cofactorDH_sha1kdf_scheme = "dhSinglePass-cofactorDH-sha1kdf-scheme";
pub const NID_dhSinglePass_cofactorDH_sha1kdf_scheme = @as(c_int, 941);
pub const OBJ_dhSinglePass_cofactorDH_sha1kdf_scheme = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 133);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 63);
    _ = @as(c_long, 0);
    break :blk @as(c_long, 3);
};
pub const SN_dhSinglePass_cofactorDH_sha224kdf_scheme = "dhSinglePass-cofactorDH-sha224kdf-scheme";
pub const NID_dhSinglePass_cofactorDH_sha224kdf_scheme = @as(c_int, 942);
pub const OBJ_dhSinglePass_cofactorDH_sha224kdf_scheme = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 1);
    _ = @as(c_long, 14);
    break :blk @as(c_long, 0);
};
pub const SN_dhSinglePass_cofactorDH_sha256kdf_scheme = "dhSinglePass-cofactorDH-sha256kdf-scheme";
pub const NID_dhSinglePass_cofactorDH_sha256kdf_scheme = @as(c_int, 943);
pub const OBJ_dhSinglePass_cofactorDH_sha256kdf_scheme = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 1);
    _ = @as(c_long, 14);
    break :blk @as(c_long, 1);
};
pub const SN_dhSinglePass_cofactorDH_sha384kdf_scheme = "dhSinglePass-cofactorDH-sha384kdf-scheme";
pub const NID_dhSinglePass_cofactorDH_sha384kdf_scheme = @as(c_int, 944);
pub const OBJ_dhSinglePass_cofactorDH_sha384kdf_scheme = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 1);
    _ = @as(c_long, 14);
    break :blk @as(c_long, 2);
};
pub const SN_dhSinglePass_cofactorDH_sha512kdf_scheme = "dhSinglePass-cofactorDH-sha512kdf-scheme";
pub const NID_dhSinglePass_cofactorDH_sha512kdf_scheme = @as(c_int, 945);
pub const OBJ_dhSinglePass_cofactorDH_sha512kdf_scheme = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 132);
    _ = @as(c_long, 1);
    _ = @as(c_long, 14);
    break :blk @as(c_long, 3);
};
pub const SN_dh_std_kdf = "dh-std-kdf";
pub const NID_dh_std_kdf = @as(c_int, 946);
pub const SN_dh_cofactor_kdf = "dh-cofactor-kdf";
pub const NID_dh_cofactor_kdf = @as(c_int, 947);
pub const SN_X25519 = "X25519";
pub const NID_X25519 = @as(c_int, 948);
pub const OBJ_X25519 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 101);
    break :blk @as(c_long, 110);
};
pub const SN_ED25519 = "ED25519";
pub const NID_ED25519 = @as(c_int, 949);
pub const OBJ_ED25519 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 101);
    break :blk @as(c_long, 112);
};
pub const SN_chacha20_poly1305 = "ChaCha20-Poly1305";
pub const LN_chacha20_poly1305 = "chacha20-poly1305";
pub const NID_chacha20_poly1305 = @as(c_int, 950);
pub const SN_kx_rsa = "KxRSA";
pub const LN_kx_rsa = "kx-rsa";
pub const NID_kx_rsa = @as(c_int, 951);
pub const SN_kx_ecdhe = "KxECDHE";
pub const LN_kx_ecdhe = "kx-ecdhe";
pub const NID_kx_ecdhe = @as(c_int, 952);
pub const SN_kx_psk = "KxPSK";
pub const LN_kx_psk = "kx-psk";
pub const NID_kx_psk = @as(c_int, 953);
pub const SN_auth_rsa = "AuthRSA";
pub const LN_auth_rsa = "auth-rsa";
pub const NID_auth_rsa = @as(c_int, 954);
pub const SN_auth_ecdsa = "AuthECDSA";
pub const LN_auth_ecdsa = "auth-ecdsa";
pub const NID_auth_ecdsa = @as(c_int, 955);
pub const SN_auth_psk = "AuthPSK";
pub const LN_auth_psk = "auth-psk";
pub const NID_auth_psk = @as(c_int, 956);
pub const SN_kx_any = "KxANY";
pub const LN_kx_any = "kx-any";
pub const NID_kx_any = @as(c_int, 957);
pub const SN_auth_any = "AuthANY";
pub const LN_auth_any = "auth-any";
pub const NID_auth_any = @as(c_int, 958);
pub const SN_CECPQ2 = "CECPQ2";
pub const NID_CECPQ2 = @as(c_int, 959);
pub const SN_ED448 = "ED448";
pub const NID_ED448 = @as(c_int, 960);
pub const OBJ_ED448 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 101);
    break :blk @as(c_long, 113);
};
pub const SN_X448 = "X448";
pub const NID_X448 = @as(c_int, 961);
pub const OBJ_X448 = blk: {
    _ = @as(c_long, 1);
    _ = @as(c_long, 3);
    _ = @as(c_long, 101);
    break :blk @as(c_long, 111);
};
pub const SN_sha512_256 = "SHA512-256";
pub const LN_sha512_256 = "sha512-256";
pub const NID_sha512_256 = @as(c_int, 962);
pub const OBJ_sha512_256 = blk: {
    _ = @as(c_long, 2);
    _ = @as(c_long, 16);
    _ = @as(c_long, 840);
    _ = @as(c_long, 1);
    _ = @as(c_long, 101);
    _ = @as(c_long, 3);
    _ = @as(c_long, 4);
    _ = @as(c_long, 2);
    break :blk @as(c_long, 6);
};
pub const SN_hkdf = "HKDF";
pub const LN_hkdf = "hkdf";
pub const NID_hkdf = @as(c_int, 963);
pub const EVP_PKEY_NONE = NID_undef;
pub const EVP_PKEY_RSA = NID_rsaEncryption;
pub const EVP_PKEY_RSA_PSS = NID_rsassaPss;
pub const EVP_PKEY_DSA = NID_dsa;
pub const EVP_PKEY_EC = NID_X9_62_id_ecPublicKey;
pub const EVP_PKEY_ED25519 = NID_ED25519;
pub const EVP_PKEY_X25519 = NID_X25519;
pub const EVP_PKEY_HKDF = NID_hkdf;
pub const EVP_PKEY_DH = NID_dhKeyAgreement;
pub const EVP_PKEY_RSA2 = NID_rsa;
pub const EVP_PKEY_X448 = NID_X448;
pub const EVP_PKEY_ED448 = NID_ED448;
pub const OPENSSL_HEADER_PKCS7_H = "";
pub const PKCS7_DETACHED = @as(c_int, 0x40);
pub const PKCS7_TEXT = @as(c_int, 0x1);
pub const PKCS7_NOCERTS = @as(c_int, 0x2);
pub const PKCS7_NOSIGS = @as(c_int, 0x4);
pub const PKCS7_NOCHAIN = @as(c_int, 0x8);
pub const PKCS7_NOINTERN = @as(c_int, 0x10);
pub const PKCS7_NOVERIFY = @as(c_int, 0x20);
pub const PKCS7_BINARY = @as(c_int, 0x80);
pub const PKCS7_NOATTR = @as(c_int, 0x100);
pub const PKCS7_NOSMIMECAP = @as(c_int, 0x200);
pub const PKCS7_STREAM = @as(c_int, 0x1000);
pub const PKCS7_PARTIAL = @as(c_int, 0x4000);
pub const PKCS7_R_BAD_PKCS7_VERSION = @as(c_int, 100);
pub const PKCS7_R_NOT_PKCS7_SIGNED_DATA = @as(c_int, 101);
pub const PKCS7_R_NO_CERTIFICATES_INCLUDED = @as(c_int, 102);
pub const PKCS7_R_NO_CRLS_INCLUDED = @as(c_int, 103);
pub const HEADER_X509_H = "";
pub const HEADER_ASN1_H = "";
pub const OPENSSL_HEADER_BN_H = "";
pub const __CLANG_INTTYPES_H = "";
pub const _INTTYPES_H_ = "";
pub const __PRI_8_LENGTH_MODIFIER__ = "hh";
pub const __PRI_64_LENGTH_MODIFIER__ = "ll";
pub const __SCN_64_LENGTH_MODIFIER__ = "ll";
pub const __PRI_MAX_LENGTH_MODIFIER__ = "j";
pub const __SCN_MAX_LENGTH_MODIFIER__ = "j";
pub const PRId8 = __PRI_8_LENGTH_MODIFIER__ ++ "d";
pub const PRIi8 = __PRI_8_LENGTH_MODIFIER__ ++ "i";
pub const PRIo8 = __PRI_8_LENGTH_MODIFIER__ ++ "o";
pub const PRIu8 = __PRI_8_LENGTH_MODIFIER__ ++ "u";
pub const PRIx8 = __PRI_8_LENGTH_MODIFIER__ ++ "x";
pub const PRIX8 = __PRI_8_LENGTH_MODIFIER__ ++ "X";
pub const PRId16 = "hd";
pub const PRIi16 = "hi";
pub const PRIo16 = "ho";
pub const PRIu16 = "hu";
pub const PRIx16 = "hx";
pub const PRIX16 = "hX";
pub const PRId32 = "d";
pub const PRIi32 = "i";
pub const PRIo32 = "o";
pub const PRIu32 = "u";
pub const PRIx32 = "x";
pub const PRIX32 = "X";
pub const PRId64 = __PRI_64_LENGTH_MODIFIER__ ++ "d";
pub const PRIi64 = __PRI_64_LENGTH_MODIFIER__ ++ "i";
pub const PRIo64 = __PRI_64_LENGTH_MODIFIER__ ++ "o";
pub const PRIu64 = __PRI_64_LENGTH_MODIFIER__ ++ "u";
pub const PRIx64 = __PRI_64_LENGTH_MODIFIER__ ++ "x";
pub const PRIX64 = __PRI_64_LENGTH_MODIFIER__ ++ "X";
pub const PRIdLEAST8 = PRId8;
pub const PRIiLEAST8 = PRIi8;
pub const PRIoLEAST8 = PRIo8;
pub const PRIuLEAST8 = PRIu8;
pub const PRIxLEAST8 = PRIx8;
pub const PRIXLEAST8 = PRIX8;
pub const PRIdLEAST16 = PRId16;
pub const PRIiLEAST16 = PRIi16;
pub const PRIoLEAST16 = PRIo16;
pub const PRIuLEAST16 = PRIu16;
pub const PRIxLEAST16 = PRIx16;
pub const PRIXLEAST16 = PRIX16;
pub const PRIdLEAST32 = PRId32;
pub const PRIiLEAST32 = PRIi32;
pub const PRIoLEAST32 = PRIo32;
pub const PRIuLEAST32 = PRIu32;
pub const PRIxLEAST32 = PRIx32;
pub const PRIXLEAST32 = PRIX32;
pub const PRIdLEAST64 = PRId64;
pub const PRIiLEAST64 = PRIi64;
pub const PRIoLEAST64 = PRIo64;
pub const PRIuLEAST64 = PRIu64;
pub const PRIxLEAST64 = PRIx64;
pub const PRIXLEAST64 = PRIX64;
pub const PRIdFAST8 = PRId8;
pub const PRIiFAST8 = PRIi8;
pub const PRIoFAST8 = PRIo8;
pub const PRIuFAST8 = PRIu8;
pub const PRIxFAST8 = PRIx8;
pub const PRIXFAST8 = PRIX8;
pub const PRIdFAST16 = PRId16;
pub const PRIiFAST16 = PRIi16;
pub const PRIoFAST16 = PRIo16;
pub const PRIuFAST16 = PRIu16;
pub const PRIxFAST16 = PRIx16;
pub const PRIXFAST16 = PRIX16;
pub const PRIdFAST32 = PRId32;
pub const PRIiFAST32 = PRIi32;
pub const PRIoFAST32 = PRIo32;
pub const PRIuFAST32 = PRIu32;
pub const PRIxFAST32 = PRIx32;
pub const PRIXFAST32 = PRIX32;
pub const PRIdFAST64 = PRId64;
pub const PRIiFAST64 = PRIi64;
pub const PRIoFAST64 = PRIo64;
pub const PRIuFAST64 = PRIu64;
pub const PRIxFAST64 = PRIx64;
pub const PRIXFAST64 = PRIX64;
pub const PRIdPTR = "ld";
pub const PRIiPTR = "li";
pub const PRIoPTR = "lo";
pub const PRIuPTR = "lu";
pub const PRIxPTR = "lx";
pub const PRIXPTR = "lX";
pub const PRIdMAX = __PRI_MAX_LENGTH_MODIFIER__ ++ "d";
pub const PRIiMAX = __PRI_MAX_LENGTH_MODIFIER__ ++ "i";
pub const PRIoMAX = __PRI_MAX_LENGTH_MODIFIER__ ++ "o";
pub const PRIuMAX = __PRI_MAX_LENGTH_MODIFIER__ ++ "u";
pub const PRIxMAX = __PRI_MAX_LENGTH_MODIFIER__ ++ "x";
pub const PRIXMAX = __PRI_MAX_LENGTH_MODIFIER__ ++ "X";
pub const SCNd8 = __PRI_8_LENGTH_MODIFIER__ ++ "d";
pub const SCNi8 = __PRI_8_LENGTH_MODIFIER__ ++ "i";
pub const SCNo8 = __PRI_8_LENGTH_MODIFIER__ ++ "o";
pub const SCNu8 = __PRI_8_LENGTH_MODIFIER__ ++ "u";
pub const SCNx8 = __PRI_8_LENGTH_MODIFIER__ ++ "x";
pub const SCNd16 = "hd";
pub const SCNi16 = "hi";
pub const SCNo16 = "ho";
pub const SCNu16 = "hu";
pub const SCNx16 = "hx";
pub const SCNd32 = "d";
pub const SCNi32 = "i";
pub const SCNo32 = "o";
pub const SCNu32 = "u";
pub const SCNx32 = "x";
pub const SCNd64 = __SCN_64_LENGTH_MODIFIER__ ++ "d";
pub const SCNi64 = __SCN_64_LENGTH_MODIFIER__ ++ "i";
pub const SCNo64 = __SCN_64_LENGTH_MODIFIER__ ++ "o";
pub const SCNu64 = __SCN_64_LENGTH_MODIFIER__ ++ "u";
pub const SCNx64 = __SCN_64_LENGTH_MODIFIER__ ++ "x";
pub const SCNdLEAST8 = SCNd8;
pub const SCNiLEAST8 = SCNi8;
pub const SCNoLEAST8 = SCNo8;
pub const SCNuLEAST8 = SCNu8;
pub const SCNxLEAST8 = SCNx8;
pub const SCNdLEAST16 = SCNd16;
pub const SCNiLEAST16 = SCNi16;
pub const SCNoLEAST16 = SCNo16;
pub const SCNuLEAST16 = SCNu16;
pub const SCNxLEAST16 = SCNx16;
pub const SCNdLEAST32 = SCNd32;
pub const SCNiLEAST32 = SCNi32;
pub const SCNoLEAST32 = SCNo32;
pub const SCNuLEAST32 = SCNu32;
pub const SCNxLEAST32 = SCNx32;
pub const SCNdLEAST64 = SCNd64;
pub const SCNiLEAST64 = SCNi64;
pub const SCNoLEAST64 = SCNo64;
pub const SCNuLEAST64 = SCNu64;
pub const SCNxLEAST64 = SCNx64;
pub const SCNdFAST8 = SCNd8;
pub const SCNiFAST8 = SCNi8;
pub const SCNoFAST8 = SCNo8;
pub const SCNuFAST8 = SCNu8;
pub const SCNxFAST8 = SCNx8;
pub const SCNdFAST16 = SCNd16;
pub const SCNiFAST16 = SCNi16;
pub const SCNoFAST16 = SCNo16;
pub const SCNuFAST16 = SCNu16;
pub const SCNxFAST16 = SCNx16;
pub const SCNdFAST32 = SCNd32;
pub const SCNiFAST32 = SCNi32;
pub const SCNoFAST32 = SCNo32;
pub const SCNuFAST32 = SCNu32;
pub const SCNxFAST32 = SCNx32;
pub const SCNdFAST64 = SCNd64;
pub const SCNiFAST64 = SCNi64;
pub const SCNoFAST64 = SCNo64;
pub const SCNuFAST64 = SCNu64;
pub const SCNxFAST64 = SCNx64;
pub const SCNdPTR = "ld";
pub const SCNiPTR = "li";
pub const SCNoPTR = "lo";
pub const SCNuPTR = "lu";
pub const SCNxPTR = "lx";
pub const SCNdMAX = __SCN_MAX_LENGTH_MODIFIER__ ++ "d";
pub const SCNiMAX = __SCN_MAX_LENGTH_MODIFIER__ ++ "i";
pub const SCNoMAX = __SCN_MAX_LENGTH_MODIFIER__ ++ "o";
pub const SCNuMAX = __SCN_MAX_LENGTH_MODIFIER__ ++ "u";
pub const SCNxMAX = __SCN_MAX_LENGTH_MODIFIER__ ++ "x";
pub const BN_BITS2 = @as(c_int, 64);
pub const BN_DEC_FMT1 = "%" ++ PRIu64;
pub const BN_DEC_FMT2 = "%019" ++ PRIu64;
pub const BN_HEX_FMT1 = "%" ++ PRIx64;
pub const BN_HEX_FMT2 = "%016" ++ PRIx64;
pub inline fn BN_mod(rem: anytype, numerator: anytype, divisor: anytype, ctx: anytype) @TypeOf(BN_div(NULL, rem, numerator, divisor, ctx)) {
    return BN_div(NULL, rem, numerator, divisor, ctx);
}
pub const BN_RAND_TOP_ANY = -@as(c_int, 1);
pub const BN_RAND_TOP_ONE = @as(c_int, 0);
pub const BN_RAND_TOP_TWO = @as(c_int, 1);
pub const BN_RAND_BOTTOM_ANY = @as(c_int, 0);
pub const BN_RAND_BOTTOM_ODD = @as(c_int, 1);
pub const BN_GENCB_GENERATED = @as(c_int, 0);
pub const BN_GENCB_PRIME_TEST = @as(c_int, 1);
pub const BN_prime_checks_for_validation = @as(c_int, 64);
pub const BN_prime_checks_for_generation = @as(c_int, 0);
pub const BN_prime_checks = BN_prime_checks_for_validation;
pub const BN_FLG_MALLOCED = @as(c_int, 0x01);
pub const BN_FLG_STATIC_DATA = @as(c_int, 0x02);
pub const BN_R_ARG2_LT_ARG3 = @as(c_int, 100);
pub const BN_R_BAD_RECIPROCAL = @as(c_int, 101);
pub const BN_R_BIGNUM_TOO_LONG = @as(c_int, 102);
pub const BN_R_BITS_TOO_SMALL = @as(c_int, 103);
pub const BN_R_CALLED_WITH_EVEN_MODULUS = @as(c_int, 104);
pub const BN_R_DIV_BY_ZERO = @as(c_int, 105);
pub const BN_R_EXPAND_ON_STATIC_BIGNUM_DATA = @as(c_int, 106);
pub const BN_R_INPUT_NOT_REDUCED = @as(c_int, 107);
pub const BN_R_INVALID_RANGE = @as(c_int, 108);
pub const BN_R_NEGATIVE_NUMBER = @as(c_int, 109);
pub const BN_R_NOT_A_SQUARE = @as(c_int, 110);
pub const BN_R_NOT_INITIALIZED = @as(c_int, 111);
pub const BN_R_NO_INVERSE = @as(c_int, 112);
pub const BN_R_PRIVATE_KEY_TOO_LARGE = @as(c_int, 113);
pub const BN_R_P_IS_NOT_PRIME = @as(c_int, 114);
pub const BN_R_TOO_MANY_ITERATIONS = @as(c_int, 115);
pub const BN_R_TOO_MANY_TEMPORARY_VARIABLES = @as(c_int, 116);
pub const BN_R_BAD_ENCODING = @as(c_int, 117);
pub const BN_R_ENCODE_ERROR = @as(c_int, 118);
pub const BN_R_INVALID_INPUT = @as(c_int, 119);
pub const V_ASN1_UNIVERSAL = @as(c_int, 0x00);
pub const V_ASN1_APPLICATION = @as(c_int, 0x40);
pub const V_ASN1_CONTEXT_SPECIFIC = @as(c_int, 0x80);
pub const V_ASN1_PRIVATE = @as(c_int, 0xc0);
pub const V_ASN1_CONSTRUCTED = @as(c_int, 0x20);
pub const V_ASN1_PRIMITIVE_TAG = @as(c_int, 0x1f);
pub const V_ASN1_MAX_UNIVERSAL = @as(c_int, 0xff);
pub const V_ASN1_UNDEF = -@as(c_int, 1);
pub const V_ASN1_OTHER = -@as(c_int, 3);
pub const V_ASN1_ANY = -@as(c_int, 4);
pub const V_ASN1_EOC = @as(c_int, 0);
pub const V_ASN1_BOOLEAN = @as(c_int, 1);
pub const V_ASN1_INTEGER = @as(c_int, 2);
pub const V_ASN1_BIT_STRING = @as(c_int, 3);
pub const V_ASN1_OCTET_STRING = @as(c_int, 4);
pub const V_ASN1_NULL = @as(c_int, 5);
pub const V_ASN1_OBJECT = @as(c_int, 6);
pub const V_ASN1_OBJECT_DESCRIPTOR = @as(c_int, 7);
pub const V_ASN1_EXTERNAL = @as(c_int, 8);
pub const V_ASN1_REAL = @as(c_int, 9);
pub const V_ASN1_ENUMERATED = @as(c_int, 10);
pub const V_ASN1_UTF8STRING = @as(c_int, 12);
pub const V_ASN1_SEQUENCE = @as(c_int, 16);
pub const V_ASN1_SET = @as(c_int, 17);
pub const V_ASN1_NUMERICSTRING = @as(c_int, 18);
pub const V_ASN1_PRINTABLESTRING = @as(c_int, 19);
pub const V_ASN1_T61STRING = @as(c_int, 20);
pub const V_ASN1_TELETEXSTRING = @as(c_int, 20);
pub const V_ASN1_VIDEOTEXSTRING = @as(c_int, 21);
pub const V_ASN1_IA5STRING = @as(c_int, 22);
pub const V_ASN1_UTCTIME = @as(c_int, 23);
pub const V_ASN1_GENERALIZEDTIME = @as(c_int, 24);
pub const V_ASN1_GRAPHICSTRING = @as(c_int, 25);
pub const V_ASN1_ISO64STRING = @as(c_int, 26);
pub const V_ASN1_VISIBLESTRING = @as(c_int, 26);
pub const V_ASN1_GENERALSTRING = @as(c_int, 27);
pub const V_ASN1_UNIVERSALSTRING = @as(c_int, 28);
pub const V_ASN1_BMPSTRING = @as(c_int, 30);
pub const V_ASN1_NEG = @as(c_int, 0x100);
pub const V_ASN1_NEG_INTEGER = V_ASN1_INTEGER | V_ASN1_NEG;
pub const V_ASN1_NEG_ENUMERATED = V_ASN1_ENUMERATED | V_ASN1_NEG;
pub const B_ASN1_NUMERICSTRING = @as(c_int, 0x0001);
pub const B_ASN1_PRINTABLESTRING = @as(c_int, 0x0002);
pub const B_ASN1_T61STRING = @as(c_int, 0x0004);
pub const B_ASN1_TELETEXSTRING = @as(c_int, 0x0004);
pub const B_ASN1_VIDEOTEXSTRING = @as(c_int, 0x0008);
pub const B_ASN1_IA5STRING = @as(c_int, 0x0010);
pub const B_ASN1_GRAPHICSTRING = @as(c_int, 0x0020);
pub const B_ASN1_ISO64STRING = @as(c_int, 0x0040);
pub const B_ASN1_VISIBLESTRING = @as(c_int, 0x0040);
pub const B_ASN1_GENERALSTRING = @as(c_int, 0x0080);
pub const B_ASN1_UNIVERSALSTRING = @as(c_int, 0x0100);
pub const B_ASN1_OCTET_STRING = @as(c_int, 0x0200);
pub const B_ASN1_BIT_STRING = @as(c_int, 0x0400);
pub const B_ASN1_BMPSTRING = @as(c_int, 0x0800);
pub const B_ASN1_UNKNOWN = @as(c_int, 0x1000);
pub const B_ASN1_UTF8STRING = @as(c_int, 0x2000);
pub const B_ASN1_UTCTIME = @as(c_int, 0x4000);
pub const B_ASN1_GENERALIZEDTIME = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x8000, .hex);
pub const B_ASN1_SEQUENCE = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10000, .hex);
pub inline fn ASN1_ITEM_ptr(iptr: anytype) @TypeOf(iptr) {
    return iptr;
}
pub const ASN1_STRING_FLAG_BITS_LEFT = @as(c_int, 0x08);
pub const MBSTRING_FLAG = @as(c_int, 0x1000);
pub const MBSTRING_UTF8 = MBSTRING_FLAG;
pub const MBSTRING_ASC = MBSTRING_FLAG | @as(c_int, 1);
pub const MBSTRING_BMP = MBSTRING_FLAG | @as(c_int, 2);
pub const MBSTRING_UNIV = MBSTRING_FLAG | @as(c_int, 4);
pub const DIRSTRING_TYPE = ((B_ASN1_PRINTABLESTRING | B_ASN1_T61STRING) | B_ASN1_BMPSTRING) | B_ASN1_UTF8STRING;
pub const PKCS9STRING_TYPE = DIRSTRING_TYPE | B_ASN1_IA5STRING;
pub const STABLE_NO_MASK = @as(c_int, 0x02);
pub const B_ASN1_DIRECTORYSTRING = (((B_ASN1_PRINTABLESTRING | B_ASN1_TELETEXSTRING) | B_ASN1_BMPSTRING) | B_ASN1_UNIVERSALSTRING) | B_ASN1_UTF8STRING;
pub const B_ASN1_DISPLAYTEXT = ((B_ASN1_IA5STRING | B_ASN1_VISIBLESTRING) | B_ASN1_BMPSTRING) | B_ASN1_UTF8STRING;
pub const B_ASN1_TIME = B_ASN1_UTCTIME | B_ASN1_GENERALIZEDTIME;
pub const ASN1_STRFLGS_ESC_2253 = @as(c_int, 1);
pub const ASN1_STRFLGS_ESC_CTRL = @as(c_int, 2);
pub const ASN1_STRFLGS_ESC_MSB = @as(c_int, 4);
pub const ASN1_STRFLGS_ESC_QUOTE = @as(c_int, 8);
pub const ASN1_STRFLGS_UTF8_CONVERT = @as(c_int, 0x10);
pub const ASN1_STRFLGS_IGNORE_TYPE = @as(c_int, 0x20);
pub const ASN1_STRFLGS_SHOW_TYPE = @as(c_int, 0x40);
pub const ASN1_STRFLGS_DUMP_ALL = @as(c_int, 0x80);
pub const ASN1_STRFLGS_DUMP_UNKNOWN = @as(c_int, 0x100);
pub const ASN1_STRFLGS_DUMP_DER = @as(c_int, 0x200);
pub const ASN1_STRFLGS_RFC2253 = ((((ASN1_STRFLGS_ESC_2253 | ASN1_STRFLGS_ESC_CTRL) | ASN1_STRFLGS_ESC_MSB) | ASN1_STRFLGS_UTF8_CONVERT) | ASN1_STRFLGS_DUMP_UNKNOWN) | ASN1_STRFLGS_DUMP_DER;
pub inline fn DECLARE_ASN1_FUNCTIONS(@"type": anytype) @TypeOf(DECLARE_ASN1_FUNCTIONS_name(@"type", @"type")) {
    return DECLARE_ASN1_FUNCTIONS_name(@"type", @"type");
}
pub inline fn DECLARE_ASN1_ALLOC_FUNCTIONS(@"type": anytype) @TypeOf(DECLARE_ASN1_ALLOC_FUNCTIONS_name(@"type", @"type")) {
    return DECLARE_ASN1_ALLOC_FUNCTIONS_name(@"type", @"type");
}
pub inline fn M_ASN1_STRING_length(x: anytype) @TypeOf(ASN1_STRING_length(x)) {
    return ASN1_STRING_length(x);
}
pub inline fn M_ASN1_STRING_type(x: anytype) @TypeOf(ASN1_STRING_type(x)) {
    return ASN1_STRING_type(x);
}
pub inline fn M_ASN1_STRING_data(x: anytype) @TypeOf(ASN1_STRING_data(x)) {
    return ASN1_STRING_data(x);
}
pub inline fn M_ASN1_BIT_STRING_new() @TypeOf(ASN1_BIT_STRING_new()) {
    return ASN1_BIT_STRING_new();
}
pub inline fn M_ASN1_BIT_STRING_free(a: anytype) @TypeOf(ASN1_BIT_STRING_free(a)) {
    return ASN1_BIT_STRING_free(a);
}
pub inline fn M_ASN1_BIT_STRING_dup(a: anytype) @TypeOf(ASN1_STRING_dup(a)) {
    return ASN1_STRING_dup(a);
}
pub inline fn M_ASN1_BIT_STRING_cmp(a: anytype, b: anytype) @TypeOf(ASN1_STRING_cmp(a, b)) {
    return ASN1_STRING_cmp(a, b);
}
// pub inline fn M_ASN1_BIT_STRING_set(a: anytype, b: anytype, c: anytype) @TypeOf(ASN1_BIT_STRING_set(a, b, c)) {
//     return ASN1_BIT_STRING_set(a, b, c);
// }
pub inline fn M_ASN1_INTEGER_new() @TypeOf(ASN1_INTEGER_new()) {
    return ASN1_INTEGER_new();
}
pub inline fn M_ASN1_INTEGER_free(a: anytype) @TypeOf(ASN1_INTEGER_free(a)) {
    return ASN1_INTEGER_free(a);
}
pub inline fn M_ASN1_INTEGER_dup(a: anytype) @TypeOf(ASN1_INTEGER_dup(a)) {
    return ASN1_INTEGER_dup(a);
}
pub inline fn M_ASN1_INTEGER_cmp(a: anytype, b: anytype) @TypeOf(ASN1_INTEGER_cmp(a, b)) {
    return ASN1_INTEGER_cmp(a, b);
}
pub inline fn M_ASN1_ENUMERATED_new() @TypeOf(ASN1_ENUMERATED_new()) {
    return ASN1_ENUMERATED_new();
}
pub inline fn M_ASN1_ENUMERATED_free(a: anytype) @TypeOf(ASN1_ENUMERATED_free(a)) {
    return ASN1_ENUMERATED_free(a);
}
pub inline fn M_ASN1_ENUMERATED_dup(a: anytype) @TypeOf(ASN1_STRING_dup(a)) {
    return ASN1_STRING_dup(a);
}
pub inline fn M_ASN1_ENUMERATED_cmp(a: anytype, b: anytype) @TypeOf(ASN1_STRING_cmp(a, b)) {
    return ASN1_STRING_cmp(a, b);
}
pub inline fn M_ASN1_OCTET_STRING_new() @TypeOf(ASN1_OCTET_STRING_new()) {
    return ASN1_OCTET_STRING_new();
}
pub inline fn M_ASN1_OCTET_STRING_free(a: anytype) @TypeOf(ASN1_OCTET_STRING_free()) {
    _ = @TypeOf(a);
    return ASN1_OCTET_STRING_free();
}
pub inline fn M_ASN1_OCTET_STRING_dup(a: anytype) @TypeOf(ASN1_OCTET_STRING_dup(a)) {
    return ASN1_OCTET_STRING_dup(a);
}
pub inline fn M_ASN1_OCTET_STRING_cmp(a: anytype, b: anytype) @TypeOf(ASN1_OCTET_STRING_cmp(a, b)) {
    return ASN1_OCTET_STRING_cmp(a, b);
}
pub inline fn M_ASN1_OCTET_STRING_set(a: anytype, b: anytype, c: anytype) @TypeOf(ASN1_OCTET_STRING_set(a, b, c)) {
    return ASN1_OCTET_STRING_set(a, b, c);
}
pub inline fn M_ASN1_OCTET_STRING_print(a: anytype, b: anytype) @TypeOf(ASN1_STRING_print(a, b)) {
    return ASN1_STRING_print(a, b);
}
pub inline fn M_ASN1_PRINTABLESTRING_new() @TypeOf(ASN1_PRINTABLESTRING_new()) {
    return ASN1_PRINTABLESTRING_new();
}
pub inline fn M_ASN1_PRINTABLESTRING_free(a: anytype) @TypeOf(ASN1_PRINTABLESTRING_free(a)) {
    return ASN1_PRINTABLESTRING_free(a);
}
pub inline fn M_ASN1_IA5STRING_new() @TypeOf(ASN1_IA5STRING_new()) {
    return ASN1_IA5STRING_new();
}
pub inline fn M_ASN1_IA5STRING_free(a: anytype) @TypeOf(ASN1_IA5STRING_free(a)) {
    return ASN1_IA5STRING_free(a);
}
pub inline fn M_ASN1_IA5STRING_dup(a: anytype) @TypeOf(ASN1_STRING_dup(a)) {
    return ASN1_STRING_dup(a);
}
pub inline fn M_ASN1_UTCTIME_new() @TypeOf(ASN1_UTCTIME_new()) {
    return ASN1_UTCTIME_new();
}
pub inline fn M_ASN1_UTCTIME_free(a: anytype) @TypeOf(ASN1_UTCTIME_free(a)) {
    return ASN1_UTCTIME_free(a);
}
pub inline fn M_ASN1_UTCTIME_dup(a: anytype) @TypeOf(ASN1_STRING_dup(a)) {
    return ASN1_STRING_dup(a);
}
pub inline fn M_ASN1_T61STRING_new() @TypeOf(ASN1_T61STRING_new()) {
    return ASN1_T61STRING_new();
}
pub inline fn M_ASN1_T61STRING_free(a: anytype) @TypeOf(ASN1_T61STRING_free(a)) {
    return ASN1_T61STRING_free(a);
}
pub inline fn M_ASN1_GENERALIZEDTIME_new() @TypeOf(ASN1_GENERALIZEDTIME_new()) {
    return ASN1_GENERALIZEDTIME_new();
}
pub inline fn M_ASN1_GENERALIZEDTIME_free(a: anytype) @TypeOf(ASN1_GENERALIZEDTIME_free(a)) {
    return ASN1_GENERALIZEDTIME_free(a);
}
pub inline fn M_ASN1_GENERALIZEDTIME_dup(a: anytype) @TypeOf(ASN1_STRING_dup(a)) {
    return ASN1_STRING_dup(a);
}
pub inline fn M_ASN1_GENERALSTRING_new() @TypeOf(ASN1_GENERALSTRING_new()) {
    return ASN1_GENERALSTRING_new();
}
pub inline fn M_ASN1_GENERALSTRING_free(a: anytype) @TypeOf(ASN1_GENERALSTRING_free(a)) {
    return ASN1_GENERALSTRING_free(a);
}
pub inline fn M_ASN1_UNIVERSALSTRING_new() @TypeOf(ASN1_UNIVERSALSTRING_new()) {
    return ASN1_UNIVERSALSTRING_new();
}
pub inline fn M_ASN1_UNIVERSALSTRING_free(a: anytype) @TypeOf(ASN1_UNIVERSALSTRING_free(a)) {
    return ASN1_UNIVERSALSTRING_free(a);
}
pub inline fn M_ASN1_BMPSTRING_new() @TypeOf(ASN1_BMPSTRING_new()) {
    return ASN1_BMPSTRING_new();
}
pub inline fn M_ASN1_BMPSTRING_free(a: anytype) @TypeOf(ASN1_BMPSTRING_free(a)) {
    return ASN1_BMPSTRING_free(a);
}
pub inline fn M_ASN1_VISIBLESTRING_new() @TypeOf(ASN1_VISIBLESTRING_new()) {
    return ASN1_VISIBLESTRING_new();
}
pub inline fn M_ASN1_VISIBLESTRING_free(a: anytype) @TypeOf(ASN1_VISIBLESTRING_free(a)) {
    return ASN1_VISIBLESTRING_free(a);
}
pub inline fn M_ASN1_UTF8STRING_new() @TypeOf(ASN1_UTF8STRING_new()) {
    return ASN1_UTF8STRING_new();
}
pub inline fn M_ASN1_UTF8STRING_free(a: anytype) @TypeOf(ASN1_UTF8STRING_free(a)) {
    return ASN1_UTF8STRING_free(a);
}
pub const B_ASN1_PRINTABLE = ((((((((B_ASN1_NUMERICSTRING | B_ASN1_PRINTABLESTRING) | B_ASN1_T61STRING) | B_ASN1_IA5STRING) | B_ASN1_BIT_STRING) | B_ASN1_UNIVERSALSTRING) | B_ASN1_BMPSTRING) | B_ASN1_UTF8STRING) | B_ASN1_SEQUENCE) | B_ASN1_UNKNOWN;
pub const ASN1_R_ASN1_LENGTH_MISMATCH = @as(c_int, 100);
pub const ASN1_R_AUX_ERROR = @as(c_int, 101);
pub const ASN1_R_BAD_GET_ASN1_OBJECT_CALL = @as(c_int, 102);
pub const ASN1_R_BAD_OBJECT_HEADER = @as(c_int, 103);
pub const ASN1_R_BMPSTRING_IS_WRONG_LENGTH = @as(c_int, 104);
pub const ASN1_R_BN_LIB = @as(c_int, 105);
pub const ASN1_R_BOOLEAN_IS_WRONG_LENGTH = @as(c_int, 106);
pub const ASN1_R_BUFFER_TOO_SMALL = @as(c_int, 107);
pub const ASN1_R_CONTEXT_NOT_INITIALISED = @as(c_int, 108);
pub const ASN1_R_DECODE_ERROR = @as(c_int, 109);
pub const ASN1_R_DEPTH_EXCEEDED = @as(c_int, 110);
pub const ASN1_R_DIGEST_AND_KEY_TYPE_NOT_SUPPORTED = @as(c_int, 111);
pub const ASN1_R_ENCODE_ERROR = @as(c_int, 112);
pub const ASN1_R_ERROR_GETTING_TIME = @as(c_int, 113);
pub const ASN1_R_EXPECTING_AN_ASN1_SEQUENCE = @as(c_int, 114);
pub const ASN1_R_EXPECTING_AN_INTEGER = @as(c_int, 115);
pub const ASN1_R_EXPECTING_AN_OBJECT = @as(c_int, 116);
pub const ASN1_R_EXPECTING_A_BOOLEAN = @as(c_int, 117);
pub const ASN1_R_EXPECTING_A_TIME = @as(c_int, 118);
pub const ASN1_R_EXPLICIT_LENGTH_MISMATCH = @as(c_int, 119);
pub const ASN1_R_EXPLICIT_TAG_NOT_CONSTRUCTED = @as(c_int, 120);
pub const ASN1_R_FIELD_MISSING = @as(c_int, 121);
pub const ASN1_R_FIRST_NUM_TOO_LARGE = @as(c_int, 122);
pub const ASN1_R_HEADER_TOO_LONG = @as(c_int, 123);
pub const ASN1_R_ILLEGAL_BITSTRING_FORMAT = @as(c_int, 124);
pub const ASN1_R_ILLEGAL_BOOLEAN = @as(c_int, 125);
pub const ASN1_R_ILLEGAL_CHARACTERS = @as(c_int, 126);
pub const ASN1_R_ILLEGAL_FORMAT = @as(c_int, 127);
pub const ASN1_R_ILLEGAL_HEX = @as(c_int, 128);
pub const ASN1_R_ILLEGAL_IMPLICIT_TAG = @as(c_int, 129);
pub const ASN1_R_ILLEGAL_INTEGER = @as(c_int, 130);
pub const ASN1_R_ILLEGAL_NESTED_TAGGING = @as(c_int, 131);
pub const ASN1_R_ILLEGAL_NULL = @as(c_int, 132);
pub const ASN1_R_ILLEGAL_NULL_VALUE = @as(c_int, 133);
pub const ASN1_R_ILLEGAL_OBJECT = @as(c_int, 134);
pub const ASN1_R_ILLEGAL_OPTIONAL_ANY = @as(c_int, 135);
pub const ASN1_R_ILLEGAL_OPTIONS_ON_ITEM_TEMPLATE = @as(c_int, 136);
pub const ASN1_R_ILLEGAL_TAGGED_ANY = @as(c_int, 137);
pub const ASN1_R_ILLEGAL_TIME_VALUE = @as(c_int, 138);
pub const ASN1_R_INTEGER_NOT_ASCII_FORMAT = @as(c_int, 139);
pub const ASN1_R_INTEGER_TOO_LARGE_FOR_LONG = @as(c_int, 140);
pub const ASN1_R_INVALID_BIT_STRING_BITS_LEFT = @as(c_int, 141);
pub const ASN1_R_INVALID_BMPSTRING = @as(c_int, 142);
pub const ASN1_R_INVALID_DIGIT = @as(c_int, 143);
pub const ASN1_R_INVALID_MODIFIER = @as(c_int, 144);
pub const ASN1_R_INVALID_NUMBER = @as(c_int, 145);
pub const ASN1_R_INVALID_OBJECT_ENCODING = @as(c_int, 146);
pub const ASN1_R_INVALID_SEPARATOR = @as(c_int, 147);
pub const ASN1_R_INVALID_TIME_FORMAT = @as(c_int, 148);
pub const ASN1_R_INVALID_UNIVERSALSTRING = @as(c_int, 149);
pub const ASN1_R_INVALID_UTF8STRING = @as(c_int, 150);
pub const ASN1_R_LIST_ERROR = @as(c_int, 151);
pub const ASN1_R_MISSING_ASN1_EOS = @as(c_int, 152);
pub const ASN1_R_MISSING_EOC = @as(c_int, 153);
pub const ASN1_R_MISSING_SECOND_NUMBER = @as(c_int, 154);
pub const ASN1_R_MISSING_VALUE = @as(c_int, 155);
pub const ASN1_R_MSTRING_NOT_UNIVERSAL = @as(c_int, 156);
pub const ASN1_R_MSTRING_WRONG_TAG = @as(c_int, 157);
pub const ASN1_R_NESTED_ASN1_ERROR = @as(c_int, 158);
pub const ASN1_R_NESTED_ASN1_STRING = @as(c_int, 159);
pub const ASN1_R_NON_HEX_CHARACTERS = @as(c_int, 160);
pub const ASN1_R_NOT_ASCII_FORMAT = @as(c_int, 161);
pub const ASN1_R_NOT_ENOUGH_DATA = @as(c_int, 162);
pub const ASN1_R_NO_MATCHING_CHOICE_TYPE = @as(c_int, 163);
pub const ASN1_R_NULL_IS_WRONG_LENGTH = @as(c_int, 164);
pub const ASN1_R_OBJECT_NOT_ASCII_FORMAT = @as(c_int, 165);
pub const ASN1_R_ODD_NUMBER_OF_CHARS = @as(c_int, 166);
pub const ASN1_R_SECOND_NUMBER_TOO_LARGE = @as(c_int, 167);
pub const ASN1_R_SEQUENCE_LENGTH_MISMATCH = @as(c_int, 168);
pub const ASN1_R_SEQUENCE_NOT_CONSTRUCTED = @as(c_int, 169);
pub const ASN1_R_SEQUENCE_OR_SET_NEEDS_CONFIG = @as(c_int, 170);
pub const ASN1_R_SHORT_LINE = @as(c_int, 171);
pub const ASN1_R_STREAMING_NOT_SUPPORTED = @as(c_int, 172);
pub const ASN1_R_STRING_TOO_LONG = @as(c_int, 173);
pub const ASN1_R_STRING_TOO_SHORT = @as(c_int, 174);
pub const ASN1_R_TAG_VALUE_TOO_HIGH = @as(c_int, 175);
pub const ASN1_R_TIME_NOT_ASCII_FORMAT = @as(c_int, 176);
pub const ASN1_R_TOO_LONG = @as(c_int, 177);
pub const ASN1_R_TYPE_NOT_CONSTRUCTED = @as(c_int, 178);
pub const ASN1_R_TYPE_NOT_PRIMITIVE = @as(c_int, 179);
pub const ASN1_R_UNEXPECTED_EOC = @as(c_int, 180);
pub const ASN1_R_UNIVERSALSTRING_IS_WRONG_LENGTH = @as(c_int, 181);
pub const ASN1_R_UNKNOWN_FORMAT = @as(c_int, 182);
pub const ASN1_R_UNKNOWN_MESSAGE_DIGEST_ALGORITHM = @as(c_int, 183);
pub const ASN1_R_UNKNOWN_SIGNATURE_ALGORITHM = @as(c_int, 184);
pub const ASN1_R_UNKNOWN_TAG = @as(c_int, 185);
pub const ASN1_R_UNSUPPORTED_ANY_DEFINED_BY_TYPE = @as(c_int, 186);
pub const ASN1_R_UNSUPPORTED_PUBLIC_KEY_TYPE = @as(c_int, 187);
pub const ASN1_R_UNSUPPORTED_TYPE = @as(c_int, 188);
pub const ASN1_R_WRONG_PUBLIC_KEY_TYPE = @as(c_int, 189);
pub const ASN1_R_WRONG_TAG = @as(c_int, 190);
pub const ASN1_R_WRONG_TYPE = @as(c_int, 191);
pub const ASN1_R_NESTED_TOO_DEEP = @as(c_int, 192);
pub const ASN1_R_BAD_TEMPLATE = @as(c_int, 193);
pub const ASN1_R_INVALID_BIT_STRING_PADDING = @as(c_int, 194);
pub const ASN1_R_WRONG_INTEGER_TYPE = @as(c_int, 195);
pub const ASN1_R_INVALID_INTEGER = @as(c_int, 196);
pub const OPENSSL_HEADER_DH_H = "";
pub const DH_GENERATOR_2 = @as(c_int, 2);
pub const DH_GENERATOR_5 = @as(c_int, 5);
pub const DH_CHECK_P_NOT_PRIME = @as(c_int, 0x01);
pub const DH_CHECK_P_NOT_SAFE_PRIME = @as(c_int, 0x02);
pub const DH_CHECK_UNABLE_TO_CHECK_GENERATOR = @as(c_int, 0x04);
pub const DH_CHECK_NOT_SUITABLE_GENERATOR = @as(c_int, 0x08);
pub const DH_CHECK_Q_NOT_PRIME = @as(c_int, 0x10);
pub const DH_CHECK_INVALID_Q_VALUE = @as(c_int, 0x20);
pub const DH_NOT_SUITABLE_GENERATOR = DH_CHECK_NOT_SUITABLE_GENERATOR;
pub const DH_UNABLE_TO_CHECK_GENERATOR = DH_CHECK_UNABLE_TO_CHECK_GENERATOR;
pub const DH_CHECK_PUBKEY_TOO_SMALL = @as(c_int, 0x1);
pub const DH_CHECK_PUBKEY_TOO_LARGE = @as(c_int, 0x2);
pub const DH_CHECK_PUBKEY_INVALID = @as(c_int, 0x4);
pub const DH_R_BAD_GENERATOR = @as(c_int, 100);
pub const DH_R_INVALID_PUBKEY = @as(c_int, 101);
pub const DH_R_MODULUS_TOO_LARGE = @as(c_int, 102);
pub const DH_R_NO_PRIVATE_VALUE = @as(c_int, 103);
pub const DH_R_DECODE_ERROR = @as(c_int, 104);
pub const DH_R_ENCODE_ERROR = @as(c_int, 105);
pub const OPENSSL_HEADER_DSA_H = "";
pub const OPENSSL_HEADER_ENGINE_H = "";
pub const ENGINE_R_OPERATION_NOT_SUPPORTED = @as(c_int, 100);
pub const DSA_R_BAD_Q_VALUE = @as(c_int, 100);
pub const DSA_R_MISSING_PARAMETERS = @as(c_int, 101);
pub const DSA_R_MODULUS_TOO_LARGE = @as(c_int, 102);
pub const DSA_R_NEED_NEW_SETUP_VALUES = @as(c_int, 103);
pub const DSA_R_BAD_VERSION = @as(c_int, 104);
pub const DSA_R_DECODE_ERROR = @as(c_int, 105);
pub const DSA_R_ENCODE_ERROR = @as(c_int, 106);
pub const DSA_R_INVALID_PARAMETERS = @as(c_int, 107);
pub const OPENSSL_HEADER_EC_H = "";
pub const OPENSSL_EC_EXPLICIT_CURVE = @as(c_int, 0);
pub const OPENSSL_EC_NAMED_CURVE = @as(c_int, 1);
pub const OPENSSL_HEADER_EC_KEY_H = "";
pub const EC_PKEY_NO_PARAMETERS = @as(c_int, 0x001);
pub const EC_PKEY_NO_PUBKEY = @as(c_int, 0x002);
pub const ECDSA_FLAG_OPAQUE = @as(c_int, 1);
pub const EC_R_BUFFER_TOO_SMALL = @as(c_int, 100);
pub const EC_R_COORDINATES_OUT_OF_RANGE = @as(c_int, 101);
pub const EC_R_D2I_ECPKPARAMETERS_FAILURE = @as(c_int, 102);
pub const EC_R_EC_GROUP_NEW_BY_NAME_FAILURE = @as(c_int, 103);
pub const EC_R_GROUP2PKPARAMETERS_FAILURE = @as(c_int, 104);
pub const EC_R_I2D_ECPKPARAMETERS_FAILURE = @as(c_int, 105);
pub const EC_R_INCOMPATIBLE_OBJECTS = @as(c_int, 106);
pub const EC_R_INVALID_COMPRESSED_POINT = @as(c_int, 107);
pub const EC_R_INVALID_COMPRESSION_BIT = @as(c_int, 108);
pub const EC_R_INVALID_ENCODING = @as(c_int, 109);
pub const EC_R_INVALID_FIELD = @as(c_int, 110);
pub const EC_R_INVALID_FORM = @as(c_int, 111);
pub const EC_R_INVALID_GROUP_ORDER = @as(c_int, 112);
pub const EC_R_INVALID_PRIVATE_KEY = @as(c_int, 113);
pub const EC_R_MISSING_PARAMETERS = @as(c_int, 114);
pub const EC_R_MISSING_PRIVATE_KEY = @as(c_int, 115);
pub const EC_R_NON_NAMED_CURVE = @as(c_int, 116);
pub const EC_R_NOT_INITIALIZED = @as(c_int, 117);
pub const EC_R_PKPARAMETERS2GROUP_FAILURE = @as(c_int, 118);
pub const EC_R_POINT_AT_INFINITY = @as(c_int, 119);
pub const EC_R_POINT_IS_NOT_ON_CURVE = @as(c_int, 120);
pub const EC_R_SLOT_FULL = @as(c_int, 121);
pub const EC_R_UNDEFINED_GENERATOR = @as(c_int, 122);
pub const EC_R_UNKNOWN_GROUP = @as(c_int, 123);
pub const EC_R_UNKNOWN_ORDER = @as(c_int, 124);
pub const EC_R_WRONG_ORDER = @as(c_int, 125);
pub const EC_R_BIGNUM_OUT_OF_RANGE = @as(c_int, 126);
pub const EC_R_WRONG_CURVE_PARAMETERS = @as(c_int, 127);
pub const EC_R_DECODE_ERROR = @as(c_int, 128);
pub const EC_R_ENCODE_ERROR = @as(c_int, 129);
pub const EC_R_GROUP_MISMATCH = @as(c_int, 130);
pub const EC_R_INVALID_COFACTOR = @as(c_int, 131);
pub const EC_R_PUBLIC_KEY_VALIDATION_FAILED = @as(c_int, 132);
pub const EC_R_INVALID_SCALAR = @as(c_int, 133);
pub const OPENSSL_HEADER_ECDH_H = "";
pub const ECDH_R_KDF_FAILED = @as(c_int, 100);
pub const ECDH_R_NO_PRIVATE_VALUE = @as(c_int, 101);
pub const ECDH_R_POINT_ARITHMETIC_FAILURE = @as(c_int, 102);
pub const ECDH_R_UNKNOWN_DIGEST_LENGTH = @as(c_int, 103);
pub const OPENSSL_HEADER_ECDSA_H = "";
pub const ECDSA_R_BAD_SIGNATURE = @as(c_int, 100);
pub const ECDSA_R_MISSING_PARAMETERS = @as(c_int, 101);
pub const ECDSA_R_NEED_NEW_SETUP_VALUES = @as(c_int, 102);
pub const ECDSA_R_NOT_IMPLEMENTED = @as(c_int, 103);
pub const ECDSA_R_RANDOM_NUMBER_GENERATION_FAILED = @as(c_int, 104);
pub const ECDSA_R_ENCODE_ERROR = @as(c_int, 105);
pub const OPENSSL_HEADER_OBJ_H = "";
pub const OPENSSL_HEADER_BYTESTRING_H = "";
pub const OPENSSL_HEADER_SSL_SPAN_H = "";
pub const CBS_ASN1_TAG_SHIFT = @as(c_int, 24);
pub const CBS_ASN1_CONSTRUCTED = @as(c_uint, 0x20) << CBS_ASN1_TAG_SHIFT;
pub const CBS_ASN1_UNIVERSAL = @as(c_uint, 0) << CBS_ASN1_TAG_SHIFT;
pub const CBS_ASN1_APPLICATION = @as(c_uint, 0x40) << CBS_ASN1_TAG_SHIFT;
pub const CBS_ASN1_CONTEXT_SPECIFIC = @as(c_uint, 0x80) << CBS_ASN1_TAG_SHIFT;
pub const CBS_ASN1_PRIVATE = @as(c_uint, 0xc0) << CBS_ASN1_TAG_SHIFT;
pub const CBS_ASN1_CLASS_MASK = @as(c_uint, 0xc0) << CBS_ASN1_TAG_SHIFT;
pub const CBS_ASN1_TAG_NUMBER_MASK = (@as(c_uint, 1) << (@as(c_int, 5) + CBS_ASN1_TAG_SHIFT)) - @as(c_int, 1);
pub const CBS_ASN1_BOOLEAN = @as(c_uint, 0x1);
pub const CBS_ASN1_INTEGER = @as(c_uint, 0x2);
pub const CBS_ASN1_BITSTRING = @as(c_uint, 0x3);
pub const CBS_ASN1_OCTETSTRING = @as(c_uint, 0x4);
pub const CBS_ASN1_NULL = @as(c_uint, 0x5);
pub const CBS_ASN1_OBJECT = @as(c_uint, 0x6);
pub const CBS_ASN1_ENUMERATED = @as(c_uint, 0xa);
pub const CBS_ASN1_UTF8STRING = @as(c_uint, 0xc);
pub const CBS_ASN1_SEQUENCE = @as(c_uint, 0x10) | CBS_ASN1_CONSTRUCTED;
pub const CBS_ASN1_SET = @as(c_uint, 0x11) | CBS_ASN1_CONSTRUCTED;
pub const CBS_ASN1_NUMERICSTRING = @as(c_uint, 0x12);
pub const CBS_ASN1_PRINTABLESTRING = @as(c_uint, 0x13);
pub const CBS_ASN1_T61STRING = @as(c_uint, 0x14);
pub const CBS_ASN1_VIDEOTEXSTRING = @as(c_uint, 0x15);
pub const CBS_ASN1_IA5STRING = @as(c_uint, 0x16);
pub const CBS_ASN1_UTCTIME = @as(c_uint, 0x17);
pub const CBS_ASN1_GENERALIZEDTIME = @as(c_uint, 0x18);
pub const CBS_ASN1_GRAPHICSTRING = @as(c_uint, 0x19);
pub const CBS_ASN1_VISIBLESTRING = @as(c_uint, 0x1a);
pub const CBS_ASN1_GENERALSTRING = @as(c_uint, 0x1b);
pub const CBS_ASN1_UNIVERSALSTRING = @as(c_uint, 0x1c);
pub const CBS_ASN1_BMPSTRING = @as(c_uint, 0x1e);
pub const OBJ_NAME_TYPE_MD_METH = @as(c_int, 1);
pub const OBJ_NAME_TYPE_CIPHER_METH = @as(c_int, 2);
pub const OBJ_R_UNKNOWN_NID = @as(c_int, 100);
pub const OBJ_R_INVALID_OID_STRING = @as(c_int, 101);
pub const OPENSSL_HEADER_POOL_H = "";
pub const OPENSSL_HEADER_RSA_H = "";
pub const RSA_PKCS1_PADDING = @as(c_int, 1);
pub const RSA_NO_PADDING = @as(c_int, 3);
pub const RSA_PKCS1_OAEP_PADDING = @as(c_int, 4);
pub const RSA_PKCS1_PSS_PADDING = @as(c_int, 6);
pub const RSA_FLAG_OPAQUE = @as(c_int, 1);
pub const RSA_FLAG_NO_BLINDING = @as(c_int, 8);
pub const RSA_FLAG_EXT_PKEY = @as(c_int, 0x20);
pub const RSA_3 = @as(c_int, 0x3);
pub const RSA_F4 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x10001, .hex);
pub const RSA_METHOD_FLAG_NO_CHECK = RSA_FLAG_OPAQUE;
pub const RSA_R_BAD_ENCODING = @as(c_int, 100);
pub const RSA_R_BAD_E_VALUE = @as(c_int, 101);
pub const RSA_R_BAD_FIXED_HEADER_DECRYPT = @as(c_int, 102);
pub const RSA_R_BAD_PAD_BYTE_COUNT = @as(c_int, 103);
pub const RSA_R_BAD_RSA_PARAMETERS = @as(c_int, 104);
pub const RSA_R_BAD_SIGNATURE = @as(c_int, 105);
pub const RSA_R_BAD_VERSION = @as(c_int, 106);
pub const RSA_R_BLOCK_TYPE_IS_NOT_01 = @as(c_int, 107);
pub const RSA_R_BN_NOT_INITIALIZED = @as(c_int, 108);
pub const RSA_R_CANNOT_RECOVER_MULTI_PRIME_KEY = @as(c_int, 109);
pub const RSA_R_CRT_PARAMS_ALREADY_GIVEN = @as(c_int, 110);
pub const RSA_R_CRT_VALUES_INCORRECT = @as(c_int, 111);
pub const RSA_R_DATA_LEN_NOT_EQUAL_TO_MOD_LEN = @as(c_int, 112);
pub const RSA_R_DATA_TOO_LARGE = @as(c_int, 113);
pub const RSA_R_DATA_TOO_LARGE_FOR_KEY_SIZE = @as(c_int, 114);
pub const RSA_R_DATA_TOO_LARGE_FOR_MODULUS = @as(c_int, 115);
pub const RSA_R_DATA_TOO_SMALL = @as(c_int, 116);
pub const RSA_R_DATA_TOO_SMALL_FOR_KEY_SIZE = @as(c_int, 117);
pub const RSA_R_DIGEST_TOO_BIG_FOR_RSA_KEY = @as(c_int, 118);
pub const RSA_R_D_E_NOT_CONGRUENT_TO_1 = @as(c_int, 119);
pub const RSA_R_EMPTY_PUBLIC_KEY = @as(c_int, 120);
pub const RSA_R_ENCODE_ERROR = @as(c_int, 121);
pub const RSA_R_FIRST_OCTET_INVALID = @as(c_int, 122);
pub const RSA_R_INCONSISTENT_SET_OF_CRT_VALUES = @as(c_int, 123);
pub const RSA_R_INTERNAL_ERROR = @as(c_int, 124);
pub const RSA_R_INVALID_MESSAGE_LENGTH = @as(c_int, 125);
pub const RSA_R_KEY_SIZE_TOO_SMALL = @as(c_int, 126);
pub const RSA_R_LAST_OCTET_INVALID = @as(c_int, 127);
pub const RSA_R_MODULUS_TOO_LARGE = @as(c_int, 128);
pub const RSA_R_MUST_HAVE_AT_LEAST_TWO_PRIMES = @as(c_int, 129);
pub const RSA_R_NO_PUBLIC_EXPONENT = @as(c_int, 130);
pub const RSA_R_NULL_BEFORE_BLOCK_MISSING = @as(c_int, 131);
pub const RSA_R_N_NOT_EQUAL_P_Q = @as(c_int, 132);
pub const RSA_R_OAEP_DECODING_ERROR = @as(c_int, 133);
pub const RSA_R_ONLY_ONE_OF_P_Q_GIVEN = @as(c_int, 134);
pub const RSA_R_OUTPUT_BUFFER_TOO_SMALL = @as(c_int, 135);
pub const RSA_R_PADDING_CHECK_FAILED = @as(c_int, 136);
pub const RSA_R_PKCS_DECODING_ERROR = @as(c_int, 137);
pub const RSA_R_SLEN_CHECK_FAILED = @as(c_int, 138);
pub const RSA_R_SLEN_RECOVERY_FAILED = @as(c_int, 139);
pub const RSA_R_TOO_LONG = @as(c_int, 140);
pub const RSA_R_TOO_MANY_ITERATIONS = @as(c_int, 141);
pub const RSA_R_UNKNOWN_ALGORITHM_TYPE = @as(c_int, 142);
pub const RSA_R_UNKNOWN_PADDING_TYPE = @as(c_int, 143);
pub const RSA_R_VALUE_MISSING = @as(c_int, 144);
pub const RSA_R_WRONG_SIGNATURE_LENGTH = @as(c_int, 145);
pub const RSA_R_PUBLIC_KEY_VALIDATION_FAILED = @as(c_int, 146);
pub const RSA_R_D_OUT_OF_RANGE = @as(c_int, 147);
pub const RSA_R_BLOCK_TYPE_IS_NOT_02 = @as(c_int, 148);
pub const OPENSSL_HEADER_SHA_H = "";
pub const SHA_CBLOCK = @as(c_int, 64);
pub const SHA_DIGEST_LENGTH = @as(c_int, 20);
pub const SHA224_CBLOCK = @as(c_int, 64);
pub const SHA224_DIGEST_LENGTH = @as(c_int, 28);
pub const SHA256_CBLOCK = @as(c_int, 64);
pub const SHA256_DIGEST_LENGTH = @as(c_int, 32);
pub const SHA384_CBLOCK = @as(c_int, 128);
pub const SHA384_DIGEST_LENGTH = @as(c_int, 48);
pub const SHA512_CBLOCK = @as(c_int, 128);
pub const SHA512_DIGEST_LENGTH = @as(c_int, 64);
pub const SHA512_256_DIGEST_LENGTH = @as(c_int, 32);
pub const X509_VERSION_1 = @as(c_int, 0);
pub const X509_VERSION_2 = @as(c_int, 1);
pub const X509_VERSION_3 = @as(c_int, 2);
pub const X509_CRL_VERSION_1 = @as(c_int, 0);
pub const X509_CRL_VERSION_2 = @as(c_int, 1);
pub const X509_REQ_VERSION_1 = @as(c_int, 0);
pub inline fn X509_extract_key(x: anytype) @TypeOf(X509_get_pubkey(x)) {
    return X509_get_pubkey(x);
}
pub inline fn X509_REQ_extract_key(a: anytype) @TypeOf(X509_REQ_get_pubkey(a)) {
    return X509_REQ_get_pubkey(a);
}
pub inline fn X509_name_cmp(a: anytype, b: anytype) @TypeOf(X509_NAME_cmp(a, b)) {
    return X509_NAME_cmp(a, b);
}
pub const X509_CRL_set_lastUpdate = X509_CRL_set1_lastUpdate;
pub const X509_CRL_set_nextUpdate = X509_CRL_set1_nextUpdate;
pub const X509_FILETYPE_PEM = @as(c_int, 1);
pub const X509_FILETYPE_ASN1 = @as(c_int, 2);
pub const X509_FILETYPE_DEFAULT = @as(c_int, 3);
pub const X509v3_KU_DIGITAL_SIGNATURE = @as(c_int, 0x0080);
pub const X509v3_KU_NON_REPUDIATION = @as(c_int, 0x0040);
pub const X509v3_KU_KEY_ENCIPHERMENT = @as(c_int, 0x0020);
pub const X509v3_KU_DATA_ENCIPHERMENT = @as(c_int, 0x0010);
pub const X509v3_KU_KEY_AGREEMENT = @as(c_int, 0x0008);
pub const X509v3_KU_KEY_CERT_SIGN = @as(c_int, 0x0004);
pub const X509v3_KU_CRL_SIGN = @as(c_int, 0x0002);
pub const X509v3_KU_ENCIPHER_ONLY = @as(c_int, 0x0001);
pub const X509v3_KU_DECIPHER_ONLY = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x8000, .hex);
pub const X509v3_KU_UNDEF = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0xffff, .hex);
pub const X509_TRUST_DEFAULT = -@as(c_int, 1);
pub const X509_TRUST_COMPAT = @as(c_int, 1);
pub const X509_TRUST_SSL_CLIENT = @as(c_int, 2);
pub const X509_TRUST_SSL_SERVER = @as(c_int, 3);
pub const X509_TRUST_EMAIL = @as(c_int, 4);
pub const X509_TRUST_OBJECT_SIGN = @as(c_int, 5);
pub const X509_TRUST_OCSP_SIGN = @as(c_int, 6);
pub const X509_TRUST_OCSP_REQUEST = @as(c_int, 7);
pub const X509_TRUST_TSA = @as(c_int, 8);
pub const X509_TRUST_MIN = @as(c_int, 1);
pub const X509_TRUST_MAX = @as(c_int, 8);
pub const X509_TRUST_DYNAMIC = @as(c_int, 1);
pub const X509_TRUST_DYNAMIC_NAME = @as(c_int, 2);
pub const X509_TRUST_TRUSTED = @as(c_int, 1);
pub const X509_TRUST_REJECTED = @as(c_int, 2);
pub const X509_TRUST_UNTRUSTED = @as(c_int, 3);
pub const X509_FLAG_COMPAT = @as(c_int, 0);
pub const X509_FLAG_NO_HEADER = @as(c_long, 1);
pub const X509_FLAG_NO_VERSION = @as(c_long, 1) << @as(c_int, 1);
pub const X509_FLAG_NO_SERIAL = @as(c_long, 1) << @as(c_int, 2);
pub const X509_FLAG_NO_SIGNAME = @as(c_long, 1) << @as(c_int, 3);
pub const X509_FLAG_NO_ISSUER = @as(c_long, 1) << @as(c_int, 4);
pub const X509_FLAG_NO_VALIDITY = @as(c_long, 1) << @as(c_int, 5);
pub const X509_FLAG_NO_SUBJECT = @as(c_long, 1) << @as(c_int, 6);
pub const X509_FLAG_NO_PUBKEY = @as(c_long, 1) << @as(c_int, 7);
pub const X509_FLAG_NO_EXTENSIONS = @as(c_long, 1) << @as(c_int, 8);
pub const X509_FLAG_NO_SIGDUMP = @as(c_long, 1) << @as(c_int, 9);
pub const X509_FLAG_NO_AUX = @as(c_long, 1) << @as(c_int, 10);
pub const X509_FLAG_NO_ATTRIBUTES = @as(c_long, 1) << @as(c_int, 11);
pub const X509_FLAG_NO_IDS = @as(c_long, 1) << @as(c_int, 12);
pub const XN_FLAG_SEP_MASK = @as(c_int, 0xf) << @as(c_int, 16);
pub const XN_FLAG_COMPAT = @as(c_int, 0);
pub const XN_FLAG_SEP_COMMA_PLUS = @as(c_int, 1) << @as(c_int, 16);
pub const XN_FLAG_SEP_CPLUS_SPC = @as(c_int, 2) << @as(c_int, 16);
pub const XN_FLAG_SEP_SPLUS_SPC = @as(c_int, 3) << @as(c_int, 16);
pub const XN_FLAG_SEP_MULTILINE = @as(c_int, 4) << @as(c_int, 16);
pub const XN_FLAG_DN_REV = @as(c_int, 1) << @as(c_int, 20);
pub const XN_FLAG_FN_MASK = @as(c_int, 0x3) << @as(c_int, 21);
pub const XN_FLAG_FN_SN = @as(c_int, 0);
pub const XN_FLAG_FN_LN = @as(c_int, 1) << @as(c_int, 21);
pub const XN_FLAG_FN_OID = @as(c_int, 2) << @as(c_int, 21);
pub const XN_FLAG_FN_NONE = @as(c_int, 3) << @as(c_int, 21);
pub const XN_FLAG_SPC_EQ = @as(c_int, 1) << @as(c_int, 23);
pub const XN_FLAG_DUMP_UNKNOWN_FIELDS = @as(c_int, 1) << @as(c_int, 24);
pub const XN_FLAG_FN_ALIGN = @as(c_int, 1) << @as(c_int, 25);
pub const XN_FLAG_RFC2253 = (((ASN1_STRFLGS_RFC2253 | XN_FLAG_SEP_COMMA_PLUS) | XN_FLAG_DN_REV) | XN_FLAG_FN_SN) | XN_FLAG_DUMP_UNKNOWN_FIELDS;
pub const XN_FLAG_ONELINE = (((ASN1_STRFLGS_RFC2253 | ASN1_STRFLGS_ESC_QUOTE) | XN_FLAG_SEP_CPLUS_SPC) | XN_FLAG_SPC_EQ) | XN_FLAG_FN_SN;
pub const XN_FLAG_MULTILINE = ((((ASN1_STRFLGS_ESC_CTRL | ASN1_STRFLGS_ESC_MSB) | XN_FLAG_SEP_MULTILINE) | XN_FLAG_SPC_EQ) | XN_FLAG_FN_LN) | XN_FLAG_FN_ALIGN;
pub const X509_LU_X509 = @as(c_int, 1);
pub const X509_LU_CRL = @as(c_int, 2);
pub const X509_LU_PKEY = @as(c_int, 3);
pub const X509_L_FILE_LOAD = @as(c_int, 1);
pub const X509_L_ADD_DIR = @as(c_int, 2);
pub inline fn X509_LOOKUP_load_file(x: anytype, name: anytype, @"type": anytype) @TypeOf(X509_LOOKUP_ctrl(x, X509_L_FILE_LOAD, name, @import("std").zig.c_translation.cast(c_long, @"type"), NULL)) {
    return X509_LOOKUP_ctrl(x, X509_L_FILE_LOAD, name, @import("std").zig.c_translation.cast(c_long, @"type"), NULL);
}
pub inline fn X509_LOOKUP_add_dir(x: anytype, name: anytype, @"type": anytype) @TypeOf(X509_LOOKUP_ctrl(x, X509_L_ADD_DIR, name, @import("std").zig.c_translation.cast(c_long, @"type"), NULL)) {
    return X509_LOOKUP_ctrl(x, X509_L_ADD_DIR, name, @import("std").zig.c_translation.cast(c_long, @"type"), NULL);
}
pub const X509_V_OK = @as(c_int, 0);
pub const X509_V_ERR_UNSPECIFIED = @as(c_int, 1);
pub const X509_V_ERR_UNABLE_TO_GET_ISSUER_CERT = @as(c_int, 2);
pub const X509_V_ERR_UNABLE_TO_GET_CRL = @as(c_int, 3);
pub const X509_V_ERR_UNABLE_TO_DECRYPT_CERT_SIGNATURE = @as(c_int, 4);
pub const X509_V_ERR_UNABLE_TO_DECRYPT_CRL_SIGNATURE = @as(c_int, 5);
pub const X509_V_ERR_UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY = @as(c_int, 6);
pub const X509_V_ERR_CERT_SIGNATURE_FAILURE = @as(c_int, 7);
pub const X509_V_ERR_CRL_SIGNATURE_FAILURE = @as(c_int, 8);
pub const X509_V_ERR_CERT_NOT_YET_VALID = @as(c_int, 9);
pub const X509_V_ERR_CERT_HAS_EXPIRED = @as(c_int, 10);
pub const X509_V_ERR_CRL_NOT_YET_VALID = @as(c_int, 11);
pub const X509_V_ERR_CRL_HAS_EXPIRED = @as(c_int, 12);
pub const X509_V_ERR_ERROR_IN_CERT_NOT_BEFORE_FIELD = @as(c_int, 13);
pub const X509_V_ERR_ERROR_IN_CERT_NOT_AFTER_FIELD = @as(c_int, 14);
pub const X509_V_ERR_ERROR_IN_CRL_LAST_UPDATE_FIELD = @as(c_int, 15);
pub const X509_V_ERR_ERROR_IN_CRL_NEXT_UPDATE_FIELD = @as(c_int, 16);
pub const X509_V_ERR_OUT_OF_MEM = @as(c_int, 17);
pub const X509_V_ERR_DEPTH_ZERO_SELF_SIGNED_CERT = @as(c_int, 18);
pub const X509_V_ERR_SELF_SIGNED_CERT_IN_CHAIN = @as(c_int, 19);
pub const X509_V_ERR_UNABLE_TO_GET_ISSUER_CERT_LOCALLY = @as(c_int, 20);
pub const X509_V_ERR_UNABLE_TO_VERIFY_LEAF_SIGNATURE = @as(c_int, 21);
pub const X509_V_ERR_CERT_CHAIN_TOO_LONG = @as(c_int, 22);
pub const X509_V_ERR_CERT_REVOKED = @as(c_int, 23);
pub const X509_V_ERR_INVALID_CA = @as(c_int, 24);
pub const X509_V_ERR_PATH_LENGTH_EXCEEDED = @as(c_int, 25);
pub const X509_V_ERR_INVALID_PURPOSE = @as(c_int, 26);
pub const X509_V_ERR_CERT_UNTRUSTED = @as(c_int, 27);
pub const X509_V_ERR_CERT_REJECTED = @as(c_int, 28);
pub const X509_V_ERR_SUBJECT_ISSUER_MISMATCH = @as(c_int, 29);
pub const X509_V_ERR_AKID_SKID_MISMATCH = @as(c_int, 30);
pub const X509_V_ERR_AKID_ISSUER_SERIAL_MISMATCH = @as(c_int, 31);
pub const X509_V_ERR_KEYUSAGE_NO_CERTSIGN = @as(c_int, 32);
pub const X509_V_ERR_UNABLE_TO_GET_CRL_ISSUER = @as(c_int, 33);
pub const X509_V_ERR_UNHANDLED_CRITICAL_EXTENSION = @as(c_int, 34);
pub const X509_V_ERR_KEYUSAGE_NO_CRL_SIGN = @as(c_int, 35);
pub const X509_V_ERR_UNHANDLED_CRITICAL_CRL_EXTENSION = @as(c_int, 36);
pub const X509_V_ERR_INVALID_NON_CA = @as(c_int, 37);
pub const X509_V_ERR_PROXY_PATH_LENGTH_EXCEEDED = @as(c_int, 38);
pub const X509_V_ERR_KEYUSAGE_NO_DIGITAL_SIGNATURE = @as(c_int, 39);
pub const X509_V_ERR_PROXY_CERTIFICATES_NOT_ALLOWED = @as(c_int, 40);
pub const X509_V_ERR_INVALID_EXTENSION = @as(c_int, 41);
pub const X509_V_ERR_INVALID_POLICY_EXTENSION = @as(c_int, 42);
pub const X509_V_ERR_NO_EXPLICIT_POLICY = @as(c_int, 43);
pub const X509_V_ERR_DIFFERENT_CRL_SCOPE = @as(c_int, 44);
pub const X509_V_ERR_UNSUPPORTED_EXTENSION_FEATURE = @as(c_int, 45);
pub const X509_V_ERR_UNNESTED_RESOURCE = @as(c_int, 46);
pub const X509_V_ERR_PERMITTED_VIOLATION = @as(c_int, 47);
pub const X509_V_ERR_EXCLUDED_VIOLATION = @as(c_int, 48);
pub const X509_V_ERR_SUBTREE_MINMAX = @as(c_int, 49);
pub const X509_V_ERR_APPLICATION_VERIFICATION = @as(c_int, 50);
pub const X509_V_ERR_UNSUPPORTED_CONSTRAINT_TYPE = @as(c_int, 51);
pub const X509_V_ERR_UNSUPPORTED_CONSTRAINT_SYNTAX = @as(c_int, 52);
pub const X509_V_ERR_UNSUPPORTED_NAME_SYNTAX = @as(c_int, 53);
pub const X509_V_ERR_CRL_PATH_VALIDATION_ERROR = @as(c_int, 54);

pub const X509_V_ERR_SUITE_B_INVALID_VERSION = @as(c_int, 56);
pub const X509_V_ERR_SUITE_B_INVALID_ALGORITHM = @as(c_int, 57);
pub const X509_V_ERR_SUITE_B_INVALID_CURVE = @as(c_int, 58);
pub const X509_V_ERR_SUITE_B_INVALID_SIGNATURE_ALGORITHM = @as(c_int, 59);
pub const X509_V_ERR_SUITE_B_LOS_NOT_ALLOWED = @as(c_int, 60);
pub const X509_V_ERR_SUITE_B_CANNOT_SIGN_P_384_WITH_P_256 = @as(c_int, 61);

pub const X509_V_ERR_HOSTNAME_MISMATCH = @as(c_int, 62);
pub const X509_V_ERR_EMAIL_MISMATCH = @as(c_int, 63);
pub const X509_V_ERR_IP_ADDRESS_MISMATCH = @as(c_int, 64);
pub const X509_V_ERR_INVALID_CALL = @as(c_int, 65);
pub const X509_V_ERR_STORE_LOOKUP = @as(c_int, 66);
pub const X509_V_ERR_NAME_CONSTRAINTS_WITHOUT_SANS = @as(c_int, 67);
pub const X509_V_FLAG_CB_ISSUER_CHECK = @as(c_int, 0x1);
pub const X509_V_FLAG_USE_CHECK_TIME = @as(c_int, 0x2);
pub const X509_V_FLAG_CRL_CHECK = @as(c_int, 0x4);
pub const X509_V_FLAG_CRL_CHECK_ALL = @as(c_int, 0x8);
pub const X509_V_FLAG_IGNORE_CRITICAL = @as(c_int, 0x10);
pub const X509_V_FLAG_X509_STRICT = @as(c_int, 0x00);
pub const X509_V_FLAG_ALLOW_PROXY_CERTS = @as(c_int, 0x40);
pub const X509_V_FLAG_POLICY_CHECK = @as(c_int, 0x80);
pub const X509_V_FLAG_EXPLICIT_POLICY = @as(c_int, 0x100);
pub const X509_V_FLAG_INHIBIT_ANY = @as(c_int, 0x200);
pub const X509_V_FLAG_INHIBIT_MAP = @as(c_int, 0x400);
pub const X509_V_FLAG_NOTIFY_POLICY = @as(c_int, 0x800);
pub const X509_V_FLAG_EXTENDED_CRL_SUPPORT = @as(c_int, 0x1000);
pub const X509_V_FLAG_USE_DELTAS = @as(c_int, 0x2000);
pub const X509_V_FLAG_CHECK_SS_SIGNATURE = @as(c_int, 0x4000);
pub const X509_V_FLAG_TRUSTED_FIRST = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x8000, .hex);
pub const X509_V_FLAG_PARTIAL_CHAIN = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x80000, .hex);
pub const X509_V_FLAG_NO_ALT_CHAINS = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x100000, .hex);
pub const X509_V_FLAG_NO_CHECK_TIME = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x200000, .hex);
pub const X509_VP_FLAG_DEFAULT = @as(c_int, 0x1);
pub const X509_VP_FLAG_OVERWRITE = @as(c_int, 0x2);
pub const X509_VP_FLAG_RESET_FLAGS = @as(c_int, 0x4);
pub const X509_VP_FLAG_LOCKED = @as(c_int, 0x8);
pub const X509_VP_FLAG_ONCE = @as(c_int, 0x10);
pub const X509_V_FLAG_POLICY_MASK = ((X509_V_FLAG_POLICY_CHECK | X509_V_FLAG_EXPLICIT_POLICY) | X509_V_FLAG_INHIBIT_ANY) | X509_V_FLAG_INHIBIT_MAP;
pub inline fn X509_STORE_set_verify_func(ctx: anytype, func: anytype) @TypeOf(X509_STORE_set_verify(ctx, func)) {
    return X509_STORE_set_verify(ctx, func);
}
pub inline fn X509_STORE_set_verify_cb_func(ctx: anytype, func: anytype) @TypeOf(X509_STORE_set_verify_cb(ctx, func)) {
    return X509_STORE_set_verify_cb(ctx, func);
}
pub inline fn X509_STORE_set_lookup_crls_cb(ctx: anytype, func: anytype) @TypeOf(X509_STORE_set_lookup_crls(ctx, func)) {
    return X509_STORE_set_lookup_crls(ctx, func);
}
pub const X509_R_AKID_MISMATCH = @as(c_int, 100);
pub const X509_R_BAD_PKCS7_VERSION = @as(c_int, 101);
pub const X509_R_BAD_X509_FILETYPE = @as(c_int, 102);
pub const X509_R_BASE64_DECODE_ERROR = @as(c_int, 103);
pub const X509_R_CANT_CHECK_DH_KEY = @as(c_int, 104);
pub const X509_R_CERT_ALREADY_IN_HASH_TABLE = @as(c_int, 105);
pub const X509_R_CRL_ALREADY_DELTA = @as(c_int, 106);
pub const X509_R_CRL_VERIFY_FAILURE = @as(c_int, 107);
pub const X509_R_IDP_MISMATCH = @as(c_int, 108);
pub const X509_R_INVALID_BIT_STRING_BITS_LEFT = @as(c_int, 109);
pub const X509_R_INVALID_DIRECTORY = @as(c_int, 110);
pub const X509_R_INVALID_FIELD_NAME = @as(c_int, 111);
pub const X509_R_INVALID_PSS_PARAMETERS = @as(c_int, 112);
pub const X509_R_INVALID_TRUST = @as(c_int, 113);
pub const X509_R_ISSUER_MISMATCH = @as(c_int, 114);
pub const X509_R_KEY_TYPE_MISMATCH = @as(c_int, 115);
pub const X509_R_KEY_VALUES_MISMATCH = @as(c_int, 116);
pub const X509_R_LOADING_CERT_DIR = @as(c_int, 117);
pub const X509_R_LOADING_DEFAULTS = @as(c_int, 118);
pub const X509_R_NEWER_CRL_NOT_NEWER = @as(c_int, 119);
pub const X509_R_NOT_PKCS7_SIGNED_DATA = @as(c_int, 120);
pub const X509_R_NO_CERTIFICATES_INCLUDED = @as(c_int, 121);
pub const X509_R_NO_CERT_SET_FOR_US_TO_VERIFY = @as(c_int, 122);
pub const X509_R_NO_CRLS_INCLUDED = @as(c_int, 123);
pub const X509_R_NO_CRL_NUMBER = @as(c_int, 124);
pub const X509_R_PUBLIC_KEY_DECODE_ERROR = @as(c_int, 125);
pub const X509_R_PUBLIC_KEY_ENCODE_ERROR = @as(c_int, 126);
pub const X509_R_SHOULD_RETRY = @as(c_int, 127);
pub const X509_R_UNKNOWN_KEY_TYPE = @as(c_int, 128);
pub const X509_R_UNKNOWN_NID = @as(c_int, 129);
pub const X509_R_UNKNOWN_PURPOSE_ID = @as(c_int, 130);
pub const X509_R_UNKNOWN_TRUST_ID = @as(c_int, 131);
pub const X509_R_UNSUPPORTED_ALGORITHM = @as(c_int, 132);
pub const X509_R_WRONG_LOOKUP_TYPE = @as(c_int, 133);
pub const X509_R_WRONG_TYPE = @as(c_int, 134);
pub const X509_R_NAME_TOO_LONG = @as(c_int, 135);
pub const X509_R_INVALID_PARAMETER = @as(c_int, 136);
pub const X509_R_SIGNATURE_ALGORITHM_MISMATCH = @as(c_int, 137);
pub const X509_R_DELTA_CRL_WITHOUT_CRL_NUMBER = @as(c_int, 138);
pub const X509_R_INVALID_FIELD_FOR_VERSION = @as(c_int, 139);
pub const X509_R_INVALID_VERSION = @as(c_int, 140);
pub const X509_R_NO_CERTIFICATE_FOUND = @as(c_int, 141);
pub const X509_R_NO_CERTIFICATE_OR_CRL_FOUND = @as(c_int, 142);
pub const X509_R_NO_CRL_FOUND = @as(c_int, 143);
pub const OPENSSL_HEADER_CRYPTO_H = "";
pub const OPENSSL_HEADER_MEM_H = "";
pub const OPENSSL_VERSION_TEXT = "OpenSSL 1.1.1 (compatible; BoringSSL)";
pub const OPENSSL_VERSION = @as(c_int, 0);
pub const OPENSSL_CFLAGS = @as(c_int, 1);
pub const OPENSSL_BUILT_ON = @as(c_int, 2);
pub const OPENSSL_PLATFORM = @as(c_int, 3);
pub const OPENSSL_DIR = @as(c_int, 4);
pub const SSLEAY_VERSION = OPENSSL_VERSION;
pub const SSLEAY_CFLAGS = OPENSSL_CFLAGS;
pub const SSLEAY_BUILT_ON = OPENSSL_BUILT_ON;
pub const SSLEAY_PLATFORM = OPENSSL_PLATFORM;
pub const SSLEAY_DIR = OPENSSL_DIR;
pub const OPENSSL_INIT_NO_LOAD_CRYPTO_STRINGS = @as(c_int, 0);
pub const OPENSSL_INIT_LOAD_CRYPTO_STRINGS = @as(c_int, 0);
pub const OPENSSL_INIT_ADD_ALL_CIPHERS = @as(c_int, 0);
pub const OPENSSL_INIT_ADD_ALL_DIGESTS = @as(c_int, 0);
pub const OPENSSL_INIT_NO_ADD_ALL_CIPHERS = @as(c_int, 0);
pub const OPENSSL_INIT_NO_ADD_ALL_DIGESTS = @as(c_int, 0);
pub const OPENSSL_INIT_LOAD_CONFIG = @as(c_int, 0);
pub const OPENSSL_INIT_NO_LOAD_CONFIG = @as(c_int, 0);
pub const PEM_BUFSIZE = @as(c_int, 1024);
pub const PEM_STRING_X509_OLD = "X509 CERTIFICATE";
pub const PEM_STRING_X509 = "CERTIFICATE";
pub const PEM_STRING_X509_PAIR = "CERTIFICATE PAIR";
pub const PEM_STRING_X509_TRUSTED = "TRUSTED CERTIFICATE";
pub const PEM_STRING_X509_REQ_OLD = "NEW CERTIFICATE REQUEST";
pub const PEM_STRING_X509_REQ = "CERTIFICATE REQUEST";
pub const PEM_STRING_X509_CRL = "X509 CRL";
pub const PEM_STRING_EVP_PKEY = "ANY PRIVATE KEY";
pub const PEM_STRING_PUBLIC = "PUBLIC KEY";
pub const PEM_STRING_RSA = "RSA PRIVATE KEY";
pub const PEM_STRING_RSA_PUBLIC = "RSA PUBLIC KEY";
pub const PEM_STRING_DSA = "DSA PRIVATE KEY";
pub const PEM_STRING_DSA_PUBLIC = "DSA PUBLIC KEY";
pub const PEM_STRING_EC = "EC PRIVATE KEY";
pub const PEM_STRING_PKCS7 = "PKCS7";
pub const PEM_STRING_PKCS7_SIGNED = "PKCS #7 SIGNED DATA";
pub const PEM_STRING_PKCS8 = "ENCRYPTED PRIVATE KEY";
pub const PEM_STRING_PKCS8INF = "PRIVATE KEY";
pub const PEM_STRING_DHPARAMS = "DH PARAMETERS";
pub const PEM_STRING_SSL_SESSION = "SSL SESSION PARAMETERS";
pub const PEM_STRING_DSAPARAMS = "DSA PARAMETERS";
pub const PEM_STRING_ECDSA_PUBLIC = "ECDSA PUBLIC KEY";
pub const PEM_STRING_ECPRIVATEKEY = "EC PRIVATE KEY";
pub const PEM_STRING_CMS = "CMS";
pub const PEM_TYPE_ENCRYPTED = @as(c_int, 10);
pub const PEM_TYPE_MIC_ONLY = @as(c_int, 20);
pub const PEM_TYPE_MIC_CLEAR = @as(c_int, 30);
pub const PEM_TYPE_CLEAR = @as(c_int, 40);
pub const PEM_R_BAD_BASE64_DECODE = @as(c_int, 100);
pub const PEM_R_BAD_DECRYPT = @as(c_int, 101);
pub const PEM_R_BAD_END_LINE = @as(c_int, 102);
pub const PEM_R_BAD_IV_CHARS = @as(c_int, 103);
pub const PEM_R_BAD_PASSWORD_READ = @as(c_int, 104);
pub const PEM_R_CIPHER_IS_NULL = @as(c_int, 105);
pub const PEM_R_ERROR_CONVERTING_PRIVATE_KEY = @as(c_int, 106);
pub const PEM_R_NOT_DEK_INFO = @as(c_int, 107);
pub const PEM_R_NOT_ENCRYPTED = @as(c_int, 108);
pub const PEM_R_NOT_PROC_TYPE = @as(c_int, 109);
pub const PEM_R_NO_START_LINE = @as(c_int, 110);
pub const PEM_R_READ_KEY = @as(c_int, 111);
pub const PEM_R_SHORT_HEADER = @as(c_int, 112);
pub const PEM_R_UNSUPPORTED_CIPHER = @as(c_int, 113);
pub const PEM_R_UNSUPPORTED_ENCRYPTION = @as(c_int, 114);
pub const OPENSSL_HEADER_SSL3_H = "";
pub const SSL2_MT_CLIENT_HELLO = @as(c_int, 1);
pub const SSL2_VERSION = @as(c_int, 0x0002);
pub const SSL3_CK_SCSV = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x030000FF, .hex);
pub const SSL3_CK_FALLBACK_SCSV = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03005600, .hex);
pub const SSL3_CK_RSA_NULL_MD5 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000001, .hex);
pub const SSL3_CK_RSA_NULL_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000002, .hex);
pub const SSL3_CK_RSA_RC4_40_MD5 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000003, .hex);
pub const SSL3_CK_RSA_RC4_128_MD5 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000004, .hex);
pub const SSL3_CK_RSA_RC4_128_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000005, .hex);
pub const SSL3_CK_RSA_RC2_40_MD5 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000006, .hex);
pub const SSL3_CK_RSA_IDEA_128_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000007, .hex);
pub const SSL3_CK_RSA_DES_40_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000008, .hex);
pub const SSL3_CK_RSA_DES_64_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000009, .hex);
pub const SSL3_CK_RSA_DES_192_CBC3_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300000A, .hex);
pub const SSL3_CK_DH_DSS_DES_40_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300000B, .hex);
pub const SSL3_CK_DH_DSS_DES_64_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300000C, .hex);
pub const SSL3_CK_DH_DSS_DES_192_CBC3_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300000D, .hex);
pub const SSL3_CK_DH_RSA_DES_40_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300000E, .hex);
pub const SSL3_CK_DH_RSA_DES_64_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300000F, .hex);
pub const SSL3_CK_DH_RSA_DES_192_CBC3_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000010, .hex);
pub const SSL3_CK_EDH_DSS_DES_40_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000011, .hex);
pub const SSL3_CK_EDH_DSS_DES_64_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000012, .hex);
pub const SSL3_CK_EDH_DSS_DES_192_CBC3_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000013, .hex);
pub const SSL3_CK_EDH_RSA_DES_40_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000014, .hex);
pub const SSL3_CK_EDH_RSA_DES_64_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000015, .hex);
pub const SSL3_CK_EDH_RSA_DES_192_CBC3_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000016, .hex);
pub const SSL3_CK_ADH_RC4_40_MD5 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000017, .hex);
pub const SSL3_CK_ADH_RC4_128_MD5 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000018, .hex);
pub const SSL3_CK_ADH_DES_40_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000019, .hex);
pub const SSL3_CK_ADH_DES_64_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300001A, .hex);
pub const SSL3_CK_ADH_DES_192_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300001B, .hex);
pub const SSL3_TXT_RSA_NULL_MD5 = "NULL-MD5";
pub const SSL3_TXT_RSA_NULL_SHA = "NULL-SHA";
pub const SSL3_TXT_RSA_RC4_40_MD5 = "EXP-RC4-MD5";
pub const SSL3_TXT_RSA_RC4_128_MD5 = "RC4-MD5";
pub const SSL3_TXT_RSA_RC4_128_SHA = "RC4-SHA";
pub const SSL3_TXT_RSA_RC2_40_MD5 = "EXP-RC2-CBC-MD5";
pub const SSL3_TXT_RSA_IDEA_128_SHA = "IDEA-CBC-SHA";
pub const SSL3_TXT_RSA_DES_40_CBC_SHA = "EXP-DES-CBC-SHA";
pub const SSL3_TXT_RSA_DES_64_CBC_SHA = "DES-CBC-SHA";
pub const SSL3_TXT_RSA_DES_192_CBC3_SHA = "DES-CBC3-SHA";
pub const SSL3_TXT_DH_DSS_DES_40_CBC_SHA = "EXP-DH-DSS-DES-CBC-SHA";
pub const SSL3_TXT_DH_DSS_DES_64_CBC_SHA = "DH-DSS-DES-CBC-SHA";
pub const SSL3_TXT_DH_DSS_DES_192_CBC3_SHA = "DH-DSS-DES-CBC3-SHA";
pub const SSL3_TXT_DH_RSA_DES_40_CBC_SHA = "EXP-DH-RSA-DES-CBC-SHA";
pub const SSL3_TXT_DH_RSA_DES_64_CBC_SHA = "DH-RSA-DES-CBC-SHA";
pub const SSL3_TXT_DH_RSA_DES_192_CBC3_SHA = "DH-RSA-DES-CBC3-SHA";
pub const SSL3_TXT_EDH_DSS_DES_40_CBC_SHA = "EXP-EDH-DSS-DES-CBC-SHA";
pub const SSL3_TXT_EDH_DSS_DES_64_CBC_SHA = "EDH-DSS-DES-CBC-SHA";
pub const SSL3_TXT_EDH_DSS_DES_192_CBC3_SHA = "EDH-DSS-DES-CBC3-SHA";
pub const SSL3_TXT_EDH_RSA_DES_40_CBC_SHA = "EXP-EDH-RSA-DES-CBC-SHA";
pub const SSL3_TXT_EDH_RSA_DES_64_CBC_SHA = "EDH-RSA-DES-CBC-SHA";
pub const SSL3_TXT_EDH_RSA_DES_192_CBC3_SHA = "EDH-RSA-DES-CBC3-SHA";
pub const SSL3_TXT_ADH_RC4_40_MD5 = "EXP-ADH-RC4-MD5";
pub const SSL3_TXT_ADH_RC4_128_MD5 = "ADH-RC4-MD5";
pub const SSL3_TXT_ADH_DES_40_CBC_SHA = "EXP-ADH-DES-CBC-SHA";
pub const SSL3_TXT_ADH_DES_64_CBC_SHA = "ADH-DES-CBC-SHA";
pub const SSL3_TXT_ADH_DES_192_CBC_SHA = "ADH-DES-CBC3-SHA";
pub const SSL3_SSL_SESSION_ID_LENGTH = @as(c_int, 32);
pub const SSL3_MAX_SSL_SESSION_ID_LENGTH = @as(c_int, 32);
pub const SSL3_MASTER_SECRET_SIZE = @as(c_int, 48);
pub const SSL3_RANDOM_SIZE = @as(c_int, 32);
pub const SSL3_SESSION_ID_SIZE = @as(c_int, 32);
pub const SSL3_RT_HEADER_LENGTH = @as(c_int, 5);
pub const SSL3_HM_HEADER_LENGTH = @as(c_int, 4);
pub const SSL3_ALIGN_PAYLOAD = @as(c_int, 8);
pub const SSL3_RT_MAX_MD_SIZE = @as(c_int, 64);
pub const SSL_RT_MAX_CIPHER_BLOCK_SIZE = @as(c_int, 16);
pub const SSL3_RT_MAX_PLAIN_LENGTH = @as(c_int, 16384);
pub const SSL3_RT_MAX_COMPRESSED_OVERHEAD = @as(c_int, 1024);
pub const SSL3_RT_MAX_ENCRYPTED_OVERHEAD = @as(c_int, 256) + SSL3_RT_MAX_MD_SIZE;
pub const SSL3_RT_SEND_MAX_ENCRYPTED_OVERHEAD = EVP_AEAD_MAX_OVERHEAD + EVP_AEAD_MAX_NONCE_LENGTH;
pub const SSL3_RT_MAX_COMPRESSED_LENGTH = SSL3_RT_MAX_PLAIN_LENGTH;
pub const SSL3_RT_MAX_ENCRYPTED_LENGTH = SSL3_RT_MAX_ENCRYPTED_OVERHEAD + SSL3_RT_MAX_COMPRESSED_LENGTH;
pub const SSL3_RT_MAX_PACKET_SIZE = SSL3_RT_MAX_ENCRYPTED_LENGTH + SSL3_RT_HEADER_LENGTH;
pub const SSL3_MD_CLIENT_FINISHED_CONST = "\x43\x4c\x4e\x54";
pub const SSL3_MD_SERVER_FINISHED_CONST = "\x53\x52\x56\x52";
pub const SSL3_RT_CHANGE_CIPHER_SPEC = @as(c_int, 20);
pub const SSL3_RT_ALERT = @as(c_int, 21);
pub const SSL3_RT_HANDSHAKE = @as(c_int, 22);
pub const SSL3_RT_APPLICATION_DATA = @as(c_int, 23);
pub const SSL3_RT_HEADER = @as(c_int, 0x100);
pub const SSL3_RT_CLIENT_HELLO_INNER = @as(c_int, 0x101);
pub const SSL3_AL_WARNING = @as(c_int, 1);
pub const SSL3_AL_FATAL = @as(c_int, 2);
pub const SSL3_AD_CLOSE_NOTIFY = @as(c_int, 0);
pub const SSL3_AD_UNEXPECTED_MESSAGE = @as(c_int, 10);
pub const SSL3_AD_BAD_RECORD_MAC = @as(c_int, 20);
pub const SSL3_AD_DECOMPRESSION_FAILURE = @as(c_int, 30);
pub const SSL3_AD_HANDSHAKE_FAILURE = @as(c_int, 40);
pub const SSL3_AD_NO_CERTIFICATE = @as(c_int, 41);
pub const SSL3_AD_BAD_CERTIFICATE = @as(c_int, 42);
pub const SSL3_AD_UNSUPPORTED_CERTIFICATE = @as(c_int, 43);
pub const SSL3_AD_CERTIFICATE_REVOKED = @as(c_int, 44);
pub const SSL3_AD_CERTIFICATE_EXPIRED = @as(c_int, 45);
pub const SSL3_AD_CERTIFICATE_UNKNOWN = @as(c_int, 46);
pub const SSL3_AD_ILLEGAL_PARAMETER = @as(c_int, 47);
pub const SSL3_AD_INAPPROPRIATE_FALLBACK = @as(c_int, 86);
pub const SSL3_CT_RSA_SIGN = @as(c_int, 1);
pub const SSL3_MT_HELLO_REQUEST = @as(c_int, 0);
pub const SSL3_MT_CLIENT_HELLO = @as(c_int, 1);
pub const SSL3_MT_SERVER_HELLO = @as(c_int, 2);
pub const SSL3_MT_NEW_SESSION_TICKET = @as(c_int, 4);
pub const SSL3_MT_END_OF_EARLY_DATA = @as(c_int, 5);
pub const SSL3_MT_ENCRYPTED_EXTENSIONS = @as(c_int, 8);
pub const SSL3_MT_CERTIFICATE = @as(c_int, 11);
pub const SSL3_MT_SERVER_KEY_EXCHANGE = @as(c_int, 12);
pub const SSL3_MT_CERTIFICATE_REQUEST = @as(c_int, 13);
pub const SSL3_MT_SERVER_HELLO_DONE = @as(c_int, 14);
pub const SSL3_MT_CERTIFICATE_VERIFY = @as(c_int, 15);
pub const SSL3_MT_CLIENT_KEY_EXCHANGE = @as(c_int, 16);
pub const SSL3_MT_FINISHED = @as(c_int, 20);
pub const SSL3_MT_CERTIFICATE_STATUS = @as(c_int, 22);
pub const SSL3_MT_SUPPLEMENTAL_DATA = @as(c_int, 23);
pub const SSL3_MT_KEY_UPDATE = @as(c_int, 24);
pub const SSL3_MT_COMPRESSED_CERTIFICATE = @as(c_int, 25);
pub const SSL3_MT_NEXT_PROTO = @as(c_int, 67);
pub const SSL3_MT_CHANNEL_ID = @as(c_int, 203);
pub const SSL3_MT_MESSAGE_HASH = @as(c_int, 254);
pub const DTLS1_MT_HELLO_VERIFY_REQUEST = @as(c_int, 3);
pub const SSL3_MT_SERVER_DONE = SSL3_MT_SERVER_HELLO_DONE;
pub const SSL3_MT_NEWSESSION_TICKET = SSL3_MT_NEW_SESSION_TICKET;
pub const SSL3_MT_CCS = @as(c_int, 1);
pub const OPENSSL_HEADER_TLS1_H = "";
pub const TLS1_AD_END_OF_EARLY_DATA = @as(c_int, 1);
pub const TLS1_AD_DECRYPTION_FAILED = @as(c_int, 21);
pub const TLS1_AD_RECORD_OVERFLOW = @as(c_int, 22);
pub const TLS1_AD_UNKNOWN_CA = @as(c_int, 48);
pub const TLS1_AD_ACCESS_DENIED = @as(c_int, 49);
pub const TLS1_AD_DECODE_ERROR = @as(c_int, 50);
pub const TLS1_AD_DECRYPT_ERROR = @as(c_int, 51);
pub const TLS1_AD_EXPORT_RESTRICTION = @as(c_int, 60);
pub const TLS1_AD_PROTOCOL_VERSION = @as(c_int, 70);
pub const TLS1_AD_INSUFFICIENT_SECURITY = @as(c_int, 71);
pub const TLS1_AD_INTERNAL_ERROR = @as(c_int, 80);
pub const TLS1_AD_USER_CANCELLED = @as(c_int, 90);
pub const TLS1_AD_NO_RENEGOTIATION = @as(c_int, 100);
pub const TLS1_AD_MISSING_EXTENSION = @as(c_int, 109);
pub const TLS1_AD_UNSUPPORTED_EXTENSION = @as(c_int, 110);
pub const TLS1_AD_CERTIFICATE_UNOBTAINABLE = @as(c_int, 111);
pub const TLS1_AD_UNRECOGNIZED_NAME = @as(c_int, 112);
pub const TLS1_AD_BAD_CERTIFICATE_STATUS_RESPONSE = @as(c_int, 113);
pub const TLS1_AD_BAD_CERTIFICATE_HASH_VALUE = @as(c_int, 114);
pub const TLS1_AD_UNKNOWN_PSK_IDENTITY = @as(c_int, 115);
pub const TLS1_AD_CERTIFICATE_REQUIRED = @as(c_int, 116);
pub const TLS1_AD_NO_APPLICATION_PROTOCOL = @as(c_int, 120);
pub const TLS1_AD_ECH_REQUIRED = @as(c_int, 121);
pub const TLSEXT_TYPE_server_name = @as(c_int, 0);
pub const TLSEXT_TYPE_status_request = @as(c_int, 5);
pub const TLSEXT_TYPE_ec_point_formats = @as(c_int, 11);
pub const TLSEXT_TYPE_signature_algorithms = @as(c_int, 13);
pub const TLSEXT_TYPE_srtp = @as(c_int, 14);
pub const TLSEXT_TYPE_application_layer_protocol_negotiation = @as(c_int, 16);
pub const TLSEXT_TYPE_padding = @as(c_int, 21);
pub const TLSEXT_TYPE_extended_master_secret = @as(c_int, 23);
pub const TLSEXT_TYPE_quic_transport_parameters_legacy = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0xffa5, .hex);
pub const TLSEXT_TYPE_quic_transport_parameters = @as(c_int, 57);
pub const TLSEXT_TYPE_quic_transport_parameters_standard = TLSEXT_TYPE_quic_transport_parameters;
pub const TLSEXT_TYPE_cert_compression = @as(c_int, 27);
pub const TLSEXT_TYPE_session_ticket = @as(c_int, 35);
pub const TLSEXT_TYPE_supported_groups = @as(c_int, 10);
pub const TLSEXT_TYPE_pre_shared_key = @as(c_int, 41);
pub const TLSEXT_TYPE_early_data = @as(c_int, 42);
pub const TLSEXT_TYPE_supported_versions = @as(c_int, 43);
pub const TLSEXT_TYPE_cookie = @as(c_int, 44);
pub const TLSEXT_TYPE_psk_key_exchange_modes = @as(c_int, 45);
pub const TLSEXT_TYPE_certificate_authorities = @as(c_int, 47);
pub const TLSEXT_TYPE_signature_algorithms_cert = @as(c_int, 50);
pub const TLSEXT_TYPE_key_share = @as(c_int, 51);
pub const TLSEXT_TYPE_renegotiate = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0xff01, .hex);
pub const TLSEXT_TYPE_delegated_credential = @as(c_int, 0x22);
pub const TLSEXT_TYPE_application_settings = @as(c_int, 17513);
pub const TLSEXT_TYPE_encrypted_client_hello = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0xfe0d, .hex);
pub const TLSEXT_TYPE_ech_outer_extensions = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0xfd00, .hex);
pub const TLSEXT_TYPE_certificate_timestamp = @as(c_int, 18);
pub const TLSEXT_TYPE_next_proto_neg = @as(c_int, 13172);
pub const TLSEXT_TYPE_channel_id = @as(c_int, 30032);
pub const TLSEXT_STATUSTYPE_nothing = -@as(c_int, 1);
pub const TLSEXT_STATUSTYPE_ocsp = @as(c_int, 1);
pub const TLSEXT_ECPOINTFORMAT_uncompressed = @as(c_int, 0);
pub const TLSEXT_ECPOINTFORMAT_ansiX962_compressed_prime = @as(c_int, 1);
pub const TLSEXT_signature_anonymous = @as(c_int, 0);
pub const TLSEXT_signature_rsa = @as(c_int, 1);
pub const TLSEXT_signature_dsa = @as(c_int, 2);
pub const TLSEXT_signature_ecdsa = @as(c_int, 3);
pub const TLSEXT_hash_none = @as(c_int, 0);
pub const TLSEXT_hash_md5 = @as(c_int, 1);
pub const TLSEXT_hash_sha1 = @as(c_int, 2);
pub const TLSEXT_hash_sha224 = @as(c_int, 3);
pub const TLSEXT_hash_sha256 = @as(c_int, 4);
pub const TLSEXT_hash_sha384 = @as(c_int, 5);
pub const TLSEXT_hash_sha512 = @as(c_int, 6);
pub const TLSEXT_cert_compression_zlib = @as(c_int, 1);
pub const TLSEXT_cert_compression_brotli = @as(c_int, 2);
pub const TLSEXT_MAXLEN_host_name = @as(c_int, 255);
pub const TLS1_CK_PSK_WITH_RC4_128_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300008A, .hex);
pub const TLS1_CK_PSK_WITH_3DES_EDE_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300008B, .hex);
pub const TLS1_CK_PSK_WITH_AES_128_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300008C, .hex);
pub const TLS1_CK_PSK_WITH_AES_256_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300008D, .hex);
pub const TLS1_CK_ECDHE_PSK_WITH_AES_128_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C035, .hex);
pub const TLS1_CK_ECDHE_PSK_WITH_AES_256_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C036, .hex);
pub const TLS1_CK_RSA_EXPORT1024_WITH_RC4_56_MD5 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000060, .hex);
pub const TLS1_CK_RSA_EXPORT1024_WITH_RC2_CBC_56_MD5 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000061, .hex);
pub const TLS1_CK_RSA_EXPORT1024_WITH_DES_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000062, .hex);
pub const TLS1_CK_DHE_DSS_EXPORT1024_WITH_DES_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000063, .hex);
pub const TLS1_CK_RSA_EXPORT1024_WITH_RC4_56_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000064, .hex);
pub const TLS1_CK_DHE_DSS_EXPORT1024_WITH_RC4_56_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000065, .hex);
pub const TLS1_CK_DHE_DSS_WITH_RC4_128_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000066, .hex);
pub const TLS1_CK_RSA_WITH_AES_128_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300002F, .hex);
pub const TLS1_CK_DH_DSS_WITH_AES_128_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000030, .hex);
pub const TLS1_CK_DH_RSA_WITH_AES_128_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000031, .hex);
pub const TLS1_CK_DHE_DSS_WITH_AES_128_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000032, .hex);
pub const TLS1_CK_DHE_RSA_WITH_AES_128_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000033, .hex);
pub const TLS1_CK_ADH_WITH_AES_128_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000034, .hex);
pub const TLS1_CK_RSA_WITH_AES_256_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000035, .hex);
pub const TLS1_CK_DH_DSS_WITH_AES_256_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000036, .hex);
pub const TLS1_CK_DH_RSA_WITH_AES_256_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000037, .hex);
pub const TLS1_CK_DHE_DSS_WITH_AES_256_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000038, .hex);
pub const TLS1_CK_DHE_RSA_WITH_AES_256_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000039, .hex);
pub const TLS1_CK_ADH_WITH_AES_256_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300003A, .hex);
pub const TLS1_CK_RSA_WITH_NULL_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300003B, .hex);
pub const TLS1_CK_RSA_WITH_AES_128_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300003C, .hex);
pub const TLS1_CK_RSA_WITH_AES_256_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300003D, .hex);
pub const TLS1_CK_DH_DSS_WITH_AES_128_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300003E, .hex);
pub const TLS1_CK_DH_RSA_WITH_AES_128_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300003F, .hex);
pub const TLS1_CK_DHE_DSS_WITH_AES_128_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000040, .hex);
pub const TLS1_CK_RSA_WITH_CAMELLIA_128_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000041, .hex);
pub const TLS1_CK_DH_DSS_WITH_CAMELLIA_128_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000042, .hex);
pub const TLS1_CK_DH_RSA_WITH_CAMELLIA_128_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000043, .hex);
pub const TLS1_CK_DHE_DSS_WITH_CAMELLIA_128_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000044, .hex);
pub const TLS1_CK_DHE_RSA_WITH_CAMELLIA_128_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000045, .hex);
pub const TLS1_CK_ADH_WITH_CAMELLIA_128_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000046, .hex);
pub const TLS1_CK_DHE_RSA_WITH_AES_128_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000067, .hex);
pub const TLS1_CK_DH_DSS_WITH_AES_256_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000068, .hex);
pub const TLS1_CK_DH_RSA_WITH_AES_256_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000069, .hex);
pub const TLS1_CK_DHE_DSS_WITH_AES_256_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300006A, .hex);
pub const TLS1_CK_DHE_RSA_WITH_AES_256_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300006B, .hex);
pub const TLS1_CK_ADH_WITH_AES_128_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300006C, .hex);
pub const TLS1_CK_ADH_WITH_AES_256_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300006D, .hex);
pub const TLS1_CK_RSA_WITH_CAMELLIA_256_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000084, .hex);
pub const TLS1_CK_DH_DSS_WITH_CAMELLIA_256_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000085, .hex);
pub const TLS1_CK_DH_RSA_WITH_CAMELLIA_256_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000086, .hex);
pub const TLS1_CK_DHE_DSS_WITH_CAMELLIA_256_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000087, .hex);
pub const TLS1_CK_DHE_RSA_WITH_CAMELLIA_256_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000088, .hex);
pub const TLS1_CK_ADH_WITH_CAMELLIA_256_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000089, .hex);
pub const TLS1_CK_RSA_WITH_SEED_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000096, .hex);
pub const TLS1_CK_DH_DSS_WITH_SEED_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000097, .hex);
pub const TLS1_CK_DH_RSA_WITH_SEED_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000098, .hex);
pub const TLS1_CK_DHE_DSS_WITH_SEED_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03000099, .hex);
pub const TLS1_CK_DHE_RSA_WITH_SEED_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300009A, .hex);
pub const TLS1_CK_ADH_WITH_SEED_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300009B, .hex);
pub const TLS1_CK_RSA_WITH_AES_128_GCM_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300009C, .hex);
pub const TLS1_CK_RSA_WITH_AES_256_GCM_SHA384 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300009D, .hex);
pub const TLS1_CK_DHE_RSA_WITH_AES_128_GCM_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300009E, .hex);
pub const TLS1_CK_DHE_RSA_WITH_AES_256_GCM_SHA384 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300009F, .hex);
pub const TLS1_CK_DH_RSA_WITH_AES_128_GCM_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x030000A0, .hex);
pub const TLS1_CK_DH_RSA_WITH_AES_256_GCM_SHA384 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x030000A1, .hex);
pub const TLS1_CK_DHE_DSS_WITH_AES_128_GCM_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x030000A2, .hex);
pub const TLS1_CK_DHE_DSS_WITH_AES_256_GCM_SHA384 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x030000A3, .hex);
pub const TLS1_CK_DH_DSS_WITH_AES_128_GCM_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x030000A4, .hex);
pub const TLS1_CK_DH_DSS_WITH_AES_256_GCM_SHA384 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x030000A5, .hex);
pub const TLS1_CK_ADH_WITH_AES_128_GCM_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x030000A6, .hex);
pub const TLS1_CK_ADH_WITH_AES_256_GCM_SHA384 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x030000A7, .hex);
pub const TLS1_CK_ECDH_ECDSA_WITH_NULL_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C001, .hex);
pub const TLS1_CK_ECDH_ECDSA_WITH_RC4_128_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C002, .hex);
pub const TLS1_CK_ECDH_ECDSA_WITH_DES_192_CBC3_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C003, .hex);
pub const TLS1_CK_ECDH_ECDSA_WITH_AES_128_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C004, .hex);
pub const TLS1_CK_ECDH_ECDSA_WITH_AES_256_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C005, .hex);
pub const TLS1_CK_ECDHE_ECDSA_WITH_NULL_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C006, .hex);
pub const TLS1_CK_ECDHE_ECDSA_WITH_RC4_128_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C007, .hex);
pub const TLS1_CK_ECDHE_ECDSA_WITH_DES_192_CBC3_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C008, .hex);
pub const TLS1_CK_ECDHE_ECDSA_WITH_AES_128_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C009, .hex);
pub const TLS1_CK_ECDHE_ECDSA_WITH_AES_256_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C00A, .hex);
pub const TLS1_CK_ECDH_RSA_WITH_NULL_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C00B, .hex);
pub const TLS1_CK_ECDH_RSA_WITH_RC4_128_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C00C, .hex);
pub const TLS1_CK_ECDH_RSA_WITH_DES_192_CBC3_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C00D, .hex);
pub const TLS1_CK_ECDH_RSA_WITH_AES_128_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C00E, .hex);
pub const TLS1_CK_ECDH_RSA_WITH_AES_256_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C00F, .hex);
pub const TLS1_CK_ECDHE_RSA_WITH_NULL_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C010, .hex);
pub const TLS1_CK_ECDHE_RSA_WITH_RC4_128_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C011, .hex);
pub const TLS1_CK_ECDHE_RSA_WITH_DES_192_CBC3_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C012, .hex);
pub const TLS1_CK_ECDHE_RSA_WITH_AES_128_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C013, .hex);
pub const TLS1_CK_ECDHE_RSA_WITH_AES_256_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C014, .hex);
pub const TLS1_CK_ECDH_anon_WITH_NULL_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C015, .hex);
pub const TLS1_CK_ECDH_anon_WITH_RC4_128_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C016, .hex);
pub const TLS1_CK_ECDH_anon_WITH_DES_192_CBC3_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C017, .hex);
pub const TLS1_CK_ECDH_anon_WITH_AES_128_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C018, .hex);
pub const TLS1_CK_ECDH_anon_WITH_AES_256_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C019, .hex);
pub const TLS1_CK_SRP_SHA_WITH_3DES_EDE_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C01A, .hex);
pub const TLS1_CK_SRP_SHA_RSA_WITH_3DES_EDE_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C01B, .hex);
pub const TLS1_CK_SRP_SHA_DSS_WITH_3DES_EDE_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C01C, .hex);
pub const TLS1_CK_SRP_SHA_WITH_AES_128_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C01D, .hex);
pub const TLS1_CK_SRP_SHA_RSA_WITH_AES_128_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C01E, .hex);
pub const TLS1_CK_SRP_SHA_DSS_WITH_AES_128_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C01F, .hex);
pub const TLS1_CK_SRP_SHA_WITH_AES_256_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C020, .hex);
pub const TLS1_CK_SRP_SHA_RSA_WITH_AES_256_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C021, .hex);
pub const TLS1_CK_SRP_SHA_DSS_WITH_AES_256_CBC_SHA = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C022, .hex);
pub const TLS1_CK_ECDHE_ECDSA_WITH_AES_128_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C023, .hex);
pub const TLS1_CK_ECDHE_ECDSA_WITH_AES_256_SHA384 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C024, .hex);
pub const TLS1_CK_ECDH_ECDSA_WITH_AES_128_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C025, .hex);
pub const TLS1_CK_ECDH_ECDSA_WITH_AES_256_SHA384 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C026, .hex);
pub const TLS1_CK_ECDHE_RSA_WITH_AES_128_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C027, .hex);
pub const TLS1_CK_ECDHE_RSA_WITH_AES_256_SHA384 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C028, .hex);
pub const TLS1_CK_ECDH_RSA_WITH_AES_128_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C029, .hex);
pub const TLS1_CK_ECDH_RSA_WITH_AES_256_SHA384 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C02A, .hex);
pub const TLS1_CK_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C02B, .hex);
pub const TLS1_CK_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C02C, .hex);
pub const TLS1_CK_ECDH_ECDSA_WITH_AES_128_GCM_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C02D, .hex);
pub const TLS1_CK_ECDH_ECDSA_WITH_AES_256_GCM_SHA384 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C02E, .hex);
pub const TLS1_CK_ECDHE_RSA_WITH_AES_128_GCM_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C02F, .hex);
pub const TLS1_CK_ECDHE_RSA_WITH_AES_256_GCM_SHA384 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C030, .hex);
pub const TLS1_CK_ECDH_RSA_WITH_AES_128_GCM_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C031, .hex);
pub const TLS1_CK_ECDH_RSA_WITH_AES_256_GCM_SHA384 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300C032, .hex);
pub const TLS1_CK_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300CCA8, .hex);
pub const TLS1_CK_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300CCA9, .hex);
pub const TLS1_CK_ECDHE_PSK_WITH_CHACHA20_POLY1305_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x0300CCAC, .hex);
pub const TLS1_3_CK_AES_128_GCM_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03001301, .hex);
pub const TLS1_3_CK_AES_256_GCM_SHA384 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03001302, .hex);
pub const TLS1_3_CK_CHACHA20_POLY1305_SHA256 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x03001303, .hex);
pub const TLS1_CK_AES_128_GCM_SHA256 = TLS1_3_CK_AES_128_GCM_SHA256;
pub const TLS1_CK_AES_256_GCM_SHA384 = TLS1_3_CK_AES_256_GCM_SHA384;
pub const TLS1_CK_CHACHA20_POLY1305_SHA256 = TLS1_3_CK_CHACHA20_POLY1305_SHA256;
pub const TLS1_TXT_RSA_EXPORT1024_WITH_RC4_56_MD5 = "EXP1024-RC4-MD5";
pub const TLS1_TXT_RSA_EXPORT1024_WITH_RC2_CBC_56_MD5 = "EXP1024-RC2-CBC-MD5";
pub const TLS1_TXT_RSA_EXPORT1024_WITH_DES_CBC_SHA = "EXP1024-DES-CBC-SHA";
pub const TLS1_TXT_DHE_DSS_EXPORT1024_WITH_DES_CBC_SHA = "EXP1024-DHE-DSS-DES-CBC-SHA";
pub const TLS1_TXT_RSA_EXPORT1024_WITH_RC4_56_SHA = "EXP1024-RC4-SHA";
pub const TLS1_TXT_DHE_DSS_EXPORT1024_WITH_RC4_56_SHA = "EXP1024-DHE-DSS-RC4-SHA";
pub const TLS1_TXT_DHE_DSS_WITH_RC4_128_SHA = "DHE-DSS-RC4-SHA";
pub const TLS1_TXT_RSA_WITH_AES_128_SHA = "AES128-SHA";
pub const TLS1_TXT_DH_DSS_WITH_AES_128_SHA = "DH-DSS-AES128-SHA";
pub const TLS1_TXT_DH_RSA_WITH_AES_128_SHA = "DH-RSA-AES128-SHA";
pub const TLS1_TXT_DHE_DSS_WITH_AES_128_SHA = "DHE-DSS-AES128-SHA";
pub const TLS1_TXT_DHE_RSA_WITH_AES_128_SHA = "DHE-RSA-AES128-SHA";
pub const TLS1_TXT_ADH_WITH_AES_128_SHA = "ADH-AES128-SHA";
pub const TLS1_TXT_RSA_WITH_AES_256_SHA = "AES256-SHA";
pub const TLS1_TXT_DH_DSS_WITH_AES_256_SHA = "DH-DSS-AES256-SHA";
pub const TLS1_TXT_DH_RSA_WITH_AES_256_SHA = "DH-RSA-AES256-SHA";
pub const TLS1_TXT_DHE_DSS_WITH_AES_256_SHA = "DHE-DSS-AES256-SHA";
pub const TLS1_TXT_DHE_RSA_WITH_AES_256_SHA = "DHE-RSA-AES256-SHA";
pub const TLS1_TXT_ADH_WITH_AES_256_SHA = "ADH-AES256-SHA";
pub const TLS1_TXT_ECDH_ECDSA_WITH_NULL_SHA = "ECDH-ECDSA-NULL-SHA";
pub const TLS1_TXT_ECDH_ECDSA_WITH_RC4_128_SHA = "ECDH-ECDSA-RC4-SHA";
pub const TLS1_TXT_ECDH_ECDSA_WITH_DES_192_CBC3_SHA = "ECDH-ECDSA-DES-CBC3-SHA";
pub const TLS1_TXT_ECDH_ECDSA_WITH_AES_128_CBC_SHA = "ECDH-ECDSA-AES128-SHA";
pub const TLS1_TXT_ECDH_ECDSA_WITH_AES_256_CBC_SHA = "ECDH-ECDSA-AES256-SHA";
pub const TLS1_TXT_ECDHE_ECDSA_WITH_NULL_SHA = "ECDHE-ECDSA-NULL-SHA";
pub const TLS1_TXT_ECDHE_ECDSA_WITH_RC4_128_SHA = "ECDHE-ECDSA-RC4-SHA";
pub const TLS1_TXT_ECDHE_ECDSA_WITH_DES_192_CBC3_SHA = "ECDHE-ECDSA-DES-CBC3-SHA";
pub const TLS1_TXT_ECDHE_ECDSA_WITH_AES_128_CBC_SHA = "ECDHE-ECDSA-AES128-SHA";
pub const TLS1_TXT_ECDHE_ECDSA_WITH_AES_256_CBC_SHA = "ECDHE-ECDSA-AES256-SHA";
pub const TLS1_TXT_ECDH_RSA_WITH_NULL_SHA = "ECDH-RSA-NULL-SHA";
pub const TLS1_TXT_ECDH_RSA_WITH_RC4_128_SHA = "ECDH-RSA-RC4-SHA";
pub const TLS1_TXT_ECDH_RSA_WITH_DES_192_CBC3_SHA = "ECDH-RSA-DES-CBC3-SHA";
pub const TLS1_TXT_ECDH_RSA_WITH_AES_128_CBC_SHA = "ECDH-RSA-AES128-SHA";
pub const TLS1_TXT_ECDH_RSA_WITH_AES_256_CBC_SHA = "ECDH-RSA-AES256-SHA";
pub const TLS1_TXT_ECDHE_RSA_WITH_NULL_SHA = "ECDHE-RSA-NULL-SHA";
pub const TLS1_TXT_ECDHE_RSA_WITH_RC4_128_SHA = "ECDHE-RSA-RC4-SHA";
pub const TLS1_TXT_ECDHE_RSA_WITH_DES_192_CBC3_SHA = "ECDHE-RSA-DES-CBC3-SHA";
pub const TLS1_TXT_ECDHE_RSA_WITH_AES_128_CBC_SHA = "ECDHE-RSA-AES128-SHA";
pub const TLS1_TXT_ECDHE_RSA_WITH_AES_256_CBC_SHA = "ECDHE-RSA-AES256-SHA";
pub const TLS1_TXT_ECDH_anon_WITH_NULL_SHA = "AECDH-NULL-SHA";
pub const TLS1_TXT_ECDH_anon_WITH_RC4_128_SHA = "AECDH-RC4-SHA";
pub const TLS1_TXT_ECDH_anon_WITH_DES_192_CBC3_SHA = "AECDH-DES-CBC3-SHA";
pub const TLS1_TXT_ECDH_anon_WITH_AES_128_CBC_SHA = "AECDH-AES128-SHA";
pub const TLS1_TXT_ECDH_anon_WITH_AES_256_CBC_SHA = "AECDH-AES256-SHA";
pub const TLS1_TXT_PSK_WITH_RC4_128_SHA = "PSK-RC4-SHA";
pub const TLS1_TXT_PSK_WITH_3DES_EDE_CBC_SHA = "PSK-3DES-EDE-CBC-SHA";
pub const TLS1_TXT_PSK_WITH_AES_128_CBC_SHA = "PSK-AES128-CBC-SHA";
pub const TLS1_TXT_PSK_WITH_AES_256_CBC_SHA = "PSK-AES256-CBC-SHA";
pub const TLS1_TXT_ECDHE_PSK_WITH_AES_128_CBC_SHA = "ECDHE-PSK-AES128-CBC-SHA";
pub const TLS1_TXT_ECDHE_PSK_WITH_AES_256_CBC_SHA = "ECDHE-PSK-AES256-CBC-SHA";
pub const TLS1_TXT_SRP_SHA_WITH_3DES_EDE_CBC_SHA = "SRP-3DES-EDE-CBC-SHA";
pub const TLS1_TXT_SRP_SHA_RSA_WITH_3DES_EDE_CBC_SHA = "SRP-RSA-3DES-EDE-CBC-SHA";
pub const TLS1_TXT_SRP_SHA_DSS_WITH_3DES_EDE_CBC_SHA = "SRP-DSS-3DES-EDE-CBC-SHA";
pub const TLS1_TXT_SRP_SHA_WITH_AES_128_CBC_SHA = "SRP-AES-128-CBC-SHA";
pub const TLS1_TXT_SRP_SHA_RSA_WITH_AES_128_CBC_SHA = "SRP-RSA-AES-128-CBC-SHA";
pub const TLS1_TXT_SRP_SHA_DSS_WITH_AES_128_CBC_SHA = "SRP-DSS-AES-128-CBC-SHA";
pub const TLS1_TXT_SRP_SHA_WITH_AES_256_CBC_SHA = "SRP-AES-256-CBC-SHA";
pub const TLS1_TXT_SRP_SHA_RSA_WITH_AES_256_CBC_SHA = "SRP-RSA-AES-256-CBC-SHA";
pub const TLS1_TXT_SRP_SHA_DSS_WITH_AES_256_CBC_SHA = "SRP-DSS-AES-256-CBC-SHA";
pub const TLS1_TXT_RSA_WITH_CAMELLIA_128_CBC_SHA = "CAMELLIA128-SHA";
pub const TLS1_TXT_DH_DSS_WITH_CAMELLIA_128_CBC_SHA = "DH-DSS-CAMELLIA128-SHA";
pub const TLS1_TXT_DH_RSA_WITH_CAMELLIA_128_CBC_SHA = "DH-RSA-CAMELLIA128-SHA";
pub const TLS1_TXT_DHE_DSS_WITH_CAMELLIA_128_CBC_SHA = "DHE-DSS-CAMELLIA128-SHA";
pub const TLS1_TXT_DHE_RSA_WITH_CAMELLIA_128_CBC_SHA = "DHE-RSA-CAMELLIA128-SHA";
pub const TLS1_TXT_ADH_WITH_CAMELLIA_128_CBC_SHA = "ADH-CAMELLIA128-SHA";
pub const TLS1_TXT_RSA_WITH_CAMELLIA_256_CBC_SHA = "CAMELLIA256-SHA";
pub const TLS1_TXT_DH_DSS_WITH_CAMELLIA_256_CBC_SHA = "DH-DSS-CAMELLIA256-SHA";
pub const TLS1_TXT_DH_RSA_WITH_CAMELLIA_256_CBC_SHA = "DH-RSA-CAMELLIA256-SHA";
pub const TLS1_TXT_DHE_DSS_WITH_CAMELLIA_256_CBC_SHA = "DHE-DSS-CAMELLIA256-SHA";
pub const TLS1_TXT_DHE_RSA_WITH_CAMELLIA_256_CBC_SHA = "DHE-RSA-CAMELLIA256-SHA";
pub const TLS1_TXT_ADH_WITH_CAMELLIA_256_CBC_SHA = "ADH-CAMELLIA256-SHA";
pub const TLS1_TXT_RSA_WITH_SEED_SHA = "SEED-SHA";
pub const TLS1_TXT_DH_DSS_WITH_SEED_SHA = "DH-DSS-SEED-SHA";
pub const TLS1_TXT_DH_RSA_WITH_SEED_SHA = "DH-RSA-SEED-SHA";
pub const TLS1_TXT_DHE_DSS_WITH_SEED_SHA = "DHE-DSS-SEED-SHA";
pub const TLS1_TXT_DHE_RSA_WITH_SEED_SHA = "DHE-RSA-SEED-SHA";
pub const TLS1_TXT_ADH_WITH_SEED_SHA = "ADH-SEED-SHA";
pub const TLS1_TXT_RSA_WITH_NULL_SHA256 = "NULL-SHA256";
pub const TLS1_TXT_RSA_WITH_AES_128_SHA256 = "AES128-SHA256";
pub const TLS1_TXT_RSA_WITH_AES_256_SHA256 = "AES256-SHA256";
pub const TLS1_TXT_DH_DSS_WITH_AES_128_SHA256 = "DH-DSS-AES128-SHA256";
pub const TLS1_TXT_DH_RSA_WITH_AES_128_SHA256 = "DH-RSA-AES128-SHA256";
pub const TLS1_TXT_DHE_DSS_WITH_AES_128_SHA256 = "DHE-DSS-AES128-SHA256";
pub const TLS1_TXT_DHE_RSA_WITH_AES_128_SHA256 = "DHE-RSA-AES128-SHA256";
pub const TLS1_TXT_DH_DSS_WITH_AES_256_SHA256 = "DH-DSS-AES256-SHA256";
pub const TLS1_TXT_DH_RSA_WITH_AES_256_SHA256 = "DH-RSA-AES256-SHA256";
pub const TLS1_TXT_DHE_DSS_WITH_AES_256_SHA256 = "DHE-DSS-AES256-SHA256";
pub const TLS1_TXT_DHE_RSA_WITH_AES_256_SHA256 = "DHE-RSA-AES256-SHA256";
pub const TLS1_TXT_ADH_WITH_AES_128_SHA256 = "ADH-AES128-SHA256";
pub const TLS1_TXT_ADH_WITH_AES_256_SHA256 = "ADH-AES256-SHA256";
pub const TLS1_TXT_RSA_WITH_AES_128_GCM_SHA256 = "AES128-GCM-SHA256";
pub const TLS1_TXT_RSA_WITH_AES_256_GCM_SHA384 = "AES256-GCM-SHA384";
pub const TLS1_TXT_DHE_RSA_WITH_AES_128_GCM_SHA256 = "DHE-RSA-AES128-GCM-SHA256";
pub const TLS1_TXT_DHE_RSA_WITH_AES_256_GCM_SHA384 = "DHE-RSA-AES256-GCM-SHA384";
pub const TLS1_TXT_DH_RSA_WITH_AES_128_GCM_SHA256 = "DH-RSA-AES128-GCM-SHA256";
pub const TLS1_TXT_DH_RSA_WITH_AES_256_GCM_SHA384 = "DH-RSA-AES256-GCM-SHA384";
pub const TLS1_TXT_DHE_DSS_WITH_AES_128_GCM_SHA256 = "DHE-DSS-AES128-GCM-SHA256";
pub const TLS1_TXT_DHE_DSS_WITH_AES_256_GCM_SHA384 = "DHE-DSS-AES256-GCM-SHA384";
pub const TLS1_TXT_DH_DSS_WITH_AES_128_GCM_SHA256 = "DH-DSS-AES128-GCM-SHA256";
pub const TLS1_TXT_DH_DSS_WITH_AES_256_GCM_SHA384 = "DH-DSS-AES256-GCM-SHA384";
pub const TLS1_TXT_ADH_WITH_AES_128_GCM_SHA256 = "ADH-AES128-GCM-SHA256";
pub const TLS1_TXT_ADH_WITH_AES_256_GCM_SHA384 = "ADH-AES256-GCM-SHA384";
pub const TLS1_TXT_ECDHE_ECDSA_WITH_AES_128_SHA256 = "ECDHE-ECDSA-AES128-SHA256";
pub const TLS1_TXT_ECDHE_ECDSA_WITH_AES_256_SHA384 = "ECDHE-ECDSA-AES256-SHA384";
pub const TLS1_TXT_ECDH_ECDSA_WITH_AES_128_SHA256 = "ECDH-ECDSA-AES128-SHA256";
pub const TLS1_TXT_ECDH_ECDSA_WITH_AES_256_SHA384 = "ECDH-ECDSA-AES256-SHA384";
pub const TLS1_TXT_ECDHE_RSA_WITH_AES_128_SHA256 = "ECDHE-RSA-AES128-SHA256";
pub const TLS1_TXT_ECDHE_RSA_WITH_AES_256_SHA384 = "ECDHE-RSA-AES256-SHA384";
pub const TLS1_TXT_ECDH_RSA_WITH_AES_128_SHA256 = "ECDH-RSA-AES128-SHA256";
pub const TLS1_TXT_ECDH_RSA_WITH_AES_256_SHA384 = "ECDH-RSA-AES256-SHA384";
pub const TLS1_TXT_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256 = "ECDHE-ECDSA-AES128-GCM-SHA256";
pub const TLS1_TXT_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384 = "ECDHE-ECDSA-AES256-GCM-SHA384";
pub const TLS1_TXT_ECDH_ECDSA_WITH_AES_128_GCM_SHA256 = "ECDH-ECDSA-AES128-GCM-SHA256";
pub const TLS1_TXT_ECDH_ECDSA_WITH_AES_256_GCM_SHA384 = "ECDH-ECDSA-AES256-GCM-SHA384";
pub const TLS1_TXT_ECDHE_RSA_WITH_AES_128_GCM_SHA256 = "ECDHE-RSA-AES128-GCM-SHA256";
pub const TLS1_TXT_ECDHE_RSA_WITH_AES_256_GCM_SHA384 = "ECDHE-RSA-AES256-GCM-SHA384";
pub const TLS1_TXT_ECDH_RSA_WITH_AES_128_GCM_SHA256 = "ECDH-RSA-AES128-GCM-SHA256";
pub const TLS1_TXT_ECDH_RSA_WITH_AES_256_GCM_SHA384 = "ECDH-RSA-AES256-GCM-SHA384";
pub const TLS1_TXT_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256 = "ECDHE-RSA-CHACHA20-POLY1305";
pub const TLS1_TXT_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256 = "ECDHE-ECDSA-CHACHA20-POLY1305";
pub const TLS1_TXT_ECDHE_PSK_WITH_CHACHA20_POLY1305_SHA256 = "ECDHE-PSK-CHACHA20-POLY1305";
pub const TLS1_3_RFC_AES_128_GCM_SHA256 = "TLS_AES_128_GCM_SHA256";
pub const TLS1_3_RFC_AES_256_GCM_SHA384 = "TLS_AES_256_GCM_SHA384";
pub const TLS1_3_RFC_CHACHA20_POLY1305_SHA256 = "TLS_CHACHA20_POLY1305_SHA256";
pub const TLS1_TXT_AES_128_GCM_SHA256 = TLS1_3_RFC_AES_128_GCM_SHA256;
pub const TLS1_TXT_AES_256_GCM_SHA384 = TLS1_3_RFC_AES_256_GCM_SHA384;
pub const TLS1_TXT_CHACHA20_POLY1305_SHA256 = TLS1_3_RFC_CHACHA20_POLY1305_SHA256;
pub const TLS_CT_RSA_SIGN = @as(c_int, 1);
pub const TLS_CT_DSS_SIGN = @as(c_int, 2);
pub const TLS_CT_RSA_FIXED_DH = @as(c_int, 3);
pub const TLS_CT_DSS_FIXED_DH = @as(c_int, 4);
pub const TLS_CT_ECDSA_SIGN = @as(c_int, 64);
pub const TLS_CT_RSA_FIXED_ECDH = @as(c_int, 65);
pub const TLS_CT_ECDSA_FIXED_ECDH = @as(c_int, 66);
pub const TLS_MD_MAX_CONST_SIZE = @as(c_int, 20);
pub const _SYS_TIME_H_ = "";
pub const _STRUCT_TIMEVAL64 = "";
pub const ITIMER_REAL = @as(c_int, 0);
pub const ITIMER_VIRTUAL = @as(c_int, 1);
pub const ITIMER_PROF = @as(c_int, 2);
pub const DST_NONE = @as(c_int, 0);
pub const DST_USA = @as(c_int, 1);
pub const DST_AUST = @as(c_int, 2);
pub const DST_WET = @as(c_int, 3);
pub const DST_MET = @as(c_int, 4);
pub const DST_EET = @as(c_int, 5);
pub const DST_CAN = @as(c_int, 6);
pub inline fn timerisset(tvp: anytype) @TypeOf((tvp.*.tv_sec != 0) or (tvp.*.tv_usec != 0)) {
    return (tvp.*.tv_sec != 0) or (tvp.*.tv_usec != 0);
}
pub inline fn timevalcmp(l: anytype, r: anytype, cmp: anytype) @TypeOf(timercmp(l, r, cmp)) {
    return timercmp(l, r, cmp);
}
pub const _SYS__SELECT_H_ = "";
pub const OPENSSL_HEADER_HMAC_H = "";
pub const SSL_KEY_UPDATE_REQUESTED = @as(c_int, 1);
pub const SSL_KEY_UPDATE_NOT_REQUESTED = @as(c_int, 0);
pub const SSL_ERROR_NONE = @as(c_int, 0);
pub const SSL_ERROR_SSL = @as(c_int, 1);
pub const SSL_ERROR_WANT_READ = @as(c_int, 2);
pub const SSL_ERROR_WANT_WRITE = @as(c_int, 3);
pub const SSL_ERROR_WANT_X509_LOOKUP = @as(c_int, 4);
pub const SSL_ERROR_SYSCALL = @as(c_int, 5);
pub const SSL_ERROR_ZERO_RETURN = @as(c_int, 6);
pub const SSL_ERROR_WANT_CONNECT = @as(c_int, 7);
pub const SSL_ERROR_WANT_ACCEPT = @as(c_int, 8);
pub const SSL_ERROR_WANT_CHANNEL_ID_LOOKUP = @as(c_int, 9);
pub const SSL_ERROR_PENDING_SESSION = @as(c_int, 11);
pub const SSL_ERROR_PENDING_CERTIFICATE = @as(c_int, 12);
pub const SSL_ERROR_WANT_PRIVATE_KEY_OPERATION = @as(c_int, 13);
pub const SSL_ERROR_PENDING_TICKET = @as(c_int, 14);
pub const SSL_ERROR_EARLY_DATA_REJECTED = @as(c_int, 15);
pub const SSL_ERROR_WANT_CERTIFICATE_VERIFY = @as(c_int, 16);
pub const SSL_ERROR_HANDOFF = @as(c_int, 17);
pub const SSL_ERROR_HANDBACK = @as(c_int, 18);
pub const SSL_ERROR_WANT_RENEGOTIATE = @as(c_int, 19);
pub const SSL_ERROR_HANDSHAKE_HINTS_READY = @as(c_int, 20);
pub const DTLS1_VERSION_MAJOR = @as(c_int, 0xfe);
pub const SSL3_VERSION_MAJOR = @as(c_int, 0x03);
pub const SSL3_VERSION = @as(c_int, 0x0300);
pub const TLS1_VERSION = @as(c_int, 0x0301);
pub const TLS1_1_VERSION = @as(c_int, 0x0302);
pub const TLS1_2_VERSION = @as(c_int, 0x0303);
pub const TLS1_3_VERSION = @as(c_int, 0x0304);
pub const DTLS1_VERSION = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0xfeff, .hex);
pub const DTLS1_2_VERSION = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0xfefd, .hex);
pub const SSL_OP_NO_QUERY_MTU = @as(c_long, 0x00001000);
pub const SSL_OP_NO_TICKET = @as(c_long, 0x00004000);
pub const SSL_OP_CIPHER_SERVER_PREFERENCE = @as(c_long, 0x00400000);
pub const SSL_OP_NO_TLSv1 = @as(c_long, 0x04000000);
pub const SSL_OP_NO_TLSv1_2 = @as(c_long, 0x08000000);
pub const SSL_OP_NO_TLSv1_1 = @as(c_long, 0x10000000);
pub const SSL_OP_NO_TLSv1_3 = @as(c_long, 0x20000000);
pub const SSL_OP_NO_DTLSv1 = SSL_OP_NO_TLSv1;
pub const SSL_OP_NO_DTLSv1_2 = SSL_OP_NO_TLSv1_2;
pub const SSL_MODE_ENABLE_PARTIAL_WRITE = @as(c_long, 0x00000001);
pub const SSL_MODE_ACCEPT_MOVING_WRITE_BUFFER = @as(c_long, 0x00000002);
pub const SSL_MODE_NO_AUTO_CHAIN = @as(c_long, 0x00000008);
pub const SSL_MODE_ENABLE_FALSE_START = @as(c_long, 0x00000080);
pub const SSL_MODE_CBC_RECORD_SPLITTING = @as(c_long, 0x00000100);
pub const SSL_MODE_NO_SESSION_CREATION = @as(c_long, 0x00000200);
pub const SSL_MODE_SEND_FALLBACK_SCSV = @as(c_long, 0x00000400);
pub const SSL_SIGN_RSA_PKCS1_SHA1 = @as(c_int, 0x0201);
pub const SSL_SIGN_RSA_PKCS1_SHA256 = @as(c_int, 0x0401);
pub const SSL_SIGN_RSA_PKCS1_SHA384 = @as(c_int, 0x0501);
pub const SSL_SIGN_RSA_PKCS1_SHA512 = @as(c_int, 0x0601);
pub const SSL_SIGN_ECDSA_SHA1 = @as(c_int, 0x0203);
pub const SSL_SIGN_ECDSA_SECP256R1_SHA256 = @as(c_int, 0x0403);
pub const SSL_SIGN_ECDSA_SECP384R1_SHA384 = @as(c_int, 0x0503);
pub const SSL_SIGN_ECDSA_SECP521R1_SHA512 = @as(c_int, 0x0603);
pub const SSL_SIGN_RSA_PSS_RSAE_SHA256 = @as(c_int, 0x0804);
pub const SSL_SIGN_RSA_PSS_RSAE_SHA384 = @as(c_int, 0x0805);
pub const SSL_SIGN_RSA_PSS_RSAE_SHA512 = @as(c_int, 0x0806);
pub const SSL_SIGN_ED25519 = @as(c_int, 0x0807);
pub const SSL_SIGN_RSA_PKCS1_MD5_SHA1 = @import("std").zig.c_translation.promoteIntLiteral(c_int, 0xff01, .hex);
pub const SSL_FILETYPE_PEM = @as(c_int, 1);
pub const SSL_FILETYPE_ASN1 = @as(c_int, 2);
pub const SSL_DEFAULT_CIPHER_LIST = "ALL";
pub const SSL_MAX_SSL_SESSION_ID_LENGTH = @as(c_int, 32);
pub const SSL_MAX_MASTER_KEY_LENGTH = @as(c_int, 48);
pub const SSL_SESS_CACHE_OFF = @as(c_int, 0x0000);
pub const SSL_SESS_CACHE_CLIENT = @as(c_int, 0x0001);
pub const SSL_SESS_CACHE_SERVER = @as(c_int, 0x0002);
pub const SSL_SESS_CACHE_BOTH = SSL_SESS_CACHE_CLIENT | SSL_SESS_CACHE_SERVER;
pub const SSL_SESS_CACHE_NO_AUTO_CLEAR = @as(c_int, 0x0080);
pub const SSL_SESS_CACHE_NO_INTERNAL_LOOKUP = @as(c_int, 0x0100);
pub const SSL_SESS_CACHE_NO_INTERNAL_STORE = @as(c_int, 0x0200);
pub const SSL_SESS_CACHE_NO_INTERNAL = SSL_SESS_CACHE_NO_INTERNAL_LOOKUP | SSL_SESS_CACHE_NO_INTERNAL_STORE;
pub const SSL_DEFAULT_SESSION_TIMEOUT = (@as(c_int, 2) * @as(c_int, 60)) * @as(c_int, 60);
pub const SSL_DEFAULT_SESSION_PSK_DHE_TIMEOUT = ((@as(c_int, 2) * @as(c_int, 24)) * @as(c_int, 60)) * @as(c_int, 60);
pub const SSL_DEFAULT_SESSION_AUTH_TIMEOUT = ((@as(c_int, 7) * @as(c_int, 24)) * @as(c_int, 60)) * @as(c_int, 60);
pub const SSL_MAX_SID_CTX_LENGTH = @as(c_int, 32);
pub const SSL_SESSION_CACHE_MAX_SIZE_DEFAULT = @as(c_int, 1024) * @as(c_int, 20);
pub const SSL_DEFAULT_TICKET_KEY_ROTATION_INTERVAL = ((@as(c_int, 2) * @as(c_int, 24)) * @as(c_int, 60)) * @as(c_int, 60);
pub const SSL_TICKET_KEY_NAME_LEN = @as(c_int, 16);
pub const SSL_CURVE_SECP224R1 = @as(c_int, 21);
pub const SSL_CURVE_SECP256R1 = @as(c_int, 23);
pub const SSL_CURVE_SECP384R1 = @as(c_int, 24);
pub const SSL_CURVE_SECP521R1 = @as(c_int, 25);
pub const SSL_CURVE_X25519 = @as(c_int, 29);
pub const SSL_CURVE_CECPQ2 = @as(c_int, 16696);
pub const SSL_VERIFY_NONE = @as(c_int, 0x00);
pub const SSL_VERIFY_PEER = @as(c_int, 0x01);
pub const SSL_VERIFY_FAIL_IF_NO_PEER_CERT = @as(c_int, 0x02);
pub const SSL_VERIFY_PEER_IF_NO_OBC = @as(c_int, 0x04);
pub const TLSEXT_NAMETYPE_host_name = @as(c_int, 0);
pub const SSL_TLSEXT_ERR_OK = @as(c_int, 0);
pub const SSL_TLSEXT_ERR_ALERT_WARNING = @as(c_int, 1);
pub const SSL_TLSEXT_ERR_ALERT_FATAL = @as(c_int, 2);
pub const SSL_TLSEXT_ERR_NOACK = @as(c_int, 3);
pub const OPENSSL_NPN_UNSUPPORTED = @as(c_int, 0);
pub const OPENSSL_NPN_NEGOTIATED = @as(c_int, 1);
pub const OPENSSL_NPN_NO_OVERLAP = @as(c_int, 2);
pub const SRTP_AES128_CM_SHA1_80 = @as(c_int, 0x0001);
pub const SRTP_AES128_CM_SHA1_32 = @as(c_int, 0x0002);
pub const SRTP_AES128_F8_SHA1_80 = @as(c_int, 0x0003);
pub const SRTP_AES128_F8_SHA1_32 = @as(c_int, 0x0004);
pub const SRTP_NULL_SHA1_80 = @as(c_int, 0x0005);
pub const SRTP_NULL_SHA1_32 = @as(c_int, 0x0006);
pub const SRTP_AEAD_AES_128_GCM = @as(c_int, 0x0007);
pub const SRTP_AEAD_AES_256_GCM = @as(c_int, 0x0008);
pub const PSK_MAX_IDENTITY_LEN = @as(c_int, 128);
pub const PSK_MAX_PSK_LEN = @as(c_int, 256);
pub const SSL_AD_REASON_OFFSET = @as(c_int, 1000);
pub const SSL_AD_CLOSE_NOTIFY = SSL3_AD_CLOSE_NOTIFY;
pub const SSL_AD_UNEXPECTED_MESSAGE = SSL3_AD_UNEXPECTED_MESSAGE;
pub const SSL_AD_BAD_RECORD_MAC = SSL3_AD_BAD_RECORD_MAC;
pub const SSL_AD_DECRYPTION_FAILED = TLS1_AD_DECRYPTION_FAILED;
pub const SSL_AD_RECORD_OVERFLOW = TLS1_AD_RECORD_OVERFLOW;
pub const SSL_AD_DECOMPRESSION_FAILURE = SSL3_AD_DECOMPRESSION_FAILURE;
pub const SSL_AD_HANDSHAKE_FAILURE = SSL3_AD_HANDSHAKE_FAILURE;
pub const SSL_AD_NO_CERTIFICATE = SSL3_AD_NO_CERTIFICATE;
pub const SSL_AD_BAD_CERTIFICATE = SSL3_AD_BAD_CERTIFICATE;
pub const SSL_AD_UNSUPPORTED_CERTIFICATE = SSL3_AD_UNSUPPORTED_CERTIFICATE;
pub const SSL_AD_CERTIFICATE_REVOKED = SSL3_AD_CERTIFICATE_REVOKED;
pub const SSL_AD_CERTIFICATE_EXPIRED = SSL3_AD_CERTIFICATE_EXPIRED;
pub const SSL_AD_CERTIFICATE_UNKNOWN = SSL3_AD_CERTIFICATE_UNKNOWN;
pub const SSL_AD_ILLEGAL_PARAMETER = SSL3_AD_ILLEGAL_PARAMETER;
pub const SSL_AD_UNKNOWN_CA = TLS1_AD_UNKNOWN_CA;
pub const SSL_AD_ACCESS_DENIED = TLS1_AD_ACCESS_DENIED;
pub const SSL_AD_DECODE_ERROR = TLS1_AD_DECODE_ERROR;
pub const SSL_AD_DECRYPT_ERROR = TLS1_AD_DECRYPT_ERROR;
pub const SSL_AD_EXPORT_RESTRICTION = TLS1_AD_EXPORT_RESTRICTION;
pub const SSL_AD_PROTOCOL_VERSION = TLS1_AD_PROTOCOL_VERSION;
pub const SSL_AD_INSUFFICIENT_SECURITY = TLS1_AD_INSUFFICIENT_SECURITY;
pub const SSL_AD_INTERNAL_ERROR = TLS1_AD_INTERNAL_ERROR;
pub const SSL_AD_INAPPROPRIATE_FALLBACK = SSL3_AD_INAPPROPRIATE_FALLBACK;
pub const SSL_AD_USER_CANCELLED = TLS1_AD_USER_CANCELLED;
pub const SSL_AD_NO_RENEGOTIATION = TLS1_AD_NO_RENEGOTIATION;
pub const SSL_AD_MISSING_EXTENSION = TLS1_AD_MISSING_EXTENSION;
pub const SSL_AD_UNSUPPORTED_EXTENSION = TLS1_AD_UNSUPPORTED_EXTENSION;
pub const SSL_AD_CERTIFICATE_UNOBTAINABLE = TLS1_AD_CERTIFICATE_UNOBTAINABLE;
pub const SSL_AD_UNRECOGNIZED_NAME = TLS1_AD_UNRECOGNIZED_NAME;
pub const SSL_AD_BAD_CERTIFICATE_STATUS_RESPONSE = TLS1_AD_BAD_CERTIFICATE_STATUS_RESPONSE;
pub const SSL_AD_BAD_CERTIFICATE_HASH_VALUE = TLS1_AD_BAD_CERTIFICATE_HASH_VALUE;
pub const SSL_AD_UNKNOWN_PSK_IDENTITY = TLS1_AD_UNKNOWN_PSK_IDENTITY;
pub const SSL_AD_CERTIFICATE_REQUIRED = TLS1_AD_CERTIFICATE_REQUIRED;
pub const SSL_AD_NO_APPLICATION_PROTOCOL = TLS1_AD_NO_APPLICATION_PROTOCOL;
pub const SSL_AD_ECH_REQUIRED = TLS1_AD_ECH_REQUIRED;
pub const SSL_MAX_CERT_LIST_DEFAULT = @as(c_int, 1024) * @as(c_int, 100);
pub const SSL_ST_CONNECT = @as(c_int, 0x1000);
pub const SSL_ST_ACCEPT = @as(c_int, 0x2000);
pub const SSL_ST_MASK = @as(c_int, 0x0FFF);
pub const SSL_ST_INIT = SSL_ST_CONNECT | SSL_ST_ACCEPT;
pub const SSL_ST_OK = @as(c_int, 0x03);
pub const SSL_ST_RENEGOTIATE = @as(c_int, 0x04) | SSL_ST_INIT;
pub const SSL_ST_BEFORE = @as(c_int, 0x05) | SSL_ST_INIT;
pub const TLS_ST_OK = SSL_ST_OK;
pub const TLS_ST_BEFORE = SSL_ST_BEFORE;
pub const SSL_CB_LOOP = @as(c_int, 0x01);
pub const SSL_CB_EXIT = @as(c_int, 0x02);
pub const SSL_CB_READ = @as(c_int, 0x04);
pub const SSL_CB_WRITE = @as(c_int, 0x08);
pub const SSL_CB_ALERT = @as(c_int, 0x4000);
pub const SSL_CB_READ_ALERT = SSL_CB_ALERT | SSL_CB_READ;
pub const SSL_CB_WRITE_ALERT = SSL_CB_ALERT | SSL_CB_WRITE;
pub const SSL_CB_ACCEPT_LOOP = SSL_ST_ACCEPT | SSL_CB_LOOP;
pub const SSL_CB_ACCEPT_EXIT = SSL_ST_ACCEPT | SSL_CB_EXIT;
pub const SSL_CB_CONNECT_LOOP = SSL_ST_CONNECT | SSL_CB_LOOP;
pub const SSL_CB_CONNECT_EXIT = SSL_ST_CONNECT | SSL_CB_EXIT;
pub const SSL_CB_HANDSHAKE_START = @as(c_int, 0x10);
pub const SSL_CB_HANDSHAKE_DONE = @as(c_int, 0x20);
pub const SSL_SENT_SHUTDOWN = @as(c_int, 1);
pub const SSL_RECEIVED_SHUTDOWN = @as(c_int, 2);
pub const SSL_MODE_HANDSHAKE_CUTTHROUGH = SSL_MODE_ENABLE_FALSE_START;
pub inline fn SSL_set_app_data(s: anytype, arg: anytype) @TypeOf(SSL_set_ex_data(s, @as(c_int, 0), @import("std").zig.c_translation.cast([*c]u8, arg))) {
    return SSL_set_ex_data(s, @as(c_int, 0), @import("std").zig.c_translation.cast([*c]u8, arg));
}
pub inline fn SSL_get_app_data(s: anytype) @TypeOf(SSL_get_ex_data(s, @as(c_int, 0))) {
    return SSL_get_ex_data(s, @as(c_int, 0));
}
pub inline fn SSL_SESSION_set_app_data(s: anytype, a: anytype) @TypeOf(SSL_SESSION_set_ex_data(s, @as(c_int, 0), @import("std").zig.c_translation.cast([*c]u8, a))) {
    return SSL_SESSION_set_ex_data(s, @as(c_int, 0), @import("std").zig.c_translation.cast([*c]u8, a));
}
pub inline fn SSL_SESSION_get_app_data(s: anytype) @TypeOf(SSL_SESSION_get_ex_data(s, @as(c_int, 0))) {
    return SSL_SESSION_get_ex_data(s, @as(c_int, 0));
}
pub inline fn SSL_CTX_get_app_data(ctx: anytype) @TypeOf(SSL_CTX_get_ex_data(ctx, @as(c_int, 0))) {
    return SSL_CTX_get_ex_data(ctx, @as(c_int, 0));
}
pub inline fn SSL_CTX_set_app_data(ctx: anytype, arg: anytype) @TypeOf(SSL_CTX_set_ex_data(ctx, @as(c_int, 0), @import("std").zig.c_translation.cast([*c]u8, arg))) {
    return SSL_CTX_set_ex_data(ctx, @as(c_int, 0), @import("std").zig.c_translation.cast([*c]u8, arg));
}
pub inline fn OpenSSL_add_ssl_algorithms() @TypeOf(SSL_library_init()) {
    return SSL_library_init();
}
pub inline fn SSLeay_add_ssl_algorithms() @TypeOf(SSL_library_init()) {
    return SSL_library_init();
}
pub inline fn SSL_get_cipher(ssl: anytype) @TypeOf(SSL_CIPHER_get_name(SSL_get_current_cipher(ssl))) {
    return SSL_CIPHER_get_name(SSL_get_current_cipher(ssl));
}
pub inline fn SSL_get_cipher_bits(ssl: anytype, out_alg_bits: anytype) @TypeOf(SSL_CIPHER_get_bits(SSL_get_current_cipher(ssl), out_alg_bits)) {
    return SSL_CIPHER_get_bits(SSL_get_current_cipher(ssl), out_alg_bits);
}
pub inline fn SSL_get_cipher_version(ssl: anytype) @TypeOf(SSL_CIPHER_get_version(SSL_get_current_cipher(ssl))) {
    return SSL_CIPHER_get_version(SSL_get_current_cipher(ssl));
}
pub inline fn SSL_get_cipher_name(ssl: anytype) @TypeOf(SSL_CIPHER_get_name(SSL_get_current_cipher(ssl))) {
    return SSL_CIPHER_get_name(SSL_get_current_cipher(ssl));
}
pub inline fn SSL_get_time(session: anytype) @TypeOf(SSL_SESSION_get_time(session)) {
    return SSL_SESSION_get_time(session);
}
pub inline fn SSL_set_time(session: anytype, time_1: anytype) @TypeOf(SSL_SESSION_set_time(session, time_1)) {
    return SSL_SESSION_set_time(session, time_1);
}
pub inline fn SSL_get_timeout(session: anytype) @TypeOf(SSL_SESSION_get_timeout(session)) {
    return SSL_SESSION_get_timeout(session);
}
pub inline fn SSL_set_timeout(session: anytype, timeout: anytype) @TypeOf(SSL_SESSION_set_timeout(session, timeout)) {
    return SSL_SESSION_set_timeout(session, timeout);
}
pub const SSL_MODE_AUTO_RETRY = @as(c_int, 0);
pub const SSL_MODE_RELEASE_BUFFERS = @as(c_int, 0);
pub const SSL_MODE_SEND_CLIENTHELLO_TIME = @as(c_int, 0);
pub const SSL_MODE_SEND_SERVERHELLO_TIME = @as(c_int, 0);
pub const SSL_OP_ALL = @as(c_int, 0);
pub const SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION = @as(c_int, 0);
pub const SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS = @as(c_int, 0);
pub const SSL_OP_EPHEMERAL_RSA = @as(c_int, 0);
pub const SSL_OP_LEGACY_SERVER_CONNECT = @as(c_int, 0);
pub const SSL_OP_MICROSOFT_BIG_SSLV3_BUFFER = @as(c_int, 0);
pub const SSL_OP_MICROSOFT_SESS_ID_BUG = @as(c_int, 0);
pub const SSL_OP_MSIE_SSLV2_RSA_PADDING = @as(c_int, 0);
pub const SSL_OP_NETSCAPE_CA_DN_BUG = @as(c_int, 0);
pub const SSL_OP_NETSCAPE_CHALLENGE_BUG = @as(c_int, 0);
pub const SSL_OP_NETSCAPE_DEMO_CIPHER_CHANGE_BUG = @as(c_int, 0);
pub const SSL_OP_NETSCAPE_REUSE_CIPHER_CHANGE_BUG = @as(c_int, 0);
pub const SSL_OP_NO_COMPRESSION = @as(c_int, 0);
pub const SSL_OP_NO_RENEGOTIATION = @as(c_int, 0);
pub const SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION = @as(c_int, 0);
pub const SSL_OP_NO_SSLv2 = @as(c_int, 0);
pub const SSL_OP_NO_SSLv3 = @as(c_int, 0);
pub const SSL_OP_PKCS1_CHECK_1 = @as(c_int, 0);
pub const SSL_OP_PKCS1_CHECK_2 = @as(c_int, 0);
pub const SSL_OP_SINGLE_DH_USE = @as(c_int, 0);
pub const SSL_OP_SINGLE_ECDH_USE = @as(c_int, 0);
pub const SSL_OP_SSLEAY_080_CLIENT_DH_BUG = @as(c_int, 0);
pub const SSL_OP_SSLREF2_REUSE_CERT_TYPE_BUG = @as(c_int, 0);
pub const SSL_OP_TLS_BLOCK_PADDING_BUG = @as(c_int, 0);
pub const SSL_OP_TLS_D5_BUG = @as(c_int, 0);
pub const SSL_OP_TLS_ROLLBACK_BUG = @as(c_int, 0);
pub const SSL_VERIFY_CLIENT_ONCE = @as(c_int, 0);
pub const SSL_NOTHING = SSL_ERROR_NONE;
pub const SSL_WRITING = SSL_ERROR_WANT_WRITE;
pub const SSL_READING = SSL_ERROR_WANT_READ;
pub inline fn SSL_want_read(ssl: anytype) @TypeOf(SSL_want(ssl) == SSL_READING) {
    return SSL_want(ssl) == SSL_READING;
}
pub inline fn SSL_want_write(ssl: anytype) @TypeOf(SSL_want(ssl) == SSL_WRITING) {
    return SSL_want(ssl) == SSL_WRITING;
}
pub const SSL_TXT_MEDIUM = "MEDIUM";
pub const SSL_TXT_HIGH = "HIGH";
pub const SSL_TXT_FIPS = "FIPS";
pub const SSL_TXT_kRSA = "kRSA";
pub const SSL_TXT_kDHE = "kDHE";
pub const SSL_TXT_kEDH = "kEDH";
pub const SSL_TXT_kECDHE = "kECDHE";
pub const SSL_TXT_kEECDH = "kEECDH";
pub const SSL_TXT_kPSK = "kPSK";
pub const SSL_TXT_aRSA = "aRSA";
pub const SSL_TXT_aECDSA = "aECDSA";
pub const SSL_TXT_aPSK = "aPSK";
pub const SSL_TXT_DH = "DH";
pub const SSL_TXT_DHE = "DHE";
pub const SSL_TXT_EDH = "EDH";
pub const SSL_TXT_RSA = "RSA";
pub const SSL_TXT_ECDH = "ECDH";
pub const SSL_TXT_ECDHE = "ECDHE";
pub const SSL_TXT_EECDH = "EECDH";
pub const SSL_TXT_ECDSA = "ECDSA";
pub const SSL_TXT_PSK = "PSK";
pub const SSL_TXT_3DES = "3DES";
pub const SSL_TXT_RC4 = "RC4";
pub const SSL_TXT_AES128 = "AES128";
pub const SSL_TXT_AES256 = "AES256";
pub const SSL_TXT_AES = "AES";
pub const SSL_TXT_AES_GCM = "AESGCM";
pub const SSL_TXT_CHACHA20 = "CHACHA20";
pub const SSL_TXT_MD5 = "MD5";
pub const SSL_TXT_SHA1 = "SHA1";
pub const SSL_TXT_SHA = "SHA";
pub const SSL_TXT_SHA256 = "SHA256";
pub const SSL_TXT_SHA384 = "SHA384";
pub const SSL_TXT_SSLV3 = "SSLv3";
pub const SSL_TXT_TLSV1 = "TLSv1";
pub const SSL_TXT_TLSV1_1 = "TLSv1.1";
pub const SSL_TXT_TLSV1_2 = "TLSv1.2";
pub const SSL_TXT_TLSV1_3 = "TLSv1.3";
pub const SSL_TXT_ALL = "ALL";
pub const SSL_TXT_CMPDEF = "COMPLEMENTOFDEFAULT";
pub inline fn SSL_get_state(ssl: anytype) @TypeOf(SSL_state(ssl)) {
    return SSL_state(ssl);
}
pub inline fn SSL_CTX_set_ecdh_auto(ctx: anytype, onoff: anytype) @TypeOf(@as(c_int, 1)) {
    _ = @TypeOf(ctx);
    _ = @TypeOf(onoff);
    return @as(c_int, 1);
}
pub inline fn SSL_set_ecdh_auto(ssl: anytype, onoff: anytype) @TypeOf(@as(c_int, 1)) {
    _ = @TypeOf(ssl);
    _ = @TypeOf(onoff);
    return @as(c_int, 1);
}
pub const SSL_get0_session = SSL_get_session;
pub const OPENSSL_INIT_NO_LOAD_SSL_STRINGS = @as(c_int, 0);
pub const OPENSSL_INIT_LOAD_SSL_STRINGS = @as(c_int, 0);
pub const OPENSSL_INIT_SSL_DEFAULT = @as(c_int, 0);
pub const SSL_SIGN_RSA_PSS_SHA256 = SSL_SIGN_RSA_PSS_RSAE_SHA256;
pub const SSL_SIGN_RSA_PSS_SHA384 = SSL_SIGN_RSA_PSS_RSAE_SHA384;
pub const SSL_SIGN_RSA_PSS_SHA512 = SSL_SIGN_RSA_PSS_RSAE_SHA512;
pub const SSL_R_TLSV1_UNSUPPORTED_EXTENSION = SSL_R_TLSV1_ALERT_UNSUPPORTED_EXTENSION;
pub const SSL_R_TLSV1_CERTIFICATE_UNOBTAINABLE = SSL_R_TLSV1_ALERT_CERTIFICATE_UNOBTAINABLE;
pub const SSL_R_TLSV1_UNRECOGNIZED_NAME = SSL_R_TLSV1_ALERT_UNRECOGNIZED_NAME;
pub const SSL_R_TLSV1_BAD_CERTIFICATE_STATUS_RESPONSE = SSL_R_TLSV1_ALERT_BAD_CERTIFICATE_STATUS_RESPONSE;
pub const SSL_R_TLSV1_BAD_CERTIFICATE_HASH_VALUE = SSL_R_TLSV1_ALERT_BAD_CERTIFICATE_HASH_VALUE;
pub const SSL_R_TLSV1_CERTIFICATE_REQUIRED = SSL_R_TLSV1_ALERT_CERTIFICATE_REQUIRED;
pub const SSL_R_APP_DATA_IN_HANDSHAKE = @as(c_int, 100);
pub const SSL_R_ATTEMPT_TO_REUSE_SESSION_IN_DIFFERENT_CONTEXT = @as(c_int, 101);
pub const SSL_R_BAD_ALERT = @as(c_int, 102);
pub const SSL_R_BAD_CHANGE_CIPHER_SPEC = @as(c_int, 103);
pub const SSL_R_BAD_DATA_RETURNED_BY_CALLBACK = @as(c_int, 104);
pub const SSL_R_BAD_DH_P_LENGTH = @as(c_int, 105);
pub const SSL_R_BAD_DIGEST_LENGTH = @as(c_int, 106);
pub const SSL_R_BAD_ECC_CERT = @as(c_int, 107);
pub const SSL_R_BAD_ECPOINT = @as(c_int, 108);
pub const SSL_R_BAD_HANDSHAKE_RECORD = @as(c_int, 109);
pub const SSL_R_BAD_HELLO_REQUEST = @as(c_int, 110);
pub const SSL_R_BAD_LENGTH = @as(c_int, 111);
pub const SSL_R_BAD_PACKET_LENGTH = @as(c_int, 112);
pub const SSL_R_BAD_RSA_ENCRYPT = @as(c_int, 113);
pub const SSL_R_BAD_SIGNATURE = @as(c_int, 114);
pub const SSL_R_BAD_SRTP_MKI_VALUE = @as(c_int, 115);
pub const SSL_R_BAD_SRTP_PROTECTION_PROFILE_LIST = @as(c_int, 116);
pub const SSL_R_BAD_SSL_FILETYPE = @as(c_int, 117);
pub const SSL_R_BAD_WRITE_RETRY = @as(c_int, 118);
pub const SSL_R_BIO_NOT_SET = @as(c_int, 119);
pub const SSL_R_BN_LIB = @as(c_int, 120);
pub const SSL_R_BUFFER_TOO_SMALL = @as(c_int, 121);
pub const SSL_R_CA_DN_LENGTH_MISMATCH = @as(c_int, 122);
pub const SSL_R_CA_DN_TOO_LONG = @as(c_int, 123);
pub const SSL_R_CCS_RECEIVED_EARLY = @as(c_int, 124);
pub const SSL_R_CERTIFICATE_VERIFY_FAILED = @as(c_int, 125);
pub const SSL_R_CERT_CB_ERROR = @as(c_int, 126);
pub const SSL_R_CERT_LENGTH_MISMATCH = @as(c_int, 127);
pub const SSL_R_CHANNEL_ID_NOT_P256 = @as(c_int, 128);
pub const SSL_R_CHANNEL_ID_SIGNATURE_INVALID = @as(c_int, 129);
pub const SSL_R_CIPHER_OR_HASH_UNAVAILABLE = @as(c_int, 130);
pub const SSL_R_CLIENTHELLO_PARSE_FAILED = @as(c_int, 131);
pub const SSL_R_CLIENTHELLO_TLSEXT = @as(c_int, 132);
pub const SSL_R_CONNECTION_REJECTED = @as(c_int, 133);
pub const SSL_R_CONNECTION_TYPE_NOT_SET = @as(c_int, 134);
pub const SSL_R_CUSTOM_EXTENSION_ERROR = @as(c_int, 135);
pub const SSL_R_DATA_LENGTH_TOO_LONG = @as(c_int, 136);
pub const SSL_R_DECODE_ERROR = @as(c_int, 137);
pub const SSL_R_DECRYPTION_FAILED = @as(c_int, 138);
pub const SSL_R_DECRYPTION_FAILED_OR_BAD_RECORD_MAC = @as(c_int, 139);
pub const SSL_R_DH_PUBLIC_VALUE_LENGTH_IS_WRONG = @as(c_int, 140);
pub const SSL_R_DH_P_TOO_LONG = @as(c_int, 141);
pub const SSL_R_DIGEST_CHECK_FAILED = @as(c_int, 142);
pub const SSL_R_DTLS_MESSAGE_TOO_BIG = @as(c_int, 143);
pub const SSL_R_ECC_CERT_NOT_FOR_SIGNING = @as(c_int, 144);
pub const SSL_R_EMS_STATE_INCONSISTENT = @as(c_int, 145);
pub const SSL_R_ENCRYPTED_LENGTH_TOO_LONG = @as(c_int, 146);
pub const SSL_R_ERROR_ADDING_EXTENSION = @as(c_int, 147);
pub const SSL_R_ERROR_IN_RECEIVED_CIPHER_LIST = @as(c_int, 148);
pub const SSL_R_ERROR_PARSING_EXTENSION = @as(c_int, 149);
pub const SSL_R_EXCESSIVE_MESSAGE_SIZE = @as(c_int, 150);
pub const SSL_R_EXTRA_DATA_IN_MESSAGE = @as(c_int, 151);
pub const SSL_R_FRAGMENT_MISMATCH = @as(c_int, 152);
pub const SSL_R_GOT_NEXT_PROTO_WITHOUT_EXTENSION = @as(c_int, 153);
pub const SSL_R_HANDSHAKE_FAILURE_ON_CLIENT_HELLO = @as(c_int, 154);
pub const SSL_R_HTTPS_PROXY_REQUEST = @as(c_int, 155);
pub const SSL_R_HTTP_REQUEST = @as(c_int, 156);
pub const SSL_R_INAPPROPRIATE_FALLBACK = @as(c_int, 157);
pub const SSL_R_INVALID_COMMAND = @as(c_int, 158);
pub const SSL_R_INVALID_MESSAGE = @as(c_int, 159);
pub const SSL_R_INVALID_SSL_SESSION = @as(c_int, 160);
pub const SSL_R_INVALID_TICKET_KEYS_LENGTH = @as(c_int, 161);
pub const SSL_R_LENGTH_MISMATCH = @as(c_int, 162);
pub const SSL_R_MISSING_EXTENSION = @as(c_int, 164);
pub const SSL_R_MISSING_RSA_CERTIFICATE = @as(c_int, 165);
pub const SSL_R_MISSING_TMP_DH_KEY = @as(c_int, 166);
pub const SSL_R_MISSING_TMP_ECDH_KEY = @as(c_int, 167);
pub const SSL_R_MIXED_SPECIAL_OPERATOR_WITH_GROUPS = @as(c_int, 168);
pub const SSL_R_MTU_TOO_SMALL = @as(c_int, 169);
pub const SSL_R_NEGOTIATED_BOTH_NPN_AND_ALPN = @as(c_int, 170);
pub const SSL_R_NESTED_GROUP = @as(c_int, 171);
pub const SSL_R_NO_CERTIFICATES_RETURNED = @as(c_int, 172);
pub const SSL_R_NO_CERTIFICATE_ASSIGNED = @as(c_int, 173);
pub const SSL_R_NO_CERTIFICATE_SET = @as(c_int, 174);
pub const SSL_R_NO_CIPHERS_AVAILABLE = @as(c_int, 175);
pub const SSL_R_NO_CIPHERS_PASSED = @as(c_int, 176);
pub const SSL_R_NO_CIPHER_MATCH = @as(c_int, 177);
pub const SSL_R_NO_COMPRESSION_SPECIFIED = @as(c_int, 178);
pub const SSL_R_NO_METHOD_SPECIFIED = @as(c_int, 179);
pub const SSL_R_NO_P256_SUPPORT = @as(c_int, 180);
pub const SSL_R_NO_PRIVATE_KEY_ASSIGNED = @as(c_int, 181);
pub const SSL_R_NO_RENEGOTIATION = @as(c_int, 182);
pub const SSL_R_NO_REQUIRED_DIGEST = @as(c_int, 183);
pub const SSL_R_NO_SHARED_CIPHER = @as(c_int, 184);
pub const SSL_R_NULL_SSL_CTX = @as(c_int, 185);
pub const SSL_R_NULL_SSL_METHOD_PASSED = @as(c_int, 186);
pub const SSL_R_OLD_SESSION_CIPHER_NOT_RETURNED = @as(c_int, 187);
pub const SSL_R_OLD_SESSION_VERSION_NOT_RETURNED = @as(c_int, 188);
pub const SSL_R_OUTPUT_ALIASES_INPUT = @as(c_int, 189);
pub const SSL_R_PARSE_TLSEXT = @as(c_int, 190);
pub const SSL_R_PATH_TOO_LONG = @as(c_int, 191);
pub const SSL_R_PEER_DID_NOT_RETURN_A_CERTIFICATE = @as(c_int, 192);
pub const SSL_R_PEER_ERROR_UNSUPPORTED_CERTIFICATE_TYPE = @as(c_int, 193);
pub const SSL_R_PROTOCOL_IS_SHUTDOWN = @as(c_int, 194);
pub const SSL_R_PSK_IDENTITY_NOT_FOUND = @as(c_int, 195);
pub const SSL_R_PSK_NO_CLIENT_CB = @as(c_int, 196);
pub const SSL_R_PSK_NO_SERVER_CB = @as(c_int, 197);
pub const SSL_R_READ_TIMEOUT_EXPIRED = @as(c_int, 198);
pub const SSL_R_RECORD_LENGTH_MISMATCH = @as(c_int, 199);
pub const SSL_R_RECORD_TOO_LARGE = @as(c_int, 200);
pub const SSL_R_RENEGOTIATION_ENCODING_ERR = @as(c_int, 201);
pub const SSL_R_RENEGOTIATION_MISMATCH = @as(c_int, 202);
pub const SSL_R_REQUIRED_CIPHER_MISSING = @as(c_int, 203);
pub const SSL_R_RESUMED_EMS_SESSION_WITHOUT_EMS_EXTENSION = @as(c_int, 204);
pub const SSL_R_RESUMED_NON_EMS_SESSION_WITH_EMS_EXTENSION = @as(c_int, 205);
pub const SSL_R_SCSV_RECEIVED_WHEN_RENEGOTIATING = @as(c_int, 206);
pub const SSL_R_SERVERHELLO_TLSEXT = @as(c_int, 207);
pub const SSL_R_SESSION_ID_CONTEXT_UNINITIALIZED = @as(c_int, 208);
pub const SSL_R_SESSION_MAY_NOT_BE_CREATED = @as(c_int, 209);
pub const SSL_R_SIGNATURE_ALGORITHMS_EXTENSION_SENT_BY_SERVER = @as(c_int, 210);
pub const SSL_R_SRTP_COULD_NOT_ALLOCATE_PROFILES = @as(c_int, 211);
pub const SSL_R_SRTP_UNKNOWN_PROTECTION_PROFILE = @as(c_int, 212);
pub const SSL_R_SSL3_EXT_INVALID_SERVERNAME = @as(c_int, 213);
pub const SSL_R_SSL_CTX_HAS_NO_DEFAULT_SSL_VERSION = @as(c_int, 214);
pub const SSL_R_SSL_HANDSHAKE_FAILURE = @as(c_int, 215);
pub const SSL_R_SSL_SESSION_ID_CONTEXT_TOO_LONG = @as(c_int, 216);
pub const SSL_R_TLS_PEER_DID_NOT_RESPOND_WITH_CERTIFICATE_LIST = @as(c_int, 217);
pub const SSL_R_TLS_RSA_ENCRYPTED_VALUE_LENGTH_IS_WRONG = @as(c_int, 218);
pub const SSL_R_TOO_MANY_EMPTY_FRAGMENTS = @as(c_int, 219);
pub const SSL_R_TOO_MANY_WARNING_ALERTS = @as(c_int, 220);
pub const SSL_R_UNABLE_TO_FIND_ECDH_PARAMETERS = @as(c_int, 221);
pub const SSL_R_UNEXPECTED_EXTENSION = @as(c_int, 222);
pub const SSL_R_UNEXPECTED_MESSAGE = @as(c_int, 223);
pub const SSL_R_UNEXPECTED_OPERATOR_IN_GROUP = @as(c_int, 224);
pub const SSL_R_UNEXPECTED_RECORD = @as(c_int, 225);
pub const SSL_R_UNINITIALIZED = @as(c_int, 226);
pub const SSL_R_UNKNOWN_ALERT_TYPE = @as(c_int, 227);
pub const SSL_R_UNKNOWN_CERTIFICATE_TYPE = @as(c_int, 228);
pub const SSL_R_UNKNOWN_CIPHER_RETURNED = @as(c_int, 229);
pub const SSL_R_UNKNOWN_CIPHER_TYPE = @as(c_int, 230);
pub const SSL_R_UNKNOWN_DIGEST = @as(c_int, 231);
pub const SSL_R_UNKNOWN_KEY_EXCHANGE_TYPE = @as(c_int, 232);
pub const SSL_R_UNKNOWN_PROTOCOL = @as(c_int, 233);
pub const SSL_R_UNKNOWN_SSL_VERSION = @as(c_int, 234);
pub const SSL_R_UNKNOWN_STATE = @as(c_int, 235);
pub const SSL_R_UNSAFE_LEGACY_RENEGOTIATION_DISABLED = @as(c_int, 236);
pub const SSL_R_UNSUPPORTED_CIPHER = @as(c_int, 237);
pub const SSL_R_UNSUPPORTED_COMPRESSION_ALGORITHM = @as(c_int, 238);
pub const SSL_R_UNSUPPORTED_ELLIPTIC_CURVE = @as(c_int, 239);
pub const SSL_R_UNSUPPORTED_PROTOCOL = @as(c_int, 240);
pub const SSL_R_WRONG_CERTIFICATE_TYPE = @as(c_int, 241);
pub const SSL_R_WRONG_CIPHER_RETURNED = @as(c_int, 242);
pub const SSL_R_WRONG_CURVE = @as(c_int, 243);
pub const SSL_R_WRONG_MESSAGE_TYPE = @as(c_int, 244);
pub const SSL_R_WRONG_SIGNATURE_TYPE = @as(c_int, 245);
pub const SSL_R_WRONG_SSL_VERSION = @as(c_int, 246);
pub const SSL_R_WRONG_VERSION_NUMBER = @as(c_int, 247);
pub const SSL_R_X509_LIB = @as(c_int, 248);
pub const SSL_R_X509_VERIFICATION_SETUP_PROBLEMS = @as(c_int, 249);
pub const SSL_R_SHUTDOWN_WHILE_IN_INIT = @as(c_int, 250);
pub const SSL_R_INVALID_OUTER_RECORD_TYPE = @as(c_int, 251);
pub const SSL_R_UNSUPPORTED_PROTOCOL_FOR_CUSTOM_KEY = @as(c_int, 252);
pub const SSL_R_NO_COMMON_SIGNATURE_ALGORITHMS = @as(c_int, 253);
pub const SSL_R_DOWNGRADE_DETECTED = @as(c_int, 254);
pub const SSL_R_EXCESS_HANDSHAKE_DATA = @as(c_int, 255);
pub const SSL_R_INVALID_COMPRESSION_LIST = @as(c_int, 256);
pub const SSL_R_DUPLICATE_EXTENSION = @as(c_int, 257);
pub const SSL_R_MISSING_KEY_SHARE = @as(c_int, 258);
pub const SSL_R_INVALID_ALPN_PROTOCOL = @as(c_int, 259);
pub const SSL_R_TOO_MANY_KEY_UPDATES = @as(c_int, 260);
pub const SSL_R_BLOCK_CIPHER_PAD_IS_WRONG = @as(c_int, 261);
pub const SSL_R_NO_CIPHERS_SPECIFIED = @as(c_int, 262);
pub const SSL_R_RENEGOTIATION_EMS_MISMATCH = @as(c_int, 263);
pub const SSL_R_DUPLICATE_KEY_SHARE = @as(c_int, 264);
pub const SSL_R_NO_GROUPS_SPECIFIED = @as(c_int, 265);
pub const SSL_R_NO_SHARED_GROUP = @as(c_int, 266);
pub const SSL_R_PRE_SHARED_KEY_MUST_BE_LAST = @as(c_int, 267);
pub const SSL_R_OLD_SESSION_PRF_HASH_MISMATCH = @as(c_int, 268);
pub const SSL_R_INVALID_SCT_LIST = @as(c_int, 269);
pub const SSL_R_TOO_MUCH_SKIPPED_EARLY_DATA = @as(c_int, 270);
pub const SSL_R_PSK_IDENTITY_BINDER_COUNT_MISMATCH = @as(c_int, 271);
pub const SSL_R_CANNOT_PARSE_LEAF_CERT = @as(c_int, 272);
pub const SSL_R_SERVER_CERT_CHANGED = @as(c_int, 273);
pub const SSL_R_CERTIFICATE_AND_PRIVATE_KEY_MISMATCH = @as(c_int, 274);
pub const SSL_R_CANNOT_HAVE_BOTH_PRIVKEY_AND_METHOD = @as(c_int, 275);
pub const SSL_R_TICKET_ENCRYPTION_FAILED = @as(c_int, 276);
pub const SSL_R_ALPN_MISMATCH_ON_EARLY_DATA = @as(c_int, 277);
pub const SSL_R_WRONG_VERSION_ON_EARLY_DATA = @as(c_int, 278);
pub const SSL_R_UNEXPECTED_EXTENSION_ON_EARLY_DATA = @as(c_int, 279);
pub const SSL_R_NO_SUPPORTED_VERSIONS_ENABLED = @as(c_int, 280);
pub const SSL_R_APPLICATION_DATA_INSTEAD_OF_HANDSHAKE = @as(c_int, 281);
pub const SSL_R_EMPTY_HELLO_RETRY_REQUEST = @as(c_int, 282);
pub const SSL_R_EARLY_DATA_NOT_IN_USE = @as(c_int, 283);
pub const SSL_R_HANDSHAKE_NOT_COMPLETE = @as(c_int, 284);
pub const SSL_R_NEGOTIATED_TB_WITHOUT_EMS_OR_RI = @as(c_int, 285);
pub const SSL_R_SERVER_ECHOED_INVALID_SESSION_ID = @as(c_int, 286);
pub const SSL_R_PRIVATE_KEY_OPERATION_FAILED = @as(c_int, 287);
pub const SSL_R_SECOND_SERVERHELLO_VERSION_MISMATCH = @as(c_int, 288);
pub const SSL_R_OCSP_CB_ERROR = @as(c_int, 289);
pub const SSL_R_SSL_SESSION_ID_TOO_LONG = @as(c_int, 290);
pub const SSL_R_APPLICATION_DATA_ON_SHUTDOWN = @as(c_int, 291);
pub const SSL_R_CERT_DECOMPRESSION_FAILED = @as(c_int, 292);
pub const SSL_R_UNCOMPRESSED_CERT_TOO_LARGE = @as(c_int, 293);
pub const SSL_R_UNKNOWN_CERT_COMPRESSION_ALG = @as(c_int, 294);
pub const SSL_R_INVALID_SIGNATURE_ALGORITHM = @as(c_int, 295);
pub const SSL_R_DUPLICATE_SIGNATURE_ALGORITHM = @as(c_int, 296);
pub const SSL_R_TLS13_DOWNGRADE = @as(c_int, 297);
pub const SSL_R_QUIC_INTERNAL_ERROR = @as(c_int, 298);
pub const SSL_R_WRONG_ENCRYPTION_LEVEL_RECEIVED = @as(c_int, 299);
pub const SSL_R_TOO_MUCH_READ_EARLY_DATA = @as(c_int, 300);
pub const SSL_R_INVALID_DELEGATED_CREDENTIAL = @as(c_int, 301);
pub const SSL_R_KEY_USAGE_BIT_INCORRECT = @as(c_int, 302);
pub const SSL_R_INCONSISTENT_CLIENT_HELLO = @as(c_int, 303);
pub const SSL_R_CIPHER_MISMATCH_ON_EARLY_DATA = @as(c_int, 304);
pub const SSL_R_QUIC_TRANSPORT_PARAMETERS_MISCONFIGURED = @as(c_int, 305);
pub const SSL_R_UNEXPECTED_COMPATIBILITY_MODE = @as(c_int, 306);
pub const SSL_R_NO_APPLICATION_PROTOCOL = @as(c_int, 307);
pub const SSL_R_NEGOTIATED_ALPS_WITHOUT_ALPN = @as(c_int, 308);
pub const SSL_R_ALPS_MISMATCH_ON_EARLY_DATA = @as(c_int, 309);
pub const SSL_R_ECH_SERVER_CONFIG_AND_PRIVATE_KEY_MISMATCH = @as(c_int, 310);
pub const SSL_R_ECH_SERVER_CONFIG_UNSUPPORTED_EXTENSION = @as(c_int, 311);
pub const SSL_R_UNSUPPORTED_ECH_SERVER_CONFIG = @as(c_int, 312);
pub const SSL_R_ECH_SERVER_WOULD_HAVE_NO_RETRY_CONFIGS = @as(c_int, 313);
pub const SSL_R_INVALID_CLIENT_HELLO_INNER = @as(c_int, 314);
pub const SSL_R_INVALID_ALPN_PROTOCOL_LIST = @as(c_int, 315);
pub const SSL_R_COULD_NOT_PARSE_HINTS = @as(c_int, 316);
pub const SSL_R_INVALID_ECH_PUBLIC_NAME = @as(c_int, 317);
pub const SSL_R_INVALID_ECH_CONFIG_LIST = @as(c_int, 318);
pub const SSL_R_ECH_REJECTED = @as(c_int, 319);
pub const SSL_R_INVALID_OUTER_EXTENSION = @as(c_int, 320);
pub const SSL_R_INCONSISTENT_ECH_NEGOTIATION = @as(c_int, 321);
pub const SSL_R_SSLV3_ALERT_CLOSE_NOTIFY = @as(c_int, 1000);
pub const SSL_R_SSLV3_ALERT_UNEXPECTED_MESSAGE = @as(c_int, 1010);
pub const SSL_R_SSLV3_ALERT_BAD_RECORD_MAC = @as(c_int, 1020);
pub const SSL_R_TLSV1_ALERT_DECRYPTION_FAILED = @as(c_int, 1021);
pub const SSL_R_TLSV1_ALERT_RECORD_OVERFLOW = @as(c_int, 1022);
pub const SSL_R_SSLV3_ALERT_DECOMPRESSION_FAILURE = @as(c_int, 1030);
pub const SSL_R_SSLV3_ALERT_HANDSHAKE_FAILURE = @as(c_int, 1040);
pub const SSL_R_SSLV3_ALERT_NO_CERTIFICATE = @as(c_int, 1041);
pub const SSL_R_SSLV3_ALERT_BAD_CERTIFICATE = @as(c_int, 1042);
pub const SSL_R_SSLV3_ALERT_UNSUPPORTED_CERTIFICATE = @as(c_int, 1043);
pub const SSL_R_SSLV3_ALERT_CERTIFICATE_REVOKED = @as(c_int, 1044);
pub const SSL_R_SSLV3_ALERT_CERTIFICATE_EXPIRED = @as(c_int, 1045);
pub const SSL_R_SSLV3_ALERT_CERTIFICATE_UNKNOWN = @as(c_int, 1046);
pub const SSL_R_SSLV3_ALERT_ILLEGAL_PARAMETER = @as(c_int, 1047);
pub const SSL_R_TLSV1_ALERT_UNKNOWN_CA = @as(c_int, 1048);
pub const SSL_R_TLSV1_ALERT_ACCESS_DENIED = @as(c_int, 1049);
pub const SSL_R_TLSV1_ALERT_DECODE_ERROR = @as(c_int, 1050);
pub const SSL_R_TLSV1_ALERT_DECRYPT_ERROR = @as(c_int, 1051);
pub const SSL_R_TLSV1_ALERT_EXPORT_RESTRICTION = @as(c_int, 1060);
pub const SSL_R_TLSV1_ALERT_PROTOCOL_VERSION = @as(c_int, 1070);
pub const SSL_R_TLSV1_ALERT_INSUFFICIENT_SECURITY = @as(c_int, 1071);
pub const SSL_R_TLSV1_ALERT_INTERNAL_ERROR = @as(c_int, 1080);
pub const SSL_R_TLSV1_ALERT_INAPPROPRIATE_FALLBACK = @as(c_int, 1086);
pub const SSL_R_TLSV1_ALERT_USER_CANCELLED = @as(c_int, 1090);
pub const SSL_R_TLSV1_ALERT_NO_RENEGOTIATION = @as(c_int, 1100);
pub const SSL_R_TLSV1_ALERT_UNSUPPORTED_EXTENSION = @as(c_int, 1110);
pub const SSL_R_TLSV1_ALERT_CERTIFICATE_UNOBTAINABLE = @as(c_int, 1111);
pub const SSL_R_TLSV1_ALERT_UNRECOGNIZED_NAME = @as(c_int, 1112);
pub const SSL_R_TLSV1_ALERT_BAD_CERTIFICATE_STATUS_RESPONSE = @as(c_int, 1113);
pub const SSL_R_TLSV1_ALERT_BAD_CERTIFICATE_HASH_VALUE = @as(c_int, 1114);
pub const SSL_R_TLSV1_ALERT_UNKNOWN_PSK_IDENTITY = @as(c_int, 1115);
pub const SSL_R_TLSV1_ALERT_CERTIFICATE_REQUIRED = @as(c_int, 1116);
pub const SSL_R_TLSV1_ALERT_NO_APPLICATION_PROTOCOL = @as(c_int, 1120);
pub const SSL_R_TLSV1_ALERT_ECH_REQUIRED = @as(c_int, 1121);
pub const asn1_null_st = struct_asn1_null_st;
pub const ASN1_ITEM_st = struct_ASN1_ITEM_st;
pub const asn1_object_st = struct_asn1_object_st;
pub const asn1_pctx_st = struct_asn1_pctx_st;
pub const asn1_string_st = struct_asn1_string_st;
pub const ASN1_VALUE_st = struct_ASN1_VALUE_st;
pub const asn1_type_st = struct_asn1_type_st;
pub const AUTHORITY_KEYID_st = struct_AUTHORITY_KEYID_st;
pub const BASIC_CONSTRAINTS_st = struct_BASIC_CONSTRAINTS_st;
pub const DIST_POINT_st = struct_DIST_POINT_st;
pub const bignum_st = struct_bignum_st;
pub const DSA_SIG_st = struct_DSA_SIG_st;
pub const ISSUING_DIST_POINT_st = struct_ISSUING_DIST_POINT_st;
pub const NAME_CONSTRAINTS_st = struct_NAME_CONSTRAINTS_st;
pub const X509_pubkey_st = struct_X509_pubkey_st;
pub const Netscape_spkac_st = struct_Netscape_spkac_st;
pub const X509_algor_st = struct_X509_algor_st;
pub const Netscape_spki_st = struct_Netscape_spki_st;
pub const RIPEMD160state_st = struct_RIPEMD160state_st;
pub const X509_VERIFY_PARAM_st = struct_X509_VERIFY_PARAM_st;
pub const X509_crl_st = struct_X509_crl_st;
pub const X509_extension_st = struct_X509_extension_st;
pub const x509_st = struct_x509_st;
pub const openssl_method_common_st = struct_openssl_method_common_st;
pub const rsa_meth_st = struct_rsa_meth_st;
pub const stack_st_void = struct_stack_st_void;
pub const crypto_ex_data_st = struct_crypto_ex_data_st;
pub const bn_mont_ctx_st = struct_bn_mont_ctx_st;
pub const bn_blinding_st = struct_bn_blinding_st;
pub const rsa_st = struct_rsa_st;
pub const dsa_st = struct_dsa_st;
pub const dh_st = struct_dh_st;
pub const ec_key_st = struct_ec_key_st;
pub const evp_pkey_asn1_method_st = struct_evp_pkey_asn1_method_st;
pub const evp_pkey_st = struct_evp_pkey_st;
pub const evp_cipher_st = struct_evp_cipher_st;
pub const evp_cipher_info_st = struct_evp_cipher_info_st;
pub const private_key_st = struct_private_key_st;
pub const X509_info_st = struct_X509_info_st;
pub const X509_name_entry_st = struct_X509_name_entry_st;
pub const X509_name_st = struct_X509_name_st;
pub const X509_req_st = struct_X509_req_st;
pub const X509_sig_st = struct_X509_sig_st;
pub const bignum_ctx = struct_bignum_ctx;
pub const bio_st = struct_bio_st;
pub const bio_method_st = struct_bio_method_st;
pub const blake2b_state_st = struct_blake2b_state_st;
pub const bn_gencb_st = struct_bn_gencb_st;
pub const buf_mem_st = struct_buf_mem_st;
pub const cbb_buffer_st = struct_cbb_buffer_st;
pub const cbb_child_st = struct_cbb_child_st;
pub const cbb_st = struct_cbb_st;
pub const cbs_st = struct_cbs_st;
pub const cmac_ctx_st = struct_cmac_ctx_st;
pub const conf_st = struct_conf_st;
pub const conf_value_st = struct_conf_value_st;
pub const crypto_buffer_pool_st = struct_crypto_buffer_pool_st;
pub const crypto_buffer_st = struct_crypto_buffer_st;
pub const ctr_drbg_state_st = struct_ctr_drbg_state_st;
pub const ec_group_st = struct_ec_group_st;
pub const ec_point_st = struct_ec_point_st;
pub const ecdsa_method_st = struct_ecdsa_method_st;
pub const ecdsa_sig_st = struct_ecdsa_sig_st;
pub const engine_st = struct_engine_st;
pub const env_md_st = struct_env_md_st;
pub const evp_pkey_ctx_st = struct_evp_pkey_ctx_st;
pub const evp_md_pctx_ops = struct_evp_md_pctx_ops;
pub const env_md_ctx_st = struct_env_md_ctx_st;
pub const evp_aead_st = struct_evp_aead_st;
pub const evp_aead_ctx_st_state = union_evp_aead_ctx_st_state;
pub const evp_aead_ctx_st = struct_evp_aead_ctx_st;
pub const evp_cipher_ctx_st = struct_evp_cipher_ctx_st;
pub const evp_encode_ctx_st = struct_evp_encode_ctx_st;
pub const evp_hpke_aead_st = struct_evp_hpke_aead_st;
pub const evp_hpke_ctx_st = struct_evp_hpke_ctx_st;
pub const evp_hpke_kdf_st = struct_evp_hpke_kdf_st;
pub const evp_hpke_kem_st = struct_evp_hpke_kem_st;
pub const evp_hpke_key_st = struct_evp_hpke_key_st;
pub const evp_pkey_method_st = struct_evp_pkey_method_st;
pub const hmac_ctx_st = struct_hmac_ctx_st;
pub const md4_state_st = struct_md4_state_st;
pub const md5_state_st = struct_md5_state_st;
pub const ossl_init_settings_st = struct_ossl_init_settings_st;
pub const pkcs12_st = struct_pkcs12_st;
pub const pkcs8_priv_key_info_st = struct_pkcs8_priv_key_info_st;
pub const rand_meth_st = struct_rand_meth_st;
pub const rc4_key_st = struct_rc4_key_st;
pub const rsa_pss_params_st = struct_rsa_pss_params_st;
pub const sha256_state_st = struct_sha256_state_st;
pub const sha512_state_st = struct_sha512_state_st;
pub const sha_state_st = struct_sha_state_st;
pub const spake2_ctx_st = struct_spake2_ctx_st;
pub const srtp_protection_profile_st = struct_srtp_protection_profile_st;
pub const ssl_cipher_st = struct_ssl_cipher_st;
// pub const ssl_ctx_st = struct_ssl_ctx_st;
// pub const ssl_st = struct_ssl_st;
pub const ssl_early_callback_ctx = struct_ssl_early_callback_ctx;
pub const ssl_ech_keys_st = struct_ssl_ech_keys_st;
pub const ssl_method_st = struct_ssl_method_st;
pub const ssl_private_key_result_t = enum_ssl_private_key_result_t;
pub const ssl_private_key_method_st = struct_ssl_private_key_method_st;
pub const ssl_encryption_level_t = enum_ssl_encryption_level_t;
pub const ssl_quic_method_st = struct_ssl_quic_method_st;
pub const ssl_session_st = struct_ssl_session_st;
pub const ssl_ticket_aead_result_t = enum_ssl_ticket_aead_result_t;
pub const ssl_ticket_aead_method_st = struct_ssl_ticket_aead_method_st;
pub const st_ERR_FNS = struct_st_ERR_FNS;
pub const trust_token_st = struct_trust_token_st;
pub const trust_token_client_st = struct_trust_token_client_st;
pub const trust_token_issuer_st = struct_trust_token_issuer_st;
pub const trust_token_method_st = struct_trust_token_method_st;
pub const v3_ext_ctx = struct_v3_ext_ctx;
pub const x509_attributes_st = struct_x509_attributes_st;
pub const x509_lookup_st = struct_x509_lookup_st;
pub const x509_lookup_method_st = struct_x509_lookup_method_st;
pub const x509_object_st = struct_x509_object_st;
pub const x509_revoked_st = struct_x509_revoked_st;
pub const x509_store_ctx_st = struct_x509_store_ctx_st;
pub const x509_store_st = struct_x509_store_st;
pub const x509_trust_st = struct_x509_trust_st;
pub const __sbuf = struct___sbuf;
pub const stack_st = struct_stack_st;
pub const stack_st_OPENSSL_STRING = struct_stack_st_OPENSSL_STRING;
pub const CRYPTO_dynlock_value = struct_CRYPTO_dynlock_value;
pub const stack_st_BIO = struct_stack_st_BIO;
pub const evp_aead_direction_t = enum_evp_aead_direction_t;
pub const stack_st_CRYPTO_BUFFER = struct_stack_st_CRYPTO_BUFFER;
pub const stack_st_X509 = struct_stack_st_X509;
pub const stack_st_X509_CRL = struct_stack_st_X509_CRL;
pub const timespec = struct_timespec;
pub const tm = struct_tm;
pub const bn_primality_result_t = enum_bn_primality_result_t;
pub const stack_st_ASN1_INTEGER = struct_stack_st_ASN1_INTEGER;
pub const stack_st_ASN1_OBJECT = struct_stack_st_ASN1_OBJECT;
pub const stack_st_ASN1_TYPE = struct_stack_st_ASN1_TYPE;
pub const ec_method_st = struct_ec_method_st;
pub const obj_name_st = struct_obj_name_st;
pub const stack_st_X509_EXTENSION = struct_stack_st_X509_EXTENSION;
pub const stack_st_X509_REVOKED = struct_stack_st_X509_REVOKED;
pub const stack_st_X509_NAME_ENTRY = struct_stack_st_X509_NAME_ENTRY;
pub const stack_st_X509_NAME = struct_stack_st_X509_NAME;
pub const stack_st_X509_ALGOR = struct_stack_st_X509_ALGOR;
pub const stack_st_X509_ATTRIBUTE = struct_stack_st_X509_ATTRIBUTE;
pub const stack_st_DIST_POINT = struct_stack_st_DIST_POINT;
pub const stack_st_GENERAL_NAME = struct_stack_st_GENERAL_NAME;
pub const stack_st_X509_TRUST = struct_stack_st_X509_TRUST;
pub const stack_st_GENERAL_NAMES = struct_stack_st_GENERAL_NAMES;
pub const AUTHORITY_INFO_ACCESS = struct_stack_st_ACCESS_DESCRIPTION;
pub const stack_st_X509_INFO = struct_stack_st_X509_INFO;
pub const stack_st_X509_LOOKUP = struct_stack_st_X509_LOOKUP;
pub const stack_st_X509_OBJECT = struct_stack_st_X509_OBJECT;
pub const stack_st_X509_VERIFY_PARAM = struct_stack_st_X509_VERIFY_PARAM;
pub const fips_counter_t = enum_fips_counter_t;
pub const stack_st_SSL_CIPHER = struct_stack_st_SSL_CIPHER;
pub const ssl_verify_result_t = enum_ssl_verify_result_t;
pub const stack_st_SRTP_PROTECTION_PROFILE = struct_stack_st_SRTP_PROTECTION_PROFILE;
pub const ssl_early_data_reason_t = enum_ssl_early_data_reason_t;
pub const ssl_renegotiate_mode_t = enum_ssl_renegotiate_mode_t;
pub const ssl_select_cert_result_t = enum_ssl_select_cert_result_t;
pub const ssl_comp_st = struct_ssl_comp_st;
pub const stack_st_SSL_COMP = struct_stack_st_SSL_COMP;
pub const ssl_conf_ctx_st = struct_ssl_conf_ctx_st;
pub const ssl_compliance_policy_t = enum_ssl_compliance_policy_t;

pub extern fn RAND_bytes(buf: [*]u8, len: usize) c_int;

/// RAND_enable_fork_unsafe_buffering enables efficient buffered reading of
/// /dev/urandom. It adds an overhead of a few KB of memory per thread. It must
/// be called before the first call to |RAND_bytes|.
///
/// |fd| must be -1. We no longer support setting the file descriptor with this
/// function.
///
/// It has an unusual name because the buffer is unsafe across calls to |fork|.
/// Hence, this function should never be called by libraries.
pub extern fn RAND_enable_fork_unsafe_buffering(c_int) void;

pub extern fn SSL_new(ctx: ?*SSL_CTX) ?*SSL;

pub extern fn EVP_md4() *const EVP_MD;
pub extern fn EVP_md5() *const EVP_MD;
pub extern fn EVP_sha1() *const EVP_MD;
pub extern fn EVP_sha224() *const EVP_MD;
pub extern fn EVP_sha256() *const EVP_MD;
pub extern fn EVP_sha384() *const EVP_MD;
pub extern fn EVP_sha512() *const EVP_MD;
pub extern fn EVP_sha512_224() *const EVP_MD;
pub extern fn EVP_sha512_256() *const EVP_MD;

pub extern fn EVP_blake2b256() *const EVP_MD;
pub extern fn EVP_blake2b512() *const EVP_MD;

pub extern fn ERR_clear_error() void;
pub extern fn ERR_set_mark() c_int;
pub extern fn ERR_pop_to_mark() c_int;
pub extern fn ERR_get_next_error_library() c_int;

pub const struct_bio_st = extern struct {
    method: [*c]const BIO_METHOD,
    _init: c_int,
    shutdown: c_int,
    flags: c_int,
    retry_reason: c_int,
    num: c_int,
    references: CRYPTO_refcount_t,
    ptr: ?*anyopaque,
    next_bio: ?*BIO,
    num_read: usize,
    num_write: usize,

    pub fn isEmpty(this: *struct_bio_st) bool {
        return BIO_eof(this) > 0;
    }

    pub fn init() !*struct_bio_st {
        return BIO_new(BIO_s_mem()) orelse error.OutOfMemory;
    }

    /// Create a read-only `BIO` using an existing buffer. `buffer` is not
    /// copied, and ownership is not transfered.
    ///
    /// `buffer` must outlive the returned `BIO`.
    ///
    /// Returns an error if
    /// - the buffer is empty
    /// - BIO initialization fails (same as `.init()`).
    pub fn initReadonlyView(buffer: []const u8) !*struct_bio_st {
        // NOTE: not exposing len parameter. If we want to ignore their
        // suggestion and pass a negative value to make it treat `buffer` as a
        // null-terminated string, create a separate `initReadonlyViewZ`
        // constructor.
        return BIO_new_mem_buf(buffer.ptr, buffer.len);
    }

    pub fn deinit(this: *struct_bio_st) void {
        _ = BIO_free(this);
    }

    pub fn slice(this: *struct_bio_st) []u8 {
        var buf_mem: ?*BUF_MEM = null;
        bun.assert(BIO_get_mem_ptr(this, &buf_mem) > -1);
        if (buf_mem) |buf| {
            if (buf.data == null) return &[_]u8{};

            return buf.data[0..buf.length];
        }

        return &[_]u8{};
    }

    pub fn pending(this: *const struct_bio_st) usize {
        return BIO_ctrl_pending(this);
    }

    pub fn write(this: *struct_bio_st, buffer: []const u8) !usize {
        const rc = BIO_write(this, buffer.ptr, @as(c_int, @intCast(buffer.len)));

        return if (rc > -1)
            return @as(usize, @intCast(rc))
        else
            return error.Fail;
    }

    pub fn read(this: *struct_bio_st, buffer: []u8) !usize {
        const rc = BIO_read(this, buffer.ptr, @as(c_int, @intCast(buffer.len)));
        return if (rc > -1)
            return @as(usize, @intCast(rc))
        else
            return error.Fail;
    }
};

pub const CertError = error{
    OK,
    UNABLE_TO_GET_ISSUER_CERT,
    UNABLE_TO_GET_CRL,
    UNABLE_TO_DECRYPT_CERT_SIGNATURE,
    UNABLE_TO_DECRYPT_CRL_SIGNATURE,
    UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY,
    CERT_SIGNATURE_FAILURE,
    CRL_SIGNATURE_FAILURE,
    CERT_NOT_YET_VALID,
    CRL_NOT_YET_VALID,
    CERT_HAS_EXPIRED,
    CRL_HAS_EXPIRED,
    ERROR_IN_CERT_NOT_BEFORE_FIELD,
    ERROR_IN_CERT_NOT_AFTER_FIELD,
    ERROR_IN_CRL_LAST_UPDATE_FIELD,
    ERROR_IN_CRL_NEXT_UPDATE_FIELD,
    OUT_OF_MEM,
    DEPTH_ZERO_SELF_SIGNED_CERT,
    SELF_SIGNED_CERT_IN_CHAIN,
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY,
    UNABLE_TO_VERIFY_LEAF_SIGNATURE,
    CERT_CHAIN_TOO_LONG,
    CERT_REVOKED,
    INVALID_CA,
    INVALID_NON_CA,
    PATH_LENGTH_EXCEEDED,
    PROXY_PATH_LENGTH_EXCEEDED,
    PROXY_CERTIFICATES_NOT_ALLOWED,
    INVALID_PURPOSE,
    CERT_UNTRUSTED,
    CERT_REJECTED,
    APPLICATION_VERIFICATION,
    SUBJECT_ISSUER_MISMATCH,
    AKID_SKID_MISMATCH,
    AKID_ISSUER_SERIAL_MISMATCH,
    KEYUSAGE_NO_CERTSIGN,
    UNABLE_TO_GET_CRL_ISSUER,
    UNHANDLED_CRITICAL_EXTENSION,
    KEYUSAGE_NO_CRL_SIGN,
    KEYUSAGE_NO_DIGITAL_SIGNATURE,
    UNHANDLED_CRITICAL_CRL_EXTENSION,
    INVALID_EXTENSION,
    INVALID_POLICY_EXTENSION,
    NO_EXPLICIT_POLICY,
    DIFFERENT_CRL_SCOPE,
    UNSUPPORTED_EXTENSION_FEATURE,
    UNNESTED_RESOURCE,
    PERMITTED_VIOLATION,
    EXCLUDED_VIOLATION,
    SUBTREE_MINMAX,
    UNSUPPORTED_CONSTRAINT_TYPE,
    UNSUPPORTED_CONSTRAINT_SYNTAX,
    UNSUPPORTED_NAME_SYNTAX,
    CRL_PATH_VALIDATION_ERROR,
    SUITE_B_INVALID_VERSION,
    SUITE_B_INVALID_ALGORITHM,
    SUITE_B_INVALID_CURVE,
    SUITE_B_INVALID_SIGNATURE_ALGORITHM,
    SUITE_B_LOS_NOT_ALLOWED,
    SUITE_B_CANNOT_SIGN_P_384_WITH_P_256,
    HOSTNAME_MISMATCH,
    EMAIL_MISMATCH,
    IP_ADDRESS_MISMATCH,
    INVALID_CALL,
    STORE_LOOKUP,
    NAME_CONSTRAINTS_WITHOUT_SANS,
    UNKNOWN_CERTIFICATE_VERIFICATION_ERROR,
};

pub fn getCertErrorFromNo(error_no: i32) CertError {
    return switch (error_no) {
        X509_V_OK => error.OK,
        X509_V_ERR_UNABLE_TO_GET_ISSUER_CERT => error.UNABLE_TO_GET_ISSUER_CERT,
        X509_V_ERR_UNABLE_TO_GET_CRL => error.UNABLE_TO_GET_CRL,
        X509_V_ERR_UNABLE_TO_DECRYPT_CERT_SIGNATURE => error.UNABLE_TO_DECRYPT_CERT_SIGNATURE,
        X509_V_ERR_UNABLE_TO_DECRYPT_CRL_SIGNATURE => error.UNABLE_TO_DECRYPT_CRL_SIGNATURE,
        X509_V_ERR_UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY => error.UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY,
        X509_V_ERR_CERT_SIGNATURE_FAILURE => error.CERT_SIGNATURE_FAILURE,
        X509_V_ERR_CRL_SIGNATURE_FAILURE => error.CRL_SIGNATURE_FAILURE,
        X509_V_ERR_CERT_NOT_YET_VALID => error.CERT_NOT_YET_VALID,
        X509_V_ERR_CRL_NOT_YET_VALID => error.CRL_NOT_YET_VALID,
        X509_V_ERR_CERT_HAS_EXPIRED => error.CERT_HAS_EXPIRED,
        X509_V_ERR_CRL_HAS_EXPIRED => error.CRL_HAS_EXPIRED,
        X509_V_ERR_ERROR_IN_CERT_NOT_BEFORE_FIELD => error.ERROR_IN_CERT_NOT_BEFORE_FIELD,
        X509_V_ERR_ERROR_IN_CERT_NOT_AFTER_FIELD => error.ERROR_IN_CERT_NOT_AFTER_FIELD,
        X509_V_ERR_ERROR_IN_CRL_LAST_UPDATE_FIELD => error.ERROR_IN_CRL_LAST_UPDATE_FIELD,
        X509_V_ERR_ERROR_IN_CRL_NEXT_UPDATE_FIELD => error.ERROR_IN_CRL_NEXT_UPDATE_FIELD,
        X509_V_ERR_OUT_OF_MEM => error.OUT_OF_MEM,
        X509_V_ERR_DEPTH_ZERO_SELF_SIGNED_CERT => error.DEPTH_ZERO_SELF_SIGNED_CERT,
        X509_V_ERR_SELF_SIGNED_CERT_IN_CHAIN => error.SELF_SIGNED_CERT_IN_CHAIN,
        X509_V_ERR_UNABLE_TO_GET_ISSUER_CERT_LOCALLY => error.UNABLE_TO_GET_ISSUER_CERT_LOCALLY,
        X509_V_ERR_UNABLE_TO_VERIFY_LEAF_SIGNATURE => error.UNABLE_TO_VERIFY_LEAF_SIGNATURE,
        X509_V_ERR_CERT_CHAIN_TOO_LONG => error.CERT_CHAIN_TOO_LONG,
        X509_V_ERR_CERT_REVOKED => error.CERT_REVOKED,
        X509_V_ERR_INVALID_CA => error.INVALID_CA,
        X509_V_ERR_INVALID_NON_CA => error.INVALID_NON_CA,
        X509_V_ERR_PATH_LENGTH_EXCEEDED => error.PATH_LENGTH_EXCEEDED,
        X509_V_ERR_PROXY_PATH_LENGTH_EXCEEDED => error.PROXY_PATH_LENGTH_EXCEEDED,
        X509_V_ERR_PROXY_CERTIFICATES_NOT_ALLOWED => error.PROXY_CERTIFICATES_NOT_ALLOWED,
        X509_V_ERR_INVALID_PURPOSE => error.INVALID_PURPOSE,
        X509_V_ERR_CERT_UNTRUSTED => error.CERT_UNTRUSTED,
        X509_V_ERR_CERT_REJECTED => error.CERT_REJECTED,
        X509_V_ERR_APPLICATION_VERIFICATION => error.APPLICATION_VERIFICATION,
        X509_V_ERR_SUBJECT_ISSUER_MISMATCH => error.SUBJECT_ISSUER_MISMATCH,
        X509_V_ERR_AKID_SKID_MISMATCH => error.AKID_SKID_MISMATCH,
        X509_V_ERR_AKID_ISSUER_SERIAL_MISMATCH => error.AKID_ISSUER_SERIAL_MISMATCH,
        X509_V_ERR_KEYUSAGE_NO_CERTSIGN => error.KEYUSAGE_NO_CERTSIGN,
        X509_V_ERR_UNABLE_TO_GET_CRL_ISSUER => error.UNABLE_TO_GET_CRL_ISSUER,
        X509_V_ERR_UNHANDLED_CRITICAL_EXTENSION => error.UNHANDLED_CRITICAL_EXTENSION,
        X509_V_ERR_KEYUSAGE_NO_CRL_SIGN => error.KEYUSAGE_NO_CRL_SIGN,
        X509_V_ERR_KEYUSAGE_NO_DIGITAL_SIGNATURE => error.KEYUSAGE_NO_DIGITAL_SIGNATURE,
        X509_V_ERR_UNHANDLED_CRITICAL_CRL_EXTENSION => error.UNHANDLED_CRITICAL_CRL_EXTENSION,
        X509_V_ERR_INVALID_EXTENSION => error.INVALID_EXTENSION,
        X509_V_ERR_INVALID_POLICY_EXTENSION => error.INVALID_POLICY_EXTENSION,
        X509_V_ERR_NO_EXPLICIT_POLICY => error.NO_EXPLICIT_POLICY,
        X509_V_ERR_DIFFERENT_CRL_SCOPE => error.DIFFERENT_CRL_SCOPE,
        X509_V_ERR_UNSUPPORTED_EXTENSION_FEATURE => error.UNSUPPORTED_EXTENSION_FEATURE,
        X509_V_ERR_UNNESTED_RESOURCE => error.UNNESTED_RESOURCE,
        X509_V_ERR_PERMITTED_VIOLATION => error.PERMITTED_VIOLATION,
        X509_V_ERR_EXCLUDED_VIOLATION => error.EXCLUDED_VIOLATION,
        X509_V_ERR_SUBTREE_MINMAX => error.SUBTREE_MINMAX,
        X509_V_ERR_UNSUPPORTED_CONSTRAINT_TYPE => error.UNSUPPORTED_CONSTRAINT_TYPE,
        X509_V_ERR_UNSUPPORTED_CONSTRAINT_SYNTAX => error.UNSUPPORTED_CONSTRAINT_SYNTAX,
        X509_V_ERR_UNSUPPORTED_NAME_SYNTAX => error.UNSUPPORTED_NAME_SYNTAX,
        X509_V_ERR_CRL_PATH_VALIDATION_ERROR => error.CRL_PATH_VALIDATION_ERROR,
        X509_V_ERR_SUITE_B_INVALID_VERSION => error.SUITE_B_INVALID_VERSION,
        X509_V_ERR_SUITE_B_INVALID_ALGORITHM => error.SUITE_B_INVALID_ALGORITHM,
        X509_V_ERR_SUITE_B_INVALID_CURVE => error.SUITE_B_INVALID_CURVE,
        X509_V_ERR_SUITE_B_INVALID_SIGNATURE_ALGORITHM => error.SUITE_B_INVALID_SIGNATURE_ALGORITHM,
        X509_V_ERR_SUITE_B_LOS_NOT_ALLOWED => error.SUITE_B_LOS_NOT_ALLOWED,
        X509_V_ERR_SUITE_B_CANNOT_SIGN_P_384_WITH_P_256 => error.SUITE_B_CANNOT_SIGN_P_384_WITH_P_256,
        X509_V_ERR_HOSTNAME_MISMATCH => error.HOSTNAME_MISMATCH,
        X509_V_ERR_EMAIL_MISMATCH => error.EMAIL_MISMATCH,
        X509_V_ERR_IP_ADDRESS_MISMATCH => error.IP_ADDRESS_MISMATCH,
        X509_V_ERR_INVALID_CALL => error.INVALID_CALL,
        X509_V_ERR_STORE_LOOKUP => error.STORE_LOOKUP,
        X509_V_ERR_NAME_CONSTRAINTS_WITHOUT_SANS => error.NAME_CONSTRAINTS_WITHOUT_SANS,
        else => error.UNKNOWN_CERTIFICATE_VERIFICATION_ERROR,
    };
}

pub const SSL = opaque {
    pub const Error = error{
        SSL,
        WantRead,
        WantWrite,
        WantX509Lookup,
        Syscall,
        ZeroReturn,
        WantConnect,
        WantAccept,
        WantChannelIdLookup,
        PendingSession,
        PendingCertificate,
        WantPrivateKeyOperation,
        PendingTicket,
        EarlyDataRejected,
        WantCertificateVerify,
        Handoff,
        Handback,
        WantRenegotiate,
        HandshakeHintsReady,
    };

    pub fn shutdown(this: *SSL) void {
        _ = SSL_shutdown(this);
    }

    pub inline fn deinit(this: *SSL) void {
        _ = SSL_free(this);
    }

    pub inline fn init(ctx: *SSL_CTX) *SSL {
        return SSL_new(ctx);
    }

    pub inline fn isInitFinished(ssl: *const SSL) bool {
        return SSL_is_init_finished(ssl) > 0;
    }

    pub inline fn pending(ssl: *SSL) usize {
        return @as(usize, @intCast(SSL_pending(ssl)));
    }

    pub inline fn hasPending(ssl: *SSL) bool {
        return SSL_has_pending(ssl) > 0;
    }

    pub inline fn setFD(this: *SSL, fd: c_int) void {
        _ = SSL_set_fd(this, fd);
    }

    pub inline fn setIsClient(ssl: *SSL, comptime is_client: bool) void {
        if (comptime is_client) {
            SSL_set_connect_state(ssl);
        } else {
            SSL_set_accept_state(ssl);
        }
    }

    pub inline fn setBIO(ssl: *SSL, in: *BIO, out: *BIO) void {
        SSL_set_bio(ssl, in, out);
    }

    pub fn setHostname(ssl: *SSL, hostname: [*c]const u8) void {
        _ = SSL_set_tlsext_host_name(ssl, hostname);
    }

    pub fn configureHTTPClient(ssl: *SSL, hostname: [:0]const u8) void {
        if (hostname.len > 0) ssl.setHostname(hostname);
        _ = SSL_clear_options(ssl, SSL_OP_LEGACY_SERVER_CONNECT);
        _ = SSL_set_options(ssl, SSL_OP_LEGACY_SERVER_CONNECT);

        const alpns = &[_]u8{ 8, 'h', 't', 't', 'p', '/', '1', '.', '1' };
        bun.assert(SSL_set_alpn_protos(ssl, alpns, alpns.len) == 0);

        SSL_enable_signed_cert_timestamps(ssl);
        SSL_enable_ocsp_stapling(ssl);

        SSL_set_enable_ech_grease(ssl, 1);
    }

    pub fn handshake(this: *SSL) Error!void {
        const rc = SSL_connect(this);
        return switch (SSL_get_error(this, rc)) {
            SSL_ERROR_SSL => return error.SSL,
            SSL_ERROR_WANT_READ => return error.WantRead,
            SSL_ERROR_WANT_WRITE => return error.WantWrite,
            SSL_ERROR_WANT_X509_LOOKUP => return error.WantX509Lookup,
            SSL_ERROR_SYSCALL => return error.Syscall,
            SSL_ERROR_ZERO_RETURN => return error.ZeroReturn,
            SSL_ERROR_WANT_CONNECT => return error.WantConnect,
            SSL_ERROR_WANT_ACCEPT => return error.WantAccept,
            SSL_ERROR_WANT_CHANNEL_ID_LOOKUP => return error.WantChannelIdLookup,
            SSL_ERROR_PENDING_SESSION => return error.PendingSession,
            SSL_ERROR_PENDING_CERTIFICATE => return error.PendingCertificate,
            SSL_ERROR_WANT_PRIVATE_KEY_OPERATION => return error.WantPrivateKeyOperation,
            SSL_ERROR_PENDING_TICKET => return error.PendingTicket,
            SSL_ERROR_EARLY_DATA_REJECTED => return error.EarlyDataRejected,
            SSL_ERROR_WANT_CERTIFICATE_VERIFY => return error.WantCertificateVerify,
            SSL_ERROR_HANDOFF => return error.Handoff,
            SSL_ERROR_HANDBACK => return error.Handback,
            SSL_ERROR_WANT_RENEGOTIATE => return error.WantRenegotiate,
            SSL_ERROR_HANDSHAKE_HINTS_READY => return error.HandshakeHintsReady,
            else => {},
        };
    }

    const Output = bun.Output;
    const Environment = bun.Environment;

    pub fn read(this: *SSL, buf: []u8) Error!usize {
        const rc = SSL_read(this, buf.ptr, @as(c_int, @intCast(buf.len)));
        return switch (SSL_get_error(this, rc)) {
            SSL_ERROR_SSL => error.SSL,
            SSL_ERROR_WANT_READ => error.WantRead,
            SSL_ERROR_WANT_WRITE => error.WantWrite,
            SSL_ERROR_WANT_X509_LOOKUP => error.WantX509Lookup,
            SSL_ERROR_SYSCALL => error.Syscall,
            SSL_ERROR_ZERO_RETURN => error.ZeroReturn,
            SSL_ERROR_WANT_CONNECT => error.WantConnect,
            SSL_ERROR_WANT_ACCEPT => error.WantAccept,
            SSL_ERROR_WANT_CHANNEL_ID_LOOKUP => error.WantChannelIdLookup,
            SSL_ERROR_PENDING_SESSION => error.PendingSession,
            SSL_ERROR_PENDING_CERTIFICATE => error.PendingCertificate,
            SSL_ERROR_WANT_PRIVATE_KEY_OPERATION => error.WantPrivateKeyOperation,
            SSL_ERROR_PENDING_TICKET => error.PendingTicket,
            SSL_ERROR_EARLY_DATA_REJECTED => error.EarlyDataRejected,
            SSL_ERROR_WANT_CERTIFICATE_VERIFY => error.WantCertificateVerify,
            SSL_ERROR_HANDOFF => error.Handoff,
            SSL_ERROR_HANDBACK => error.Handback,
            SSL_ERROR_WANT_RENEGOTIATE => error.WantRenegotiate,
            SSL_ERROR_HANDSHAKE_HINTS_READY => error.HandshakeHintsReady,
            else => @as(usize, @intCast(rc)),
        };
    }

    pub fn write(this: *SSL, buf: []const u8) Error!u32 {
        const rc = SSL_write(this, buf.ptr, @as(c_int, @intCast(buf.len)));
        return switch (SSL_get_error(this, rc)) {
            SSL_ERROR_SSL => {
                if (comptime Environment.isDebug) {
                    const errdescription = std.mem.span(SSL_error_description(SSL_ERROR_SSL).?);
                    Output.prettyError("SSL_ERROR: {s}", .{errdescription});
                }
                return error.SSL;
            },
            SSL_ERROR_WANT_READ => error.WantRead,
            SSL_ERROR_WANT_WRITE => error.WantWrite,
            SSL_ERROR_WANT_X509_LOOKUP => error.WantX509Lookup,
            SSL_ERROR_SYSCALL => error.Syscall,
            SSL_ERROR_ZERO_RETURN => error.ZeroReturn,
            SSL_ERROR_WANT_CONNECT => error.WantConnect,
            SSL_ERROR_WANT_ACCEPT => error.WantAccept,
            SSL_ERROR_WANT_CHANNEL_ID_LOOKUP => error.WantChannelIdLookup,
            SSL_ERROR_PENDING_SESSION => error.PendingSession,
            SSL_ERROR_PENDING_CERTIFICATE => error.PendingCertificate,
            SSL_ERROR_WANT_PRIVATE_KEY_OPERATION => error.WantPrivateKeyOperation,
            SSL_ERROR_PENDING_TICKET => error.PendingTicket,
            SSL_ERROR_EARLY_DATA_REJECTED => error.EarlyDataRejected,
            SSL_ERROR_WANT_CERTIFICATE_VERIFY => error.WantCertificateVerify,
            SSL_ERROR_HANDOFF => error.Handoff,
            SSL_ERROR_HANDBACK => error.Handback,
            SSL_ERROR_WANT_RENEGOTIATE => error.WantRenegotiate,
            SSL_ERROR_HANDSHAKE_HINTS_READY => error.HandshakeHintsReady,
            else => @as(u32, @intCast(rc)),
        };
    }

    pub fn readAll(this: *SSL, buf: []u8) Error![]u8 {
        var rbio = SSL_get_rbio(this);
        const start_len = rbio.slice().len;
        const written = try this.read(buf);
        return rbio.slice()[start_len..][0..written];
    }

    pub fn writeAll(this: *SSL, buf: []const u8) Error![]const u8 {
        var rbio = SSL_get_wbio(this);
        const start_len = rbio.slice().len;
        const written = try this.write(buf);
        return rbio.slice()[start_len..][0..written];
    }
};

pub const VerifyResult = enum(c_int) {
    ok = 0,
    invalid = 1,
    retry = 2,
};
pub const VerifyCallback = *const fn (*SSL, [*c]u8) callconv(.C) VerifyResult;

pub extern fn SSL_CTX_set_custom_verify(ctx: ?*SSL_CTX, mode: c_int, callback: ?VerifyCallback) void;

pub const SSL_CTX = opaque {
    pub fn init() ?*SSL_CTX {
        var ctx = SSL_CTX_new(TLS_with_buffers_method()) orelse return null;
        ctx.setCustomVerify(noop_custom_verify);
        ctx.setup();
        return ctx;
    }

    pub fn setup(ctx: *SSL_CTX) void {
        if (auto_crypto_buffer_pool == null) auto_crypto_buffer_pool = CRYPTO_BUFFER_POOL_new();
        SSL_CTX_set0_buffer_pool(ctx, auto_crypto_buffer_pool);
        _ = SSL_CTX_set_cipher_list(ctx, SSL_DEFAULT_CIPHER_LIST);
    }

    pub inline fn setCustomVerify(this: *SSL_CTX, cb: ?VerifyCallback) void {
        SSL_CTX_set_custom_verify(this, 0, cb);
        // SSL_CTX_set_custom_verify(this, 1, cb);
        // SSL_CTX_set_custom_verify(this, 2, cb);
    }

    pub fn deinit(this: *SSL_CTX) void {
        SSL_CTX_free(this);
    }
};

fn noop_custom_verify(_: *SSL, _: [*c]u8) callconv(.C) VerifyResult {
    return VerifyResult.ok;
}

threadlocal var auto_crypto_buffer_pool: ?*CRYPTO_BUFFER_POOL = null;

pub const BIOMethod = struct {
    pub const create = *const fn (*BIO) callconv(.C) c_int;
    pub const destroy = *const fn (*BIO) callconv(.C) c_int;
    pub const write = *const fn (*BIO, [*c]const u8, c_int) callconv(.C) c_int;
    pub const read = *const fn (*BIO, [*c]u8, c_int) callconv(.C) c_int;
    pub const gets = *const fn (*BIO, [*c]u8, c_int) callconv(.C) c_int;
    pub const ctrl = *const fn (*BIO, c_int, c_long, ?*anyopaque) callconv(.C) c_long;
    pub fn init(
        name: [:0]const u8,
        comptime create__: ?create,
        comptime destroy__: ?destroy,
        comptime write__: ?write,
        comptime read__: ?read,
        comptime gets__: ?gets,
        comptime ctrl__: ?ctrl,
    ) *BIO_METHOD {
        const method = BIO_meth_new(BIO_get_new_index() | BIO_TYPE_SOURCE_SINK, name);
        if (comptime create__) |create_| {
            bun.assert(BIO_meth_set_create(method, create_) > 0);
        }
        if (comptime destroy__) |destroy_| {
            bun.assert(BIO_meth_set_destroy(method, destroy_) > 0);
        }
        if (comptime write__) |write_| {
            bun.assert(BIO_meth_set_write(method, write_) > 0);
        }
        if (comptime read__) |read_| {
            bun.assert(BIO_meth_set_read(method, read_) > 0);
        }
        if (comptime gets__) |gets_| {
            bun.assert(BIO_meth_set_gets(method, gets_) > 0);
        }
        if (comptime ctrl__) |ctrl_| {
            bun.assert(BIO_meth_set_ctrl(method, ctrl_) > 0);
        }

        return method;
    }
};

pub fn getError(this: *SSL, rc: c_int) SSL.Error!u32 {
    return switch (SSL_get_error(this, rc)) {
        SSL_ERROR_SSL => error.SSL,
        SSL_ERROR_WANT_READ => error.WantRead,
        SSL_ERROR_WANT_WRITE => error.WantWrite,
        SSL_ERROR_WANT_X509_LOOKUP => error.WantX509Lookup,
        SSL_ERROR_SYSCALL => error.Syscall,
        SSL_ERROR_ZERO_RETURN => error.ZeroReturn,
        SSL_ERROR_WANT_CONNECT => error.WantConnect,
        SSL_ERROR_WANT_ACCEPT => error.WantAccept,
        SSL_ERROR_WANT_CHANNEL_ID_LOOKUP => error.WantChannelIdLookup,
        SSL_ERROR_PENDING_SESSION => error.PendingSession,
        SSL_ERROR_PENDING_CERTIFICATE => error.PendingCertificate,
        SSL_ERROR_WANT_PRIVATE_KEY_OPERATION => error.WantPrivateKeyOperation,
        SSL_ERROR_PENDING_TICKET => error.PendingTicket,
        SSL_ERROR_EARLY_DATA_REJECTED => error.EarlyDataRejected,
        SSL_ERROR_WANT_CERTIFICATE_VERIFY => error.WantCertificateVerify,
        SSL_ERROR_HANDOFF => error.Handoff,
        SSL_ERROR_HANDBACK => error.Handback,
        SSL_ERROR_WANT_RENEGOTIATE => error.WantRenegotiate,
        SSL_ERROR_HANDSHAKE_HINTS_READY => error.HandshakeHintsReady,
        else => @as(u32, @intCast(rc)),
    };
}
