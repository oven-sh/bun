/*
 * Authored by Alex Hultman, 2018-2019.
 * Intellectual property of third-party.

 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 *     http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
// clang-format off
#if (defined(LIBUS_USE_OPENSSL) || defined(LIBUS_USE_WOLFSSL))


#include "internal/internal.h"
#include "libusockets.h"
#include <string.h>

/* These are in sni_tree.cpp */
void *sni_new();
void sni_free(void *sni, void (*cb)(void *));
int sni_add(void *sni, const char *hostname, void *user);
void *sni_remove(void *sni, const char *hostname);
void *sni_find(void *sni, const char *hostname);

/* This module contains the entire OpenSSL implementation
 * of the SSL socket and socket context interfaces. */
#ifdef LIBUS_USE_OPENSSL
#include <openssl/bio.h>
#include <openssl/dh.h>
#include <openssl/err.h>
#include <openssl/ssl.h>
#elif LIBUS_USE_WOLFSSL
#include <wolfssl/openssl/bio.h>
#include <wolfssl/openssl/dh.h>
#include <wolfssl/openssl/err.h>
#include <wolfssl/openssl/ssl.h>
#include <wolfssl/options.h>
#endif

#include "./root_certs.h"

/* These are in root_certs.cpp */
extern X509_STORE *us_get_default_ca_store();

struct loop_ssl_data {
  char *ssl_read_input, *ssl_read_output;
  unsigned int ssl_read_input_length;
  unsigned int ssl_read_input_offset;

  struct us_socket_t *ssl_socket;

  int last_write_was_msg_more;
  int msg_more;

  BIO *shared_rbio;
  BIO *shared_wbio;
  BIO_METHOD *shared_biom;
};

struct us_internal_ssl_socket_context_t {
  struct us_socket_context_t sc;

  // this thing can be shared with other socket contexts via socket transfer!
  // maybe instead of holding once you hold many, a vector or set
  // when a socket that belongs to another socket context transfers to a new
  // socket context
  SSL_CTX *ssl_context;
  int is_parent;
  /* These decorate the base implementation */
  struct us_internal_ssl_socket_t *(*on_open)(struct us_internal_ssl_socket_t *,
                                              int is_client, char *ip,
                                              int ip_length);
  struct us_internal_ssl_socket_t *(*on_data)(struct us_internal_ssl_socket_t *,
                                              char *data, int length);
  struct us_internal_ssl_socket_t *(*on_writable)(
      struct us_internal_ssl_socket_t *);
  struct us_internal_ssl_socket_t *(*on_close)(
      struct us_internal_ssl_socket_t *, int code, void *reason);

  struct us_internal_ssl_socket_t *(*on_timeout)(
      struct us_internal_ssl_socket_t *);
      struct us_internal_ssl_socket_t *(*on_long_timeout)(struct us_internal_ssl_socket_t *);

  /* Called for missing SNI hostnames, if not NULL */
  void (*on_server_name)(struct us_internal_ssl_socket_context_t *,
                         const char *hostname);

  /* Pointer to sni tree, created when the context is created and freed likewise
   * when freed */
  void *sni;

  us_internal_on_handshake_t on_handshake;
  void *handshake_data;
};

// same here, should or shouldn't it
enum {
  HANDSHAKE_PENDING = 0,
  HANDSHAKE_COMPLETED = 1,
  HANDSHAKE_RENEGOTIATION_PENDING = 2,
};

struct us_internal_ssl_socket_t {
  struct us_socket_t s;
  SSL *ssl; // this _must_ be the first member after s
  unsigned int ssl_write_wants_read : 1; // we use this for now
  unsigned int ssl_read_wants_write : 1;
  unsigned int handshake_state : 2;
  unsigned int fatal_error : 1;
};

int passphrase_cb(char *buf, int size, int rwflag, void *u) {
  const char *passphrase = (const char *)u;
  size_t passphrase_length = strlen(passphrase);
  memcpy(buf, passphrase, passphrase_length);
  // put null at end? no?
  return (int)passphrase_length;
}

int BIO_s_custom_create(BIO *bio) {
  BIO_set_init(bio, 1);
  return 1;
}

long BIO_s_custom_ctrl(BIO *bio, int cmd, long num, void *user) {
  switch (cmd) {
  case BIO_CTRL_FLUSH:
    return 1;
  default:
    return 0;
  }
}

int BIO_s_custom_write(BIO *bio, const char *data, int length) {
  struct loop_ssl_data *loop_ssl_data =
      (struct loop_ssl_data *)BIO_get_data(bio);

  loop_ssl_data->last_write_was_msg_more =
      loop_ssl_data->msg_more || length == 16413;
  int written = us_socket_write(0, loop_ssl_data->ssl_socket, data, length,
                                loop_ssl_data->last_write_was_msg_more);

  BIO_clear_retry_flags(bio);
  if (!written) {
    BIO_set_retry_write(bio);
    return -1;
  }

  return written;
}

int BIO_s_custom_read(BIO *bio, char *dst, int length) {
  struct loop_ssl_data *loop_ssl_data =
      (struct loop_ssl_data *)BIO_get_data(bio);

  BIO_clear_retry_flags(bio);
  if (!loop_ssl_data->ssl_read_input_length) {
    BIO_set_retry_read(bio);
    return -1;
  }

  if ((unsigned int)length > loop_ssl_data->ssl_read_input_length) {
    length = loop_ssl_data->ssl_read_input_length;
  }

  memcpy(dst,
         loop_ssl_data->ssl_read_input + loop_ssl_data->ssl_read_input_offset,
         length);

  loop_ssl_data->ssl_read_input_offset += length;
  loop_ssl_data->ssl_read_input_length -= length;
  return length;
}


struct loop_ssl_data * us_internal_set_loop_ssl_data(struct us_internal_ssl_socket_t *s) {
   // note: this context can change when we adopt the socket!
  struct us_internal_ssl_socket_context_t *context =
      (struct us_internal_ssl_socket_context_t *)us_socket_context(0, &s->s);

  struct us_loop_t *loop = us_socket_context_loop(0, &context->sc);
  struct loop_ssl_data *loop_ssl_data =
      (struct loop_ssl_data *)loop->data.ssl_data;

  // note: if we put data here we should never really clear it (not in write
  // either, it still should be available for SSL_write to read from!)

  loop_ssl_data->ssl_read_input_length = 0;
  loop_ssl_data->ssl_read_input_offset = 0;
  loop_ssl_data->ssl_socket = &s->s;
  loop_ssl_data->msg_more = 0;
  return loop_ssl_data;
}

struct us_internal_ssl_socket_t *ssl_on_open(struct us_internal_ssl_socket_t *s,
                                             int is_client, char *ip,
                                             int ip_length, const char* sni) {

  struct us_internal_ssl_socket_context_t *context =
      (struct us_internal_ssl_socket_context_t *)us_socket_context(0, &s->s);

  struct loop_ssl_data *loop_ssl_data = us_internal_set_loop_ssl_data(s);

  s->ssl = SSL_new(context->ssl_context);
  s->ssl_write_wants_read = 0;
  s->ssl_read_wants_write = 0;
  s->fatal_error = 0;
  s->handshake_state = HANDSHAKE_PENDING;
  

  SSL_set_bio(s->ssl, loop_ssl_data->shared_rbio, loop_ssl_data->shared_wbio);
// if we allow renegotiation, we need to set the mode here
// https://github.com/oven-sh/bun/issues/6197
// https://github.com/oven-sh/bun/issues/5363
// renegotiation is only valid for <= TLS1_2_VERSION
// this can be a DoS vector for servers, so we enable it using a limit
// we do not use ssl_renegotiate_freely, since ssl_renegotiate_explicit is
// more performant when using BoringSSL


  BIO_up_ref(loop_ssl_data->shared_rbio);
  BIO_up_ref(loop_ssl_data->shared_wbio);

  if (is_client) {
    SSL_set_renegotiate_mode(s->ssl, ssl_renegotiate_explicit);
    SSL_set_connect_state(s->ssl);

    if (sni) {
      SSL_set_tlsext_host_name(s->ssl, sni);
    }
  } else {
    SSL_set_accept_state(s->ssl);
    // we do not allow renegotiation on the server side (should be the default for BoringSSL, but we set to make openssl compatible)
    SSL_set_renegotiate_mode(s->ssl, ssl_renegotiate_never);
  }

  struct us_internal_ssl_socket_t *result =
      (struct us_internal_ssl_socket_t *)context->on_open(s, is_client, ip,
                                                          ip_length);

  // Hello Message!
  // always handshake after open
  // this is important because some servers/clients can get stuck waiting for
  // this
  us_internal_update_handshake(s);

  return result;
}

/// @brief Complete the shutdown or do a fast shutdown when needed, this should only be called before closing the socket
/// @param s 
int us_internal_handle_shutdown(struct us_internal_ssl_socket_t *s, int force_fast_shutdown) {
  // if we are already shutdown or in the middle of a handshake we dont need to do anything
  // Scenarios:
  // 1 - SSL is not initialized yet (null)
  // 2 - socket is alread shutdown
  // 3 - we already sent a shutdown
  // 4 - we are in the middle of a handshake
  // 5 - we received a fatal error
  if(us_internal_ssl_socket_is_shut_down(s) || s->fatal_error || !SSL_is_init_finished(s->ssl)) return 1;
    
  // we are closing the socket but did not sent a shutdown yet
  int state = SSL_get_shutdown(s->ssl);
  int sent_shutdown = state & SSL_SENT_SHUTDOWN;
  int received_shutdown = state & SSL_RECEIVED_SHUTDOWN;
  // if we are missing a shutdown call, we need to do a fast shutdown here
  if(!sent_shutdown || !received_shutdown) {
    // make sure that the ssl loop data is set
    us_internal_set_loop_ssl_data(s);
    // Zero means that we should wait for the peer to close the connection
    // but we are already closing the connection so we do a fast shutdown here
    int ret = SSL_shutdown(s->ssl);
    if(ret == 0 && force_fast_shutdown) { 
      // do a fast shutdown (dont wait for peer)
      ret = SSL_shutdown(s->ssl);
    }
    if(ret < 0) {
      // we got some error here, but we dont care about it, we are closing the socket
      int err = SSL_get_error(s->ssl, ret);
      if (err == SSL_ERROR_SSL || err == SSL_ERROR_SYSCALL) {
        // clear
        ERR_clear_error();
        s->fatal_error = 1;
        // Fatal error occurred, we should close the socket imeadiatly
        return 1;
      }
      if(err == SSL_ERROR_WANT_READ || err == SSL_ERROR_WANT_WRITE) {
        // We are waiting to be readable or writable this will come in SSL_read to complete the shutdown
        // if we are forcing a fast shutdown we should return 1 here to imeadiatly close the socket
        // Scenarios:
        // 1 - We called abort but the socket is not writable or reable anymore (force_fast_shutdown = 1)
        // 2 - We called close but wanna to wait until close_notify is received (force_fast_shutdown = 0)
        return force_fast_shutdown ? 1 : 0;
      }
      // If we error we probably do not even start the first handshake or have a critical error so just close the socket
      // Scenarios:
      // 1 - We abort the connection to fast and we did not even start the first handshake
      // 2 - SSL is in a broken state
      // 3 - SSL is not broken but is in a state that we cannot recover from
      s->fatal_error = 1;
      return 1;
    }
    return ret == 1;
  }
  return 1;
}

