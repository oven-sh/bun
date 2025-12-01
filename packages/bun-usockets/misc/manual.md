# libusockets.h

This is the only header you include. Following documentation has been extracted from this header. It may be outdated, go read the header directly for up-to-date documentation.

These interfaces are "beta" and subject to smaller changes. Last updated **2019-06-11**.

# A quick note on compilation

Major differences in performance can be seen based solely on compiler and/or linker options. Important is to compile with some kind of link-time-optimization mode, preferably with static linking of this library such as including all C source files in the user program build step itself. Proper compilation and linking can lead to over 25% performance increase (in my case, YMMV).

# Cross-platform benchmarks

While the library is compatible with many platforms, Linux in particular is the preferred production system. Benchmarking has been done on Windows, Linux and macOS where Linux clearly stood out as significant winner. Windows performed about half that of Linux and macOS was not much better than Windows. Do run your production systems on Linux.

# us_loop_t - The root per-thread resource and callback emitter

```c
/* Returns a new event loop with user data extension */
WIN32_EXPORT struct us_loop_t *us_create_loop(void *hint, void (*wakeup_cb)(struct us_loop_t *loop), void (*pre_cb)(struct us_loop_t *loop), void (*post_cb)(struct us_loop_t *loop), unsigned int ext_size);

/* Frees the loop immediately */
WIN32_EXPORT void us_loop_free(struct us_loop_t *loop);

/* Returns the loop user data extension */
WIN32_EXPORT void *us_loop_ext(struct us_loop_t *loop);

/* Blocks the calling thread and drives the event loop until no more non-fallthrough polls are scheduled */
WIN32_EXPORT void us_loop_run(struct us_loop_t *loop);

/* Signals the loop from any thread to wake up and execute its wakeup handler from the loop's own running thread.
 * This is the only fully thread-safe function and serves as the basis for thread safety */
WIN32_EXPORT void us_wakeup_loop(struct us_loop_t *loop);

/* Hook up timers in existing loop */
WIN32_EXPORT void us_loop_integrate(struct us_loop_t *loop);

/* Returns the loop iteration number */
WIN32_EXPORT long long us_loop_iteration_number(struct us_loop_t *loop);
```

# us_socket_context_t - The per-behavior group of networking sockets

```c
struct us_socket_context_options_t {
    const char *key_file_name;
    const char *cert_file_name;
    const char *passphrase;
    const char *dh_params_file_name;
    const char *ca_file_name;
    const char *ssl_ciphers;
    int ssl_prefer_low_memory_usage;
};

/* A socket context holds shared callbacks and user data extension for associated sockets */
WIN32_EXPORT struct us_socket_context_t *us_create_socket_context(int ssl, struct us_loop_t *loop, int ext_size, struct us_socket_context_options_t options);

/* Delete resources allocated at creation time. */
WIN32_EXPORT void us_socket_context_free(int ssl, struct us_socket_context_t *context);

/* Setters of various async callbacks */
WIN32_EXPORT void us_socket_context_on_open(int ssl, struct us_socket_context_t *context, struct us_socket_t *(*on_open)(struct us_socket_t *s, int is_client, char *ip, int ip_length));
WIN32_EXPORT void us_socket_context_on_close(int ssl, struct us_socket_context_t *context, struct us_socket_t *(*on_close)(struct us_socket_t *s));
WIN32_EXPORT void us_socket_context_on_data(int ssl, struct us_socket_context_t *context, struct us_socket_t *(*on_data)(struct us_socket_t *s, char *data, int length));
WIN32_EXPORT void us_socket_context_on_writable(int ssl, struct us_socket_context_t *context, struct us_socket_t *(*on_writable)(struct us_socket_t *s));
WIN32_EXPORT void us_socket_context_on_timeout(int ssl, struct us_socket_context_t *context, struct us_socket_t *(*on_timeout)(struct us_socket_t *s));

/* Emitted when a socket has been half-closed */
WIN32_EXPORT void us_socket_context_on_end(int ssl, struct us_socket_context_t *context, struct us_socket_t *(*on_end)(struct us_socket_t *s));

/* Returns user data extension for this socket context */
WIN32_EXPORT void *us_socket_context_ext(int ssl, struct us_socket_context_t *context);

/* Listen for connections. Acts as the main driving cog in a server. Will call set async callbacks. */
WIN32_EXPORT struct us_listen_socket_t *us_socket_context_listen(int ssl, struct us_socket_context_t *context, const char *host, int port, int options, int socket_ext_size);

/* listen_socket.c/.h */
WIN32_EXPORT void us_listen_socket_close(int ssl, struct us_listen_socket_t *ls);

/* Land in on_open or on_close or return null or return socket */
WIN32_EXPORT struct us_socket_t *us_socket_context_connect(int ssl, struct us_socket_context_t *context, const char *host, int port, int options, int socket_ext_size);

/* Returns the loop for this socket context. */
WIN32_EXPORT struct us_loop_t *us_socket_context_loop(int ssl, struct us_socket_context_t *context);

/* Invalidates passed socket, returning a new resized socket which belongs to a different socket context.
 * Used mainly for "socket upgrades" such as when transitioning from HTTP to WebSocket. */
WIN32_EXPORT struct us_socket_t *us_socket_context_adopt_socket(int ssl, struct us_socket_context_t *context, struct us_socket_t *s, int ext_size);

/* Create a child socket context which acts much like its own socket context with its own callbacks yet still relies on the
 * parent socket context for some shared resources. Child socket contexts should be used together with socket adoptions and nothing else. */
WIN32_EXPORT struct us_socket_context_t *us_create_child_socket_context(int ssl, struct us_socket_context_t *context, int context_ext_size);
```

