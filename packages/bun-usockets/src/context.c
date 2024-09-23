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

#include "internal/internal.h"
#include "libusockets.h"
#include <errno.h>
#include <stdlib.h>
#include <string.h>
#ifndef _WIN32
#include <arpa/inet.h>
#endif

#define CONCURRENT_CONNECTIONS 4

// clang-format off
int default_is_low_prio_handler(struct us_socket_t *s) {
    return 0;
}

/* Shared with SSL */

unsigned short us_socket_context_timestamp(int ssl, struct us_socket_context_t *context) {
    return context->timestamp;
}
int us_internal_raw_root_certs(struct us_cert_string_t** out);
int us_raw_root_certs(struct us_cert_string_t**out){
    return us_internal_raw_root_certs(out);
}

void us_listen_socket_close(int ssl, struct us_listen_socket_t *ls) {
    /* us_listen_socket_t extends us_socket_t so we close in similar ways */
    if (!us_socket_is_closed(0, &ls->s)) {
        us_internal_socket_context_unlink_listen_socket(ssl, ls->s.context, ls);
        us_poll_stop((struct us_poll_t *) &ls->s, ls->s.context->loop);
        bsd_close_socket(us_poll_fd((struct us_poll_t *) &ls->s));

        /* Link this socket to the close-list and let it be deleted after this iteration */
        ls->s.next = ls->s.context->loop->data.closed_head;
        ls->s.context->loop->data.closed_head = &ls->s;

        /* Any socket with prev = context is marked as closed */
        ls->s.prev = (struct us_socket_t *) ls->s.context;
    }

    /* We cannot immediately free a listen socket as we can be inside an accept loop */
}

void us_socket_context_close(int ssl, struct us_socket_context_t *context) {
    /* First start closing pending connecting sockets*/
    struct us_connecting_socket_t *c = context->head_connecting_sockets;
    while (c) {
        struct us_connecting_socket_t *nextC = c->next_pending;
        us_connecting_socket_close(ssl, c);
        c = nextC;
    }
    /* After this by closing all listen sockets */
    struct us_listen_socket_t *ls = context->head_listen_sockets;
    while (ls) {
        struct us_listen_socket_t *nextLS = (struct us_listen_socket_t *) ls->s.next;
        us_listen_socket_close(ssl, ls);
        
        ls = nextLS;
    }

    /* Then close all regular sockets */
    struct us_socket_t *s = context->head_sockets;
    while (s) {
        struct us_socket_t *nextS = s->next;
        us_socket_close(ssl, s, LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN, 0);
        s = nextS;
    }
}

void us_internal_socket_context_unlink_listen_socket(int ssl, struct us_socket_context_t *context, struct us_listen_socket_t *ls) {
    /* We have to properly update the iterator used to sweep sockets for timeouts */
    if (ls == (struct us_listen_socket_t *) context->iterator) {
        context->iterator = ls->s.next;
    }

    if (ls->s.prev == ls->s.next) {
        context->head_listen_sockets = 0;
    } else {
        if (ls->s.prev) {
            ls->s.prev->next = ls->s.next;
        } else {
            context->head_listen_sockets = (struct us_listen_socket_t *) ls->s.next;
        }
        if (ls->s.next) {
            ls->s.next->prev = ls->s.prev;
        }
    }
    us_socket_context_unref(ssl, context);
}

void us_internal_socket_context_unlink_socket(int ssl, struct us_socket_context_t *context, struct us_socket_t *s) {
    /* We have to properly update the iterator used to sweep sockets for timeouts */
    if (s == context->iterator) {
        context->iterator = s->next;
    }

    if (s->prev == s->next) {
        context->head_sockets = 0;
    } else {
        if (s->prev) {
            s->prev->next = s->next;
        } else {
            context->head_sockets = s->next;
        }
        if (s->next) {
            s->next->prev = s->prev;
        }
    }
    us_socket_context_unref(ssl, context);
}
void us_internal_socket_context_unlink_connecting_socket(int ssl, struct us_socket_context_t *context, struct us_connecting_socket_t *c) {
    if (c->prev_pending == c->next_pending) {
        context->head_connecting_sockets = 0;
    } else {
        if (c->prev_pending) {
            c->prev_pending->next_pending = c->next_pending;
        } else {
            context->head_connecting_sockets = c->next_pending;
        }
        if (c->next_pending) {
            c->next_pending->prev_pending = c->prev_pending;
        }
    }
    us_socket_context_unref(ssl, context);
}