void us_internal_on_ssl_handshake(
    struct us_internal_ssl_socket_context_t *context,
    void (*on_handshake)(struct us_internal_ssl_socket_t *, int success,
                         struct us_bun_verify_error_t verify_error,
                         void *custom_data),
    void *custom_data) {
  context->on_handshake = on_handshake;
  context->handshake_data = custom_data;
}

int us_internal_ssl_socket_is_closed(struct us_internal_ssl_socket_t *s) {
  return us_socket_is_closed(0, &s->s);
}

struct us_internal_ssl_socket_t *
us_internal_ssl_socket_close(struct us_internal_ssl_socket_t *s, int code,
                             void *reason) {

  // check if we are already closed
  if (us_internal_ssl_socket_is_closed(s)) return s;
  
  if (s->handshake_state != HANDSHAKE_COMPLETED) {
    // if we have some pending handshake we cancel it and try to check the
    // latest handshake error this way we will always call on_handshake with the
    // latest error before closing this should always call
    // secureConnection/secure before close if we remove this here, we will need
    // to do this check on every on_close event on sockets, fetch etc and will
    // increase complexity on a lot of places
    us_internal_trigger_handshake_callback(s, 0);
  }

  // if we are in the middle of a close_notify we need to finish it (code != 0 forces a fast shutdown)
  int can_close = us_internal_handle_shutdown(s, code != 0);

  // only close the socket if we are not in the middle of a handshake
  if(can_close) {
    return (struct us_internal_ssl_socket_t *)us_socket_close(0, (struct us_socket_t *)s, code, reason);
  }
  return s;
}

void us_internal_trigger_handshake_callback(struct us_internal_ssl_socket_t *s,
                                            int success) {
  struct us_internal_ssl_socket_context_t *context =
      (struct us_internal_ssl_socket_context_t *)us_socket_context(0, &s->s);

  // always set the handshake state to completed
  s->handshake_state = HANDSHAKE_COMPLETED;

  if (context->on_handshake != NULL) {
    struct us_bun_verify_error_t verify_error = us_internal_verify_error(s);
    context->on_handshake(s, success, verify_error, context->handshake_data);
  }
}
int us_internal_ssl_renegotiate(struct us_internal_ssl_socket_t *s) {
  // handle renegotation here since we are using ssl_renegotiate_explicit

  // if is a server and we have no pending renegotiation we can check
  // the limits
  s->handshake_state = HANDSHAKE_RENEGOTIATION_PENDING;

  if (!SSL_renegotiate(s->ssl)) {
    // we failed to renegotiate
    us_internal_trigger_handshake_callback(s, 0);
    return 0;
  }
  return 1;
}

void us_internal_update_handshake(struct us_internal_ssl_socket_t *s) {

  // nothing todo here, renegotiation must be handled in SSL_read
  if (s->handshake_state != HANDSHAKE_PENDING)
    return;
  
  if (us_internal_ssl_socket_is_closed(s) || us_internal_ssl_socket_is_shut_down(s) ||
     (s->ssl && SSL_get_shutdown(s->ssl) & SSL_RECEIVED_SHUTDOWN)) {

    us_internal_trigger_handshake_callback(s, 0);
    return;
  }

  int result = SSL_do_handshake(s->ssl);

  if (SSL_get_shutdown(s->ssl) & SSL_RECEIVED_SHUTDOWN) {
    us_internal_ssl_socket_close(s, 0, NULL);
    return;
  }

  if (result <= 0) {
    int err = SSL_get_error(s->ssl, result);
    // as far as I know these are the only errors we want to handle
    if (err != SSL_ERROR_WANT_READ && err != SSL_ERROR_WANT_WRITE) {
      // clear per thread error queue if it may contain something
      if (err == SSL_ERROR_SSL || err == SSL_ERROR_SYSCALL) {
        ERR_clear_error();
        s->fatal_error = 1;
      }
      us_internal_trigger_handshake_callback(s, 0);
    
      return;
    }
    s->handshake_state = HANDSHAKE_PENDING;
    s->ssl_write_wants_read = 1;

    return;
  }
  // success
  us_internal_trigger_handshake_callback(s, 1);
  s->ssl_write_wants_read = 1;
}

struct us_internal_ssl_socket_t *
ssl_on_close(struct us_internal_ssl_socket_t *s, int code, void *reason) {
  struct us_internal_ssl_socket_context_t *context =
      (struct us_internal_ssl_socket_context_t *)us_socket_context(0, &s->s);

  us_internal_set_loop_ssl_data(s);
  struct us_internal_ssl_socket_t * ret = context->on_close(s, code, reason);
  SSL_free(s->ssl); // free SSL after on_close
  s->ssl = NULL; // set to NULL
  return ret;
}

struct us_internal_ssl_socket_t * ssl_on_timeout(struct us_internal_ssl_socket_t *s) {
  struct us_internal_ssl_socket_context_t *context =
      (struct us_internal_ssl_socket_context_t *)us_socket_context(0, &s->s);

  us_internal_set_loop_ssl_data(s);
  return context->on_timeout(s);
}

struct us_internal_ssl_socket_t * ssl_on_long_timeout(struct us_internal_ssl_socket_t *s) {
  struct us_internal_ssl_socket_context_t *context =
      (struct us_internal_ssl_socket_context_t *)us_socket_context(0, &s->s);

  us_internal_set_loop_ssl_data(s);
  return context->on_long_timeout(s);
}

struct us_internal_ssl_socket_t *
ssl_on_end(struct us_internal_ssl_socket_t *s) {
  us_internal_set_loop_ssl_data(s);
  // whatever state we are in, a TCP FIN is always an answered shutdown
  return us_internal_ssl_socket_close(s, 0, NULL);
}

// this whole function needs a complete clean-up
struct us_internal_ssl_socket_t *ssl_on_data(struct us_internal_ssl_socket_t *s,
                                             void *data, int length) {

  // note: this context can change when we adopt the socket!
  struct us_internal_ssl_socket_context_t *context =
      (struct us_internal_ssl_socket_context_t *)us_socket_context(0, &s->s);

  struct loop_ssl_data *loop_ssl_data = us_internal_set_loop_ssl_data(s);

  // note: if we put data here we should never really clear it (not in write
  // either, it still should be available for SSL_write to read from!)
  loop_ssl_data->ssl_read_input = data;
  loop_ssl_data->ssl_read_input_length = length;

  if (us_internal_ssl_socket_is_closed(s)) {
    return NULL;
  }

  if (us_internal_ssl_socket_is_shut_down(s)) {
      us_internal_ssl_socket_close(s, 0, NULL);
      return NULL;
  }

  // bug checking: this loop needs a lot of attention and clean-ups and
  // check-ups
  int read = 0;
restart:
  // read until shutdown
  while (1) {
    int just_read = SSL_read(s->ssl,
                             loop_ssl_data->ssl_read_output +
                                 LIBUS_RECV_BUFFER_PADDING + read,
                             LIBUS_RECV_BUFFER_LENGTH - read);
    
    if (just_read <= 0) {
      int err = SSL_get_error(s->ssl, just_read);
      // as far as I know these are the only errors we want to handle
      if (err != SSL_ERROR_WANT_READ && err != SSL_ERROR_WANT_WRITE) {
        if (err == SSL_ERROR_WANT_RENEGOTIATE) {
          if (us_internal_ssl_renegotiate(s)) {
            // ok, we are done here, we need to call SSL_read again
            // this dont mean that we are done with the handshake renegotiation
            // we need to call SSL_read again
            continue;
          }
          // clean and close renegotiation failed
          err = SSL_ERROR_SSL;
        } else if (err == SSL_ERROR_ZERO_RETURN) {
          // Remotely-Initiated Shutdown
          // See: https://www.openssl.org/docs/manmaster/man3/SSL_shutdown.html

          if (read) {
            context =
                (struct us_internal_ssl_socket_context_t *)us_socket_context(
                    0, &s->s);

            s = context->on_data(
                s, loop_ssl_data->ssl_read_output + LIBUS_RECV_BUFFER_PADDING,
                read);
            if (!s || us_internal_ssl_socket_is_closed(s)) {
              return NULL;  // stop processing data
            }
          }
          // terminate connection here
          us_internal_ssl_socket_close(s, 0, NULL);
          return NULL;  // stop processing data
        }

        if (err == SSL_ERROR_SSL || err == SSL_ERROR_SYSCALL) {
          // clear per thread error queue if it may contain something
          ERR_clear_error();
          s->fatal_error = 1;
        }

        // terminate connection here
        us_internal_ssl_socket_close(s, 0, NULL);
        return NULL; // stop processing data
      } else {
        // emit the data we have and exit

        if (err == SSL_ERROR_WANT_WRITE) {
          // here we need to trigger writable event next ssl_read!
          s->ssl_read_wants_write = 1;
        }

        // assume we emptied the input buffer fully or error here as well!
        if (loop_ssl_data->ssl_read_input_length) {
          return us_internal_ssl_socket_close(s, 0, NULL);
        }

        // cannot emit zero length to app
        if (!read) {
          break;
        }

        context = (struct us_internal_ssl_socket_context_t *)us_socket_context(
            0, &s->s);

        s = context->on_data(
            s, loop_ssl_data->ssl_read_output + LIBUS_RECV_BUFFER_PADDING,
            read);
        if (!s || us_internal_ssl_socket_is_closed(s)) {
          return NULL; // stop processing data
        }

        break;
      }
    } else if (s->handshake_state == HANDSHAKE_RENEGOTIATION_PENDING) {
      // renegotiation ended successfully call on_handshake
      us_internal_trigger_handshake_callback(s, 1);
    }

    read += just_read;

    // at this point we might be full and need to emit the data to application
    // and start over
    if (read == LIBUS_RECV_BUFFER_LENGTH) {

      context = (struct us_internal_ssl_socket_context_t *)us_socket_context(
          0, &s->s);

      // emit data and restart
      s = context->on_data(
          s, loop_ssl_data->ssl_read_output + LIBUS_RECV_BUFFER_PADDING, read);
      if (!s || us_internal_ssl_socket_is_closed(s)) {
        return NULL;
      }

      read = 0;
      goto restart;
    }
  }
  // Trigger writable if we failed last SSL_write with SSL_ERROR_WANT_READ 
  // If we failed SSL_read because we need to write more data (SSL_ERROR_WANT_WRITE) we are not going to trigger on_writable, we will wait until the next on_data or on_writable event
  // SSL_read will try to flush the write buffer and if fails with SSL_ERROR_WANT_WRITE means the socket is not in a writable state anymore and only makes sense to trigger on_writable if we can write more data
  // Otherwise we possible would trigger on_writable -> on_data event in a recursive loop
  if (s->ssl_write_wants_read && !s->ssl_read_wants_write) {
    s->ssl_write_wants_read = 0;

    // make sure to update context before we call (context can change if the
    // user adopts the socket!)
    context =
        (struct us_internal_ssl_socket_context_t *)us_socket_context(0, &s->s);

    s = (struct us_internal_ssl_socket_t *)context->sc.on_writable(
        &s->s); // cast here!
    // if we are closed here, then exit
    if (!s || us_internal_ssl_socket_is_closed(s)) {
      return NULL;
    }
  }

  return s;
}

