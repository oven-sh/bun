#ifdef LIBUS_USE_QUIC

/* Todo: quic layer should not use bsd layer directly (sendmmsg) */
#include "internal/networking/bsd.h"

#include "quic.h"

#include "internal/internal.h"
#include <openssl/ssl.h>
#include <openssl/x509.h>
#include <openssl/x509v3.h>
#include <openssl/rsa.h>
#include <openssl/evp.h>

#include "lsquic.h"
#include "lsquic_types.h"
#include "lsxpack_header.h"

/* Todo: remove these */
#ifndef _WIN32
#include <netinet/in.h>
#include <errno.h>
#include <sys/socket.h>
#include <unistd.h>
#include <arpa/inet.h>
#endif

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

void leave_all();

// Enhanced peer context structure for lsquic - contains UDP socket and connection metadata
struct quic_peer_ctx {
    struct us_udp_socket_t *udp_socket;
    us_quic_socket_context_t *context;
    us_quic_connection_t *connection;     // Back-reference to connection
    void *reserved[13];                   // Adjusted space for alignment
};

// Connection lookup table entry for tracking active connections
struct quic_connection_entry {
    lsquic_conn_t *lsquic_conn;
    us_quic_connection_t *quic_conn;
    struct sockaddr_storage peer_addr;
    struct quic_connection_entry *next;
};

// Connection tracking table - hash table for fast lookup
#define QUIC_CONNECTION_TABLE_SIZE 256
struct quic_connection_table {
    struct quic_connection_entry *buckets[QUIC_CONNECTION_TABLE_SIZE];
    size_t count;
};

// Forward declarations for QUIC UDP callback functions
void on_udp_socket_data_client(struct us_udp_socket_t *s, struct us_udp_packet_buffer_t *buf, int packets);
void on_udp_socket_data(struct us_udp_socket_t *s, struct us_udp_packet_buffer_t *buf, int packets);

/*
struct sockaddr_in client_addr = {
    AF_INET,
    1,
    1
};

struct sockaddr_in server_addr = {
    AF_INET,
    2,
    2
};*/


/* Socket context */
struct us_quic_socket_context_s {

    struct us_udp_packet_buffer_t *recv_buf;
    //struct us_udp_packet_buffer_t *send_buf;
    int outgoing_packets;

    //struct us_udp_socket_t *udp_socket;
    struct us_loop_t *loop;
    /* Engines are now stored in loop_data for sharing across contexts */
    
    /* Deferred cleanup lists (swept each loop iteration) */
    struct us_quic_connection_s *closing_connections;
    struct us_quic_socket_s *closing_sockets;
    
    /* Connection tracking table for efficient lookup */
    struct quic_connection_table *connection_table;

    // we store the options the context was created with here
    struct us_bun_socket_context_options_t options;
    
    // SSL context created from options
    SSL_CTX *ssl_context;

    void(*on_stream_data)(us_quic_stream_t *s, char *data, int length);
    void(*on_stream_end)(us_quic_stream_t *s);
    void(*on_stream_headers)(us_quic_stream_t *s);
    void(*on_stream_open)(us_quic_stream_t *s, int is_client);
    void(*on_stream_close)(us_quic_stream_t *s);
    void(*on_stream_writable)(us_quic_stream_t *s);
    void(*on_open)(us_quic_socket_t *s, int is_client);
    void(*on_close)(us_quic_socket_t *s);
    void(*on_connection)(us_quic_socket_t *s);  // Called when server accepts a new connection
    
    /* Per-context header storage to avoid global state */
    struct header_buf {
        unsigned off;
        char buf[UINT16_MAX];
    } header_buffer;
    struct lsxpack_header headers_arr[10];
};

/* Connection table management functions */
static uint32_t hash_peer_addr(const struct sockaddr *addr) {
    uint32_t hash = 0;
    if (addr->sa_family == AF_INET) {
        struct sockaddr_in *sin = (struct sockaddr_in *)addr;
        hash = sin->sin_addr.s_addr ^ sin->sin_port;
    } else if (addr->sa_family == AF_INET6) {
        struct sockaddr_in6 *sin6 = (struct sockaddr_in6 *)addr;
        // Simple hash of first 4 bytes of IPv6 address + port
        hash = *(uint32_t *)sin6->sin6_addr.s6_addr ^ sin6->sin6_port;
    }
    return hash % QUIC_CONNECTION_TABLE_SIZE;
}

static struct quic_connection_table *create_connection_table() {
    struct quic_connection_table *table = malloc(sizeof(struct quic_connection_table));
    if (table) {
        memset(table, 0, sizeof(struct quic_connection_table));
    }
    return table;
}

static void free_connection_table(struct quic_connection_table *table) {
    if (!table) return;
    
    for (int i = 0; i < QUIC_CONNECTION_TABLE_SIZE; i++) {
        struct quic_connection_entry *entry = table->buckets[i];
        while (entry) {
            struct quic_connection_entry *next = entry->next;
            free(entry);
            entry = next;
        }
    }
    free(table);
}

static us_quic_connection_t *find_connection_by_peer(struct quic_connection_table *table, const struct sockaddr *peer_addr) {
    if (!table || !peer_addr) return NULL;
    
    uint32_t bucket = hash_peer_addr(peer_addr);
    struct quic_connection_entry *entry = table->buckets[bucket];
    
    while (entry) {
        // Compare peer addresses (simplified comparison)
        if (entry->peer_addr.ss_family == peer_addr->sa_family) {
            if (peer_addr->sa_family == AF_INET) {
                struct sockaddr_in *sin1 = (struct sockaddr_in *)&entry->peer_addr;
                struct sockaddr_in *sin2 = (struct sockaddr_in *)peer_addr;
                if (sin1->sin_addr.s_addr == sin2->sin_addr.s_addr && sin1->sin_port == sin2->sin_port) {
                    return entry->quic_conn;
                }
            } else if (peer_addr->sa_family == AF_INET6) {
                struct sockaddr_in6 *sin1 = (struct sockaddr_in6 *)&entry->peer_addr;
                struct sockaddr_in6 *sin2 = (struct sockaddr_in6 *)peer_addr;
                if (memcmp(&sin1->sin6_addr, &sin2->sin6_addr, sizeof(sin1->sin6_addr)) == 0 && sin1->sin6_port == sin2->sin6_port) {
                    return entry->quic_conn;
                }
            }
        }
        entry = entry->next;
    }
    return NULL;
}

static int add_connection_to_table(struct quic_connection_table *table, lsquic_conn_t *lsquic_conn, us_quic_connection_t *quic_conn, const struct sockaddr *peer_addr) {
    if (!table || !lsquic_conn || !quic_conn || !peer_addr) return -1;
    
    struct quic_connection_entry *entry = malloc(sizeof(struct quic_connection_entry));
    if (!entry) return -1;
    
    entry->lsquic_conn = lsquic_conn;
    entry->quic_conn = quic_conn;
    memcpy(&entry->peer_addr, peer_addr, 
           (peer_addr->sa_family == AF_INET) ? sizeof(struct sockaddr_in) : sizeof(struct sockaddr_in6));
    
    uint32_t bucket = hash_peer_addr(peer_addr);
    entry->next = table->buckets[bucket];
    table->buckets[bucket] = entry;
    table->count++;
    
    return 0;
}

static void remove_connection_from_table(struct quic_connection_table *table, lsquic_conn_t *lsquic_conn) {
    if (!table || !lsquic_conn) return;
    
    for (int i = 0; i < QUIC_CONNECTION_TABLE_SIZE; i++) {
        struct quic_connection_entry **entry_ptr = &table->buckets[i];
        while (*entry_ptr) {
            if ((*entry_ptr)->lsquic_conn == lsquic_conn) {
                struct quic_connection_entry *to_remove = *entry_ptr;
                *entry_ptr = to_remove->next;
                free(to_remove);
                table->count--;
                return;
            }
            entry_ptr = &(*entry_ptr)->next;
        }
    }
}

/* Helper functions to get engines from context */
static inline lsquic_engine_t *get_server_engine(us_quic_socket_context_t *context) {
    if (!context || !context->loop) return NULL;
    struct us_internal_loop_data_t *loop_data = (struct us_internal_loop_data_t *)context->loop;
    return loop_data->quic_server_engine;
}

static inline lsquic_engine_t *get_client_engine(us_quic_socket_context_t *context) {
    if (!context || !context->loop) return NULL;
    struct us_internal_loop_data_t *loop_data = (struct us_internal_loop_data_t *)context->loop;
    return loop_data->quic_client_engine;
}

/* Setters */
void us_quic_socket_context_on_stream_data(us_quic_socket_context_t *context, void(*on_stream_data)(us_quic_stream_t *s, char *data, int length)) {
    context->on_stream_data = on_stream_data;
}
void us_quic_socket_context_on_stream_end(us_quic_socket_context_t *context, void(*on_stream_end)(us_quic_stream_t *s)) {
    context->on_stream_end = on_stream_end;
}
void us_quic_socket_context_on_stream_headers(us_quic_socket_context_t *context, void(*on_stream_headers)(us_quic_stream_t *s)) {
    context->on_stream_headers = on_stream_headers;
}
void us_quic_socket_context_on_stream_open(us_quic_socket_context_t *context, void(*on_stream_open)(us_quic_stream_t *s, int is_client)) {
    // printf("us_quic_socket_context_on_stream_open: context=%p, callback=%p\n", context, on_stream_open);
    context->on_stream_open = on_stream_open;
}
void us_quic_socket_context_on_stream_close(us_quic_socket_context_t *context, void(*on_stream_close)(us_quic_stream_t *s)) {
    context->on_stream_close = on_stream_close;
}
void us_quic_socket_context_on_open(us_quic_socket_context_t *context, void(*on_open)(us_quic_socket_t *s, int is_client)) {
    // printf("us_quic_socket_context_on_open: context=%p, callback=%p\n", context, on_open);
    context->on_open = on_open;
}
void us_quic_socket_context_on_close(us_quic_socket_context_t *context, void(*on_close)(us_quic_socket_t *s)) {
    context->on_close = on_close;
}
void us_quic_socket_context_on_connection(us_quic_socket_context_t *context, void(*on_connection)(us_quic_socket_t *s)) {
    // printf("us_quic_socket_context_on_connection: context=%p, callback=%p\n", context, on_connection);
    context->on_connection = on_connection;
}
void us_quic_socket_context_on_stream_writable(us_quic_socket_context_t *context, void(*on_stream_writable)(us_quic_stream_t *s)) {
    context->on_stream_writable = on_stream_writable;
}