/* We always add in the top, so we don't modify any s.next */
void us_internal_socket_context_link_listen_socket(struct us_socket_context_t *context, struct us_listen_socket_t *ls) {
    ls->s.context = context;
    ls->s.next = (struct us_socket_t *) context->head_listen_sockets;
    ls->s.prev = 0;
    if (context->head_listen_sockets) {
        context->head_listen_sockets->s.prev = &ls->s;
    }
    context->head_listen_sockets = ls;
    us_socket_context_ref(0, context);
}

void us_internal_socket_context_link_connecting_socket(int ssl, struct us_socket_context_t *context, struct us_connecting_socket_t *c) {
    c->context = context;
    c->next_pending = context->head_connecting_sockets;
    c->prev_pending = 0;
    if (context->head_connecting_sockets) {
        context->head_connecting_sockets->prev_pending = c;
    }
    context->head_connecting_sockets = c;
    us_socket_context_ref(ssl, context);
}


/* We always add in the top, so we don't modify any s.next */
void us_internal_socket_context_link_socket(struct us_socket_context_t *context, struct us_socket_t *s) {
    s->context = context;
    s->next = context->head_sockets;
    s->prev = 0;
    if (context->head_sockets) {
        context->head_sockets->prev = s;
    }
    context->head_sockets = s;
    us_socket_context_ref(0, context);
}

struct us_loop_t *us_socket_context_loop(int ssl, struct us_socket_context_t *context) {
    return context->loop;
}

/* Not shared with SSL */

/* Lookup userdata by server name pattern */
void *us_socket_context_find_server_name_userdata(int ssl, struct us_socket_context_t *context, const char *hostname_pattern) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        return us_internal_ssl_socket_context_find_server_name_userdata((struct us_internal_ssl_socket_context_t *) context, hostname_pattern);
    }
#endif
    return NULL;
}

/* Get userdata attached to this SNI-routed socket, or nullptr if default */
void *us_socket_server_name_userdata(int ssl, struct us_socket_t *s) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        return us_internal_ssl_socket_get_sni_userdata((struct us_internal_ssl_socket_t *) s);
    }
#endif
    return NULL;
}

/* Add SNI context */
void us_socket_context_add_server_name(int ssl, struct us_socket_context_t *context, const char *hostname_pattern, struct us_socket_context_options_t options, void *user) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        us_internal_ssl_socket_context_add_server_name((struct us_internal_ssl_socket_context_t *) context, hostname_pattern, options, user);
    }
#endif
}
void us_bun_socket_context_add_server_name(int ssl, struct us_socket_context_t *context, const char *hostname_pattern, struct us_bun_socket_context_options_t options, void *user) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        us_bun_internal_ssl_socket_context_add_server_name((struct us_internal_ssl_socket_context_t *) context, hostname_pattern, options, user);
    }
#endif
}

/* Remove SNI context */
void us_socket_context_remove_server_name(int ssl, struct us_socket_context_t *context, const char *hostname_pattern) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        us_internal_ssl_socket_context_remove_server_name((struct us_internal_ssl_socket_context_t *) context, hostname_pattern);
    }
#endif
}

/* I don't like this one - maybe rename it to on_missing_server_name? */

/* Called when SNI matching fails - not if a match could be made.
 * You may modify the context by adding/removing names in this callback.
 * If the correct name is added immediately in the callback, it will be used */
void us_socket_context_on_server_name(int ssl, struct us_socket_context_t *context, void (*cb)(struct us_socket_context_t *, const char *hostname)) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        us_internal_ssl_socket_context_on_server_name((struct us_internal_ssl_socket_context_t *) context, (void (*)(struct us_internal_ssl_socket_context_t *, const char *hostname)) cb);
    }
#endif
}

/* Todo: get native context from SNI pattern */

void *us_socket_context_get_native_handle(int ssl, struct us_socket_context_t *context) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        return us_internal_ssl_socket_context_get_native_handle((struct us_internal_ssl_socket_context_t *) context);
    }
#endif

    /* There is no native handle for a non-SSL socket context */
    return 0;
}