struct us_internal_ssl_socket_t *
ssl_on_writable(struct us_internal_ssl_socket_t *s) {
  us_internal_set_loop_ssl_data(s);
  us_internal_update_handshake(s);

  struct us_internal_ssl_socket_context_t *context =
      (struct us_internal_ssl_socket_context_t *)us_socket_context(0, &s->s);

  // todo: cork here so that we efficiently output both from reading and from
  // writing?
  if (s->ssl_read_wants_write) {
    s->ssl_read_wants_write = 0;

    // make sure to update context before we call (context can change if the
    // user adopts the socket!)
    context =
        (struct us_internal_ssl_socket_context_t *)us_socket_context(0, &s->s);

    // if this one fails to write data, it sets ssl_read_wants_write again
    s = (struct us_internal_ssl_socket_t *)context->sc.on_data(&s->s, 0,
                                                               0); // cast here!
  }
  // Do not call on_writable if the socket is closed.
  // on close means the socket data is no longer accessible
  if (!s || us_internal_ssl_socket_is_closed(s) || us_internal_ssl_socket_is_shut_down(s)) {
    return s;
  }

  if (s->handshake_state == HANDSHAKE_COMPLETED) {
    s = context->on_writable(s);
  }

  return s;
}

/* Lazily inits loop ssl data first time */
void us_internal_init_loop_ssl_data(struct us_loop_t *loop) {
  if (!loop->data.ssl_data) {
    struct loop_ssl_data *loop_ssl_data =
        us_calloc(1, sizeof(struct loop_ssl_data));
    loop_ssl_data->ssl_read_input_length = 0;
    loop_ssl_data->ssl_read_input_offset = 0;
    loop_ssl_data->last_write_was_msg_more = 0;
    loop_ssl_data->msg_more = 0;

    loop_ssl_data->ssl_read_output =
        us_malloc(LIBUS_RECV_BUFFER_LENGTH + LIBUS_RECV_BUFFER_PADDING * 2);

    OPENSSL_init_ssl(0, NULL);

    loop_ssl_data->shared_biom = BIO_meth_new(BIO_TYPE_MEM, "µS BIO");
    BIO_meth_set_create(loop_ssl_data->shared_biom, BIO_s_custom_create);
    BIO_meth_set_write(loop_ssl_data->shared_biom, BIO_s_custom_write);
    BIO_meth_set_read(loop_ssl_data->shared_biom, BIO_s_custom_read);
    BIO_meth_set_ctrl(loop_ssl_data->shared_biom, BIO_s_custom_ctrl);

    loop_ssl_data->shared_rbio = BIO_new(loop_ssl_data->shared_biom);
    loop_ssl_data->shared_wbio = BIO_new(loop_ssl_data->shared_biom);
    BIO_set_data(loop_ssl_data->shared_rbio, loop_ssl_data);
    BIO_set_data(loop_ssl_data->shared_wbio, loop_ssl_data);

    loop->data.ssl_data = loop_ssl_data;
  }
}

/* Called by loop free, clears any loop ssl data */
void us_internal_free_loop_ssl_data(struct us_loop_t *loop) {
  struct loop_ssl_data *loop_ssl_data =
      (struct loop_ssl_data *)loop->data.ssl_data;

  if (loop_ssl_data) {
    us_free(loop_ssl_data->ssl_read_output);

    BIO_free(loop_ssl_data->shared_rbio);
    BIO_free(loop_ssl_data->shared_wbio);

    BIO_meth_free(loop_ssl_data->shared_biom);

    us_free(loop_ssl_data);
  }
}

// we throttle reading data for ssl sockets that are in init state. here we
// actually use the kernel buffering to our advantage
int ssl_is_low_prio(struct us_internal_ssl_socket_t *s) {
  /* We use SSL_in_before() instead of SSL_in_init(), because only the first
   * step is CPU intensive, and we want to speed up the rest of connection
   * establishing if the CPU intensive work is already done, so fully
   * established connections increase lineary over time under high load */
  return SSL_in_init(s->ssl);
}

/* Per-context functions */
void *us_internal_ssl_socket_context_get_native_handle(
    struct us_internal_ssl_socket_context_t *context) {
  return context->ssl_context;
}

struct us_internal_ssl_socket_context_t *
us_internal_create_child_ssl_socket_context(
    struct us_internal_ssl_socket_context_t *context, int context_ext_size) {
  /* Create a new non-SSL context */
  struct us_socket_context_options_t options = {0};
  struct us_internal_ssl_socket_context_t *child_context =
      (struct us_internal_ssl_socket_context_t *)us_create_socket_context(
          0, context->sc.loop,
          sizeof(struct us_internal_ssl_socket_context_t) + context_ext_size,
          options);

  /* The only thing we share is SSL_CTX */
  child_context->ssl_context = context->ssl_context;
  child_context->is_parent = 0;

  return child_context;
}

/* Common function for creating a context from options.
 * We must NOT free a SSL_CTX with only SSL_CTX_free! Also free any password */
void free_ssl_context(SSL_CTX *ssl_context) {
  if (!ssl_context) {
    return;
  }

  /* If we have set a password string, free it here */
  void *password = SSL_CTX_get_default_passwd_cb_userdata(ssl_context);
  /* OpenSSL returns NULL if we have no set password */
  us_free(password);

  SSL_CTX_free(ssl_context);
}

/* This function should take any options and return SSL_CTX - which has to be
 * free'd with our destructor function - free_ssl_context() */
SSL_CTX *
create_ssl_context_from_options(struct us_socket_context_options_t options) {
  /* Create the context */
  SSL_CTX *ssl_context = SSL_CTX_new(TLS_method());

  /* Default options we rely on - changing these will break our logic */
  SSL_CTX_set_read_ahead(ssl_context, 1);
  /* we should always accept moving write buffer so we can retry writes with a
   * buffer allocated in a different address */
  SSL_CTX_set_mode(ssl_context, SSL_MODE_ACCEPT_MOVING_WRITE_BUFFER);

  /* Anything below TLS 1.2 is disabled */
  SSL_CTX_set_min_proto_version(ssl_context, TLS1_2_VERSION);

  /* The following are helpers. You may easily implement whatever you want by
   * using the native handle directly */

  /* Important option for lowering memory usage, but lowers performance slightly
   */
  if (options.ssl_prefer_low_memory_usage) {
    SSL_CTX_set_mode(ssl_context, SSL_MODE_RELEASE_BUFFERS);
  }

  if (options.passphrase) {
    #ifdef _WIN32
    /* When freeing the CTX we need to check
     * SSL_CTX_get_default_passwd_cb_userdata and free it if set */
    SSL_CTX_set_default_passwd_cb_userdata(ssl_context,
                                           (void *)_strdup(options.passphrase));
    SSL_CTX_set_default_passwd_cb(ssl_context, passphrase_cb);

    #else
    /* When freeing the CTX we need to check
     * SSL_CTX_get_default_passwd_cb_userdata and free it if set */
    SSL_CTX_set_default_passwd_cb_userdata(ssl_context,
                                           (void *)strdup(options.passphrase));
    SSL_CTX_set_default_passwd_cb(ssl_context, passphrase_cb);
    #endif
  }

  /* This one most probably do not need the cert_file_name string to be kept
   * alive */
  if (options.cert_file_name) {
    if (SSL_CTX_use_certificate_chain_file(ssl_context,
                                           options.cert_file_name) != 1) {
      free_ssl_context(ssl_context);
      return NULL;
    }
  }

  /* Same as above - we can discard this string afterwards I suppose */
  if (options.key_file_name) {
    if (SSL_CTX_use_PrivateKey_file(ssl_context, options.key_file_name,
                                    SSL_FILETYPE_PEM) != 1) {
      free_ssl_context(ssl_context);
      return NULL;
    }
  }

  if (options.ca_file_name) {
    STACK_OF(X509_NAME) * ca_list;
    ca_list = SSL_load_client_CA_file(options.ca_file_name);
    if (ca_list == NULL) {
      free_ssl_context(ssl_context);
      return NULL;
    }
    SSL_CTX_set_client_CA_list(ssl_context, ca_list);
    if (SSL_CTX_load_verify_locations(ssl_context, options.ca_file_name,
                                      NULL) != 1) {
      free_ssl_context(ssl_context);
      return NULL;
    }
    SSL_CTX_set_verify(ssl_context, SSL_VERIFY_PEER, NULL);
  }

  if (options.dh_params_file_name) {
    /* Set up ephemeral DH parameters. */
    DH *dh_2048 = NULL;
    FILE *paramfile;
    paramfile = fopen(options.dh_params_file_name, "r");

    if (paramfile) {
      dh_2048 = PEM_read_DHparams(paramfile, NULL, NULL, NULL);
      fclose(paramfile);
    } else {
      free_ssl_context(ssl_context);
      return NULL;
    }

    if (dh_2048 == NULL) {
      free_ssl_context(ssl_context);
      return NULL;
    }

    const long set_tmp_dh = SSL_CTX_set_tmp_dh(ssl_context, dh_2048);
    DH_free(dh_2048);

    if (set_tmp_dh != 1) {
      free_ssl_context(ssl_context);
      return NULL;
    }

    /* OWASP Cipher String 'A+'
     * (https://www.owasp.org/index.php/TLS_Cipher_String_Cheat_Sheet) */
    if (SSL_CTX_set_cipher_list(
            ssl_context,
            "DHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-"
            "AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256") != 1) {
      free_ssl_context(ssl_context);
      return NULL;
    }
  }

  if (options.ssl_ciphers) {
    if (SSL_CTX_set_cipher_list(ssl_context, options.ssl_ciphers) != 1) {
      free_ssl_context(ssl_context);
      return NULL;
    }
  }

  if (ERR_peek_error() != 0) {
    free_ssl_context(ssl_context);
    return NULL;
  }

  /* This must be free'd with free_ssl_context, not SSL_CTX_free */
  return ssl_context;
}