/* UDP handlers */
void on_udp_socket_writable(struct us_udp_socket_t *s) {
    if (!s) {
        printf("ERROR: NULL socket in on_udp_socket_writable\n");
        return;
    }
    
    /* The user data could be either a context (client) or listen socket (server) */
    void *user_data = us_udp_socket_user(s);
    if (!user_data) {
        printf("ERROR: No user data found in UDP socket\n");
        return;
    }
    
    us_quic_socket_context_t *context = NULL;
    
    /* Check if it's a listen socket or direct context */
    /* We can distinguish by checking if the first field is a valid UDP socket pointer */
    us_quic_listen_socket_t *listen = (us_quic_listen_socket_t *)user_data;
    if (listen && listen->udp_socket == s) {
        /* It's a listen socket if its udp_socket field matches the callback socket */
        context = listen->context;
    } else {
        /* Otherwise it's directly a context (client socket) */
        context = (us_quic_socket_context_t *)user_data;
    }
    
    if (!context) {
        printf("ERROR: No context found in UDP socket writable\n");
        return;
    }

    /* Send unsent packets for both engines if they exist */
    lsquic_engine_t *server_engine = get_server_engine(context);
    lsquic_engine_t *client_engine = get_client_engine(context);
    
    // printf("on_udp_socket_writable: socket=%p, context=%p, engine=%p, client_engine=%p\n", 
    //        s, context, server_engine, client_engine);
    
    if (server_engine) {
        // printf("  Calling lsquic_engine_send_unsent_packets for server engine\n");
        lsquic_engine_send_unsent_packets(server_engine);
        // printf("  Done with server engine\n");
    }
    if (client_engine) {
        // printf("  Calling lsquic_engine_send_unsent_packets for client engine\n");
        lsquic_engine_send_unsent_packets(client_engine);
        // printf("  Done with client engine\n");
    }
    
    // printf("on_udp_socket_writable: done sending packets, socket=%p still valid\n", s);
}

// Wrapper function to match uSockets UDP callback signature
void on_udp_socket_data_client_wrapper(struct us_udp_socket_t *s, void *buf, int packets) {
    on_udp_socket_data_client(s, (struct us_udp_packet_buffer_t *)buf, packets);
}

// we need two differetn handlers to know to put it in client or servcer context
void on_udp_socket_data_client(struct us_udp_socket_t *s, struct us_udp_packet_buffer_t *buf, int packets) {

    // Remove unused fd variable
    // int fd = us_poll_fd((struct us_poll_t *) s);
    //printf("Reading on fd: %d\n", fd);

    // printf("UDP client socket got data: %p, packets: %d\n", s, packets);

    /* We need to lookup the context from the udp socket */
    //us_udpus_udp_socket_context(s);
    // do we have udp socket contexts? or do we just have user data?

    us_quic_socket_context_t *context = us_udp_socket_user(s);
    if (!context) {
        printf("ERROR: No context found in UDP client socket\n");
        return;
    }
    
    if (!buf) {
        printf("ERROR: Null packet buffer in UDP client handler\n");
        return;
    }
    
    if (packets <= 0) {
        return;
    }

    /* We just shove it to lsquic */
    for (int i = 0; i < packets; i++) {
        char *payload = us_udp_packet_buffer_payload(buf, i);
        int length = us_udp_packet_buffer_payload_length(buf, i);
        // ECN not available in current uSockets API - remove this line
        // int ecn = us_udp_packet_buffer_ecn(buf, i);
        void *peer_addr = us_udp_packet_buffer_peer(buf, i);

        // Validate packet data before processing
        if (!payload || length <= 0 || length > 65536 || !peer_addr) {
            printf("Invalid packet data: payload=%p, length=%d, peer_addr=%p\n", payload, length, peer_addr);
            continue;
        }

        //printf("Reading UDP of size %d\n", length);

        char ip[16];
        int ip_length = us_udp_packet_buffer_local_ip(buf, i, ip);
        if (!ip_length) {
            printf("We got no ip on received packet!\n");
            continue; // Don't exit, just skip this packet
        }

        //printf("Our received destination IP length is: %d\n", ip_length);

        int port = us_udp_socket_bound_port(s);
        //printf("We received packet on port: %d\n", port);

        /* We build our address based on what the dest addr is */
        struct sockaddr_storage local_addr = {0};
        if (ip_length == 16) {
            struct sockaddr_in6 *ipv6 = (struct sockaddr_in6 *) &local_addr;

            ipv6->sin6_family = AF_INET6;
            ipv6->sin6_port = ntohs(port);
            memcpy(ipv6->sin6_addr.s6_addr, ip, 16);
        } else if (ip_length == 4) {
            struct sockaddr_in *ipv4 = (struct sockaddr_in *) &local_addr;

            ipv4->sin_family = AF_INET;
            ipv4->sin_port = ntohs(port);
            memcpy(&ipv4->sin_addr.s_addr, ip, 4);
        } else {
            printf("Invalid IP length: %d\n", ip_length);
            continue;
        }

        lsquic_engine_t *client_engine = get_client_engine(context);
        if (!client_engine) {
            printf("ERROR: Client engine is null\n");
            continue;
        }

        // For client connections, use the persistent peer context from the UDP socket extension area
        struct quic_peer_ctx *peer_ctx = (struct quic_peer_ctx *)((char *)s + sizeof(struct us_udp_socket_t));
        
        // Add client connection to tracking table if not already there
        if (peer_ctx && peer_ctx->connection && context->connection_table) {
            // Check if this connection is already in the table
            us_quic_connection_t *existing = find_connection_by_peer(context->connection_table, (struct sockaddr *)peer_addr);
            if (!existing && peer_ctx->connection->lsquic_conn) {
                // Add it to the tracking table now that we have the peer address
                if (add_connection_to_table(context->connection_table, peer_ctx->connection->lsquic_conn, peer_ctx->connection, (struct sockaddr *)peer_addr) == 0) {
                    // printf("Added client connection to tracking table with peer address\n");
                }
            }
        }
        
        // Debug print the packet
        // printf("Client processing packet %d: length=%d\n", i, length);
        
        int ret = lsquic_engine_packet_in(client_engine, (const unsigned char *)payload, length, (struct sockaddr *) &local_addr, peer_addr, (void *) peer_ctx, 0);
        // printf("  lsquic_engine_packet_in (client) returned: %d\n", ret);
        (void)ret; // Suppress unused variable warning


    }

    // Process connections after receiving packets to handle state changes
    lsquic_engine_t *engine = get_client_engine(context);
    if (engine) {
        lsquic_engine_process_conns(engine);
        
        // Also check if we have unsent packets and trigger send
        if (lsquic_engine_has_unsent_packets(engine)) {
            lsquic_engine_send_unsent_packets(engine);
        }
    }

}

// Wrapper function to match uSockets UDP callback signature
void on_udp_socket_data_wrapper(struct us_udp_socket_t *s, void *buf, int packets) {
    on_udp_socket_data(s, (struct us_udp_packet_buffer_t *)buf, packets);
}

/* Enhanced sweep function to clean up closed connections and sockets following usockets patterns */
void us_internal_quic_sweep_closed(us_quic_socket_context_t *context) {
    if (!context) return;
    
    /* Free closed connections */
    while (context->closing_connections) {
        us_quic_connection_t *conn = context->closing_connections;
        context->closing_connections = conn->next;
        
        /* Remove from connection table before cleanup */
        if (conn->lsquic_conn && context->connection_table) {
            remove_connection_from_table(context->connection_table, (lsquic_conn_t *)conn->lsquic_conn);
        }
        
        /* Connection cleanup - lsquic will handle stream cleanup */
        
        /* Free the peer context if it exists */
        if (conn->peer_ctx) {
            /* For server connections, we allocated the peer_ctx, so free it */
            if (!conn->socket || !conn->socket->is_client) {
                free(conn->peer_ctx);
            }
            /* For client connections, peer_ctx points to UDP socket extension area, don't free */
            conn->peer_ctx = NULL;
        }
        
        free(conn);
    }
    
    /* Free closed sockets */
    while (context->closing_sockets) {
        us_quic_socket_t *socket = context->closing_sockets;
        context->closing_sockets = socket->next;
        
        /* Close the UDP socket if this is a client socket */
        if (socket->is_client && socket->udp_socket) {
            us_udp_socket_close(socket->udp_socket);
        }
        
        free(socket);
    }
}

/* Add connection to deferred cleanup list */
static void schedule_connection_cleanup(us_quic_socket_context_t *context, us_quic_connection_t *conn) {
    if (!context || !conn) return;
    
    conn->is_closed = 1;
    conn->next = context->closing_connections;
    context->closing_connections = conn;
}

/* Helper function to add server connection to tracking table with peer address */
static void add_server_connection_to_table(us_quic_socket_context_t *context, lsquic_conn_t *lsquic_conn, us_quic_connection_t *quic_conn, const struct sockaddr *peer_addr) {
    if (!context || !context->connection_table || !lsquic_conn || !quic_conn || !peer_addr) {
        return;
    }
    
    if (add_connection_to_table(context->connection_table, lsquic_conn, quic_conn, peer_addr) != 0) {
        printf("WARNING: Failed to add server connection to tracking table\n");
    } else {
        // printf("Added server connection %p to tracking table\n", lsquic_conn);
    }
}

/* Add socket to deferred cleanup list */
static void schedule_socket_cleanup(us_quic_socket_context_t *context, us_quic_socket_t *socket) {
    if (!context || !socket) return;
    
    socket->is_closed = 1;
    socket->next = context->closing_sockets;
    context->closing_sockets = socket;
}

