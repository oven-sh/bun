// TLSv1.3 suites start with TLS_, and are the OpenSSL defaults, see:
//   https://www.openssl.org/docs/man1.1.1/man3/SSL_CTX_set_ciphersuites.html
#ifndef DEFAULT_CIPHER_LIST
#define DEFAULT_CIPHER_LIST \
                                 "ECDHE-RSA-AES128-GCM-SHA256:"     \
                                 "ECDHE-ECDSA-AES128-GCM-SHA256:"   \
                                 "ECDHE-RSA-AES256-GCM-SHA384:"     \
                                 "ECDHE-ECDSA-AES256-GCM-SHA384:"   \
                                 "ECDHE-RSA-AES128-SHA256:"         \
                                 "ECDHE-RSA-AES256-SHA384:"         \
                                 "HIGH:"                            \
                                 "!aNULL:"                          \
                                 "!eNULL:"                          \
                                 "!EXPORT:"                         \
                                 "!DES:"                            \
                                 "!RC4:"                            \
                                 "!MD5:"                            \
                                 "!PSK:"                            \
                                 "!SRP:"                            \
                                 "!CAMELLIA"
#endif

// BoringSSL does not support legacy DHE ciphers and dont support SSL_CTX_set_cipher_list (see https://github.com/envoyproxy/envoy/issues/8848#issuecomment-548672667)
// Node.js full list bellow

// In node.js they filter TLS_* ciphers and use SSL_CTX_set_cipher_list (TODO: Electron has a patch https://github.com/nodejs/node/issues/25890)
// if passed to SSL_CTX_set_cipher_list it will be filtered out and not used in BoringSSL
// "TLS_AES_256_GCM_SHA384:"          \
// "TLS_CHACHA20_POLY1305_SHA256:"    \
// "TLS_AES_128_GCM_SHA256:"          \

// Supported by BoringSSL:
// "ECDHE-RSA-AES128-GCM-SHA256:"     \
// "ECDHE-ECDSA-AES128-GCM-SHA256:"   \
// "ECDHE-RSA-AES256-GCM-SHA384:"     \
// "ECDHE-ECDSA-AES256-GCM-SHA384:"   \
// "ECDHE-RSA-AES128-SHA256:"         \
// "ECDHE-RSA-AES256-SHA384:"         \

// Not supported by BoringSSL:
// "ECDHE-RSA-AES256-SHA256:"         \
// "DHE-RSA-AES128-GCM-SHA256:"       \
// "DHE-RSA-AES128-SHA256:"           \
// "DHE-RSA-AES256-SHA384:"           \
// "DHE-RSA-AES256-SHA256:"           \


// Also present in Node.js and supported by BoringSSL:
// "HIGH:"                            \
// "!aNULL:"                          \
// "!eNULL:"                          \
// "!EXPORT:"                         \
// "!DES:"                            \
// "!RC4:"                            \
// "!MD5:"                            \
// "!PSK:"                            \
// "!SRP:"                            \
// "!CAMELLIA"