int us_ssl_ctx_use_privatekey_content(SSL_CTX *ctx, const char *content,
                                      int type) {
  int reason_code, ret = 0;
  BIO *in;
  EVP_PKEY *pkey = NULL;
  in = BIO_new_mem_buf(content, strlen(content));
  if (in == NULL) {
    OPENSSL_PUT_ERROR(SSL, ERR_R_BUF_LIB);
    goto end;
  }

  if (type == SSL_FILETYPE_PEM) {
    reason_code = ERR_R_PEM_LIB;
    pkey = PEM_read_bio_PrivateKey(in, NULL, SSL_CTX_get_default_passwd_cb(ctx),
                                   SSL_CTX_get_default_passwd_cb_userdata(ctx));
  } else if (type == SSL_FILETYPE_ASN1) {
    reason_code = ERR_R_ASN1_LIB;
    pkey = d2i_PrivateKey_bio(in, NULL);
  } else {
    OPENSSL_PUT_ERROR(SSL, SSL_R_BAD_SSL_FILETYPE);
    goto end;
  }

  if (pkey == NULL) {
    OPENSSL_PUT_ERROR(SSL, reason_code);
    goto end;
  }
  ret = SSL_CTX_use_PrivateKey(ctx, pkey);
  EVP_PKEY_free(pkey);

end:
  BIO_free(in);
  return ret;
}

int add_ca_cert_to_ctx_store(SSL_CTX *ctx, const char *content,
                             X509_STORE *store) {

  X509 *x = NULL;
  ERR_clear_error(); // clear error stack for SSL_CTX_use_certificate()
  int count = 0;
  BIO *in = BIO_new_mem_buf(content, strlen(content));
  if (in == NULL) {
    OPENSSL_PUT_ERROR(SSL, ERR_R_BUF_LIB);
    goto end;
  }

  while ((x = PEM_read_bio_X509(in, NULL, SSL_CTX_get_default_passwd_cb(ctx),
                                SSL_CTX_get_default_passwd_cb_userdata(ctx)))) {

    X509_STORE_add_cert(store, x);

    if (!SSL_CTX_add_client_CA(ctx, x)) {
      X509_free(x);
      BIO_free(in);
      return 0;
    }
    count++;
    X509_free(x);
  }

end:
  BIO_free(in);

  return count > 0;
}

int us_ssl_ctx_use_certificate_chain(SSL_CTX *ctx, const char *content) {
  BIO *in;
  int ret = 0;
  X509 *x = NULL;

  ERR_clear_error(); // clear error stack for SSL_CTX_use_certificate()

  in = BIO_new_mem_buf(content, strlen(content));
  if (in == NULL) {
    OPENSSL_PUT_ERROR(SSL, ERR_R_BUF_LIB);
    goto end;
  }

  x = PEM_read_bio_X509_AUX(in, NULL, SSL_CTX_get_default_passwd_cb(ctx),
                            SSL_CTX_get_default_passwd_cb_userdata(ctx));
  if (x == NULL) {
    OPENSSL_PUT_ERROR(SSL, ERR_R_PEM_LIB);
    goto end;
  }

  ret = SSL_CTX_use_certificate(ctx, x);

  if (ERR_peek_error() != 0) {
    ret = 0; // Key/certificate mismatch doesn't imply ret==0 ...
  }

  if (ret) {
    // If we could set up our certificate, now proceed to the CA
    // certificates.
    X509 *ca;
    int r;
    uint32_t err;

    SSL_CTX_clear_chain_certs(ctx);

    while ((ca = PEM_read_bio_X509(
                in, NULL, SSL_CTX_get_default_passwd_cb(ctx),
                SSL_CTX_get_default_passwd_cb_userdata(ctx))) != NULL) {
      r = SSL_CTX_add0_chain_cert(ctx, ca);
      if (!r) {
        X509_free(ca);
        ret = 0;
        goto end;
      }
      // Note that we must not free r if it was successfully added to the chain
      // (while we must free the main certificate, since its reference count is
      // increased by SSL_CTX_use_certificate).
    }

    // When the while loop ends, it's usually just EOF.
    err = ERR_peek_last_error();
    if (ERR_GET_LIB(err) == ERR_LIB_PEM &&
        ERR_GET_REASON(err) == PEM_R_NO_START_LINE) {
      ERR_clear_error();
    } else {
      ret = 0; // some real error
    }
  }

end:
  X509_free(x);
  BIO_free(in);
  return ret;
}

const char *us_X509_error_code(long err) { // NOLINT(runtime/int)
  const char *code = "UNSPECIFIED";
#define CASE_X509_ERR(CODE)                                                    \
  case X509_V_ERR_##CODE:                                                      \
    code = #CODE;                                                              \
    break;
  switch (err) {
    // if you modify anything in here, *please* update the respective section in
    // doc/api/tls.md as well
    CASE_X509_ERR(UNABLE_TO_GET_ISSUER_CERT)
    CASE_X509_ERR(UNABLE_TO_GET_CRL)
    CASE_X509_ERR(UNABLE_TO_DECRYPT_CERT_SIGNATURE)
    CASE_X509_ERR(UNABLE_TO_DECRYPT_CRL_SIGNATURE)
    CASE_X509_ERR(UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY)
    CASE_X509_ERR(CERT_SIGNATURE_FAILURE)
    CASE_X509_ERR(CRL_SIGNATURE_FAILURE)
    CASE_X509_ERR(CERT_NOT_YET_VALID)
    CASE_X509_ERR(CERT_HAS_EXPIRED)
    CASE_X509_ERR(CRL_NOT_YET_VALID)
    CASE_X509_ERR(CRL_HAS_EXPIRED)
    CASE_X509_ERR(ERROR_IN_CERT_NOT_BEFORE_FIELD)
    CASE_X509_ERR(ERROR_IN_CERT_NOT_AFTER_FIELD)
    CASE_X509_ERR(ERROR_IN_CRL_LAST_UPDATE_FIELD)
    CASE_X509_ERR(ERROR_IN_CRL_NEXT_UPDATE_FIELD)
    CASE_X509_ERR(OUT_OF_MEM)
    CASE_X509_ERR(DEPTH_ZERO_SELF_SIGNED_CERT)
    CASE_X509_ERR(SELF_SIGNED_CERT_IN_CHAIN)
    CASE_X509_ERR(UNABLE_TO_GET_ISSUER_CERT_LOCALLY)
    CASE_X509_ERR(UNABLE_TO_VERIFY_LEAF_SIGNATURE)
    CASE_X509_ERR(CERT_CHAIN_TOO_LONG)
    CASE_X509_ERR(CERT_REVOKED)
    CASE_X509_ERR(INVALID_CA)
    CASE_X509_ERR(PATH_LENGTH_EXCEEDED)
    CASE_X509_ERR(INVALID_PURPOSE)
    CASE_X509_ERR(CERT_UNTRUSTED)
    CASE_X509_ERR(CERT_REJECTED)
    CASE_X509_ERR(HOSTNAME_MISMATCH)
  }
#undef CASE_X509_ERR
  return code;
}

long us_internal_verify_peer_certificate( // NOLINT(runtime/int)
    const SSL *ssl,
    long def) { // NOLINT(runtime/int)
  if (!ssl)
    return def;
  long err = def; // NOLINT(runtime/int)
  X509 *peer_cert = SSL_get_peer_certificate(ssl);
  if (peer_cert) {
    X509_free(peer_cert);
    err = SSL_get_verify_result(ssl);
  } else {
    const SSL_CIPHER *curr_cipher = SSL_get_current_cipher(ssl);

    const SSL_SESSION *sess = SSL_get_session(ssl);
    // Allow no-cert for PSK authentication in TLS1.2 and lower.
    // In TLS1.3 check that session was reused because TLS1.3 PSK
    // looks like session resumption.
    if ((curr_cipher && SSL_CIPHER_get_auth_nid(curr_cipher) == NID_auth_psk) ||
        (sess && SSL_SESSION_get_protocol_version(sess) == TLS1_3_VERSION &&
         SSL_session_reused(ssl))) {
      return X509_V_OK;
    }
  }
  return err;
}
struct us_bun_verify_error_t us_ssl_socket_verify_error_from_ssl(SSL *ssl) {

  long x509_verify_error = // NOLINT(runtime/int)
      us_internal_verify_peer_certificate(ssl,
                                          X509_V_ERR_UNABLE_TO_GET_ISSUER_CERT);

  if (x509_verify_error == X509_V_OK)
    return (struct us_bun_verify_error_t){
        .error = x509_verify_error, .code = NULL, .reason = NULL};

  const char *reason = X509_verify_cert_error_string(x509_verify_error);
  const char *code = us_X509_error_code(x509_verify_error);

  return (struct us_bun_verify_error_t){
      .error = x509_verify_error, .code = code, .reason = reason};
}