void on_udp_socket_data(struct us_udp_socket_t *s, struct us_udp_packet_buffer_t *buf, int packets) {

    // printf("UDP server socket got data: %p, packets: %d\n", s, packets);

    /* The user data is now the listen socket structure */
    us_quic_listen_socket_t *listen_socket = (us_quic_listen_socket_t *)us_udp_socket_user(s);
    if (!listen_socket) {
        printf("ERROR: No listen socket found in UDP server socket\n");
        return;
    }
    
    us_quic_socket_context_t *context = listen_socket->context;
    if (!context) {
        printf("ERROR: No context found in UDP server socket\n");
        return;
    }
    
    if (!buf) {
        printf("ERROR: Null packet buffer in UDP server handler\n");
        return;
    }
    
    if (packets <= 0) {
        return;
    }

    // process conns now? to accept new connections?
    lsquic_engine_t *server_engine = get_server_engine(context);
    if (server_engine) {
        // printf("Processing server connections on engine: %p\n", server_engine);
        // Process connections before processing packets to ensure connections are ready
        lsquic_engine_process_conns(server_engine);
    }

    /* We just shove it to lsquic */
    for (int i = 0; i < packets; i++) {
        char *payload = us_udp_packet_buffer_payload(buf, i);
        int length = us_udp_packet_buffer_payload_length(buf, i);
        // ECN not available in current uSockets API - remove this line
        // int ecn = us_udp_packet_buffer_ecn(buf, i);
        void *peer_addr = us_udp_packet_buffer_peer(buf, i);

        // Validate packet data before processing
        if (!payload || length <= 0 || length > 65536 || !peer_addr) {
            printf("Invalid server packet data: payload=%p, length=%d, peer_addr=%p\n", payload, length, peer_addr);
            continue;
        }

        //printf("Reading UDP of size %d\n", length);

        char ip[16];
        int ip_length = us_udp_packet_buffer_local_ip(buf, i, ip);
        if (!ip_length) {
            printf("We got no ip on received packet!\n");
            continue; // Don't exit, just skip this packet
        }

        //printf("Our received destination IP length is: %d\n", ip_length);

        int port = us_udp_socket_bound_port(s);
        //printf("We received packet on port: %d\n", port);

        /* We build our address based on what the dest addr is */
        struct sockaddr_storage local_addr = {0};
        if (ip_length == 16) {
            struct sockaddr_in6 *ipv6 = (struct sockaddr_in6 *) &local_addr;

            ipv6->sin6_family = AF_INET6;
            ipv6->sin6_port = ntohs(port);
            memcpy(ipv6->sin6_addr.s6_addr, ip, 16);
        } else if (ip_length == 4) {
            struct sockaddr_in *ipv4 = (struct sockaddr_in *) &local_addr;

            ipv4->sin_family = AF_INET;
            ipv4->sin_port = ntohs(port);
            memcpy(&ipv4->sin_addr.s_addr, ip, 4);
        } else {
            printf("Invalid server IP length: %d\n", ip_length);
            continue;
        }

        if (!server_engine) {
            printf("ERROR: Server engine is null\n");
            continue;
        }

        // For server packets, try to find existing connection first
        us_quic_connection_t *existing_conn = find_connection_by_peer(context->connection_table, (struct sockaddr *)peer_addr);
        void *peer_ctx_to_use = NULL;
        
        if (existing_conn && existing_conn->peer_ctx) {
            // Use existing connection's peer context
            peer_ctx_to_use = existing_conn->peer_ctx;
            // printf("Server using existing connection peer_ctx=%p for packet %d\n", peer_ctx_to_use, i);
        } else {
            // For new connections, pass the listen socket as peer_ctx
            peer_ctx_to_use = (void *)listen_socket;
            // printf("Server using listen socket as peer_ctx=%p for new connection, packet %d\n", peer_ctx_to_use, i);
        }
        
        if (!server_engine) {
            printf("  ERROR: Engine is NULL!\n");
            continue;
        }
        
        int ret = lsquic_engine_packet_in(server_engine, (const unsigned char *)payload, length, (struct sockaddr *) &local_addr, peer_addr, peer_ctx_to_use, 0);
        // printf("  lsquic_engine_packet_in returned: %d\n", ret);
        
        // Check if we have any connections to process
        if (ret == 0) {
            // printf("  Packet accepted, processing connections...\n");
            
            // For new server connections, add them to the connection tracking table
            // This ensures proper peer context management and prevents memory leaks
            if (!existing_conn) {
                // This might be a new connection, check if one was created
                us_quic_connection_t *new_conn = find_connection_by_peer(context->connection_table, (struct sockaddr *)peer_addr);
                if (!new_conn) {
                    // Connection hasn't been added yet, it will be added in on_new_conn
                    // For now, just mark that we processed a packet for a potential new connection
                }
            }
        }
        
        // Connection tracking is now handled properly via the connection table
        // No memory leaks as peer contexts are managed per-connection
        
        // IMPORTANT: Call process_conns after accepting the packet
        if (ret == 0) {
            lsquic_engine_process_conns(server_engine);
        }


    }

    if (server_engine) {
        lsquic_engine_process_conns(server_engine);
        
        // Check if the server has packets to send
        if (lsquic_engine_has_unsent_packets(server_engine)) {
            // printf("Server has unsent packets, sending...\n");
            lsquic_engine_send_unsent_packets(server_engine);
        }
    }

}

/* Let's use this on Windows and macOS where it is not defined (todo: put in bsd.h) */
#ifndef UIO_MAXIOV
#define UIO_MAXIOV 1024
#endif

/* Server and client packet out is identical */
int send_packets_out(void *ctx, const struct lsquic_out_spec *specs, unsigned n_specs) {
    // printf("send_packets_out called with %u packets\n", n_specs);
#ifndef _WIN32
    // For now, send packets one by one using regular sendto
    // TODO: Optimize with proper batch sending using uSockets API
    int sent = 0;
    for (unsigned i = 0; i < n_specs; i++) {
        // Get the peer context - it could be either a connection, listen socket, or direct peer_ctx
        void *peer_ctx_raw = specs[i].peer_ctx;
        struct us_udp_socket_t *udp_socket = NULL;
        
        // printf("  Packet %u: peer_ctx_raw=%p\n", i, peer_ctx_raw);
        
        if (!peer_ctx_raw) {
            printf("ERROR: NULL peer_ctx_raw for packet %u\n", i);
            continue;
        }
        
        // Strategy 1: Try as a us_quic_listen_socket_t first (for server packets)
        us_quic_listen_socket_t *listen = (us_quic_listen_socket_t *)peer_ctx_raw;
        if (listen && listen->udp_socket) {
            // Validate the UDP socket before using it
            int fd = us_poll_fd((struct us_poll_t *) listen->udp_socket);
            if (fd >= 0) {
                udp_socket = listen->udp_socket;
                // printf("  Using listen socket: %p, udp_socket: %p, fd: %d\n", listen, udp_socket, fd);
            } else {
                printf("  Listen socket has invalid fd: %d\n", fd);
            }
        }
        
        // Strategy 2: Try as direct peer_ctx (for client connections) 
        if (!udp_socket) {
            struct quic_peer_ctx *peer_ctx = (struct quic_peer_ctx *)peer_ctx_raw;
            if (peer_ctx && peer_ctx->udp_socket) {
                // Validate the UDP socket before using it
                int fd = us_poll_fd((struct us_poll_t *) peer_ctx->udp_socket);
                if (fd >= 0) {
                    udp_socket = peer_ctx->udp_socket;
                    // printf("  Using direct peer_ctx: %p, udp_socket: %p, fd: %d\n", peer_ctx, udp_socket, fd);
                } else {
                    printf("  Direct peer_ctx has invalid fd: %d\n", fd);
                }
            }
        }
        
        if (!udp_socket) {
            printf("ERROR: No valid UDP socket found for packet %u (peer_ctx_raw=%p)\n", i, peer_ctx_raw);
            continue;
        }
        
        int fd = us_poll_fd((struct us_poll_t *) udp_socket);
        
        // Double-check the file descriptor is valid
        if (fd < 0) {
            printf("ERROR: Invalid file descriptor %d for UDP socket %p\n", fd, udp_socket);
            continue;
        }
        
        // Combine all iovecs into a single buffer for simple sending
        size_t total_len = 0;
        for (int j = 0; j < specs[i].iovlen; j++) {
            total_len += specs[i].iov[j].iov_len;
        }
        
        if (total_len > 0) {
            // Simple approach: use sendto for each packet
            // In a real implementation, we'd want to use the proper uSockets batch API
            char buffer[2048]; // Maximum UDP payload size
            if (total_len <= sizeof(buffer)) {
                size_t offset = 0;
                for (int j = 0; j < specs[i].iovlen; j++) {
                    memcpy(buffer + offset, specs[i].iov[j].iov_base, specs[i].iov[j].iov_len);
                    offset += specs[i].iov[j].iov_len;
                }
                
                // Debug: print destination address
                if (specs[i].dest_sa->sa_family == AF_INET) {
                    // struct sockaddr_in *sin = (struct sockaddr_in *)specs[i].dest_sa;
                    // printf("  Sending %zu bytes to %s:%d\n", total_len,
                    //        inet_ntoa(sin->sin_addr), ntohs(sin->sin_port));
                }
                
                ssize_t ret = sendto(fd, buffer, total_len, MSG_DONTWAIT, 
                                   specs[i].dest_sa, 
                                   (specs[i].dest_sa->sa_family == AF_INET) ? 
                                   sizeof(struct sockaddr_in) : sizeof(struct sockaddr_in6));
                if (ret > 0) {
                    sent++;
                } else {
                    // Handle backpressure
                    if (errno == EAGAIN || errno == EWOULDBLOCK) {
                        return sent;
                    }
                    printf("  sendto error: %s (errno: %d)\n", strerror(errno), errno);
                    return -1;
                }
            }
        }
    }
    return sent;
#else
    // Windows implementation would go here
    return n_specs;
#endif
}

lsquic_conn_ctx_t *on_new_conn(void *stream_if_ctx, lsquic_conn_t *c) {
    us_quic_socket_context_t *context = stream_if_ctx;

    lsquic_engine_t *client_engine = get_client_engine(context);
    lsquic_engine_t *server_engine = get_server_engine(context);
    
    // printf("on_new_conn - Context: %p, is_client: %d\n", context, 
    //        (context && lsquic_conn_get_engine(c) == client_engine) ? 1 : 0);

    if (!context) {
        printf("ERROR: No context in on_new_conn\n");
        return NULL;
    }

    int is_client = 0;
    if (lsquic_conn_get_engine(c) == client_engine) {
        is_client = 1;
    } else if (lsquic_conn_get_engine(c) == server_engine) {
        is_client = 0;
        // printf("SERVER: New incoming connection on server engine\n");
    } else {
        printf("ERROR: Unknown engine for connection - conn engine: %p, server: %p, client: %p\n",
               lsquic_conn_get_engine(c), server_engine, client_engine);
    }
    
    if (is_client) {
        /* For client connections, the socket is already set as the connection context */
        us_quic_socket_t *socket = (us_quic_socket_t *) lsquic_conn_get_ctx(c);
        if (!socket) {
            printf("ERROR: No socket found in client connection context\n");
            return NULL;
        }
        // printf("Client socket retrieved: %p\n", socket);
        
            /* Create a us_quic_connection_t to track this connection */
        us_quic_connection_t *conn = malloc(sizeof(us_quic_connection_t) + 256);
        if (!conn) {
            printf("ERROR: Failed to allocate client connection\n");
            return NULL;
        }
        memset(conn, 0, sizeof(us_quic_connection_t) + 256);
        
        /* Client connection initialized - lsquic will manage streams */
        conn->socket = socket;
        conn->lsquic_conn = c;
        conn->is_closed = 0;
        conn->next = NULL;
        
        /* Store the connection in the socket for easy access */
        socket->lsquic_conn = c;
        
        /* Use the persistent peer context from the UDP socket extension area */
        struct quic_peer_ctx *peer_ctx = (struct quic_peer_ctx *)((char *)socket->udp_socket + sizeof(struct us_udp_socket_t));
        peer_ctx->connection = conn;  // Set back-reference to connection
        conn->peer_ctx = peer_ctx;
        
        /* For client connections, we can't add to tracking table yet as we don't have peer address
         * The peer address will be available during packet processing */
        
        /* Call the on_open callback immediately for client connections.
         * The connection object exists, so the user can create streams.
         * If the connection fails, the error callback will be invoked. */
        if (context->on_open) {
            // printf("Calling on_open callback for client socket %p\n", socket);
            context->on_open(socket, 1); // is_client = 1
        }
        
        /* Let the user explicitly create streams via socket.createStream() calls */
        // printf("Client connection established, ready for stream creation\n");
        
        /* CRITICAL FIX: Return the CONTEXT (not the connection) as the lsquic connection context
         * This is what the on_read callback expects to find */
        return (lsquic_conn_ctx_t *) context;
    } else {
        /* For server connections, get the listen socket from the peer context */
        us_quic_listen_socket_t *listen_socket = (us_quic_listen_socket_t *) lsquic_conn_get_peer_ctx(c, NULL);
        if (!listen_socket) {
            printf("ERROR: No listen socket found for server connection\n");
            return NULL;
        }
        
        /* Create a new us_quic_connection_t for this server connection */
        us_quic_connection_t *conn = malloc(sizeof(us_quic_connection_t) + 256);
        if (!conn) {
            printf("ERROR: Failed to allocate server connection\n");
            return NULL;
        }
        
        memset(conn, 0, sizeof(us_quic_connection_t) + 256);
        
        /* Server connection initialized - lsquic will manage streams */
        conn->socket = listen_socket;  // Server connections reference the listen socket
        conn->lsquic_conn = c;
        conn->is_closed = 0;
        conn->next = NULL;
        
        /* For server connections, create a proper peer context */
        struct quic_peer_ctx *peer_ctx = malloc(sizeof(struct quic_peer_ctx));
        if (!peer_ctx) {
            printf("ERROR: Failed to allocate server peer context\n");
            free(conn);
            return NULL;
        }
        peer_ctx->udp_socket = listen_socket->udp_socket;
        peer_ctx->context = context;
        peer_ctx->connection = conn;
        memset(peer_ctx->reserved, 0, sizeof(peer_ctx->reserved));
        conn->peer_ctx = peer_ctx;
        
        /* Connection will be added to tracking table during packet processing
         * when we have the peer address from the incoming packet */
        
        /* CRITICAL FIX: Set the CONTEXT (not the connection) as the lsquic connection context
         * This is what the on_read callback expects to find */
        lsquic_conn_set_ctx(c, (lsquic_conn_ctx_t *) context);
        
        /* Store the connection in the listen socket for backward compatibility */
        listen_socket->lsquic_conn = c;
        
        /* Call the on_connection callback for server connections */
        // printf("Server connection: context=%p, context->on_connection=%p\n", context, context ? context->on_connection : NULL);
        if (context->on_connection) {
            // printf("Server connection using listen socket %p\n", listen_socket);
            context->on_connection((us_quic_socket_t *)listen_socket);
        } else {
            printf("WARNING: on_connection callback is NULL for server connection\n");
        }
        
        /* CRITICAL FIX: Do NOT auto-create streams on connection establishment.
         * Let the user explicitly create streams via socket.createStream() calls.
         * This prevents multiple streams from being created when only one is expected. */
        // printf("Server connection established, waiting for explicit stream creation\n");
        
        /* Return the connection context */
        return lsquic_conn_get_ctx(c);
    }
}