/* Options is currently only applicable for SSL - this will change with time (prefer_low_memory is one example) */
struct us_socket_context_t *us_create_socket_context(int ssl, struct us_loop_t *loop, int context_ext_size, struct us_socket_context_options_t options) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        /* This function will call us, again, with SSL = false and a bigger ext_size */
        return (struct us_socket_context_t *) us_internal_create_ssl_socket_context(loop, context_ext_size, options);
    }
#endif

    /* This path is taken once either way - always BEFORE whatever SSL may do LATER.
     * context_ext_size will however be modified larger in case of SSL, to hold SSL extensions */

    struct us_socket_context_t *context = us_calloc(1, sizeof(struct us_socket_context_t) + context_ext_size);
    context->loop = loop;
    context->is_low_prio = default_is_low_prio_handler;
    context->ref_count = 1;

    us_internal_loop_link(loop, context);

    /* If we are called from within SSL code, SSL code will make further changes to us */
    return context;
}

struct us_socket_context_t *us_create_bun_socket_context(int ssl, struct us_loop_t *loop, int context_ext_size, struct us_bun_socket_context_options_t options) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        /* This function will call us, again, with SSL = false and a bigger ext_size */
        return (struct us_socket_context_t *) us_internal_bun_create_ssl_socket_context(loop, context_ext_size, options);
    }
#endif

    /* This path is taken once either way - always BEFORE whatever SSL may do LATER.
     * context_ext_size will however be modified larger in case of SSL, to hold SSL extensions */

    struct us_socket_context_t *context = us_calloc(1, sizeof(struct us_socket_context_t) + context_ext_size);
    context->loop = loop;
    context->is_low_prio = default_is_low_prio_handler;
    context->ref_count = 1;

    us_internal_loop_link(loop, context);

    /* If we are called from within SSL code, SSL code will make further changes to us */
    return context;
}


struct us_bun_verify_error_t us_socket_verify_error(int ssl, struct us_socket_t *socket) {
    #ifndef LIBUS_NO_SSL
        if (ssl) {
            /* This function will call us again with SSL=false */
            return us_internal_verify_error((struct us_internal_ssl_socket_t *)socket);
        }
    #endif

    return (struct us_bun_verify_error_t) { .error = 0, .code = NULL, .reason = NULL };    
}

void us_internal_socket_context_free(int ssl, struct us_socket_context_t *context) {

#ifndef LIBUS_NO_SSL
    if (ssl) {
        /* This function will call us again with SSL=false */
        us_internal_ssl_socket_context_free((struct us_internal_ssl_socket_context_t *) context);
        return;
    }
#endif

    /* This path is taken once either way - always AFTER whatever SSL may do BEFORE.
     * This is the opposite order compared to when creating the context - SSL code is cleaning up before non-SSL */

    us_internal_loop_unlink(context->loop, context);
    /* Link this context to the close-list and let it be deleted after this iteration */
    context->next = context->loop->data.closed_context_head;
    context->loop->data.closed_context_head = context;
}

void us_socket_context_ref(int ssl, struct us_socket_context_t *context) {
    context->ref_count++;
}
void us_socket_context_unref(int ssl, struct us_socket_context_t *context) {
    uint32_t ref_count = context->ref_count;
    context->ref_count--;    
    if (ref_count == 1) {
        us_internal_socket_context_free(ssl, context);
    }
}

void us_socket_context_free(int ssl, struct us_socket_context_t *context) {
    us_socket_context_unref(ssl, context);
}

struct us_listen_socket_t *us_socket_context_listen(int ssl, struct us_socket_context_t *context, const char *host, int port, int options, int socket_ext_size) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        return us_internal_ssl_socket_context_listen((struct us_internal_ssl_socket_context_t *) context, host, port, options, socket_ext_size);
    }
#endif

    LIBUS_SOCKET_DESCRIPTOR listen_socket_fd = bsd_create_listen_socket(host, port, options);

    if (listen_socket_fd == LIBUS_SOCKET_ERROR) {
        return 0;
    }

    struct us_poll_t *p = us_create_poll(context->loop, 0, sizeof(struct us_listen_socket_t));
    us_poll_init(p, listen_socket_fd, POLL_TYPE_SEMI_SOCKET);
    us_poll_start(p, context->loop, LIBUS_SOCKET_READABLE);

    struct us_listen_socket_t *ls = (struct us_listen_socket_t *) p;

    ls->s.context = context;
    ls->s.timeout = 255;
    ls->s.long_timeout = 255;
    ls->s.low_prio_state = 0;
    ls->s.next = 0;
    us_internal_socket_context_link_listen_socket(context, ls);

    ls->socket_ext_size = socket_ext_size;

    return ls;
}

