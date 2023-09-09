# You need to link with wrapped syscalls
override CFLAGS += -Wl,--wrap=recv,--wrap=read,--wrap=listen,--wrap=getaddrinfo,--wrap=freeaddrinfo,--wrap=setsockopt,--wrap=fcntl,--wrap=bind,--wrap=socket,--wrap=epoll_wait,--wrap=epoll_create1,--wrap=timerfd_settime,--wrap=close,--wrap=accept4,--wrap=eventfd,--wrap=timerfd_create,--wrap=epoll_ctl,--wrap=shutdown

# Include uSockets and uWebSockets
override CFLAGS += -DUWS_NO_ZLIB -I./uWebSockets/src -I./uSockets/src

default:
	clang++ -std=c++17 -fsanitize=address,fuzzer test.c $(CFLAGS) -o test uSockets/uSockets.a