void us_quic_socket_create_stream(us_quic_socket_t *s, int ext_size) {
    if (!s) {
        printf("ERROR: Invalid socket in create_stream\n");
        return;
    }
    
    // Check if this socket has a connection
    if (s->lsquic_conn) {
        // printf("Creating stream on connection %p\n", s->lsquic_conn);
        lsquic_conn_make_stream((lsquic_conn_t *)s->lsquic_conn);
    } else {
        printf("ERROR: No connection associated with socket %p\n", s);
    }
    
    (void)ext_size; // Suppress unused warning for now
}


void on_conn_closed(lsquic_conn_t *c) {
    // printf("on_conn_closed called for connection %p!\n", c);
    
    /* CRITICAL FIX: The connection context is now the socket context, not the connection
     * This was changed in on_new_conn where we set lsquic_conn_set_ctx(c, context) */
    us_quic_socket_context_t *context = (us_quic_socket_context_t *)lsquic_conn_get_ctx(c);
    if (!context) {
        printf("ERROR: No context found in on_conn_closed\n");
        return;
    }
    
    // printf("Found context %p in connection closure\n", context);
    
    /* Find the connection in our tracking table and schedule it for cleanup */
    if (context->connection_table) {
        for (int i = 0; i < QUIC_CONNECTION_TABLE_SIZE; i++) {
            struct quic_connection_entry *entry = context->connection_table->buckets[i];
            while (entry) {
                if (entry->lsquic_conn == c) {
                    /* Schedule the connection for deferred cleanup */
                    schedule_connection_cleanup(context, entry->quic_conn);
                    
                    /* Call the on_close callback if available */
                    if (context->on_close && entry->quic_conn->socket) {
                        context->on_close(entry->quic_conn->socket);
                    }
                    
                    // printf("Connection %p scheduled for cleanup\n", c);
                    return;
                }
                entry = entry->next;
            }
        }
    }
    
    // printf("Connection %p closed, but not found in tracking table\n", c);
}

lsquic_stream_ctx_t *on_new_stream(void *stream_if_ctx, lsquic_stream_t *s) {
    // printf("on_new_stream called, stream=%p, context=%p\n", s, stream_if_ctx);

    /* In true usockets style we always want read */
    lsquic_stream_wantread(s, 1);

    us_quic_socket_context_t *context = stream_if_ctx;
    
    if (!context) {
        printf("ERROR: No context in on_new_stream\n");
        return NULL;
    }

    // Enhanced validation for the context pointer
    // Check if it's a reasonable memory address range for user-space pointers
    if ((uintptr_t)context < 0x1000 || (uintptr_t)context > 0x7fffffffffff) {
        printf("ERROR: Invalid context pointer in on_new_stream: %p\n", context);
        return NULL;
    }

    // Get the connection and determine client/server
    lsquic_conn_t *lsquic_conn = lsquic_stream_conn(s);
    if (!lsquic_conn) {
        printf("ERROR: No connection for stream\n");
        return NULL;
    }
    
    // CRITICAL FIX: The issue is that stream_if_ctx might not be the socket context
    // For server connections, we need to get the context from the connection context
    // since the stream_if_ctx might be pointing to incorrect memory
    
    // First, try to get the connection context which was set in on_new_conn
    lsquic_conn_ctx_t *conn_ctx = lsquic_conn_get_ctx(lsquic_conn);
    if (conn_ctx) {
        // For server connections, we set the connection context to be the socket context
        us_quic_socket_context_t *verified_context = (us_quic_socket_context_t *)conn_ctx;
        
        // Verify this is a valid context by checking if it has valid engines
        if (verified_context && 
            (get_server_engine(verified_context) != NULL || get_client_engine(verified_context) != NULL)) {
            // printf("Using connection context instead of stream_if_ctx: %p -> %p\n", 
            //        context, verified_context);
            context = verified_context;
        }
    }
    
    // Now safely access context fields
    lsquic_engine_t *client_engine = get_client_engine(context);
    lsquic_engine_t *server_engine = get_server_engine(context);
    void (*on_stream_open_callback)(us_quic_stream_t *, int) = context->on_stream_open;
    
    // printf("Engines - server: %p, client: %p, connection engine: %p\n", 
    //        server_engine, client_engine, lsquic_conn_get_engine(lsquic_conn));
    
    // Determine if this is a client or server connection
    lsquic_engine_t *conn_engine = lsquic_conn_get_engine(lsquic_conn);
    int is_client = 0;
    
    if (conn_engine == client_engine) {
        is_client = 1;
    } else if (conn_engine == server_engine) {
        is_client = 0;
    } else {
        printf("ERROR: Connection engine %p doesn't match server %p or client %p\n",
               conn_engine, server_engine, client_engine);
        return NULL;
    }
    
    // Get the stream ID from lsquic
    uint64_t stream_id = lsquic_stream_id(s);
    // printf("New stream with ID: %llu (client: %d)\n", (unsigned long long)stream_id, is_client);
    (void)stream_id; // Suppress unused variable warning
    
    // Allocate enhanced extension data for stream management
    struct us_quic_stream_ext {
        void *user_data;              // User extension data
        struct header_set_hd *header_set;  // Per-stream header management
        int stream_flags;             // Stream state flags
        char padding[48];             // Ensure 64-byte total size
    } *ext = malloc(sizeof(struct us_quic_stream_ext));
    
    if (!ext) {
        printf("ERROR: Failed to allocate stream extension memory\n");
        return NULL;
    }
    memset(ext, 0, sizeof(struct us_quic_stream_ext));
    
    // Set the extension data as lsquic stream context
    lsquic_stream_set_ctx(s, (lsquic_stream_ctx_t *)ext);
    
    // printf("on_new_stream: stream_id=%llu, is_client=%d, on_stream_open=%p\n", 
    //        (unsigned long long)stream_id, is_client, on_stream_open_callback);
    
    // printf("Stream %p opened, stream_id=%llu, is_client=%d\n", s, 
    //        (unsigned long long)stream_id, is_client);
    
    // Only call the callback if it's valid
    if (on_stream_open_callback) {
        // printf("Calling on_stream_open callback at %p with stream=%p, is_client=%d\n", 
        //        on_stream_open_callback, s, is_client);
        fflush(stdout);  // Force output before calling
        on_stream_open_callback((us_quic_stream_t *) s, is_client);
        // printf("on_stream_open callback completed\n");
    } else {
        printf("WARNING: on_stream_open callback is NULL\n");
    }

    return (lsquic_stream_ctx_t *)ext;
}

//#define V(v) (v), strlen(v)

// header_buf is already defined in the context struct above
// Using the per-context header buffer to avoid redefinition
#if 0
struct header_buf
{
    unsigned    off;
    char        buf[UINT16_MAX];
};

int
header_set_ptr (struct lsxpack_header *hdr, struct header_buf *header_buf,
                const char *name, size_t name_len,
                const char *val, size_t val_len)
{
    if (header_buf->off + name_len + val_len <= sizeof(header_buf->buf))
    {
        memcpy(header_buf->buf + header_buf->off, name, name_len);
        memcpy(header_buf->buf + header_buf->off + name_len, val, val_len);
        lsxpack_header_set_offset2(hdr, header_buf->buf + header_buf->off,
                                            0, name_len, name_len, val_len);
        header_buf->off += name_len + val_len;
        return 0;
    }
    else
        return -1;
}
#endif

/* Inline header setting function using context buffer */
static int header_set_ptr_inline(struct lsxpack_header *hdr, struct header_buf *header_buf,
                const char *name, size_t name_len,
                const char *val, size_t val_len)
{
    if (header_buf->off + name_len + val_len <= sizeof(header_buf->buf))
    {
        memcpy(header_buf->buf + header_buf->off, name, name_len);
        memcpy(header_buf->buf + header_buf->off + name_len, val, val_len);
        lsxpack_header_set_offset2(hdr, header_buf->buf + header_buf->off,
                                            0, name_len, name_len, val_len);
        header_buf->off += name_len + val_len;
        return 0;
    }
    else
        return -1;
}

/* Header storage moved to context to avoid global state */
// These will be moved to per-context storage