struct us_listen_socket_t *us_socket_context_listen_unix(int ssl, struct us_socket_context_t *context, const char *path, size_t pathlen, int options, int socket_ext_size) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        return us_internal_ssl_socket_context_listen_unix((struct us_internal_ssl_socket_context_t *) context, path, pathlen, options, socket_ext_size);
    }
#endif

    LIBUS_SOCKET_DESCRIPTOR listen_socket_fd = bsd_create_listen_socket_unix(path, pathlen, options);

    if (listen_socket_fd == LIBUS_SOCKET_ERROR) {
        return 0;
    }

    struct us_poll_t *p = us_create_poll(context->loop, 0, sizeof(struct us_listen_socket_t));
    us_poll_init(p, listen_socket_fd, POLL_TYPE_SEMI_SOCKET);
    us_poll_start(p, context->loop, LIBUS_SOCKET_READABLE);

    struct us_listen_socket_t *ls = (struct us_listen_socket_t *) p;
    ls->s.connect_state = NULL;
    ls->s.context = context;
    ls->s.timeout = 255;
    ls->s.long_timeout = 255;
    ls->s.low_prio_state = 0;
    ls->s.next = 0;
    us_internal_socket_context_link_listen_socket(context, ls);

    ls->socket_ext_size = socket_ext_size;

    return ls;
}


struct us_socket_t* us_socket_context_connect_resolved_dns(struct us_socket_context_t *context, struct sockaddr_storage* addr, int options, int socket_ext_size) {
    LIBUS_SOCKET_DESCRIPTOR connect_socket_fd = bsd_create_connect_socket(addr, options);
    if (connect_socket_fd == LIBUS_SOCKET_ERROR) {
        return NULL;
    }

    bsd_socket_nodelay(connect_socket_fd, 1);

    /* Connect sockets are semi-sockets just like listen sockets */
    struct us_poll_t *p = us_create_poll(context->loop, 0, sizeof(struct us_socket_t) + socket_ext_size);
    us_poll_init(p, connect_socket_fd, POLL_TYPE_SEMI_SOCKET);
    us_poll_start(p, context->loop, LIBUS_SOCKET_WRITABLE);

    struct us_socket_t *socket = (struct us_socket_t *) p;

    /* Link it into context so that timeout fires properly */
    socket->context = context;
    socket->timeout = 255;
    socket->long_timeout = 255;
    socket->low_prio_state = 0;
    socket->connect_state = NULL;
    us_internal_socket_context_link_socket(context, socket);

    return socket;
}

static void init_addr_with_port(struct addrinfo* info, int port, struct sockaddr_storage *addr) {
    if (info->ai_family == AF_INET) {
        struct sockaddr_in *addr_in = (struct sockaddr_in *) addr;
        memcpy(addr_in, info->ai_addr, info->ai_addrlen);
        addr_in->sin_port = htons(port);
    } else {
        struct sockaddr_in6 *addr_in6 = (struct sockaddr_in6 *) addr;
        memcpy(addr_in6, info->ai_addr, info->ai_addrlen);
        addr_in6->sin6_port = htons(port);
    }
}

static int try_parse_ip(const char *ip_str, int port, struct sockaddr_storage *storage) {
    memset(storage, 0, sizeof(struct sockaddr_storage));
    // Try to parse as IPv4
    struct sockaddr_in *addr4 = (struct sockaddr_in *)storage;
    if (inet_pton(AF_INET, ip_str, &addr4->sin_addr) == 1) {
        addr4->sin_port = htons(port);
        addr4->sin_family = AF_INET;
#ifdef __APPLE__
        addr4->sin_len = sizeof(struct sockaddr_in);
#endif
        return 0;
    }

    // Try to parse as IPv6
    struct sockaddr_in6 *addr6 = (struct sockaddr_in6 *)storage;
    if (inet_pton(AF_INET6, ip_str, &addr6->sin6_addr) == 1) {
        addr6->sin6_port = htons(port);
        addr6->sin6_family = AF_INET6;
#ifdef __APPLE__
        addr6->sin6_len = sizeof(struct sockaddr_in6);
#endif
        return 0;
    }

    // If we reach here, the input is neither IPv4 nor IPv6
    return 1;
}