struct us_bun_verify_error_t
us_internal_verify_error(struct us_internal_ssl_socket_t *s) {
  if (!s->ssl || us_socket_is_closed(0, &s->s) || us_internal_ssl_socket_is_shut_down(s)) {
    return (struct us_bun_verify_error_t){
        .error = 0, .code = NULL, .reason = NULL};
  }

  return us_ssl_socket_verify_error_from_ssl(s->ssl);
}


int us_verify_callback(int preverify_ok, X509_STORE_CTX *ctx) {
  // From https://www.openssl.org/docs/man1.1.1/man3/SSL_verify_cb:
  //
  //   If VerifyCallback returns 1, the verification process is continued. If
  //   VerifyCallback always returns 1, the TLS/SSL handshake will not be
  //   terminated with respect to verification failures and the connection will
  //   be established. The calling process can however retrieve the error code
  //   of the last verification error using SSL_get_verify_result(3) or by
  //   maintaining its own error storage managed by VerifyCallback.
  //
  // Since we cannot perform I/O quickly enough with X509_STORE_CTX_ APIs in
  // this callback, we ignore all preverify_ok errors and let the handshake
  // continue. It is imperative that the user use Connection::VerifyError after
  // the 'secure' callback has been made.
  return 1;
}

SSL_CTX *create_ssl_context_from_bun_options(
    struct us_bun_socket_context_options_t options, 
    enum create_bun_socket_error_t *err) {
  ERR_clear_error();

  /* Create the context */
  SSL_CTX *ssl_context = SSL_CTX_new(TLS_method());

  /* Default options we rely on - changing these will break our logic */
  SSL_CTX_set_read_ahead(ssl_context, 1);
  /* we should always accept moving write buffer so we can retry writes with a
   * buffer allocated in a different address */
  SSL_CTX_set_mode(ssl_context, SSL_MODE_ACCEPT_MOVING_WRITE_BUFFER);

  /* Anything below TLS 1.2 is disabled */
  SSL_CTX_set_min_proto_version(ssl_context, TLS1_2_VERSION);

  /* The following are helpers. You may easily implement whatever you want by
   * using the native handle directly */

  /* Important option for lowering memory usage, but lowers performance slightly
   */
  if (options.ssl_prefer_low_memory_usage) {
    SSL_CTX_set_mode(ssl_context, SSL_MODE_RELEASE_BUFFERS);
  }

  if (options.passphrase) {
    #ifdef _WIN32
    /* When freeing the CTX we need to check
     * SSL_CTX_get_default_passwd_cb_userdata and free it if set */
    SSL_CTX_set_default_passwd_cb_userdata(ssl_context,
                                           (void *)_strdup(options.passphrase));
    SSL_CTX_set_default_passwd_cb(ssl_context, passphrase_cb);
    #else
    /* When freeing the CTX we need to check
     * SSL_CTX_get_default_passwd_cb_userdata and free it if set */
    SSL_CTX_set_default_passwd_cb_userdata(ssl_context,
                                           (void *)strdup(options.passphrase));
    SSL_CTX_set_default_passwd_cb(ssl_context, passphrase_cb);
    #endif
  }

  /* This one most probably do not need the cert_file_name string to be kept
   * alive */
  if (options.cert_file_name) {
    if (SSL_CTX_use_certificate_chain_file(ssl_context,
                                           options.cert_file_name) != 1) {
      free_ssl_context(ssl_context);
      return NULL;
    }
  } else if (options.cert && options.cert_count > 0) {
    for (unsigned int i = 0; i < options.cert_count; i++) {
      if (us_ssl_ctx_use_certificate_chain(ssl_context, options.cert[i]) != 1) {
        free_ssl_context(ssl_context);
        return NULL;
      }
    }
  }

  /* Same as above - we can discard this string afterwards I suppose */
  if (options.key_file_name) {
    if (SSL_CTX_use_PrivateKey_file(ssl_context, options.key_file_name,
                                    SSL_FILETYPE_PEM) != 1) {
      free_ssl_context(ssl_context);
      return NULL;
    }
  } else if (options.key && options.key_count > 0) {
    for (unsigned int i = 0; i < options.key_count; i++) {
      if (us_ssl_ctx_use_privatekey_content(ssl_context, options.key[i],
                                            SSL_FILETYPE_PEM) != 1) {
        free_ssl_context(ssl_context);
        return NULL;
      }
    }
  }

  if (options.ca_file_name) {
    SSL_CTX_set_cert_store(ssl_context, us_get_default_ca_store());

    STACK_OF(X509_NAME) * ca_list;
    ca_list = SSL_load_client_CA_file(options.ca_file_name);
    if (ca_list == NULL) {
      *err = CREATE_BUN_SOCKET_ERROR_LOAD_CA_FILE;
      free_ssl_context(ssl_context);
      return NULL;
    }

    SSL_CTX_set_client_CA_list(ssl_context, ca_list);
    if (SSL_CTX_load_verify_locations(ssl_context, options.ca_file_name,
                                      NULL) != 1) {
      *err = CREATE_BUN_SOCKET_ERROR_INVALID_CA_FILE;
      free_ssl_context(ssl_context);
      return NULL;
    }

    if (options.reject_unauthorized) {
      SSL_CTX_set_verify(ssl_context,
                         SSL_VERIFY_PEER | SSL_VERIFY_FAIL_IF_NO_PEER_CERT,
                         us_verify_callback);
    } else {
      SSL_CTX_set_verify(ssl_context, SSL_VERIFY_PEER, us_verify_callback);
    }

  } else if (options.ca && options.ca_count > 0) {
    X509_STORE *cert_store = NULL;

    for (unsigned int i = 0; i < options.ca_count; i++) {
      if (cert_store == NULL) {
        cert_store = us_get_default_ca_store();
        SSL_CTX_set_cert_store(ssl_context, cert_store);
      }

      if (!add_ca_cert_to_ctx_store(ssl_context, options.ca[i], cert_store)) {
        *err = CREATE_BUN_SOCKET_ERROR_INVALID_CA;
        free_ssl_context(ssl_context);
        return NULL;
      }

     // It may return spurious errors here.
    ERR_clear_error();

      if (options.reject_unauthorized) {
        SSL_CTX_set_verify(ssl_context,
                           SSL_VERIFY_PEER | SSL_VERIFY_FAIL_IF_NO_PEER_CERT,
                           us_verify_callback);
      } else {
        SSL_CTX_set_verify(ssl_context, SSL_VERIFY_PEER, us_verify_callback);
      }
    }
  } else {
    if (options.request_cert) {
      SSL_CTX_set_cert_store(ssl_context, us_get_default_ca_store());

      if (options.reject_unauthorized) {
        SSL_CTX_set_verify(ssl_context,
                           SSL_VERIFY_PEER | SSL_VERIFY_FAIL_IF_NO_PEER_CERT,
                           us_verify_callback);
      } else {
        SSL_CTX_set_verify(ssl_context, SSL_VERIFY_PEER, us_verify_callback);
      }
    }
  }
  if (options.dh_params_file_name) {
    /* Set up ephemeral DH parameters. */
    DH *dh_2048 = NULL;
    FILE *paramfile;
    paramfile = fopen(options.dh_params_file_name, "r");

    if (paramfile) {
      dh_2048 = PEM_read_DHparams(paramfile, NULL, NULL, NULL);
      fclose(paramfile);
    } else {
      free_ssl_context(ssl_context);
      return NULL;
    }

    if (dh_2048 == NULL) {
      free_ssl_context(ssl_context);
      return NULL;
    }

    const long set_tmp_dh = SSL_CTX_set_tmp_dh(ssl_context, dh_2048);
    DH_free(dh_2048);

    if (set_tmp_dh != 1) {
      free_ssl_context(ssl_context);
      return NULL;
    }

    /* OWASP Cipher String 'A+'
     * (https://www.owasp.org/index.php/TLS_Cipher_String_Cheat_Sheet) */
    if (SSL_CTX_set_cipher_list(
            ssl_context,
            "DHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-"
            "AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256") != 1) {
      free_ssl_context(ssl_context);
      return NULL;
    }
  }

  if (options.ssl_ciphers) {
    if (SSL_CTX_set_cipher_list(ssl_context, options.ssl_ciphers) != 1) {
      free_ssl_context(ssl_context);
      return NULL;
    }
  }

  if (options.secure_options) {
    SSL_CTX_set_options(ssl_context, options.secure_options);
  }

  /* This must be free'd with free_ssl_context, not SSL_CTX_free */
  return ssl_context;
}

/* Returns a servername's userdata if any */
void *us_internal_ssl_socket_context_find_server_name_userdata(
    struct us_internal_ssl_socket_context_t *context,
    const char *hostname_pattern) {

  /* We can use sni_find because looking up a "wildcard pattern" will match the
   * exact literal "wildcard pattern" first, before it matches by the very
   * wildcard itself, so it works fine (exact match is the only thing we care
   * for here) */
  SSL_CTX *ssl_context = sni_find(context->sni, hostname_pattern);

  if (ssl_context) {
    return SSL_CTX_get_ex_data(ssl_context, 0);
  }

  return 0;
}

/* Returns either nullptr or the previously set user data attached to this SSL's
 * selected SNI context */
void *
us_internal_ssl_socket_get_sni_userdata(struct us_internal_ssl_socket_t *s) {
  return SSL_CTX_get_ex_data(SSL_get_SSL_CTX(s->ssl), 0);
}

/* Todo: return error on failure? */
void us_internal_ssl_socket_context_add_server_name(
    struct us_internal_ssl_socket_context_t *context,
    const char *hostname_pattern, struct us_socket_context_options_t options,
    void *user) {

  /* Try and construct an SSL_CTX from options */
  SSL_CTX *ssl_context = create_ssl_context_from_options(options);

  if (ssl_context) {
    /* Attach the user data to this context */
    if (1 != SSL_CTX_set_ex_data(ssl_context, 0, user)) {
#if BUN_DEBUG
      printf("CANNOT SET EX DATA!\n");
      abort();
#endif
    }

    /* * We do not want to hold any nullptr's in our SNI tree */
    if (sni_add(context->sni, hostname_pattern, ssl_context)) {
      /* If we already had that name, ignore */
      free_ssl_context(ssl_context);
    }
  }
}