void us_quic_socket_context_set_header(us_quic_socket_context_t *context, int index, const char *key, int key_length, const char *value, int value_length) {
    if (header_set_ptr_inline(&context->headers_arr[index], &context->header_buffer, key, key_length, value, value_length) != 0) {
        printf("CANNOT FORMAT HEADER!\n");
        exit(0);
    }
}

void us_quic_socket_context_send_headers(us_quic_socket_context_t *context, us_quic_stream_t *s, int num, int has_body) {

    lsquic_http_headers_t headers = {
        .count = num,
        .headers = context->headers_arr,
    };
    // last here is whether this is eof or not (has body)
    if (lsquic_stream_send_headers((lsquic_stream_t *) s, &headers, has_body ? 0 : 1)) {// pass 0 if data
        printf("CANNOT SEND HEADERS!\n");
        exit(0);
    }

    /* Reset header offset */
    context->header_buffer.off = 0;
}

int us_quic_stream_is_client(us_quic_stream_t *s) {
    us_quic_socket_context_t *context = (us_quic_socket_context_t *) lsquic_conn_get_ctx(lsquic_stream_conn((lsquic_stream_t *) s));

    int is_client = 0;
    lsquic_engine_t *client_engine = get_client_engine(context);
    if (lsquic_conn_get_engine(lsquic_stream_conn((lsquic_stream_t *) s)) == client_engine) {
        is_client = 1;
    }
    return is_client;
}

us_quic_socket_t *us_quic_stream_socket(us_quic_stream_t *s) {
    lsquic_conn_t *conn = lsquic_stream_conn((lsquic_stream_t *) s);
    if (!conn) {
        return NULL;
    }
    
    // Get the connection from the lsquic context
    us_quic_connection_t *quic_conn = (us_quic_connection_t *) lsquic_conn_get_ctx(conn);
    if (!quic_conn) {
        return NULL;
    }
    
    // Return the socket from the connection
    return quic_conn->socket;
}

//#include <errno.h>


// only for servers?
static void on_read(lsquic_stream_t *s, lsquic_stream_ctx_t *h) {
    // printf("on_read called for stream %p, context %p\n", s, h);

    /* Get the connection context which should point to the socket context */
    lsquic_conn_t *conn = lsquic_stream_conn(s);
    if (!conn) {
        printf("ERROR: No connection for stream in on_read\n");
        return;
    }
    
    us_quic_socket_context_t *context = (us_quic_socket_context_t *) lsquic_conn_get_ctx(conn);
    if (!context) {
        printf("ERROR: No context for connection in on_read\n");
        return;
    }

    /* This object is (and must be) fetched from a stream by
     * calling lsquic_stream_get_hset() before the stream can be read. */
    /* This call must precede calls to lsquic_stream_read(), lsquic_stream_readv(), and lsquic_stream_readf(). */
    void *header_set = lsquic_stream_get_hset(s);
    if (header_set) {
        context->on_stream_headers((us_quic_stream_t *) s);
        // header management is obviously broken and needs to be per-stream
        leave_all();
    }

    // all of this logic should be moved to uws and WE here should only hand over the data

    char temp[4096] = {0};
    int nr = lsquic_stream_read(s, temp, 4096);

    // emit on_end when we receive fin, regardless of whether we emitted data yet
    if (nr == 0) {
        // any time we read EOF we stop reading
        lsquic_stream_wantread(s, 0);
        context->on_stream_end((us_quic_stream_t *) s);
    } else if (nr == -1) {
        if (errno != EWOULDBLOCK) {
            // error handling should not be needed if we use lsquic correctly
            printf("UNHANDLED ON_READ ERROR: errno=%d (%s)\n", errno, strerror(errno));
            // Don't exit, just stop reading from this stream
            lsquic_stream_wantread(s, 0);
            return;
        }
        // if we for some reason could not read even though we were told to read, we just ignore it
        // this should not really happen but whatever
    } else {
        // otherwise if we have data, then emit it
        context->on_stream_data((us_quic_stream_t *) s, temp, nr);
    }

    // that's it
    return;

    //lsquic_stream_readf

    // printf("read returned: %d\n", nr);

    // we will get 9, ebadf if we read from a closed stream
    if (nr == -1) {
        printf("Error in reading! errno is: %d\n", errno);
        if (errno != EWOULDBLOCK) {
            printf("Errno is not EWOULDBLOCK\n");
        } else {
            printf("Errno is would block, fine!\n");
        }
        exit(0);
        return;
    }

    /* We have reached EOF */
    if (nr == 0) {

        /* Are we polling for writable (todo: make this check faster)? */
        if (lsquic_stream_wantwrite(s, 1)) {

            // we happened to be polling for writable so leave the connection open until on_write eventually closes it
            printf("we are polling for write, so leaving the stream open!\n");

            // stop reading though!
            lsquic_stream_wantread(s, 0); // I hope this is fine? half open?

        } else {
            // we weren't polling for writable so reset it to old value
            lsquic_stream_wantwrite(s, 0);

            // I guess we can close it since we have called shutdown before this so data should flow out
            lsquic_stream_close(s);
        }

        // reached the EOF
        //lsquic_stream_close(s);
        //lsquic_stream_wantread(s, 0);
        return;
    }

    //printf("read: %d\n", nr);

    //printf("%s\n", temp);

    // why do we get tons of zero reads?
    // maybe it doesn't matter, if we can parse this input then we are fine
    //lsquic_stream_wantread(s, 0);
    //lsquic_stream_wantwrite(s, 1);

    // printf("on_stream_data: %d\n", nr);
    context->on_stream_data((us_quic_stream_t *) s, temp, nr);
}

int us_quic_stream_write(us_quic_stream_t *s, char *data, int length) {
    // printf("us_quic_stream_write called: stream=%p, data=%p, length=%d\n", s, data, length);
    
    if (!s) {
        printf("ERROR: NULL stream in us_quic_stream_write\n");
        return -1;
    }
    
    if (!data || length <= 0) {
        printf("ERROR: Invalid data or length in us_quic_stream_write\n");
        return -1;
    }
    
    int ret = lsquic_stream_write((lsquic_stream_t *) s, data, length);
    // printf("lsquic_stream_write returned: %d (requested %d)\n", ret, length);
    
    if (ret > 0) {
        // Flush the stream to ensure data is sent immediately
        int flush_ret = lsquic_stream_flush((lsquic_stream_t *) s);
        // printf("lsquic_stream_flush returned: %d\n", flush_ret);
        (void)flush_ret; // Suppress unused variable warning
        
        // Get the connection and process it to send packets
        lsquic_conn_t *conn = lsquic_stream_conn((lsquic_stream_t *) s);
        if (conn) {
            lsquic_engine_t *engine = lsquic_conn_get_engine(conn);
            if (engine) {
                // printf("Processing engine after write to send packets\n");
                lsquic_engine_process_conns(engine);
                if (lsquic_engine_has_unsent_packets(engine)) {
                    lsquic_engine_send_unsent_packets(engine);
                }
            }
        }
    }
    
    // just like otherwise, we automatically poll for writable when failed
    if (ret != length) {
        // printf("Partial write, requesting writable notification\n");
        lsquic_stream_wantwrite((lsquic_stream_t *) s, 1);
    } else {
        // printf("Full write successful, no longer need writable notification\n");
        lsquic_stream_wantwrite((lsquic_stream_t *) s, 0);
    }
    return ret;
}

static void on_write (lsquic_stream_t *s, lsquic_stream_ctx_t *h) {

    us_quic_socket_context_t *context = (us_quic_socket_context_t *) lsquic_conn_get_ctx(lsquic_stream_conn(s));

    context->on_stream_writable((us_quic_stream_t *) s);

    // here we might want to check if the user did write to failure or not, and if the user did not write, stop polling for writable
    // i think that is what we do for http1
}

static void on_stream_close (lsquic_stream_t *s, lsquic_stream_ctx_t *h) {
    // printf("on_stream_close called for stream %p\n", s);
    
    // Get the stream ID for logging
    uint64_t stream_id = lsquic_stream_id(s);
    // printf("Stream ID %llu closed\n", (unsigned long long)stream_id);
    (void)stream_id; // Suppress unused variable warning
    
    // Get the connection and context for callback
    lsquic_conn_t *lsquic_conn = lsquic_stream_conn(s);
    if (lsquic_conn) {
        us_quic_socket_context_t *context = (us_quic_socket_context_t *)lsquic_conn_get_ctx(lsquic_conn);
        if (context && context->on_stream_close) {
            context->on_stream_close((us_quic_stream_t *)s);
        }
    }
    
    // Free the extension data if it exists
    if (h) {
        free(h);
    }
}

#include "openssl/ssl.h"

// External function from crypto/openssl.c for creating SSL contexts
extern SSL_CTX *create_ssl_context_from_bun_options(
    struct us_bun_socket_context_options_t options,
    enum create_bun_socket_error_t *err);

extern void us_internal_init_loop_ssl_data(struct us_loop_t *loop);

/* Forward declare needed UDP functions */

static char s_alpn[0x100];

int add_alpn (const char *alpn)
{
    size_t alpn_len, all_len;

    alpn_len = strlen(alpn);
    if (alpn_len > 255)
        return -1;

    all_len = strlen(s_alpn);
    if (all_len + 1 + alpn_len + 1 > sizeof(s_alpn))
        return -1;

    s_alpn[all_len] = alpn_len;
    memcpy(&s_alpn[all_len + 1], alpn, alpn_len);
    s_alpn[all_len + 1 + alpn_len] = '\0';
    return 0;
}

static int select_alpn(SSL *ssl, const unsigned char **out, unsigned char *outlen,
                    const unsigned char *in, unsigned int inlen, void *arg) {
    int r;

    // printf("select_alpn\n");

    r = SSL_select_next_proto((unsigned char **) out, outlen, in, inlen,
                                    (unsigned char *) s_alpn, strlen(s_alpn));
    if (r == OPENSSL_NPN_NEGOTIATED) {
        // printf("OPENSSL_NPN_NEGOTIATED\n");
        return SSL_TLSEXT_ERR_OK;
    }
    else
    {
        printf("no supported protocol can be selected!\n");
        //LSQ_WARN("no supported protocol can be selected from %.*s",
                                                    //(int) inlen, (char *) in);
        return SSL_TLSEXT_ERR_ALERT_FATAL;
    }
}

int server_name_cb(SSL *s, int *al, void *arg) {
    // printf("QUIC SNI server_name_cb\n");

    const char *servername = SSL_get_servername(s, TLSEXT_NAMETYPE_host_name);
    // printf("SNI hostname: %s\n", servername ? servername : "(none)");
    (void)servername; // Suppress unused variable warning

    // TODO: Implement proper SNI support for QUIC if needed
    // For now, we just use the default context

    return SSL_TLSEXT_ERR_OK;
}

// this one is required for servers
struct ssl_ctx_st *get_ssl_ctx(void *peer_ctx, const struct sockaddr *local) {
    // printf("getting ssl ctx now, peer_ctx: %p\n", peer_ctx);

