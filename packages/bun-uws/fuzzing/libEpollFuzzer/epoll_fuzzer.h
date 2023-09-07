/* Welcome to libEpollFuzzer - a mock implementation of the epoll/socket syscalls */

/* Current implementation is extremely experimental and trashy, mind you */

#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <stdarg.h>
//#include <threads.h>

#include <sys/timerfd.h>
#include <sys/epoll.h>
#include <sys/types.h>
#include <sys/socket.h>
#include <netdb.h>
#include <errno.h>

// todo: add connect, donät pass invalid-FD to real syscalls
// getaddrinfo should return inet6 somtimes and sometimes wrong family (done)
// accept4 should produce inet6 sometimes (done)
// socket syscall should fail with given invalid family (done)
// listen syscall should fail sometimes (done)

/* Currently read, close, fcntl are wrapped to real syscalls */

/* TODO: Our FDs should start at 1024 while actual real FDs should be reserved from 0 to 1023 and passed to actual
 * real syscalls so that we can co-exist with overlapping syscalls like read, open, write, close */

//#define PRINTF_DEBUG

/* The test case */
void test();
void teardown();

#ifdef __cplusplus
extern "C" {
#endif

struct file {
	/* Every file has a type; socket, event, timer, epoll */
	int type;

	/* We assume there can only be one event-loop at any given point in time,
	 * so every file holds its own epoll_event */
	struct epoll_event epev;

	/* A file may be added to an epfd by linking it in a list */
	struct file *prev, *next;
};

/* If FD is less than this, it should be passed to REAL syscall.
 * We never produce FDs lower than this (except for -1 on error) */
const int RESERVED_SYSTEM_FDS = 1024;

/* Map from some collection of integers to a shared extensible struct of data */
const int MAX_FDS = 1000;
struct file *fd_to_file[MAX_FDS];

const int FD_TYPE_EPOLL = 0;
const int FD_TYPE_TIMER = 1;
const int FD_TYPE_EVENT = 2;
const int FD_TYPE_SOCKET = 3;

int num_fds = 0;

/* Keeping track of cunsumable data */
unsigned char *consumable_data;
int consumable_data_length;

void set_consumable_data(const unsigned char *new_data, int new_length) {
	consumable_data = (unsigned char *) new_data;
	consumable_data_length = new_length;
}

/* Returns non-null on error */
int consume_byte(unsigned char *b) {
	if (consumable_data_length) {
		*b = consumable_data[0];
		consumable_data++;
		consumable_data_length--;
		return 0;
	}
	return -1;
}

/* Keeping track of FDs */

/* Returns -1 on error, or RESERVED_SYSTEM_FDS and above */
int allocate_fd() {
	// this can be massively optimized by having a list of free blocks or the like
	for (int fd = 0; fd < MAX_FDS; fd++) {
		if (!fd_to_file[fd]) {
			num_fds++;
			return fd + RESERVED_SYSTEM_FDS;
		}
	}
	return -1;
}

/* This one should set the actual file for this FD */
void init_fd(int fd, int type, struct file *f) {
	if (fd >= RESERVED_SYSTEM_FDS) {
		fd_to_file[fd - RESERVED_SYSTEM_FDS] = f;
		fd_to_file[fd - RESERVED_SYSTEM_FDS]->type = type;
		fd_to_file[fd - RESERVED_SYSTEM_FDS]->next = NULL;
		fd_to_file[fd - RESERVED_SYSTEM_FDS]->prev = NULL;
	}
}

struct file *map_fd(int fd) {
	if (fd >= RESERVED_SYSTEM_FDS && fd < MAX_FDS + RESERVED_SYSTEM_FDS) {
		return fd_to_file[fd - RESERVED_SYSTEM_FDS];
	}
	return NULL;
}

/* This one should remove the FD from any pollset by calling epoll_ctl remove */
int free_fd(int fd) {
	if (fd >= RESERVED_SYSTEM_FDS && fd < MAX_FDS + RESERVED_SYSTEM_FDS) {
		if (fd_to_file[fd - RESERVED_SYSTEM_FDS]) {
			fd_to_file[fd - RESERVED_SYSTEM_FDS] = 0;
			num_fds--;
			return 0;
		}
	}

	return -1;
}

/* The epoll syscalls */

struct epoll_file {
	struct file base;

	/* A doubly linked list for polls awaiting events */
	struct file *poll_set_head, *poll_set_tail;
};

/* This function is O(n) and does not consume any fuzz data, but will fail if run out of FDs */
int __wrap_epoll_create1(int flags) {

	/* Todo: check that we do not allocate more than one epoll FD */
	int fd = allocate_fd();

	if (fd != -1) {
		struct epoll_file *ef = (struct epoll_file *)malloc(sizeof(struct epoll_file));

		/* Init the epoll_file */
		ef->poll_set_head = NULL;
		ef->poll_set_tail = NULL;

		init_fd(fd, FD_TYPE_EPOLL, (struct file *)ef);
	}

#ifdef PRINTF_DEBUG
	printf("epoll_create1 returning epfd: %d\n", fd);
#endif

	return fd;
}

// this function cannot be called inside an iteration! it changes the list
/* This function is O(1) and does not consume any fuzz data */
int __wrap_epoll_ctl(int epfd, int op, int fd, struct epoll_event *event) {

	struct epoll_file *ef = (struct epoll_file *)map_fd(epfd);
	if (!ef) {
		return -1;
	}

	struct file *f = (struct file *)map_fd(fd);
	if (!f) {
		return -1;
	}

	/* We add new polls in the head */
	if (op == EPOLL_CTL_ADD) {
		// if there is a head already
		if (ef->poll_set_head) {
			ef->poll_set_head->prev = f;

			// then it will be our next
			f->next = ef->poll_set_head;
		} else {
			// if there was no head then we became the tail also
			ef->poll_set_tail = f;
		}

		// we are now the head in any case
		ef->poll_set_head = f;

		f->epev = *event;

	} else if (op == EPOLL_CTL_MOD) {
		/* Modifying is simply changing the file itself */
		f->epev = *event;
	} else if (op == EPOLL_CTL_DEL) {

		if (f->prev) {
			f->prev->next = f->next;
		} else {
			ef->poll_set_head = f->next;
		}

		if (f->next) {
			f->next->prev = f->prev;
		} else {
			// tail ska vara vår.prev
			ef->poll_set_tail = f->prev;
		}

		// a file that is not in the list should be reset to NULL
		f->prev = NULL;
		f->next = NULL;
	}

	/* You have to poll for errors and hangups */
	f->epev.events |= EPOLLERR | EPOLLHUP;

	return 0;
}

/* This function is O(n) and consumes fuzz data and might trigger teardown callback */
int __wrap_epoll_wait(int epfd, struct epoll_event *events,
               int maxevents, int timeout) {
	//printf("epoll_wait: %d\n", 0);

#ifdef PRINTF_DEBUG
	printf("Calling epoll_wait\n");
#endif

	struct epoll_file *ef = (struct epoll_file *)map_fd(epfd);
	if (!ef) {
		return -1;
	}

	if (consumable_data_length) {

		int ready_events = 0;

		for (struct file *f = ef->poll_set_head; f; f = f->next) {


			/* Consume one fuzz byte, AND it with the event */
			if (!consumable_data_length) {
				// break if we have no data
				break;
			}

			// here we have the main condition that drives everything
			int ready_event = consumable_data[0] & f->epev.events;

			// consume the byte
			consumable_data_length--;
			consumable_data++;

			if (ready_event) {
				if (ready_events < maxevents) {
					events[ready_events] = f->epev;

					// todo: the event should be masked by the byte, not everything it wants shold be given all the time!
					events[ready_events++].events = ready_event;
				} else {
					// we are full, break
					break;
				}
			}

		}

		return ready_events;

	} else {

#ifdef PRINTF_DEBUG
		printf("Calling teardown\n");
#endif
		teardown();

		// after shutting down the listen socket we clear the whole list (the bug in epoll_ctl remove)
		// so the below loop doesn't work - we never close anything more than the listen socket!

		/* You don't really need to emit teardown, you could simply emit error on every poll */

		int ready_events = 0;

#ifdef PRINTF_DEBUG
		printf("Emitting error on every remaining FD\n");
#endif
		for (struct file *f = ef->poll_set_head; f; f = f->next) {

			if (f->type == FD_TYPE_SOCKET) {

				if (ready_events < maxevents) {
					events[ready_events] = f->epev;

					// todo: the event should be masked by the byte, not everything it wants shold be given all the time!
					events[ready_events++].events = EPOLLERR | EPOLLHUP;
				} else {
					// we are full, break
					break;
				}

			}
		}

#ifdef PRINTF_DEBUG
		printf("Ready events: %d\n", ready_events);
#endif

		return ready_events;
	}
}

/* The socket syscalls */

struct socket_file {
	struct file base;

	/* We store socket addresses created in accept4 */
	union {
		struct sockaddr_in6 in6;
		struct sockaddr_in in;
	} addr;

	/* The size of sockaddr_in6 or sockaddr_in as a whole */
	socklen_t len;
};

extern int __real_read(int fd, void *buf, size_t count);
int __wrap_read(int fd, void *buf, size_t count) {

	if (fd < RESERVED_SYSTEM_FDS) {
		return __real_read(fd, buf, count);
	}

#ifdef PRINTF_DEBUG
	printf("Wrapped read\n");
#endif

	/* Let's try and clear the buffer first */
	//memset(buf, 0, count);

	struct file *f = map_fd(fd);
	if (!f) {
		return -1;
	}

	errno = 0;

	if (f->type == FD_TYPE_SOCKET) {

		if (!consumable_data_length) {
			errno = EWOULDBLOCK;
			return -1;
		} else {
			int data_available = (unsigned char) consumable_data[0];
			consumable_data_length--;
			consumable_data++;

			if (consumable_data_length < data_available) {
				data_available = consumable_data_length;
			}

			if (count < data_available) {
				data_available = count;
			}

			memcpy(buf, consumable_data, data_available);

			consumable_data_length -= data_available;
			consumable_data += data_available;

			return data_available;
		}
	}

	if (f->type == FD_TYPE_EVENT) {
		memset(buf, 1, 8);
		return 8;
	}

	if (f->type == FD_TYPE_TIMER) {
		memset(buf, 1, 8);
		return 8;
	}

	return -1;
}

/* We just ignore the extra flag here */
int __wrap_recv(int sockfd, void *buf, size_t len, int flags) {
	return __wrap_read(sockfd, buf, len);
}

int __wrap_send(int sockfd, const void *buf, size_t len, int flags) {

	if (consumable_data_length) {
		/* We can send len scaled by the 1 byte */
		unsigned char scale = consumable_data[0];
		consumable_data++;
		consumable_data_length--;

		int written = float(scale) / 255.0f * len;

		if (written == 0) {
			errno = EWOULDBLOCK;
		} else {
			errno = 0;
		}

		return written;
	} else {
		return -1;
	}
}

int __wrap_sendto(int sockfd, const void *buf, size_t len, int flags,
	const struct sockaddr *dest_addr, socklen_t addrlen) {
		return __wrap_send(sockfd, buf, len, flags);
}

int __wrap_bind() {
	return 0;
}

int __wrap_setsockopt() {
	return 0;
}

extern int __real_fcntl(int fd, int cmd, ... /* arg */ );
int __wrap_fcntl(int fd, int cmd, ... /* arg */) {
	if (fd < RESERVED_SYSTEM_FDS) {
		va_list args;
		va_start(args, cmd);
		int ret = __real_fcntl(fd, cmd, args);
		va_end(args);
		return ret;
	}

	return 0;
}

/* Addrinfo */
int __wrap_getaddrinfo(const char *node, const char *service,
                       const struct addrinfo *hints,
                       struct addrinfo **res) {
	//printf("Wrapped getaddrinfo\n");

	struct addrinfo default_hints = {};

	if (!hints) {
		hints = &default_hints;
	}

	unsigned char b;
	if (consume_byte(&b)) {
		return -1;
	}

	/* This one should be thread_local */
	static /*thread_local*/ struct addrinfo ai;
	ai.ai_flags = hints->ai_flags;
	ai.ai_socktype = hints->ai_socktype;
	ai.ai_protocol = hints->ai_protocol;

	if (b > 127) {
		ai.ai_family = AF_INET;//hints->ai_family;
	} else {
		ai.ai_family = AF_INET6;//hints->ai_family;
	}

	/* This one is for generating the wrong family (maybe invalid?) */
	if (b == 0) {
		ai.ai_family = hints->ai_family;
	}

	ai.ai_next = NULL;
	ai.ai_canonname = NULL; // fel

	// these should depend on inet6 or inet */
	ai.ai_addrlen = 4; // fel
	ai.ai_addr = NULL; // ska peka på en sockaddr!

	// we need to return an addrinfo with family AF_INET6

	*res = &ai;
	return 0;
}

int __wrap_freeaddrinfo() {
	return 0;
}

/* This one should return the same address as accept4 did produce */
int __wrap_getpeername(int sockfd, struct sockaddr *addr, socklen_t *addrlen) {

	struct file *f = map_fd(sockfd);
	if (!f) {
		return -1;
	}

	// todo: this could fail with -1 also (consume a byte)?

	if (f->type == FD_TYPE_SOCKET) {

		struct socket_file *sf = (struct socket_file *) f;

		if (addr) {
			memcpy(addr, &sf->addr, sf->len);
			*addrlen = sf->len;
		}

		return 0;
	}

	return -1;
}

int __wrap_accept4(int sockfd, struct sockaddr *addr, socklen_t *addrlen) {
	/* We must end with -1 since we are called in a loop */

	unsigned char b;
	if (consume_byte(&b)) {
		return -1;
	}

	/* This rule might change, anything below 10 is accepted */
	if (b < 10) {

		int fd = allocate_fd();
		if (fd != -1) {

			/* Allocate the file */
			struct socket_file *sf = (struct socket_file *) malloc(sizeof(struct socket_file));

			/* Init the file */

			/* Here we need to create a socket FD and return */
			init_fd(fd, FD_TYPE_SOCKET, (struct file *)sf);

			/* We need to provide an addr */

			/* Begin by setting it to an empty in6 address */
			memset(&sf->addr, 0, sizeof(struct sockaddr_in6));
			sf->len = sizeof(struct sockaddr_in6);
			sf->addr.in6.sin6_family = AF_INET6;

			/* Opt-in to ipv4 */
			if (b < 5) {
				memset(&sf->addr, 0, sizeof(struct sockaddr_in6));
				sf->len = sizeof(struct sockaddr_in);
				sf->addr.in.sin_family = AF_INET;
			}

			if (addr) {
				/* Copy from socket to addr */
				memcpy(addr, &sf->addr, sf->len);
			}
		}

		return fd;
	}

	return -1;
}

int __wrap_listen() {
	/* Listen consumes one byte and fails on -1 */
	unsigned char b;
	if (consume_byte(&b)) {
		return -1;
	}

	if (b) {
		return 0;
	}

	return -1;
}

/* This one is similar to accept4 and has to return a valid FD of type socket */
int __wrap_socket(int domain, int type, int protocol) {

	/* Only accept valid families */
	if (domain != AF_INET && domain != AF_INET6) {
		return -1;
	}

	int fd = allocate_fd();

	if (fd != -1) {
		struct socket_file *sf = (struct socket_file *)malloc(sizeof(struct socket_file));

		/* Init the file */

		init_fd(fd, FD_TYPE_SOCKET, (struct file *)sf);
	}

#ifdef PRINTF_DEBUG
	printf("socket returning fd: %d\n", fd);
#endif

	return fd;
}

int __wrap_shutdown() {
	//printf("Wrapped shutdown\n");
	return 0;
}

/* The timerfd syscalls */

struct timer_file {
	struct file base;
};

int __wrap_timerfd_create(int clockid, int flags) {

	int fd = allocate_fd();

	if (fd != -1) {
		struct timer_file *tf = (struct timer_file *)malloc(sizeof(struct timer_file));

		/* Init the file */


		init_fd(fd, FD_TYPE_TIMER, (struct file *)tf);

	}

#ifdef PRINTF_DEBUG
	printf("timerfd_create returning fd: %d\n", fd);
#endif

	return fd;
}

int __wrap_timerfd_settime(int fd, int flags,
                    const struct itimerspec *new_value,
                    struct itimerspec *old_value) {
	//printf("timerfd_settime: %d\n", fd);
	return 0;
}

/* The eventfd syscalls */

struct event_file {
	struct file base;
};

int __wrap_eventfd() {

	int fd = allocate_fd();

	if (fd != -1) {
		struct event_file *ef = (struct event_file *)malloc(sizeof(struct event_file));

		/* Init the file */

		init_fd(fd, FD_TYPE_EVENT, (struct file *)ef);

		//printf("eventfd: %d\n", fd);
	}

#ifdef PRINTF_DEBUG
	printf("eventfd returning fd: %d\n", fd);
#endif

	return fd;
}

// timerfd_settime

/* File descriptors exist in a shared dimension, and has to know its type */
extern int __real_close(int fd);
int __wrap_close(int fd) {

	if (fd < RESERVED_SYSTEM_FDS) {
		return __real_close(fd);
	}

	struct file *f = map_fd(fd);

	if (!f) {
		return -1;
	}

	if (f->type == FD_TYPE_EPOLL) {
#ifdef PRINTF_DEBUG
		printf("Closing epoll FD: %d\n", fd);
#endif

		free(f);

		return free_fd(fd);

	} else if (f->type == FD_TYPE_TIMER) {
#ifdef PRINTF_DEBUG
		printf("Closing timer fd: %d\n", fd);
#endif

		free(f);

		return free_fd(fd);
	} else if (f->type == FD_TYPE_EVENT) {
#ifdef PRINTF_DEBUG
		printf("Closing event fd: %d\n", fd);
#endif

		free(f);

		return free_fd(fd);
	} else if (f->type == FD_TYPE_SOCKET) {
#ifdef PRINTF_DEBUG
		printf("Closing socket fd: %d\n", fd);
#endif

		// we should call epoll_ctl remove here

		free(f);

		int ret = free_fd(fd);

#ifdef PRINTF_DEBUG
		printf("Ret: %d\n", ret);
#endif

		//free(-1);
		return ret;
	}

	return -1;
}

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
	set_consumable_data(data, size);

	test();

	if (num_fds) {
		printf("ERROR! Cannot leave open FDs after test!\n");
	}

	return 0;
}

#ifdef __cplusplus
}
#endif