int us_bun_internal_ssl_socket_context_add_server_name(
    struct us_internal_ssl_socket_context_t *context,
    const char *hostname_pattern,
    struct us_bun_socket_context_options_t options, void *user) {

  /* Try and construct an SSL_CTX from options */
  enum create_bun_socket_error_t err = CREATE_BUN_SOCKET_ERROR_NONE;
  SSL_CTX *ssl_context = create_ssl_context_from_bun_options(options, &err);
  if (ssl_context == NULL) {
    return -1;
  }

  /* Attach the user data to this context */
  if (1 != SSL_CTX_set_ex_data(ssl_context, 0, user)) {
#if BUN_DEBUG
    printf("CANNOT SET EX DATA!\n");
    abort();
#endif
    return -1;
  }

  if (sni_add(context->sni, hostname_pattern, ssl_context)) {
    /* If we already had that name, ignore */
    free_ssl_context(ssl_context);
  }

  return 0;
}

void us_internal_ssl_socket_context_on_server_name(
    struct us_internal_ssl_socket_context_t *context,
    void (*cb)(struct us_internal_ssl_socket_context_t *,
               const char *hostname)) {
  context->on_server_name = cb;
}

void us_internal_ssl_socket_context_remove_server_name(
    struct us_internal_ssl_socket_context_t *context,
    const char *hostname_pattern) {

  /* The same thing must happen for sni_free, that's why we have a callback */
  SSL_CTX *sni_node_ssl_context =
      (SSL_CTX *)sni_remove(context->sni, hostname_pattern);
  free_ssl_context(sni_node_ssl_context);
}

/* Returns NULL or SSL_CTX. May call missing server name callback */
SSL_CTX *resolve_context(struct us_internal_ssl_socket_context_t *context,
                         const char *hostname) {

  /* Try once first */
  void *user = sni_find(context->sni, hostname);
  if (!user) {
    /* Emit missing hostname then try again */
    if (!context->on_server_name) {
      /* We have no callback registered, so fail */
      return NULL;
    }

    context->on_server_name(context, hostname);

    /* Last try */
    user = sni_find(context->sni, hostname);
  }

  return user;
}

// arg is context
int sni_cb(SSL *ssl, int *al, void *arg) {

  if (ssl) {
    const char *hostname = SSL_get_servername(ssl, TLSEXT_NAMETYPE_host_name);
    if (hostname && hostname[0]) {
      /* Try and resolve (match) required hostname with what we have registered
       */
      SSL_CTX *resolved_ssl_context = resolve_context(
          (struct us_internal_ssl_socket_context_t *)arg, hostname);
      if (resolved_ssl_context) {
        SSL_set_SSL_CTX(ssl, resolved_ssl_context);
      } else {
        /* Call a blocking callback notifying of missing context */
      }
    }

    return SSL_TLSEXT_ERR_OK;
  }

  /* Can we even come here ever? */
  return SSL_TLSEXT_ERR_NOACK;
}

struct us_internal_ssl_socket_context_t *us_internal_create_ssl_socket_context(
    struct us_loop_t *loop, int context_ext_size,
    struct us_socket_context_options_t options) {
  /* If we haven't initialized the loop data yet, do so .
   * This is needed because loop data holds shared OpenSSL data and
   * the function is also responsible for initializing OpenSSL */
  us_internal_init_loop_ssl_data(loop);

  /* First of all we try and create the SSL context from options */
  SSL_CTX *ssl_context = create_ssl_context_from_options(options);
  if (!ssl_context) {
    /* We simply fail early if we cannot even create the OpenSSL context */
    return NULL;
  }

  /* Otherwise ee continue by creating a non-SSL context, but with larger ext to
   * hold our SSL stuff */
  struct us_internal_ssl_socket_context_t *context =
      (struct us_internal_ssl_socket_context_t *)us_create_socket_context(
          0, loop,
          sizeof(struct us_internal_ssl_socket_context_t) + context_ext_size,
          options);

  /* I guess this is the only optional callback */
  context->on_server_name = NULL;

  /* Then we extend its SSL parts */
  context->ssl_context =
      ssl_context; // create_ssl_context_from_options(options);
  context->is_parent = 1;

  context->on_handshake = NULL;
  context->handshake_data = NULL;
  /* We, as parent context, may ignore data */
  context->sc.is_low_prio = (int (*)(struct us_socket_t *))ssl_is_low_prio;

  /* Parent contexts may use SNI */
  SSL_CTX_set_tlsext_servername_callback(context->ssl_context, sni_cb);
  SSL_CTX_set_tlsext_servername_arg(context->ssl_context, context);

  /* Also create the SNI tree */
  context->sni = sni_new();

  return context;
}
struct us_internal_ssl_socket_context_t *
us_internal_bun_create_ssl_socket_context(
    struct us_loop_t *loop, int context_ext_size,
    struct us_bun_socket_context_options_t options,
    enum create_bun_socket_error_t *err) {
  /* If we haven't initialized the loop data yet, do so .
   * This is needed because loop data holds shared OpenSSL data and
   * the function is also responsible for initializing OpenSSL */
  us_internal_init_loop_ssl_data(loop);

  /* First of all we try and create the SSL context from options */
  SSL_CTX *ssl_context = create_ssl_context_from_bun_options(options, err);
  if (!ssl_context) {
    /* We simply fail early if we cannot even create the OpenSSL context */
    return NULL;
  }

  /* Otherwise ee continue by creating a non-SSL context, but with larger ext to
   * hold our SSL stuff */
  struct us_internal_ssl_socket_context_t *context =
      (struct us_internal_ssl_socket_context_t *)us_create_bun_socket_context(
          0, loop,
          sizeof(struct us_internal_ssl_socket_context_t) + context_ext_size,
          options, err);

  /* I guess this is the only optional callback */
  context->on_server_name = NULL;
  /* Then we extend its SSL parts */
  context->ssl_context =
      ssl_context; // create_ssl_context_from_options(options);
  context->is_parent = 1;

  context->on_handshake = NULL;
  context->handshake_data = NULL;
  /* We, as parent context, may ignore data */
  context->sc.is_low_prio = (int (*)(struct us_socket_t *))ssl_is_low_prio;

  /* Parent contexts may use SNI */
  SSL_CTX_set_tlsext_servername_callback(context->ssl_context, sni_cb);
  SSL_CTX_set_tlsext_servername_arg(context->ssl_context, context);

  /* Also create the SNI tree */
  context->sni = sni_new();

  return context;
}

/* Our destructor for hostnames, used below */
void sni_hostname_destructor(void *user) {
  /* Some nodes hold null, so this one must ignore this case */
  free_ssl_context((SSL_CTX *)user);
}

void us_internal_ssl_socket_context_free(
    struct us_internal_ssl_socket_context_t *context) {
  /* If we are parent then we need to free our OpenSSL context */
  if (context->is_parent) {
    free_ssl_context(context->ssl_context);

    /* Here we need to register a temporary callback for all still-existing
     * hostnames and their contexts. Only parents have an SNI tree */
    sni_free(context->sni, sni_hostname_destructor);
  }

  us_internal_socket_context_free(0, &context->sc);
}

struct us_listen_socket_t *us_internal_ssl_socket_context_listen(
    struct us_internal_ssl_socket_context_t *context, const char *host,
    int port, int options, int socket_ext_size, int* error) {
  return us_socket_context_listen(0, &context->sc, host, port, options,
                                  sizeof(struct us_internal_ssl_socket_t) -
                                      sizeof(struct us_socket_t) +
                                      socket_ext_size, error);
}

struct us_listen_socket_t *us_internal_ssl_socket_context_listen_unix(
    struct us_internal_ssl_socket_context_t *context, const char *path,
    size_t pathlen, int options, int socket_ext_size, int* error) {
  return us_socket_context_listen_unix(0, &context->sc, path, pathlen, options,
                                       sizeof(struct us_internal_ssl_socket_t) -
                                           sizeof(struct us_socket_t) +
                                           socket_ext_size, error);
}

// TODO does this need more changes?
struct us_connecting_socket_t *us_internal_ssl_socket_context_connect(
    struct us_internal_ssl_socket_context_t *context, const char *host,
    int port, int options, int socket_ext_size, int* is_connected) {
  return us_socket_context_connect(
      2, &context->sc, host, port, options,
      sizeof(struct us_internal_ssl_socket_t) - sizeof(struct us_socket_t) +
          socket_ext_size, is_connected);
}
struct us_internal_ssl_socket_t *us_internal_ssl_socket_context_connect_unix(
    struct us_internal_ssl_socket_context_t *context, const char *server_path,
    size_t pathlen, int options, int socket_ext_size) {
  return (struct us_internal_ssl_socket_t *)us_socket_context_connect_unix(
      0, &context->sc, server_path, pathlen, options,
      sizeof(struct us_internal_ssl_socket_t) - sizeof(struct us_socket_t) +
          socket_ext_size);
}

static void ssl_on_open_without_sni(struct us_internal_ssl_socket_t *s, int is_client, char *ip, int ip_length) {
  ssl_on_open(s, is_client, ip, ip_length, NULL);
}

void us_internal_ssl_socket_context_on_open(
    struct us_internal_ssl_socket_context_t *context,
    struct us_internal_ssl_socket_t *(*on_open)(
        struct us_internal_ssl_socket_t *s, int is_client, char *ip,
        int ip_length)) {
  us_socket_context_on_open(
      0, &context->sc,
      (struct us_socket_t * (*)(struct us_socket_t *, int, char *, int))
          ssl_on_open_without_sni);
  context->on_open = on_open;
}

void us_internal_ssl_socket_context_on_close(
    struct us_internal_ssl_socket_context_t *context,
    struct us_internal_ssl_socket_t *(*on_close)(
        struct us_internal_ssl_socket_t *s, int code, void *reason)) {
  us_socket_context_on_close(
      0, (struct us_socket_context_t *)context,
      (struct us_socket_t * (*)(struct us_socket_t *, int, void *))
          ssl_on_close);
  context->on_close = on_close;
}

void us_internal_ssl_socket_context_on_data(
    struct us_internal_ssl_socket_context_t *context,
    struct us_internal_ssl_socket_t *(*on_data)(
        struct us_internal_ssl_socket_t *s, char *data, int length)) {
  us_socket_context_on_data(
      0, (struct us_socket_context_t *)context,
      (struct us_socket_t * (*)(struct us_socket_t *, char *, int))
          ssl_on_data);
  context->on_data = on_data;
}