    if (!peer_ctx) {
        printf("ERROR: No peer_ctx in get_ssl_ctx\n");
        return NULL;
    }

    struct us_quic_socket_context_s *context = NULL;
    
    // peer_ctx could be a connection, listen socket, or raw peer_ctx
    // Try as a connection first
    us_quic_connection_t *conn = (us_quic_connection_t *)peer_ctx;
    if (conn && conn->socket && conn->socket->context) {
        context = conn->socket->context;
    } else {
        // Try as a listen socket
        us_quic_listen_socket_t *listen = (us_quic_listen_socket_t *)peer_ctx;
        if (listen && listen->context) {
            context = listen->context;
        } else {
            // Try as a raw peer_ctx
            struct quic_peer_ctx *qctx = (struct quic_peer_ctx *)peer_ctx;
            if (qctx && qctx->context) {
                context = qctx->context;
            }
        }
    }
    
    if (!context) {
        printf("ERROR: Could not find context from peer_ctx\n");
        return NULL;
    }

    // Return the SSL context that was created when the QUIC context was initialized
    if (context->ssl_context) {
        // printf("Returning existing SSL context: %p\n", context->ssl_context);
        return context->ssl_context;
    }

    printf("ERROR: No SSL context found in QUIC context\n");
    return NULL;
}

SSL_CTX *sni_lookup(void *lsquic_cert_lookup_ctx, const struct sockaddr *local, const char *sni) {
    // printf("QUIC sni_lookup called for: %s\n", sni ? sni : "(null)");
    
    // The lsquic_cert_lookup_ctx should be our context
    if (!lsquic_cert_lookup_ctx) {
        printf("ERROR: No cert lookup context in sni_lookup\n");
        return NULL;
    }
    
    us_quic_socket_context_t *context = (us_quic_socket_context_t *)lsquic_cert_lookup_ctx;
    if (context->ssl_context) {
        // printf("SNI lookup returning SSL context: %p\n", context->ssl_context);
        return context->ssl_context;
    }
    
    printf("ERROR: No SSL context in sni_lookup\n");
    return NULL;
}

int log_buf_cb(void *logger_ctx, const char *buf, size_t len) {
    printf("%.*s\n", (int) len, buf);
    return 0;
}

int us_quic_stream_shutdown_read(us_quic_stream_t *s) {
    int ret = lsquic_stream_shutdown((lsquic_stream_t *) s, 0);
    if (ret != 0) {
        printf("cannot shutdown stream!\n");
        exit(0);
    }

    return 0;
}

void *us_quic_stream_ext(us_quic_stream_t *s) {
    struct us_quic_stream_ext {
        void *user_data;
        struct header_set_hd *header_set;
        int stream_flags;
        char padding[48];
    } *ext = (struct us_quic_stream_ext *)lsquic_stream_get_ctx((lsquic_stream_t *) s);
    
    return ext ? ext->user_data : NULL;
}

void us_quic_stream_close(us_quic_stream_t *s) {
    int ret = lsquic_stream_close((lsquic_stream_t *) s);
    if (ret != 0) {
        printf("cannot close stream!\n");
        exit(0);
    }

    return;
}

int us_quic_stream_shutdown(us_quic_stream_t *s) {
    int ret = lsquic_stream_shutdown((lsquic_stream_t *) s, 1);
    if (ret != 0) {
        printf("cannot shutdown stream!\n");
        exit(0);
    }

    return 0;
}

// header of header set
struct header_set_hd {
    int offset;
};

// Per-stream header set tracking (moved from global to per-stream)
// This will be managed per stream context instead of globally

// Header processing structure for stream-level management
struct processed_header {
    void *name, *value;
    int name_length, value_length;
};

// Stream extension structure definition (must match the one in on_new_stream)
struct us_quic_stream_ext {
    void *user_data;                    // User extension data
    struct header_set_hd *header_set;   // Per-stream header management
    int stream_flags;                   // Stream state flags
    char padding[48];                   // Ensure 64-byte total size
};

int us_quic_socket_context_get_header(us_quic_socket_context_t *context, int index, char **name, int *name_length, char **value, int *value_length) {
    // This function needs to be updated to work with per-stream header sets
    // For now, return 0 to indicate no headers available
    // TODO: Implement proper per-stream header retrieval
    (void)context; (void)index; (void)name; (void)name_length; (void)value; (void)value_length;
    return 0;
}

char pool[1000][4096];
int pool_top = 0;

void *take() {
    if (pool_top >= 1000) {
        printf("out of memory\n");
        return NULL; // Don't exit, return NULL instead
    }
    return pool[pool_top++];
}

void leave_all() {
    pool_top = 0;
}


// header set callbacks
void *hsi_create_header_set(void *hsi_ctx, lsquic_stream_t *stream, int is_push_promise) {

    //printf("hsi_create_header_set\n");

    void *hset = take();//malloc(1024);
    memset(hset, 0, sizeof(struct header_set_hd));

    // hsi_ctx is set in engine creation below

    // I guess we just return whatever here, what we return here is gettable via the stream

    // gettable via lsquic_stream_get_hset

    // return user defined header set

    return hset;
}

void hsi_discard_header_set(void *hdr_set) {
    // this is pretty much the destructor of above constructor

    // printf("hsi_discard_header!\n");
}

// one header set allocates one 8kb buffer from a linked list of available buffers


// 8kb of preallocated heap for headers
char header_decode_heap[1024 * 8];
int header_decode_heap_offset = 0;

struct lsxpack_header *hsi_prepare_decode(void *hdr_set, struct lsxpack_header *hdr, size_t space) {

    //printf("hsi_prepare_decode\n");
    
    // Validate space parameter - prevent buffer overflow
    if (space > 4096 - sizeof(struct lsxpack_header)) {
        // printf("Space too large: %zu\n", space);
        return NULL; // Don't exit, return NULL
    }

    if (!hdr) {
        char *mem = take();
        if (!mem) {
            // printf("Failed to allocate memory from pool\n");
            return NULL;
        }
        hdr = (struct lsxpack_header *) mem;//malloc(sizeof(struct lsxpack_header));
        memset(hdr, 0, sizeof(struct lsxpack_header));
        hdr->buf = mem + sizeof(struct lsxpack_header);//take();//malloc(space);
        lsxpack_header_prepare_decode(hdr, hdr->buf, 0, space);
    } else {
        hdr->val_len = space;
        //hdr->buf = realloc(hdr->buf, space);
    }

    return hdr;
}

int hsi_process_header(void *hdr_set, struct lsxpack_header *hdr) {

    // I guess this is the emitting of the header to app space

    //printf("hsi_process_header: %p\n", hdr);

    if (!hdr_set) {
        printf("ERROR: hdr_set is null\n");
        return -1;
    }

    struct header_set_hd *hd = hdr_set;
    struct processed_header *proc_hdr = (struct processed_header *) (hd + 1);

    if (!hdr) {
        //printf("end of headers!\n");

        // Store the header set in the stream extension data for per-stream management
        // last_hset = hd;  // Removed global state

        // mark end, well we can also just read the offset!
        //memset(&proc_hdr[hd->offset], 0, sizeof(struct processed_header));

        return 0;
    }

    // Bounds check for header offset - prevent buffer overflow
    if (hd->offset < 0 || hd->offset >= (4096 - sizeof(struct header_set_hd)) / sizeof(struct processed_header)) {
        printf("ERROR: Header offset out of bounds: %d\n", hd->offset);
        return -1;
    }

    // Validate header buffer bounds
    if (!hdr->buf || hdr->val_offset < 0 || hdr->name_offset < 0 || 
        hdr->val_len < 0 || hdr->name_len < 0 ||
        hdr->val_offset + hdr->val_len > 4096 ||
        hdr->name_offset + hdr->name_len > 4096) {
        printf("ERROR: Invalid header buffer bounds\n");
        return -1;
    }

    /*if (hdr->hpack_index) {
        printf("header has hpack index: %d\n", hdr->hpack_index);
    }

    if (hdr->qpack_index) {
        printf("header has qpack index: %d\n", hdr->qpack_index);
    }*/

    proc_hdr[hd->offset].value = &hdr->buf[hdr->val_offset];
    proc_hdr[hd->offset].name = &hdr->buf[hdr->name_offset];
    proc_hdr[hd->offset].value_length = hdr->val_len;
    proc_hdr[hd->offset].name_length = hdr->name_len;

    //printf("header %.*s = %.*s\n", hdr->name_len, &hdr->buf[hdr->name_offset], hdr->val_len, &hdr->buf[hdr->val_offset]);

    hd->offset++;

    return 0;
}

//extern us_quic_socket_context_t *context;

void timer_cb(struct us_timer_t *t) {
    static int count = 0;
    
    // Get the loop and its data
    struct us_loop_t *loop = us_timer_loop(t);
    struct us_internal_loop_data_t *loop_data = (struct us_internal_loop_data_t *)loop;
    
    // if (count++ < 10) {
    //     printf("Timer tick %d - processing connections\n", count);
    // }
    // count++; // No longer needed
    (void)count; // Suppress unused variable warning
    
    // Process the loop's shared engines
    if (loop_data->quic_server_engine) {
        lsquic_engine_process_conns(loop_data->quic_server_engine);
        lsquic_engine_send_unsent_packets(loop_data->quic_server_engine);
    }
    
    if (loop_data->quic_client_engine) {
        lsquic_engine_process_conns(loop_data->quic_client_engine);
        lsquic_engine_send_unsent_packets(loop_data->quic_client_engine);
    }
    
    /* Sweep closed connections and sockets for all QUIC contexts in this loop */
    /* Note: In a full implementation, we'd iterate through all QUIC contexts */
    /* For now, the sweep is called explicitly when needed */
}

// Get context from socket
us_quic_socket_context_t *us_quic_socket_context(us_quic_socket_t *s) {
    if (!s) {
        printf("ERROR: Invalid socket\n");
        return NULL;
    }
    
    return s->context;
}

void *us_quic_socket_context_ext(us_quic_socket_context_t *context) {
    if (!context) {
        printf("ERROR: Context is null in us_quic_socket_context_ext\n");
        return NULL;
    }
    return context + 1;
}