void *us_socket_context_connect(int ssl, struct us_socket_context_t *context, const char *host, int port, int options, int socket_ext_size, int* is_connecting) {
#ifndef LIBUS_NO_SSL
    if (ssl == 1) {
        return us_internal_ssl_socket_context_connect((struct us_internal_ssl_socket_context_t *) context, host, port, options, socket_ext_size, is_connecting);
    }
#endif

    struct us_loop_t* loop = us_socket_context_loop(ssl, context);

    // fast path for IP addresses in text form
    struct sockaddr_storage addr;
    if (try_parse_ip(host, port, &addr) == 0) {
        *is_connecting = 1;
        return us_socket_context_connect_resolved_dns(context, &addr, options, socket_ext_size);
    }

    struct addrinfo_request* ai_req;
    if (Bun__addrinfo_get(loop, host, &ai_req) == 0) {
        // fast path for cached results
        struct addrinfo_result *result = Bun__addrinfo_getRequestResult(ai_req);
        // fast failure path
        if (result->error) {
            errno = result->error;
            Bun__addrinfo_freeRequest(ai_req, 1);
            return NULL;
        }

        // if there is only one result we can immediately connect
        if (result->entries && result->entries->info.ai_next == NULL) {
            struct sockaddr_storage addr;
            init_addr_with_port(&result->entries->info, port, &addr);
            *is_connecting = 1;
            struct us_socket_t *s = us_socket_context_connect_resolved_dns(context, &addr, options, socket_ext_size);
            Bun__addrinfo_freeRequest(ai_req, s == NULL);
            return s;
        }
    }

    struct us_connecting_socket_t *c = us_calloc(1, sizeof(struct us_connecting_socket_t) + socket_ext_size);
    c->socket_ext_size = socket_ext_size;  
    c->options = options;
    c->ssl = ssl > 0;
    c->timeout = 255;
    c->long_timeout = 255;
    c->pending_resolve_callback = 1;
    c->port = port;
    us_internal_socket_context_link_connecting_socket(ssl, context, c);

#ifdef _WIN32
    loop->uv_loop->active_handles++;
#else
    loop->num_polls++;
#endif

    Bun__addrinfo_set(ai_req, c);

    return c;
}

int start_connections(struct us_connecting_socket_t *c, int count) {
    int opened = 0;
    for (; c->addrinfo_head != NULL && opened < count; c->addrinfo_head = c->addrinfo_head->ai_next) {
        struct sockaddr_storage addr;
        init_addr_with_port(c->addrinfo_head, c->port, &addr);
        LIBUS_SOCKET_DESCRIPTOR connect_socket_fd = bsd_create_connect_socket(&addr, c->options);
        if (connect_socket_fd == LIBUS_SOCKET_ERROR) {
            continue;
        }
        ++opened;
        bsd_socket_nodelay(connect_socket_fd, 1);

        struct us_socket_t *s = (struct us_socket_t *)us_create_poll(c->context->loop, 0, sizeof(struct us_socket_t) + c->socket_ext_size);
        s->context = c->context;
        s->timeout = c->timeout;
        s->long_timeout = c->long_timeout;
        s->low_prio_state = 0;
        /* Link it into context so that timeout fires properly */
        us_internal_socket_context_link_socket(s->context, s);

        // TODO check this, specifically how it interacts with the SSL code
        // does this work when we create multiple sockets at once? will we need multiple SSL contexts?
        // no, we won't need multiple contexts - the context is only initialized on_open
        memcpy(us_socket_ext(0, s), us_connecting_socket_ext(0, c), c->socket_ext_size);

        // store the socket so we can close it if we need to
        s->connect_next = c->connecting_head;
        c->connecting_head = s;

        s->connect_state = c;

        /* Connect sockets are semi-sockets just like listen sockets */
        us_poll_init(&s->p, connect_socket_fd, POLL_TYPE_SEMI_SOCKET);
        us_poll_start(&s->p, s->context->loop, LIBUS_SOCKET_WRITABLE);
    }
    return opened;
}