void us_internal_ssl_socket_context_on_writable(
    struct us_internal_ssl_socket_context_t *context,
    struct us_internal_ssl_socket_t *(*on_writable)(
        struct us_internal_ssl_socket_t *s)) {
  us_socket_context_on_writable(0, (struct us_socket_context_t *)context,
                                (struct us_socket_t * (*)(struct us_socket_t *))
                                    ssl_on_writable);
  context->on_writable = on_writable;
}

void us_internal_ssl_socket_context_on_timeout(
    struct us_internal_ssl_socket_context_t *context,
    struct us_internal_ssl_socket_t *(*on_timeout)(
        struct us_internal_ssl_socket_t *s)) {
  us_socket_context_on_timeout(0, (struct us_socket_context_t *)context,
                               (struct us_socket_t * (*)(struct us_socket_t *))
                                   ssl_on_timeout);
  context->on_timeout = on_timeout;
}

void us_internal_ssl_socket_context_on_long_timeout(
    struct us_internal_ssl_socket_context_t *context,
    struct us_internal_ssl_socket_t *(*on_long_timeout)(
        struct us_internal_ssl_socket_t *s)) {
  us_socket_context_on_long_timeout(
      0, (struct us_socket_context_t *)context,
      (struct us_socket_t * (*)(struct us_socket_t *)) ssl_on_long_timeout);
  context->on_long_timeout = on_long_timeout;
}

/* We do not really listen to passed FIN-handler, we entirely override it with
 * our handler since SSL doesn't really have support for half-closed sockets */
void us_internal_ssl_socket_context_on_end(
    struct us_internal_ssl_socket_context_t *context,
    struct us_internal_ssl_socket_t *(*on_end)(
        struct us_internal_ssl_socket_t *)) {
  us_socket_context_on_end(0, (struct us_socket_context_t *)context,
                           (struct us_socket_t * (*)(struct us_socket_t *))
                               ssl_on_end);
}

void us_internal_ssl_socket_context_on_connect_error(
    struct us_internal_ssl_socket_context_t *context,
    struct us_internal_ssl_socket_t *(*on_connect_error)(
        struct us_internal_ssl_socket_t *, int code)) {
  us_socket_context_on_connect_error(
      0, (struct us_socket_context_t *)context,
      (struct us_connecting_socket_t * (*)(struct us_connecting_socket_t *, int)) on_connect_error);
}

void us_internal_ssl_socket_context_on_socket_connect_error(
    struct us_internal_ssl_socket_context_t *context,
    struct us_internal_ssl_socket_t *(*on_connect_error)(
        struct us_internal_ssl_socket_t *, int code)) {
  us_socket_context_on_socket_connect_error(
      0, (struct us_socket_context_t *)context,
      (struct us_socket_t * (*)(struct us_socket_t *, int)) on_connect_error);
}

void *us_internal_ssl_socket_context_ext(
    struct us_internal_ssl_socket_context_t *context) {
  return context + 1;
}

/* Per socket functions */
void *
us_internal_ssl_socket_get_native_handle(struct us_internal_ssl_socket_t *s) {
  return s->ssl;
}

int us_internal_ssl_socket_raw_write(struct us_internal_ssl_socket_t *s,
                                     const char *data, int length,
                                     int msg_more) {

  if (us_socket_is_closed(0, &s->s) || us_internal_ssl_socket_is_shut_down(s)) {
    return 0;
  }
  return us_socket_write(0, &s->s, data, length, msg_more);
}

int us_internal_ssl_socket_write(struct us_internal_ssl_socket_t *s,
                                 const char *data, int length, int msg_more) {
  
  if (us_socket_is_closed(0, &s->s) || us_internal_ssl_socket_is_shut_down(s) || length == 0) {
    return 0;
  }

  struct us_internal_ssl_socket_context_t *context =
      (struct us_internal_ssl_socket_context_t *)us_socket_context(0, &s->s);

  struct us_loop_t *loop = us_socket_context_loop(0, &context->sc);
  struct loop_ssl_data *loop_ssl_data =
      (struct loop_ssl_data *)loop->data.ssl_data;

  // it makes literally no sense to touch this here! it should start at 0 and
  // ONLY be set and reset by the on_data function! the way is is now,
  // triggering a write from a read will essentially delete all input data! what
  // we need to do is to check if this ever is non-zero and print a warning

  loop_ssl_data->ssl_read_input_length = 0;

  loop_ssl_data->ssl_socket = &s->s;
  loop_ssl_data->msg_more = msg_more;
  loop_ssl_data->last_write_was_msg_more = 0;
  int written = SSL_write(s->ssl, data, length);
  loop_ssl_data->msg_more = 0;

  if (loop_ssl_data->last_write_was_msg_more && !msg_more) {
    us_socket_flush(0, &s->s);
  }

  if (written > 0) {
    return written;
  }

  int err = SSL_get_error(s->ssl, written);
  if (err == SSL_ERROR_WANT_READ) {
    // here we need to trigger writable event next ssl_read!
    s->ssl_write_wants_read = 1;
  } else if (err == SSL_ERROR_SSL || err == SSL_ERROR_SYSCALL) {
    // these two errors may add to the error queue, which is per thread and
    // must be cleared
    ERR_clear_error();
    s->fatal_error = 1;

    // all errors here except for want write are critical and should not
    // happen
  }

  return 0;
}

void *us_internal_ssl_socket_ext(struct us_internal_ssl_socket_t *s) {
  return s + 1;
}

void *us_internal_connecting_ssl_socket_ext(struct us_connecting_socket_t *s) {
  return (char*)(s + 1) + sizeof(struct us_internal_ssl_socket_t) - sizeof(struct us_socket_t);
}

int us_internal_ssl_socket_is_shut_down(struct us_internal_ssl_socket_t *s) {
  return !s->ssl || us_socket_is_shut_down(0, &s->s) ||
         SSL_get_shutdown(s->ssl) & SSL_SENT_SHUTDOWN || s->fatal_error;
}

void us_internal_ssl_socket_shutdown(struct us_internal_ssl_socket_t *s) {
  if (!us_internal_ssl_socket_is_closed(s) &&
      !us_internal_ssl_socket_is_shut_down(s)) {
    struct us_internal_ssl_socket_context_t *context =
        (struct us_internal_ssl_socket_context_t *)us_socket_context(0, &s->s);
    struct us_loop_t *loop = us_socket_context_loop(0, &context->sc);
    struct loop_ssl_data *loop_ssl_data =
        (struct loop_ssl_data *)loop->data.ssl_data;

    // also makes no sense to touch this here!
    // however the idea is that if THIS socket is not the same as ssl_socket
    // then this data is not for me but this is not correct as it is currently
    // anyways, any data available should be properly reset
    loop_ssl_data->ssl_read_input_length = 0;

    // essentially we need two of these: one for CURRENT CALL and one for
    // CURRENT SOCKET WITH DATA if those match in the BIO function then you may
    // read, if not then you may not read we need ssl_read_socket to be set in
    // on_data and checked in the BIO
    loop_ssl_data->ssl_socket = &s->s;

    loop_ssl_data->msg_more = 0;
    // sets SSL_SENT_SHUTDOWN and waits for the other side to do the same
    int ret = SSL_shutdown(s->ssl);

    if (SSL_in_init(s->ssl) || SSL_get_quiet_shutdown(s->ssl)) {
      // when SSL_in_init or quiet shutdown in BoringSSL, we call shutdown
      // directly
      us_socket_shutdown(0, &s->s);
      return;
    }

    if (ret < 0) {
      int err = SSL_get_error(s->ssl, ret);
      if (err == SSL_ERROR_SSL || err == SSL_ERROR_SYSCALL) {
        // clear
        ERR_clear_error();
        s->fatal_error = 1;
      }

      // we get here if we are shutting down while still in init
      us_socket_shutdown(0, &s->s);
    }
  }
}

struct us_internal_ssl_socket_t *us_internal_ssl_socket_context_adopt_socket(
    struct us_internal_ssl_socket_context_t *context,
    struct us_internal_ssl_socket_t *s, int ext_size) {
  // todo: this is completely untested
  int new_ext_size = ext_size;
  if (ext_size != -1) {
    new_ext_size = sizeof(struct us_internal_ssl_socket_t) - sizeof(struct us_socket_t) + ext_size;
  }
  return (struct us_internal_ssl_socket_t *)us_socket_context_adopt_socket(
      0, &context->sc, &s->s,
      new_ext_size);
}

struct us_internal_ssl_socket_t *
ssl_wrapped_context_on_close(struct us_internal_ssl_socket_t *s, int code,
                             void *reason) {
  struct us_internal_ssl_socket_context_t *context =
      (struct us_internal_ssl_socket_context_t *)us_socket_context(0, &s->s);
  struct us_wrapped_socket_context_t *wrapped_context =
      (struct us_wrapped_socket_context_t *)us_internal_ssl_socket_context_ext(
          context);


  // writting here can cause the context to not be writable anymore but its the
  // user responsability to check for that
  if (wrapped_context->old_events.on_close) {
    wrapped_context->old_events.on_close((struct us_socket_t *)s, code, reason);
  }

  if (wrapped_context->events.on_close) {
    wrapped_context->events.on_close((struct us_socket_t *)s, code, reason);
  }

  us_socket_context_unref(0, wrapped_context->tcp_context);
  return s;
}

struct us_internal_ssl_socket_t *
ssl_wrapped_context_on_writable(struct us_internal_ssl_socket_t *s) {
  struct us_internal_ssl_socket_context_t *context =
      (struct us_internal_ssl_socket_context_t *)us_socket_context(0, &s->s);
  struct us_wrapped_socket_context_t *wrapped_context =
      (struct us_wrapped_socket_context_t *)us_internal_ssl_socket_context_ext(
          context);


  // writting here can cause the context to not be writable anymore but its the
  // user responsability to check for that
  if (wrapped_context->old_events.on_writable) {
    wrapped_context->old_events.on_writable((struct us_socket_t *)s);
  }

  if (wrapped_context->events.on_writable) {
    wrapped_context->events.on_writable((struct us_socket_t *)s);
  }

  return s;
}

