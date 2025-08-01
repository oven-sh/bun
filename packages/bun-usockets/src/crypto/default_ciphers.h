// TLSv1.3 suites start with TLS_, and are the OpenSSL defaults, see:
//   https://www.openssl.org/docs/man1.1.1/man3/SSL_CTX_set_ciphersuites.html
#define DEFAULT_CIPHER_LIST \
                                 "TLS_AES_256_GCM_SHA384:"          \
                                 "TLS_CHACHA20_POLY1305_SHA256:"    \
                                 "TLS_AES_128_GCM_SHA256:"          \
                                 "ECDHE-RSA-AES128-GCM-SHA256:"     \
                                 "ECDHE-ECDSA-AES128-GCM-SHA256:"   \
                                 "ECDHE-RSA-AES256-GCM-SHA384:"     \
                                 "ECDHE-ECDSA-AES256-GCM-SHA384:"   \
                                 "DHE-RSA-AES128-GCM-SHA256:"       \
                                 "ECDHE-RSA-AES128-SHA256:"         \
                                 "DHE-RSA-AES128-SHA256:"           \
                                 "ECDHE-RSA-AES256-SHA384:"         \
                                 "DHE-RSA-AES256-SHA384:"           \
                                 "ECDHE-RSA-AES256-SHA256:"         \
                                 "DHE-RSA-AES256-SHA256:"           \
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