void us_internal_socket_after_resolve(struct us_connecting_socket_t *c) {
    // make sure to decrement the active_handles counter, no matter what
#ifdef _WIN32
    c->context->loop->uv_loop->active_handles--;
#else
    c->context->loop->num_polls--;
#endif

    c->pending_resolve_callback = 0;
    // if the socket was closed while we were resolving the address, free it
    if (c->closed) {
        us_connecting_socket_free(c->ssl, c);
        return;
    }
    struct addrinfo_result *result = Bun__addrinfo_getRequestResult(c->addrinfo_req);
    if (result->error) {
        us_connecting_socket_close(c->ssl, c);
        return;
    }

    c->addrinfo_head = &result->entries->info;

    int opened = start_connections(c, CONCURRENT_CONNECTIONS);
    if (opened == 0) {
        us_connecting_socket_close(c->ssl, c);
        return;
    }
}

void us_internal_socket_after_open(struct us_socket_t *s, int error) {
    struct us_connecting_socket_t *c = s->connect_state;
    #if _WIN32
    // libuv doesn't give us a way to know if a non-blockingly connected socket failed to connect
    // It shows up as writable.
    //
    // TODO: Submit PR to libuv to allow uv_poll to poll for connect and connect_fail
    //
    // AFD_POLL_CONNECT
    // AFD_POLL_CONNECT_FAIL
    //
    if (error == 0) {
        if (recv( us_poll_fd((struct us_poll_t*)s), NULL, 0, MSG_PUSH_IMMEDIATE ) == SOCKET_ERROR) {
            // When a socket is not connected, this function returns WSAENOTCONN.
            error = WSAGetLastError();
            switch (error) {
                case WSAEWOULDBLOCK:
                case WSAEINTR: {
                    error = 0;
                    break;
                }
                default: {
                    break;
                }
            }
        }
    }
    #endif
    /* It is perfectly possible to come here with an error */
    if (error) {

        /* Emit error, close without emitting on_close */

        /* There are two possible states here: 
            1. It's a us_connecting_socket_t*. DNS resolution failed, or a connection failed. 
            2. It's a us_socket_t* 

            We differentiate between these two cases by checking if the connect_state is null.
        */
        if (c) {
            // remove this connecting socket from the list of connecting sockets
            // if it was the last one, signal the error to the user
            for (struct us_socket_t **next = &c->connecting_head; *next; next = &(*next)->connect_next) {
                if (*next == s) {
                    *next = s->connect_next;
                    break;
                }
            }
            us_socket_close(0, s, LIBUS_SOCKET_CLOSE_CODE_CONNECTION_RESET, 0);

            // Since CONCURRENT_CONNECTIONS is 2, we know there is room for at least 1 more active connection
            // now that we've closed the current socket.
            //
            // Three possible cases:
            // 1. The list of addresses to try is now empty -> throw an error
            // 2. There is a next address to try -> start the next one
            // 3. There are 2 or more addresses to try -> start the next two.
            if (c->connecting_head == NULL || c->connecting_head->connect_next == NULL) {
                // start opening the next batch of connections
                int opened = start_connections(c, c->connecting_head == NULL ? CONCURRENT_CONNECTIONS : 1);
                // we have run out of addresses to attempt, signal the connection error
                // but only if there are no other sockets in the list
                if (opened == 0 && c->connecting_head == NULL) {
                    us_connecting_socket_close(c->ssl, c);
                }
            }
        } else {
            s->context->on_socket_connect_error(s, error);
            // It's expected that close is called by the caller
        }
    } else {
        /* All sockets poll for readable */
        us_poll_change(&s->p, s->context->loop, LIBUS_SOCKET_READABLE);

        /* We always use nodelay */
        bsd_socket_nodelay(us_poll_fd(&s->p), 1);

        /* We are now a proper socket */
        us_internal_poll_set_type(&s->p, POLL_TYPE_SOCKET);

        /* If we used a connection timeout we have to reset it here */
        us_socket_timeout(0, s, 0);

        // if there is a connect_state, we need to close all other connection attempts that are currently in progress
        if (c) {
            for (struct us_socket_t *next = c->connecting_head; next; next = next->connect_next) {
                if (next != s) {
                    us_socket_close(0, next, LIBUS_SOCKET_CLOSE_CODE_CONNECTION_RESET, 0);
                }
            }
            // now that the socket is open, we can release the associated us_connecting_socket_t if it exists
            Bun__addrinfo_freeRequest(c->addrinfo_req, 0);
            us_connecting_socket_free(c->ssl, c);
            s->connect_state = NULL;
        }

        s->context->on_open(s, 1, 0, 0);
    }
}

