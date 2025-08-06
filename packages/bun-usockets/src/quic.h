#ifdef LIBUS_USE_QUIC

#ifndef LIBUS_QUIC_H
#define LIBUS_QUIC_H

/* Experimental QUIC functions */

#include "libusockets.h"

// Forward declarations
struct us_quic_socket_context_s;
struct us_quic_stream_s;

typedef struct us_quic_socket_context_s us_quic_socket_context_t;
typedef struct us_quic_stream_s us_quic_stream_t;

// QUIC uses the same options as regular SSL sockets to support all SSL features
typedef struct us_bun_socket_context_options_t us_quic_socket_context_options_t;

/* Socket that handles UDP transport and QUIC connections */
typedef struct us_quic_socket_s {
    struct us_udp_socket_t *udp_socket;     /* UDP socket for I/O */
    us_quic_socket_context_t *context;      /* Reference to context */
    
    struct us_quic_socket_s *next;          /* For deferred free list */
    int is_closed;                          /* Marked for cleanup */
    int is_client;                          /* 1 = client, 0 = server/listen */
    
    /* Extension data follows */
} us_quic_socket_t;

/* Individual QUIC connection (multiplexed over socket) */
typedef struct us_quic_connection_s {
    us_quic_socket_t *socket;               /* Parent socket for I/O */
    void *lsquic_conn;                      /* Opaque QUIC connection */
    void *peer_ctx;                         /* For lsquic callbacks */
    
    struct us_quic_connection_s *next;      /* For deferred free list */
    int is_closed;                          /* Marked for cleanup */
    
    /* Extension data follows */
} us_quic_connection_t;

/* Listen socket is just an alias - same structure */
typedef struct us_quic_socket_s us_quic_listen_socket_t;


void *us_quic_stream_ext(us_quic_stream_t *s);
int us_quic_stream_write(us_quic_stream_t *s, char *data, int length);
int us_quic_stream_shutdown(us_quic_stream_t *s);
int us_quic_stream_shutdown_read(us_quic_stream_t *s);
void us_quic_stream_close(us_quic_stream_t *s);

int us_quic_socket_context_get_header(us_quic_socket_context_t *context, int index, char **name, int *name_length, char **value, int *value_length);


void us_quic_socket_context_set_header(us_quic_socket_context_t *context, int index, const char *key, int key_length, const char *value, int value_length);
void us_quic_socket_context_send_headers(us_quic_socket_context_t *context, us_quic_stream_t *s, int num, int has_body);

us_quic_socket_context_t *us_create_quic_socket_context(struct us_loop_t *loop, us_quic_socket_context_options_t options, int ext_size);
us_quic_listen_socket_t *us_quic_socket_context_listen(us_quic_socket_context_t *context, const char *host, int port, int ext_size);
us_quic_socket_t *us_quic_socket_context_connect(us_quic_socket_context_t *context, const char *host, int port, int ext_size);

void us_quic_socket_create_stream(us_quic_socket_t *s, int ext_size);
us_quic_socket_t *us_quic_stream_socket(us_quic_stream_t *s);

/* This one is ugly and is only used to make clean examples */
int us_quic_stream_is_client(us_quic_stream_t *s);

void us_quic_socket_context_on_stream_data(us_quic_socket_context_t *context, void(*on_stream_data)(us_quic_stream_t *s, char *data, int length));
void us_quic_socket_context_on_stream_end(us_quic_socket_context_t *context, void(*on_stream_data)(us_quic_stream_t *s));
void us_quic_socket_context_on_stream_headers(us_quic_socket_context_t *context, void(*on_stream_headers)(us_quic_stream_t *s));
void us_quic_socket_context_on_stream_open(us_quic_socket_context_t *context, void(*on_stream_open)(us_quic_stream_t *s, int is_client));
void us_quic_socket_context_on_stream_close(us_quic_socket_context_t *context, void(*on_stream_close)(us_quic_stream_t *s));
void us_quic_socket_context_on_open(us_quic_socket_context_t *context, void(*on_open)(us_quic_socket_t *s, int is_client));
void us_quic_socket_context_on_close(us_quic_socket_context_t *context, void(*on_close)(us_quic_socket_t *s));
void us_quic_socket_context_on_connection(us_quic_socket_context_t *context, void(*on_connection)(us_quic_socket_t *s));
void us_quic_socket_context_on_stream_writable(us_quic_socket_context_t *context, void(*on_stream_writable)(us_quic_stream_t *s));



void *us_quic_socket_context_ext(us_quic_socket_context_t *context);
us_quic_socket_context_t *us_quic_socket_context(us_quic_socket_t *s);

#endif
#endif