struct us_internal_ssl_socket_t *
ssl_wrapped_context_on_data(struct us_internal_ssl_socket_t *s, char *data,
                            int length) {
  struct us_internal_ssl_socket_context_t *context =
      (struct us_internal_ssl_socket_context_t *)us_socket_context(0, &s->s);
  struct us_wrapped_socket_context_t *wrapped_context =
      (struct us_wrapped_socket_context_t *)us_internal_ssl_socket_context_ext(
          context);
  // raw data if needed
  if (wrapped_context->old_events.on_data) {
    wrapped_context->old_events.on_data((struct us_socket_t *)s, data, length);
  }
  // ssl wrapped data
  return ssl_on_data(s, data, length);
}

struct us_internal_ssl_socket_t *
ssl_wrapped_context_on_timeout(struct us_internal_ssl_socket_t *s) {
  struct us_internal_ssl_socket_context_t *context =
      (struct us_internal_ssl_socket_context_t *)us_socket_context(0, &s->s);
  struct us_wrapped_socket_context_t *wrapped_context =
      (struct us_wrapped_socket_context_t *)us_internal_ssl_socket_context_ext(
          context);
  if (wrapped_context->old_events.on_timeout) {
    wrapped_context->old_events.on_timeout((struct us_socket_t *)s);
  }

  if (wrapped_context->events.on_timeout) {
    wrapped_context->events.on_timeout((struct us_socket_t *)s);
  }


  return s;
}

struct us_internal_ssl_socket_t *
ssl_wrapped_context_on_long_timeout(struct us_internal_ssl_socket_t *s) {
  struct us_internal_ssl_socket_context_t *context =
      (struct us_internal_ssl_socket_context_t *)us_socket_context(0, &s->s);
  struct us_wrapped_socket_context_t *wrapped_context =
      (struct us_wrapped_socket_context_t *)us_internal_ssl_socket_context_ext(
          context);
  if (wrapped_context->old_events.on_long_timeout) {
    wrapped_context->old_events.on_long_timeout((struct us_socket_t *)s);
  }

  if (wrapped_context->events.on_long_timeout) {
    wrapped_context->events.on_long_timeout((struct us_socket_t *)s);
  }

  return s;
}

struct us_internal_ssl_socket_t *
ssl_wrapped_context_on_end(struct us_internal_ssl_socket_t *s) {
  struct us_internal_ssl_socket_context_t *context =
      (struct us_internal_ssl_socket_context_t *)us_socket_context(0, &s->s);
  struct us_wrapped_socket_context_t *wrapped_context =
      (struct us_wrapped_socket_context_t *)us_internal_ssl_socket_context_ext(
          context);
  if (wrapped_context->old_events.on_end) {
    wrapped_context->old_events.on_end((struct us_socket_t *)s);
  }
  if (wrapped_context->events.on_end) {
    wrapped_context->events.on_end((struct us_socket_t *)s);
  }
  
  return s;
}

struct us_internal_ssl_socket_t *
ssl_wrapped_on_connect_error(struct us_internal_ssl_socket_t *s, int code) {
  struct us_internal_ssl_socket_context_t *context =
      (struct us_internal_ssl_socket_context_t *)us_socket_context(0, &s->s);
  struct us_wrapped_socket_context_t *wrapped_context =
      (struct us_wrapped_socket_context_t *)us_internal_ssl_socket_context_ext(
          context);

  if (wrapped_context->old_events.on_connect_error) {
    wrapped_context->old_events.on_connect_error((struct us_connecting_socket_t *)s, code);
  }
  if (wrapped_context->events.on_connect_error) {
    wrapped_context->events.on_connect_error((struct us_connecting_socket_t *)s, code);
  }

  return s;
}

struct us_internal_ssl_socket_t *
ssl_wrapped_on_socket_connect_error(struct us_internal_ssl_socket_t *s, int code) {
  struct us_internal_ssl_socket_context_t *context =
      (struct us_internal_ssl_socket_context_t *)us_socket_context(0, &s->s);
  struct us_wrapped_socket_context_t *wrapped_context =
      (struct us_wrapped_socket_context_t *)us_internal_ssl_socket_context_ext(
          context);
  if (wrapped_context->old_events.on_connecting_socket_error) {
    wrapped_context->old_events.on_connecting_socket_error((struct us_socket_t *)s, code);
  }
  if (wrapped_context->events.on_connecting_socket_error) {
    wrapped_context->events.on_connecting_socket_error((struct us_socket_t *)s, code);
  }


  return s;
}

struct us_internal_ssl_socket_t *
us_internal_ssl_socket_open(struct us_internal_ssl_socket_t *s, int is_client,
                            char *ip, int ip_length) {
  // closed
  if (us_socket_is_closed(0, &s->s)) {
    return s;
  }
  // already opened
  if (s->ssl)
    return s;

  // start SSL open
  return ssl_on_open(s, is_client, ip, ip_length, NULL);
}

struct us_socket_t *us_socket_upgrade_to_tls(us_socket_r s, us_socket_context_r new_context, const char *sni) {
  // Resize to tls + ext size
  void** prev_ext_ptr = (void**)us_socket_ext(0, s);
  void* prev_ext = *prev_ext_ptr;
  struct us_internal_ssl_socket_t *socket =
      (struct us_internal_ssl_socket_t *)us_socket_context_adopt_socket(
          0, new_context, s,
          (sizeof(struct us_internal_ssl_socket_t) - sizeof(struct us_socket_t)) + sizeof(void*));
  socket->ssl = NULL;
  socket->ssl_write_wants_read = 0;
  socket->ssl_read_wants_write = 0;
  socket->fatal_error = 0;
  socket->handshake_state = HANDSHAKE_PENDING;

  void** new_ext_ptr = (void**)us_socket_ext(1, (struct us_socket_t *)socket);
  *new_ext_ptr = prev_ext;

  ssl_on_open(socket, 1, NULL, 0, sni);


  return (struct us_socket_t *)socket;
}

struct us_internal_ssl_socket_t *us_internal_ssl_socket_wrap_with_tls(
    struct us_socket_t *s, struct us_bun_socket_context_options_t options,
    struct us_socket_events_t events, int socket_ext_size) {
  /* Cannot wrap a closed socket */
  if (us_socket_is_closed(0, s)) {
    return NULL;
  }

  struct us_socket_context_t *old_context = us_socket_context(0, s);
  us_socket_context_ref(0,old_context);

  enum create_bun_socket_error_t err = CREATE_BUN_SOCKET_ERROR_NONE;
  struct us_socket_context_t *context = us_create_bun_socket_context(
      1, old_context->loop, sizeof(struct us_wrapped_socket_context_t),
      options, &err);
  
  // Handle SSL context creation failure
  if (UNLIKELY(!context)) {
    return NULL;
  }

  struct us_internal_ssl_socket_context_t *tls_context =
      (struct us_internal_ssl_socket_context_t *)context;

  struct us_wrapped_socket_context_t *wrapped_context =
      (struct us_wrapped_socket_context_t *)us_internal_ssl_socket_context_ext(
          tls_context);
  // we need to fire this events on the old context
  struct us_socket_events_t old_events = (struct us_socket_events_t){
      .on_close = old_context->on_close,
      .on_data = old_context->on_data,
      .on_writable = old_context->on_writable,
      .on_timeout = old_context->on_socket_timeout,
      .on_long_timeout = old_context->on_socket_long_timeout,
      .on_end = old_context->on_end,
      .on_connect_error = old_context->on_connect_error,
  };
  wrapped_context->old_events = old_events;
  wrapped_context->events = events;
  wrapped_context->tcp_context = old_context;

  // no need to wrap open because socket is already open (only new context will
  // be called so we can configure hostname and ssl stuff normally here before
  // handshake)
  tls_context->on_open =
      (struct us_internal_ssl_socket_t *
       (*)(struct us_internal_ssl_socket_t *, int, char *, int)) events.on_open;

  // on handshake is not available on the old context so we just add this
  if (events.on_handshake) {
    us_internal_on_ssl_handshake(
        tls_context,
        (void (*)(struct us_internal_ssl_socket_t *, int,
                  struct us_bun_verify_error_t, void *))events.on_handshake,
        NULL);
  }

  // we need to wrap these events because we need to call the old context events
  // as well
  us_socket_context_on_connect_error(
      0, context,
      (struct us_connecting_socket_t * (*)(struct us_connecting_socket_t *, int))
          ssl_wrapped_on_connect_error);
us_socket_context_on_socket_connect_error(
      0, context,
      (struct us_socket_t * (*)(struct us_socket_t *, int))
          ssl_wrapped_on_socket_connect_error);
  us_socket_context_on_end(0, context,
                           (struct us_socket_t * (*)(struct us_socket_t *))
                               ssl_wrapped_context_on_end);
  us_socket_context_on_long_timeout(
      0, context,
      (struct us_socket_t * (*)(struct us_socket_t *))
          ssl_wrapped_context_on_long_timeout);
  us_socket_context_on_timeout(0, context,
                               (struct us_socket_t * (*)(struct us_socket_t *))
                                   ssl_wrapped_context_on_timeout);

  // special case this will be called after ssl things are done

  // called from ssl_on_data handler is called inside
  // ssl_wrapped_context_on_data
  tls_context->on_data =
      (struct us_internal_ssl_socket_t *
       (*)(struct us_internal_ssl_socket_t *, char *, int)) events.on_data;
  us_socket_context_on_data(
      0, context,
      (struct us_socket_t * (*)(struct us_socket_t *, char *, int))
          ssl_wrapped_context_on_data);

  // here is the inverse of the above ssl_on_writable will call
  // ssl_wrapped_context_on_writable
  tls_context->on_writable = ssl_wrapped_context_on_writable;
  us_socket_context_on_writable(0, context,
                                (struct us_socket_t * (*)(struct us_socket_t *))
                                    ssl_on_writable);

  tls_context->on_close = ssl_wrapped_context_on_close;
  us_socket_context_on_close(
      0, context,
      (struct us_socket_t * (*)(struct us_socket_t *, int, void *))
          ssl_on_close);

  // will resize to tls + ext size
  struct us_internal_ssl_socket_t *socket =
      (struct us_internal_ssl_socket_t *)us_socket_context_adopt_socket(
          0, context, s,
          sizeof(struct us_internal_ssl_socket_t) - sizeof(struct us_socket_t) +
              socket_ext_size);
  socket->ssl = NULL;
  socket->ssl_write_wants_read = 0;
  socket->ssl_read_wants_write = 0;
  socket->fatal_error = 0;
  socket->handshake_state = HANDSHAKE_PENDING;
  // always resume the socket
  us_socket_resume(1, &socket->s);
  return socket;
}

#endif