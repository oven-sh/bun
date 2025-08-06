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
    void *lsquic_conn;                      /* QUIC connection for this socket */
    
    struct us_quic_socket_s *next;          /* For deferred free list */
    int is_closed;                          /* Marked for cleanup */
    int is_client;                          /* 1 = client, 0 = server/listen */
    
    /* Extension data follows */
} us_quic_socket_t;

/* Stream table entry for tracking multiple streams per connection */
typedef struct us_quic_stream_entry_s {
    void *lsquic_stream;                    /* Opaque lsquic stream pointer */
    uint64_t stream_id;                     /* QUIC stream ID */
    int is_closed;                          /* Stream state */
    void *ext_data;                         /* Extension data for this stream */
    struct us_quic_stream_entry_s *next;   /* For hash table chaining */
} us_quic_stream_entry_t;

/* Stream table for managing multiple streams per connection */
typedef struct us_quic_stream_table_s {
    us_quic_stream_entry_t **buckets;       /* Hash table buckets */
    uint32_t bucket_count;                  /* Number of buckets */
    uint32_t stream_count;                  /* Total streams */
    uint64_t next_client_stream_id;         /* Next client-initiated stream ID */
    uint64_t next_server_stream_id;         /* Next server-initiated stream ID */
} us_quic_stream_table_t;

/* Individual QUIC connection (multiplexed over socket) */
typedef struct us_quic_connection_s {
    us_quic_socket_t *socket;               /* Parent socket for I/O */
    void *lsquic_conn;                      /* Opaque QUIC connection */
    void *peer_ctx;                         /* For lsquic callbacks */
    us_quic_stream_table_t *stream_table;   /* Multi-stream management pointer */
    
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

/* Stream management functions */
void us_quic_socket_create_stream(us_quic_socket_t *s, int ext_size);
us_quic_socket_t *us_quic_stream_socket(us_quic_stream_t *s);

/* Multi-stream management functions */
us_quic_stream_t *us_quic_socket_create_stream_with_id(us_quic_socket_t *s, uint64_t stream_id, int ext_size);
us_quic_stream_t *us_quic_socket_get_stream(us_quic_socket_t *s, uint64_t stream_id);
uint32_t us_quic_socket_get_stream_count(us_quic_socket_t *s);
void us_quic_socket_close_stream(us_quic_socket_t *s, uint64_t stream_id);
void us_quic_socket_close_all_streams(us_quic_socket_t *s);
void us_quic_socket_close(us_quic_socket_t *s);

/* Stream table management */
us_quic_stream_table_t *us_quic_stream_table_create(int is_client);
void us_quic_stream_table_destroy(us_quic_stream_table_t *table);
us_quic_stream_entry_t *us_quic_stream_table_add(us_quic_stream_table_t *table, uint64_t stream_id, void *lsquic_stream, void *ext_data);
us_quic_stream_entry_t *us_quic_stream_table_get(us_quic_stream_table_t *table, uint64_t stream_id);
void us_quic_stream_table_remove(us_quic_stream_table_t *table, uint64_t stream_id);
uint64_t us_quic_stream_table_allocate_id(us_quic_stream_table_t *table, int is_client);

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