// this will be for both client and server, but will be only for either h3 or raw quic
us_quic_socket_context_t *us_create_quic_socket_context(struct us_loop_t *loop, us_quic_socket_context_options_t options, int ext_size) {


    /* Holds all callbacks */
    us_quic_socket_context_t *context = malloc(sizeof(struct us_quic_socket_context_s) + ext_size);
    if (!context) {
        return NULL;
    }

    // the option is put on the socket context
    context->options = options;
    context->loop = loop;
    
    // Initialize OpenSSL if not already done - this is critical for SSL_CTX_new to work
    us_internal_init_loop_ssl_data(loop);
    
    // For QUIC, we need to create SSL context even without certificates
    // because we'll generate self-signed ones if needed
    enum create_bun_socket_error_t ssl_error = CREATE_BUN_SOCKET_ERROR_NONE;
    
    // Check if we have certificates provided
    int has_certs = (options.cert && options.cert_count > 0) || 
                   (options.cert_file_name != NULL) ||
                   (options.key && options.key_count > 0) ||
                   (options.key_file_name != NULL);
    
    if (has_certs) {
        // Use regular SSL context creation if certificates are provided
        context->ssl_context = create_ssl_context_from_bun_options(options, &ssl_error);
        if (!context->ssl_context) {
            printf("ERROR: Failed to create SSL context for QUIC with provided certificates, error: %d\n", ssl_error);
            free(context);
            return NULL;
        }
    } else {
        // Create a basic SSL context without certificates for QUIC
        // We'll add self-signed certificates later
        ERR_clear_error();
        context->ssl_context = SSL_CTX_new(TLS_method());
        if (!context->ssl_context) {
            printf("ERROR: Failed to create basic SSL context for QUIC\n");
            free(context);
            return NULL;
        }
        
        // Set basic SSL options
        SSL_CTX_set_read_ahead(context->ssl_context, 1);
        SSL_CTX_set_mode(context->ssl_context, SSL_MODE_ACCEPT_MOVING_WRITE_BUFFER);
        // QUIC requires TLS 1.3, so set that as minimum even in basic setup
        SSL_CTX_set_min_proto_version(context->ssl_context, TLS1_3_VERSION);
        
        if (options.ssl_prefer_low_memory_usage) {
            SSL_CTX_set_mode(context->ssl_context, SSL_MODE_RELEASE_BUFFERS);
        }
    }
    // printf("SSL context created successfully: %p\n", context->ssl_context);
    
    // If no certificate was provided, generate a self-signed one for testing
    // This is especially important for QUIC which requires TLS 1.3
    if (!has_certs) {
        // printf("No certificate provided, generating self-signed certificate for QUIC\n");
        
        // Generate a self-signed certificate and key
        EVP_PKEY *pkey = EVP_PKEY_new();
        RSA *rsa = RSA_generate_key(2048, RSA_F4, NULL, NULL);
        if (rsa && pkey) {
            EVP_PKEY_assign_RSA(pkey, rsa);
            
            X509 *x509 = X509_new();
            if (x509) {
                ASN1_INTEGER_set(X509_get_serialNumber(x509), 1);
                X509_gmtime_adj(X509_get_notBefore(x509), 0);
                X509_gmtime_adj(X509_get_notAfter(x509), 31536000L); // 1 year
                
                X509_set_pubkey(x509, pkey);
                
                X509_NAME *name = X509_get_subject_name(x509);
                X509_NAME_add_entry_by_txt(name, "C", MBSTRING_ASC, (unsigned char *)"US", -1, -1, 0);
                X509_NAME_add_entry_by_txt(name, "O", MBSTRING_ASC, (unsigned char *)"Bun", -1, -1, 0);
                X509_NAME_add_entry_by_txt(name, "CN", MBSTRING_ASC, (unsigned char *)"localhost", -1, -1, 0);
                
                X509_set_issuer_name(x509, name);
                X509_sign(x509, pkey, EVP_sha256());
                
                // Set the certificate and key in the SSL context
                SSL_CTX_use_certificate(context->ssl_context, x509);
                SSL_CTX_use_PrivateKey(context->ssl_context, pkey);
                
                // printf("Self-signed certificate generated and set for QUIC\n");
                
                X509_free(x509);
            }
            EVP_PKEY_free(pkey);
        } else {
            printf("ERROR: Failed to generate self-signed certificate\n");
        }
    }
    
    // QUIC requires TLS 1.3
    SSL_CTX_set_min_proto_version(context->ssl_context, TLS1_3_VERSION);
    SSL_CTX_set_max_proto_version(context->ssl_context, TLS1_3_VERSION);
    
    // Set QUIC-specific SSL options
    SSL_CTX_set_options(context->ssl_context, SSL_OP_NO_TICKET);  // QUIC handles session tickets
    SSL_CTX_set_options(context->ssl_context, SSL_OP_NO_RENEGOTIATION);  // No renegotiation in QUIC
    
    // Set SSL mode for QUIC
    SSL_CTX_set_mode(context->ssl_context, SSL_MODE_ACCEPT_MOVING_WRITE_BUFFER);
    
    // Disable session caching for now
    SSL_CTX_set_session_cache_mode(context->ssl_context, SSL_SESS_CACHE_OFF);
    
    // For testing, disable certificate verification if NODE_TLS_REJECT_UNAUTHORIZED=0
    const char* reject_unauthorized = getenv("NODE_TLS_REJECT_UNAUTHORIZED");
    if (reject_unauthorized && strcmp(reject_unauthorized, "0") == 0) {
        SSL_CTX_set_verify(context->ssl_context, SSL_VERIFY_NONE, NULL);
        // printf("QUIC: Certificate verification disabled for testing\n");
    }
    
    // Set session ID context for server mode (required for QUIC)
    const unsigned char session_id_context[] = "QUIC";
    SSL_CTX_set_session_id_context(context->ssl_context, session_id_context, 
                                    sizeof(session_id_context) - 1);
    
    // Initialize ALPN before setting callbacks
    add_alpn("h3");
    
    // Set up ALPN for QUIC
    SSL_CTX_set_alpn_select_cb(context->ssl_context, select_alpn, NULL);
    
    // For client connections, set ALPN protocols
    unsigned char alpn_list[] = "\x02h3";  // Length-prefixed "h3"
    SSL_CTX_set_alpn_protos(context->ssl_context, alpn_list, sizeof(alpn_list) - 1);
    
    // printf("Created SSL context for QUIC: %p\n", context->ssl_context);

    /* Allocate per thread, UDP packet buffers */
    context->recv_buf = us_create_udp_packet_buffer();
    if (!context->recv_buf) {
        free(context);
        return NULL;
    }
    
    /* Initialize connection tracking table */
    context->connection_table = create_connection_table();
    if (!context->connection_table) {
        printf("ERROR: Failed to create connection tracking table\n");
        free(context->recv_buf);  // Clean up allocated buffer
        free(context);
        return NULL;
    }
    
    /* Initialize deferred cleanup lists */
    context->closing_connections = NULL;
    context->closing_sockets = NULL;
    
    /* Initialize per-context header storage */
    memset(&context->header_buffer, 0, sizeof(context->header_buffer));
    memset(context->headers_arr, 0, sizeof(context->headers_arr));

    /* Init lsquic engine */
    if (0 != lsquic_global_init(LSQUIC_GLOBAL_CLIENT|LSQUIC_GLOBAL_SERVER)) {
        free(context);
        return NULL;
    }

    static struct lsquic_stream_if stream_callbacks = {
        .on_close = on_stream_close,
        .on_conn_closed = on_conn_closed,
        .on_write = on_write,
        .on_read = on_read,
        .on_new_stream = on_new_stream,
        .on_new_conn = on_new_conn
    };

    //memset(&stream_callbacks, 13, sizeof(struct lsquic_stream_if));

    static struct lsquic_hset_if hset_if = {
        .hsi_discard_header_set = hsi_discard_header_set,
        .hsi_create_header_set = hsi_create_header_set,
        .hsi_prepare_decode = hsi_prepare_decode,
        .hsi_process_header = hsi_process_header
    };

    // Initialize engine settings for server
    struct lsquic_engine_settings server_settings;
    lsquic_engine_init_settings(&server_settings, LSENG_SERVER);
    
    // Use default QUIC versions (includes latest stable versions)
    server_settings.es_versions = LSQUIC_DF_VERSIONS;
    // printf("Server QUIC versions: 0x%x\n", server_settings.es_versions);
    
    // Set max packet size for UDP (0 means use default)
    server_settings.es_max_udp_payload_size_rx = 0;

    struct lsquic_engine_api engine_api = {
        .ea_packets_out     = send_packets_out,
        .ea_packets_out_ctx = (void *) context,  /* For example */
        .ea_stream_if       = &stream_callbacks,
        .ea_stream_if_ctx   = context,

        .ea_get_ssl_ctx = get_ssl_ctx,

        // lookup certificate
        .ea_lookup_cert = sni_lookup,
        .ea_cert_lu_ctx = context,  // Pass context for SSL lookups

        // these are zero anyways
        .ea_hsi_ctx = 0,
        .ea_hsi_if = &hset_if,
        
        .ea_settings = &server_settings,
    };

    // printf("log: %d\n", lsquic_set_log_level("info"));

    // Initialize the logger to get better debugging info
    static struct lsquic_logger_if logger = {
        .log_buf = log_buf_cb,
    };

    lsquic_logger_init(&logger, 0, LLTS_NONE);

    /* Get or create shared engines in loop_data */
    struct us_internal_loop_data_t *loop_data = (struct us_internal_loop_data_t *)loop;
    
    /* Create server engine if it doesn't exist (one per loop) */
    if (!loop_data->quic_server_engine) {
        loop_data->quic_server_engine = lsquic_engine_new(LSENG_SERVER, &engine_api);
        if (!loop_data->quic_server_engine) {
            printf("ERROR: Failed to create server QUIC engine\n");
            free(context);
            return NULL;
        }
        // printf("Created shared server engine: %p\n", loop_data->quic_server_engine);
    }

    /* Create client engine if it doesn't exist (one per loop) */
    if (!loop_data->quic_client_engine) {
        // Initialize engine settings for client
        struct lsquic_engine_settings client_settings;
        lsquic_engine_init_settings(&client_settings, 0);
        
        // Use default QUIC versions (includes latest stable versions)
        client_settings.es_versions = LSQUIC_DF_VERSIONS;
        // printf("Client QUIC versions: 0x%x\n", client_settings.es_versions);
        
        // Set max packet size for UDP (0 means use default)
        client_settings.es_max_udp_payload_size_rx = 0;

        struct lsquic_engine_api engine_api_client = {
            .ea_packets_out     = send_packets_out,
            .ea_packets_out_ctx = (void *) context,  /* For example */
            .ea_stream_if       = &stream_callbacks,
            .ea_stream_if_ctx   = context,

            .ea_get_ssl_ctx = get_ssl_ctx, // Client also needs SSL context

            // lookup certificate
            // Client doesn't need SNI lookup callback
            .ea_lookup_cert = NULL,
            .ea_cert_lu_ctx = NULL,

            // these are zero anyways
            .ea_hsi_ctx = 0,
            .ea_hsi_if = &hset_if,
            
            .ea_settings = &client_settings,
        };

        loop_data->quic_client_engine = lsquic_engine_new(0, &engine_api_client);
        if (!loop_data->quic_client_engine) {
            printf("ERROR: Failed to create client QUIC engine\n");
            // Clean up server engine if we created it
            if (loop_data->quic_server_engine) {
                lsquic_engine_destroy(loop_data->quic_server_engine);
                loop_data->quic_server_engine = NULL;
            }
            free(context);
            return NULL;
        }
        // printf("Created shared client engine: %p\n", loop_data->quic_client_engine);
    }

    // printf("Using shared engines - Server: %p, Client: %p\n", 
    //        loop_data->quic_server_engine, loop_data->quic_client_engine);

    // Start a timer to handle connections (one timer per loop)
    // Check if this loop already has a QUIC timer
    if (!loop_data->quic_timer) {
        loop_data->quic_timer = us_create_timer(loop, 0, 0);
        us_timer_set(loop_data->quic_timer, timer_cb, 50, 50);
        // printf("Created QUIC timer for loop\n");
    }

    return context;
}

