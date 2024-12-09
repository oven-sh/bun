const std = @import("std");
const Allocator = std.mem.Allocator;

const ssl = @import("./boringssl.translated.zig");

// pub const struct_stack_st_X509 = opaque {};
// pub const struct_stack_st_X509_CRL = opaque {};

// pub const struct_X509_VERIFY_PARAM_st = opaque {};
// pub const X509_VERIFY_PARAM = struct_X509_VERIFY_PARAM_st;
// pub const struct_X509_crl_st = opaque {};
// pub const X509_CRL = struct_X509_crl_st;
// pub const struct_X509_extension_st = opaque {};
// pub const X509_EXTENSION = struct_X509_extension_st;
// pub const struct_x509_st = opaque {};
// pub const X509 = struct_x509_st;

// pub const struct_X509_algor_st = extern struct {
//     algorithm: ?*ssl.ASN1_OBJECT,
//     parameter: [*c]ssl.ASN1_TYPE,
// };
// pub const X509_ALGOR = struct_X509_algor_st;

/// An X509 Certificate.
///
/// NOTE: unless otherwise stated, no reference counting is performed.
///
/// NOTE: Not all BoringSSL functions have been ported yet. Please add them as
/// needed.
///
/// ## References
/// - [RFC 5280](https://tools.ietf.org/html/rfc5280)
/// - [BoringSSL Docs - `x509.h`](https://commondatastorage.googleapis.com/chromium-boringssl-docs/x509.h.html)
pub const X509 = opaque {
    /// Create a newly allocated, empty X.509 certificate.
    ///
    /// The new certificate is incomplete and may be filled in to issue a new
    /// certificate.
    pub fn init() Allocator.Error!*X509 {
        return X509_new() orelse Allocator.OutOfMemory;
    }

    pub fn deinit(this: *X509) void {
        X509_free(this);
    }

    /// Get name of the entity who signed and issued this certificate.
    ///
    /// Returns `null` for incomplete certificates.
    ///
    /// ## References
    /// - [RFC 5280 - sec 4.1.2.4](https://datatracker.ietf.org/doc/html/rfc5280#section-4.1.2.4)
    pub fn issuer(this: *const X509) ?*const X509.Name {
        return X509_get_issuer_name(this);
    }

    /// Get the subject of the certificate.
    ///
    /// The subject is the entity associated with the public key stored in the
    /// certificate.
    ///
    /// Returns `null` for incomplete certificates.
    ///
    /// ## References
    /// - [RFC 5280 - sec 4.1.2.6](https://datatracker.ietf.org/doc/html/rfc5280#section-4.1.2.6)
    pub fn subject(this: *const X509) ?*const X509.Name {
        return X509_get_subject_name(this);
    }

    /// Get this certificate's serial number.
    ///
    /// Returns `null` for incomplete certificates.
    ///
    /// > NOTE: ASN.1 integer types may be negative, but RFC 5280 requires X.509
    /// > serial numbers to be non-zero positive. Such cases must still be
    /// > checkd for and handled.
    /// >
    /// > NOTE: these are usually long. Max value is 20 octets.
    ///
    /// [spec](https://datatracker.ietf.org/doc/html/rfc5280#section-4.1.2.2)
    pub fn serialNumber(this: *const X509) ?*const ssl.ASN1_INTEGER {
        return X509_get0_serialNumber(this);
    }

    /// Get the date the certificate validity period begins.
    ///
    /// ## References
    /// - [RFC 5280 - sec 4.1.2.5](https://datatracker.ietf.org/doc/html/rfc5280#section-4.1.2.5)
    pub fn notBefore(this: *const X509) ?*const ssl.ASN1_TIME {
        return X509_get0_notBefore(this);
    }

    /// Get the date the certificate validity period ends.
    ///
    /// ## References
    /// - [RFC 5280 - sec 4.1.2.5](https://datatracker.ietf.org/doc/html/rfc5280#section-4.1.2.5)
    pub fn notAfter(this: *const X509) ?*const ssl.ASN1_TIME {
        return X509_get0_notAfter(this);
    }

    /// Is this certificate for a Certificate Authority?
    pub fn isCA(self: *X509) bool {
        return X509_check_ca(self) == 1;
    }

    /// Get this certificate's public key as an Envelope Public Key (EVP_PKEY).
    ///
    /// Returns `null` for unsupported keys or if the key could not be decoded.
    /// Use `publicKeySPKI` for the raw Subject Public Key Info (SPKI) encoded
    /// key.
    ///
    /// The returned key is cached within the cert and must not be mutated.
    pub fn publicKey(self: *const X509) ?*const ssl.EVP_PKEY {
        return X509_get0_pubkey(self);
    }

    /// The public key of this certificate encoded in Subject Public Key Info
    /// (SPKI) format. You likely want `publicKey` instead.
    ///
    /// Returns `null` for incomplete certificates.
    pub fn publicKeySPKI(self: *const X509) ?*const PubKey {
        // NOTE: BoringSSL docs says this is not const-correct (for legacy
        // reasons) and that the returned key should not be modified, so we're
        // adjusting the function's API.
        // see: https://commondatastorage.googleapis.com/chromium-boringssl-docs/x509.h.html#X509V3_extensions_print:~:text=X509_get_X509_PUBKEY%20returns%20the%20public%20key%20of%20x509.%20Note%20this%20function%20is%20not%20const%2Dcorrect%20for%20legacy%20reasons.%20Callers%20should%20not%20modify%20the%20returned%20object.
        return X509_get_X509_PUBKEY(self);
    }

    // =========================================================================
    // ================================ SUBTYPES ===============================
    // =========================================================================

    /// > NOTE: Corresponds to `X509_NAME`.
    ///
    /// ## References
    /// - [BoringSSL - `x509name.cc`](https://github.com/google/boringssl/blob/master/crypto/x509/x509name.cc)
    pub const Name = opaque {
        /// Get an attribute at index `loc`. `loc` is interpreted using
        /// `X509.Name`'s flattened representation.
        ///
        /// Returns `null` if `loc` is out of bounds.
        pub fn entry(this: *Name, loc: u32) ?*const Name.Entry {
            // NOTE: BoringSSL checks for < 0 values, returning null to
            // represent an error if so.
            // see: https://github.com/google/boringssl/blob/9559c4566a6d12194c42db5f3dbbcb5de35cfec2/crypto/x509/x509name.cc#L158
            return X509_NAME_get_entry(this, @as(c_int, @intCast(loc)));
        }

        /// Corresponds to `X509_NAME_ENTRY`.
        pub const Entry = opaque {
            /// Get this entry's attribute type.
            pub fn object(this: *const Entry) ?*const ssl.ASN1_OBJECT {
                return X509_NAME_ENTRY_get_object(this);
            }

            /// Get this entry's attribute value, represented as an
            /// `ASN1_STRING`.  This value may have any ASN.1 type, so callers
            /// must check the type before interpreting the contents. Use
            /// `.object()` to get the type.
            pub fn data(this: *const Entry) ?*const ssl.ASN1_STRING {
                return X509_NAME_ENTRY_get_data(this);
            }

            extern fn X509_NAME_ENTRY_get_object(entry: ?*X509.Name.Entry) ?*ssl.ASN1_OBJECT;
            extern fn X509_NAME_ENTRY_get_data(entry: ?X509.Name.Entry) ?*ssl.ASN1_STRING;
        };

        extern fn X509_NAME_get_entry(name: *Name, loc: c_int) ?X509.Name_ENTRY;
    };

    /// A Subject Public Key Info (SPKI) encoded public key.
    ///
    /// ## References
    /// - [RFC 5280 - sec 4.1.2.7](https://datatracker.ietf.org/doc/html/rfc5280#section-4.1.2.7)
    pub const PubKey = opaque {};

    // /// > NOTE: Corresponds to `X509_ALGOR`.
    // pub const Algorithm = extern struct {
    //     algorithm: ?*ssl.ASN1_OBJECT,
    //     parameter: [*c]ssl.ASN1_TYPE,
    // };

    // =========================================================================
    // ========================== EXTERNAL FUNCTIONS ===========================
    // =========================================================================

    // NOTE: subtypes should contain their own external function declarations.

    // memory management
    extern fn X509_new() ?*X509;
    extern fn X509_free(x509: ?*X509) void;

    // getters
    // NOTE: get0_* functions do not increment the reference count
    extern fn X509_check_ca(x: ?*X509) c_int;
    extern fn X509_get_pubkey(x509: ?*X509) ?*ssl.EVP_PKEY;
    extern fn X509_get0_pubkey(x509: ?*X509) ?*ssl.EVP_PKEY;
    extern fn X509_get_subject_name(x509: ?*const X509) ?*X509.Name; // NOTE: was ?X509.Name
    extern fn X509_get_version(x509: ?*const X509) c_long;
    extern fn X509_get_X509_PUBKEY(x509: ?*const X509) ?*X509.PubKey;
    extern fn X509_get0_notAfter(x509: ?*const X509) [*c]const ssl.ASN1_TIME;
    extern fn X509_get0_notBefore(x509: ?*const X509) [*c]const ssl.ASN1_TIME;
    extern fn X509_get0_serialNumber(x509: ?*const X509) [*c]const ssl.ASN1_INTEGER;
    extern fn X509_get_issuer_name(x509: ?*const X509) ?*X509.Name; // NOTE: was ?X509.Name
};