struct us_socket_t *us_socket_context_connect_unix(int ssl, struct us_socket_context_t *context, const char *server_path, size_t pathlen, int options, int socket_ext_size) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        return (struct us_socket_t *) us_internal_ssl_socket_context_connect_unix((struct us_internal_ssl_socket_context_t *) context, server_path, pathlen, options, socket_ext_size);
    }
#endif

    LIBUS_SOCKET_DESCRIPTOR connect_socket_fd = bsd_create_connect_socket_unix(server_path, pathlen, options);
    if (connect_socket_fd == LIBUS_SOCKET_ERROR) {
        return 0;
    }

    /* Connect sockets are semi-sockets just like listen sockets */
    struct us_poll_t *p = us_create_poll(context->loop, 0, sizeof(struct us_socket_t) + socket_ext_size);
    us_poll_init(p, connect_socket_fd, POLL_TYPE_SEMI_SOCKET);
    us_poll_start(p, context->loop, LIBUS_SOCKET_WRITABLE);

    struct us_socket_t *connect_socket = (struct us_socket_t *) p;

    /* Link it into context so that timeout fires properly */
    connect_socket->context = context;
    connect_socket->timeout = 255;
    connect_socket->long_timeout = 255;
    connect_socket->low_prio_state = 0;
    connect_socket->connect_state = NULL;
    us_internal_socket_context_link_socket(context, connect_socket);

    return connect_socket;
}

struct us_socket_context_t *us_create_child_socket_context(int ssl, struct us_socket_context_t *context, int context_ext_size) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        return (struct us_socket_context_t *) us_internal_create_child_ssl_socket_context((struct us_internal_ssl_socket_context_t *) context, context_ext_size);
    }
#endif

    /* For TCP we simply create a new context as nothing is shared */
    struct us_socket_context_options_t options = {0};
    return us_create_socket_context(ssl, context->loop, context_ext_size, options);
}

/* Note: This will set timeout to 0 */
struct us_socket_t *us_socket_context_adopt_socket(int ssl, struct us_socket_context_t *context, struct us_socket_t *s, int ext_size) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        return (struct us_socket_t *) us_internal_ssl_socket_context_adopt_socket((struct us_internal_ssl_socket_context_t *) context, (struct us_internal_ssl_socket_t *) s, ext_size);
    }
#endif

    /* Cannot adopt a closed socket */
    if (us_socket_is_closed(ssl, s) || us_socket_is_shut_down(ssl, s)) {
        return s;
    }

    if (s->low_prio_state != 1) {
         /* We need to be sure that we still holding a reference*/
        us_socket_context_ref(ssl, context);
        /* This properly updates the iterator if in on_timeout */
        us_internal_socket_context_unlink_socket(ssl, s->context, s);
    }


    struct us_connecting_socket_t *c = s->connect_state;

    struct us_socket_t *new_s = s;
    if (ext_size != -1) {
        new_s = (struct us_socket_t *) us_poll_resize(&s->p, s->context->loop, sizeof(struct us_socket_t) + ext_size);
        if (c) {
            c->connecting_head = new_s;
            struct us_socket_context_t *old_context = s->context;
            c->context = context;
            us_internal_socket_context_link_connecting_socket(ssl, context, c);
            us_internal_socket_context_unlink_connecting_socket(ssl, old_context, c);
        }
    }
    new_s->timeout = 255;
    new_s->long_timeout = 255;

    if (new_s->low_prio_state == 1) {
        /* update pointers in low-priority queue */
        if (!new_s->prev) new_s->context->loop->data.low_prio_head = new_s;
        else new_s->prev->next = new_s;

        if (new_s->next) new_s->next->prev = new_s;
    } else {
        us_internal_socket_context_link_socket(context, new_s);
        us_socket_context_unref(ssl, context);
    }

    return new_s;
}


void us_socket_context_on_open(int ssl, struct us_socket_context_t *context, struct us_socket_t *(*on_open)(struct us_socket_t *s, int is_client, char *ip, int ip_length)) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        us_internal_ssl_socket_context_on_open((struct us_internal_ssl_socket_context_t *) context, (struct us_internal_ssl_socket_t * (*)(struct us_internal_ssl_socket_t *, int,  char *, int)) on_open);
        return;
    }
#endif

    context->on_open = on_open;
}