/* Context cleanup function to free all resources */
void us_quic_socket_context_free(us_quic_socket_context_t *context) {
    if (!context) return;
    
    /* Clean up any remaining connections and sockets */
    us_internal_quic_sweep_closed(context);
    
    /* Free connection tracking table */
    if (context->connection_table) {
        free_connection_table(context->connection_table);
        context->connection_table = NULL;
    }
    
    /* Note: QUIC timer cleanup is handled by the loop shutdown */
    
    /* Free packet buffer */
    if (context->recv_buf) {
        us_free_udp_packet_buffer(context->recv_buf);
        context->recv_buf = NULL;
    }
    
    /* Free SSL context */
    if (context->ssl_context) {
        SSL_CTX_free(context->ssl_context);
        context->ssl_context = NULL;
    }
    
    free(context);
}

us_quic_listen_socket_t *us_quic_socket_context_listen(us_quic_socket_context_t *context, const char *host, int port, int ext_size) {
    /* We create a proper us_quic_listen_socket_t structure */
    int err = 0;
    
    // printf("Creating QUIC listen socket on %s:%d\n", host, port);
    
    // Allocate the listen socket structure with extension space
    us_quic_listen_socket_t *listen_socket = malloc(sizeof(us_quic_listen_socket_t) + ext_size);
    if (!listen_socket) {
        printf("ERROR: Failed to allocate listen socket\n");
        return NULL;
    }
    
    memset(listen_socket, 0, sizeof(us_quic_listen_socket_t) + ext_size);
    
    // Initialize the listen socket structure BEFORE creating UDP socket
    listen_socket->context = context;
    listen_socket->is_closed = 0;
    listen_socket->is_client = 0;  // This is a server/listen socket
    listen_socket->next = NULL;
    
    // Create the UDP socket with extension space for peer context
    struct us_udp_socket_t *udp_socket = us_create_udp_socket_with_ext(context->loop, on_udp_socket_data_wrapper, on_udp_socket_writable, NULL, host, port, 0, &err, listen_socket, sizeof(struct quic_peer_ctx));
    
    if (udp_socket) {
        // Set the UDP socket in the structure
        listen_socket->udp_socket = udp_socket;
        
        // Initialize the peer context in the UDP socket extension area
        struct quic_peer_ctx *peer_ctx = (struct quic_peer_ctx *)((char *)udp_socket + sizeof(struct us_udp_socket_t));
        // printf("Listen socket: %p, UDP socket: %p, peer_ctx: %p, context: %p\n", listen_socket, udp_socket, peer_ctx, context);
        peer_ctx->udp_socket = udp_socket;
        peer_ctx->context = context;
        peer_ctx->connection = NULL;  // Will be set when connections are established
        memset(peer_ctx->reserved, 0, sizeof(peer_ctx->reserved));
        
        // Get the actual port if it was 0
        if (port == 0) {
            struct sockaddr_storage addr;
            socklen_t addr_len = sizeof(addr);
            int fd = us_poll_fd((struct us_poll_t *)udp_socket);
            if (getsockname(fd, (struct sockaddr *)&addr, &addr_len) == 0) {
                if (addr.ss_family == AF_INET) {
                    // struct sockaddr_in *sin = (struct sockaddr_in *)&addr;
                    // printf("Server listening on actual port: %d\n", ntohs(sin->sin_port));
                }
            }
        }
    } else {
        printf("ERROR: Failed to create UDP listen socket, error: %d\n", err);
        free(listen_socket);
        return NULL;
    }
    
    return listen_socket;
}

int us_quic_listen_socket_get_port(us_quic_listen_socket_t *listen_socket) {
    if (!listen_socket || !listen_socket->udp_socket) return 0;
    
    struct us_udp_socket_t *udp_socket = listen_socket->udp_socket;
    struct sockaddr_storage addr;
    socklen_t addr_len = sizeof(addr);
    int fd = us_poll_fd((struct us_poll_t *)udp_socket);
    
    if (getsockname(fd, (struct sockaddr *)&addr, &addr_len) == 0) {
        if (addr.ss_family == AF_INET) {
            struct sockaddr_in *sin = (struct sockaddr_in *)&addr;
            return ntohs(sin->sin_port);
        } else if (addr.ss_family == AF_INET6) {
            struct sockaddr_in6 *sin6 = (struct sockaddr_in6 *)&addr;
            return ntohs(sin6->sin6_port);
        }
    }
    
    return 0;
}

/* A client connection is its own UDP socket, while a server connection makes use of the shared listen UDP socket */
us_quic_socket_t *us_quic_socket_context_connect(us_quic_socket_context_t *context, const char *host, int port, int ext_size) {
    // printf("Connecting..\n");


    // Resolve the hostname and port
    struct sockaddr_storage storage = {0};
    struct sockaddr *addr = (struct sockaddr *)&storage;
    
    // For now, support IPv4 only (can be extended to support IPv6)
    struct sockaddr_in *addr4 = (struct sockaddr_in *)addr;
    addr4->sin_family = AF_INET;
    addr4->sin_port = htons(port);
    
    // Simple hostname resolution - for now just handle localhost/127.0.0.1
    if (strcmp(host, "localhost") == 0 || strcmp(host, "127.0.0.1") == 0) {
        addr4->sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    } else {
        // For other hosts, try to parse as IP address
        if (inet_pton(AF_INET, host, &addr4->sin_addr) != 1) {
            printf("ERROR: Failed to parse host address: %s\n", host);
            return NULL;
        }
    }

    // Create the UDP socket binding to ephemeral port
    int err = 0;
    // For QUIC client sockets, we also need extension space to avoid buffer overflows
    struct us_udp_socket_t *udp_socket = us_create_udp_socket_with_ext(context->loop, on_udp_socket_data_client_wrapper, on_udp_socket_writable, NULL, 0, 0, 0, &err, context, sizeof(struct quic_peer_ctx));
    
    if (udp_socket) {
        // Initialize the peer context in the extension area
        struct quic_peer_ctx *peer_ctx = (struct quic_peer_ctx *)((char *)udp_socket + sizeof(struct us_udp_socket_t));
        // printf("Client socket: %p, peer_ctx: %p, context: %p\n", udp_socket, peer_ctx, context);
        peer_ctx->udp_socket = udp_socket;
        peer_ctx->context = context;
        peer_ctx->connection = NULL;  // Will be set in on_new_conn
        memset(peer_ctx->reserved, 0, sizeof(peer_ctx->reserved));
    }

    // Determine what port we got, creating the local sockaddr
    int ephemeral = us_udp_socket_bound_port(udp_socket);

    // printf("Connecting with udp socket bound to port: %d\n", ephemeral);

    // printf("Client udp socket is: %p\n", udp_socket);


    // let's call ourselves an ipv6 client and see if that solves anything
    struct sockaddr_storage local_storage = {0};
    // struct sockaddr_in *local_addr = (struct sockaddr_in *) &local_storage;
    // local_addr->sin_addr.s_addr = 16777343;
    // local_addr->sin_port = htons(ephemeral);
    // local_addr->sin_family = AF_INET;

    struct sockaddr_in6 *local_addr = (struct sockaddr_in6 *) &local_storage;
    local_addr->sin6_addr.s6_addr[15] = 1;
    local_addr->sin6_port = htons(ephemeral);
    local_addr->sin6_family = AF_INET6;

    // Refer to the UDP socket, and from that, get the context?

    // Create an UDP socket with host-picked port, or well, any port for now

    // we need 1 socket for servers, then we bind multiple ports to that one socket

    // Create the us_quic_socket_t structure first so we can pass it as context
    us_quic_socket_t *quic_socket = malloc(sizeof(us_quic_socket_t) + ext_size);
    if (!quic_socket) {
        printf("ERROR: Failed to allocate QUIC socket structure\n");
        return NULL;
    }
    
    memset(quic_socket, 0, sizeof(us_quic_socket_t) + ext_size);
    quic_socket->udp_socket = udp_socket;
    quic_socket->context = context;
    quic_socket->is_closed = 0;
    quic_socket->is_client = 1;
    quic_socket->next = NULL;
    
    // char addr_str[INET6_ADDRSTRLEN];
    // int dest_port = 0;
    // 
    // if (addr->sa_family == AF_INET) {
    //     struct sockaddr_in *sin = (struct sockaddr_in *)addr;
    //     inet_ntop(AF_INET, &sin->sin_addr, addr_str, sizeof(addr_str));
    //     dest_port = ntohs(sin->sin_port);
    // } else if (addr->sa_family == AF_INET6) {
    //     struct sockaddr_in6 *sin6 = (struct sockaddr_in6 *)addr;
    //     inet_ntop(AF_INET6, &sin6->sin6_addr, addr_str, sizeof(addr_str));
    //     dest_port = ntohs(sin6->sin6_port);
    // }
    // 
    // printf("Client connecting to: %s:%d\n", addr_str, dest_port);
    
    // Get the peer context from the UDP socket extension area
    struct quic_peer_ctx *connect_peer_ctx = (struct quic_peer_ctx *)((char *)udp_socket + sizeof(struct us_udp_socket_t));
    
    // Use version 0 to let the engine negotiate the best version
    lsquic_engine_t *client_engine = get_client_engine(context);
    if (!client_engine) {
        printf("ERROR: No client engine available\n");
        free(quic_socket);
        return NULL;
    }
    void *client = lsquic_engine_connect(client_engine, 0, (struct sockaddr *) local_addr, addr, connect_peer_ctx, (lsquic_conn_ctx_t *) quic_socket, host, 0, 0, 0, 0, 0);

    // printf("Client: %p\n", client);

    if (!client) {
        printf("ERROR: Failed to create LSQUIC connection\n");
        free(quic_socket);
        return NULL;
    }
    
    // The connection will be created in on_new_conn callback
    // printf("Created QUIC socket: %p with UDP socket: %p and LSQUIC conn: %p\n", quic_socket, udp_socket, client);

    // this is required to even have packets sending out (run this in post)
    if (client_engine) {
        lsquic_engine_process_conns(client_engine);
    }
    
    return quic_socket;
}

/* Close a QUIC socket by forcing connection close */
void us_quic_socket_close(us_quic_socket_t *s) {
    if (!s || !s->lsquic_conn) {
        return;
    }
    
    // printf("us_quic_socket_close: Closing QUIC socket %p, lsquic_conn %p\n", s, s->lsquic_conn);
    
    /* Force close the connection - this will trigger on_conn_closed callback */
    lsquic_conn_close((lsquic_conn_t *)s->lsquic_conn);
    
    /* Mark the socket as closed */
    s->is_closed = 1;
}

#endif