# us_socket_t - The network connection (SSL or non-SSL)

```c
/* Write up to length bytes of data. Returns actual bytes written. Will call the on_writable callback of active socket context on failure to write everything off in one go.
WIN32_EXPORT int us_socket_write(int ssl, struct us_socket_t *s, const char *data, int length);

/* Set a low precision, high performance timer on a socket. A socket can only have one single active timer at any given point in time. Will remove any such pre set timer */
WIN32_EXPORT void us_socket_timeout(int ssl, struct us_socket_t *s, unsigned int seconds);

/* Return the user data extension of this socket */
WIN32_EXPORT void *us_socket_ext(int ssl, struct us_socket_t *s);

/* Return the socket context of this socket */
WIN32_EXPORT struct us_socket_context_t *us_socket_context(int ssl, struct us_socket_t *s);

/* Withdraw any msg_more status and flush any pending data */
WIN32_EXPORT void us_socket_flush(int ssl, struct us_socket_t *s);

/* Shuts down the connection by sending FIN and/or close_notify */
WIN32_EXPORT void us_socket_shutdown(int ssl, struct us_socket_t *s);

/* Returns whether the socket has been shut down or not */
WIN32_EXPORT int us_socket_is_shut_down(int ssl, struct us_socket_t *s);

/* Returns whether this socket has been closed. Only valid if memory has not yet been released. */
WIN32_EXPORT int us_socket_is_closed(int ssl, struct us_socket_t *s);

/* Immediately closes the socket */
WIN32_EXPORT struct us_socket_t *us_socket_close(int ssl, struct us_socket_t *s);

/* Copy remote (IP) address of socket, or fail with zero length. */
WIN32_EXPORT void us_socket_remote_address(int ssl, struct us_socket_t *s, char *buf, int *length);
```

# Low level components

## us_timer_t - High cost (very expensive resource) timers

**NOTE:** Many slow servers use one timer per socket. That is incredibly inefficient and so uSockets will only use one single us_timer_t per every one us_loop_t. A similar design is utilized in the Linux kernel and is how you should think of timers yourself.

```c
/* Create a new high precision, low performance timer. May fail and return null */
WIN32_EXPORT struct us_timer_t *us_create_timer(struct us_loop_t *loop, int fallthrough, unsigned int ext_size);

/* Returns user data extension for this timer */
WIN32_EXPORT void *us_timer_ext(struct us_timer_t *timer);

/* */
WIN32_EXPORT void us_timer_close(struct us_timer_t *timer);

/* Arm a timer with a delay from now and eventually a repeat delay.
 * Specify 0 as repeat delay to disable repeating. Specify both 0 to disarm. */
WIN32_EXPORT void us_timer_set(struct us_timer_t *timer, void (*cb)(struct us_timer_t *t), int ms, int repeat_ms);

/* Returns the loop for this timer */
WIN32_EXPORT struct us_loop_t *us_timer_loop(struct us_timer_t *t);
```

## us_poll_t - The eventing foundation of a socket or anything that has a file descriptor

```c
/* A fallthrough poll does not keep the loop running, it falls through */
WIN32_EXPORT struct us_poll_t *us_create_poll(struct us_loop_t *loop, int fallthrough, unsigned int ext_size);

/* After stopping a poll you must manually free the memory */
WIN32_EXPORT void us_poll_free(struct us_poll_t *p, struct us_loop_t *loop);

/* Associate this poll with a socket descriptor and poll type */
WIN32_EXPORT void us_poll_init(struct us_poll_t *p, LIBUS_SOCKET_DESCRIPTOR fd, int poll_type);

/* Start, change and stop polling for events */
WIN32_EXPORT void us_poll_start(struct us_poll_t *p, struct us_loop_t *loop, int events);
WIN32_EXPORT void us_poll_change(struct us_poll_t *p, struct us_loop_t *loop, int events);
WIN32_EXPORT void us_poll_stop(struct us_poll_t *p, struct us_loop_t *loop);

/* Return what events we are polling for */
WIN32_EXPORT int us_poll_events(struct us_poll_t *p);

/* Returns the user data extension of this poll */
WIN32_EXPORT void *us_poll_ext(struct us_poll_t *p);

/* Get associated socket descriptor from a poll */
WIN32_EXPORT LIBUS_SOCKET_DESCRIPTOR us_poll_fd(struct us_poll_t *p);

/* Resize an active poll */
WIN32_EXPORT struct us_poll_t *us_poll_resize(struct us_poll_t *p, struct us_loop_t *loop, unsigned int ext_size);
```