void us_socket_context_on_close(int ssl, struct us_socket_context_t *context, struct us_socket_t *(*on_close)(struct us_socket_t *s, int code, void *reason)) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        us_internal_ssl_socket_context_on_close((struct us_internal_ssl_socket_context_t *) context, (struct us_internal_ssl_socket_t * (*)(struct us_internal_ssl_socket_t *, int code, void *reason)) on_close);
        return;
    }
#endif

    context->on_close = on_close;
}

void us_socket_context_on_data(int ssl, struct us_socket_context_t *context, struct us_socket_t *(*on_data)(struct us_socket_t *s, char *data, int length)) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        us_internal_ssl_socket_context_on_data((struct us_internal_ssl_socket_context_t *) context, (struct us_internal_ssl_socket_t * (*)(struct us_internal_ssl_socket_t *, char *, int)) on_data);
        return;
    }
#endif

    context->on_data = on_data;
}

void us_socket_context_on_writable(int ssl, struct us_socket_context_t *context, struct us_socket_t *(*on_writable)(struct us_socket_t *s)) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        us_internal_ssl_socket_context_on_writable((struct us_internal_ssl_socket_context_t *) context, (struct us_internal_ssl_socket_t * (*)(struct us_internal_ssl_socket_t *)) on_writable);
        return;
    }
#endif

    context->on_writable = on_writable;
}

void us_socket_context_on_long_timeout(int ssl, struct us_socket_context_t *context, struct us_socket_t *(*on_long_timeout)(struct us_socket_t *)) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        us_internal_ssl_socket_context_on_long_timeout((struct us_internal_ssl_socket_context_t *) context, (struct us_internal_ssl_socket_t * (*)(struct us_internal_ssl_socket_t *)) on_long_timeout);
        return;
    }
#endif

    context->on_socket_long_timeout = on_long_timeout;
}

void us_socket_context_on_timeout(int ssl, struct us_socket_context_t *context, struct us_socket_t *(*on_timeout)(struct us_socket_t *)) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        us_internal_ssl_socket_context_on_timeout((struct us_internal_ssl_socket_context_t *) context, (struct us_internal_ssl_socket_t * (*)(struct us_internal_ssl_socket_t *)) on_timeout);
        return;
    }
#endif

    context->on_socket_timeout = on_timeout;
}

void us_socket_context_on_end(int ssl, struct us_socket_context_t *context, struct us_socket_t *(*on_end)(struct us_socket_t *)) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        us_internal_ssl_socket_context_on_end((struct us_internal_ssl_socket_context_t *) context, (struct us_internal_ssl_socket_t * (*)(struct us_internal_ssl_socket_t *)) on_end);
        return;
    }
#endif

    context->on_end = on_end;
}

void us_socket_context_on_connect_error(int ssl, struct us_socket_context_t *context, struct us_connecting_socket_t *(*on_connect_error)(struct us_connecting_socket_t *s, int code)) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        us_internal_ssl_socket_context_on_connect_error((struct us_internal_ssl_socket_context_t *) context, (struct us_internal_ssl_socket_t * (*)(struct us_internal_ssl_socket_t *, int)) on_connect_error);
        return;
    }
#endif
    
    context->on_connect_error = on_connect_error;
}

void us_socket_context_on_socket_connect_error(int ssl, struct us_socket_context_t *context, struct us_socket_t *(*on_connect_error)(struct us_socket_t *s, int code)) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        us_internal_ssl_socket_context_on_socket_connect_error((struct us_internal_ssl_socket_context_t *) context, (struct us_internal_ssl_socket_t * (*)(struct us_internal_ssl_socket_t *, int)) on_connect_error);
        return;
    }
#endif
    
    context->on_socket_connect_error = on_connect_error;
}

void *us_socket_context_ext(int ssl, struct us_socket_context_t *context) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        return us_internal_ssl_socket_context_ext((struct us_internal_ssl_socket_context_t *) context);
    }
#endif

    return context + 1;
}


void us_socket_context_on_handshake(int ssl, struct us_socket_context_t *context, void (*on_handshake)(struct us_socket_t *, int success, struct us_bun_verify_error_t verify_error, void* custom_data), void* custom_data) {
#ifndef LIBUS_NO_SSL
    if (ssl) {
        us_internal_on_ssl_handshake((struct us_internal_ssl_socket_context_t *) context, (us_internal_on_handshake_t)on_handshake, custom_data);
        return;
    }
#endif
}