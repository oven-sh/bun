# You can select which sanitizer to use by setting this
SANITIZER ?= address
# These are set by OSS-Fuzz, we default to AddressSanitizer
CXXFLAGS ?= -DLIBUS_NO_SSL -fsanitize=$(SANITIZER),fuzzer
CFLAGS ?= -DLIBUS_NO_SSL
OUT ?= .

# These are fetched from libEpollFuzzer
WRAPPED_SYSCALLS = -Wl,--wrap=getpeername,--wrap=sendto,--wrap=send,--wrap=recv,--wrap=read,--wrap=listen,--wrap=getaddrinfo,--wrap=freeaddrinfo,--wrap=setsockopt,--wrap=fcntl,--wrap=bind,--wrap=socket,--wrap=epoll_wait,--wrap=epoll_create1,--wrap=timerfd_settime,--wrap=close,--wrap=accept4,--wrap=eventfd,--wrap=timerfd_create,--wrap=epoll_ctl,--wrap=shutdown

oss-fuzz:
# Copy dictionaries
	cp *.dict $(OUT)
# libEpollFuzzer cases
	# Compile uSockets without -flto
	rm -rf *.o
	$(CC) $(CFLAGS) -DLIBUS_NO_SSL -std=c11 -I../uSockets/src -O3 -c ../uSockets/src/*.c ../uSockets/src/eventing/*.c ../uSockets/src/crypto/*.c
	# Link against object files
	$(CXX) $(CXXFLAGS) $(WRAPPED_SYSCALLS) -std=c++17 -O3 -DUWS_MOCK_ZLIB -I../src -I../uSockets/src EpollHelloWorld.cpp -o $(OUT)/EpollHelloWorld $(LIB_FUZZING_ENGINE) *.o
	rm -f EpollHelloWorld.o
	$(CXX) $(CXXFLAGS) $(WRAPPED_SYSCALLS) -std=c++17 -O3 -DUWS_MOCK_ZLIB -I../src -I../uSockets/src AsyncEpollHelloWorld.cpp -o $(OUT)/AsyncEpollHelloWorld $(LIB_FUZZING_ENGINE) *.o
	rm -f AsyncEpollHelloWorld.o
	$(CXX) $(CXXFLAGS) $(WRAPPED_SYSCALLS) -std=c++17 -O3 -DUWS_MOCK_ZLIB -I../src -I../uSockets/src EpollEchoServer.cpp -o $(OUT)/EpollEchoServer $(LIB_FUZZING_ENGINE) *.o
	rm -f EpollEchoServer.o
	$(CXX) $(CXXFLAGS) $(WRAPPED_SYSCALLS) -std=c++17 -O3 -DUWS_MOCK_ZLIB -I../src -I../uSockets/src EpollEchoServerPubSub.cpp -o $(OUT)/EpollEchoServerPubSub $(LIB_FUZZING_ENGINE) *.o
# "Unit tests"
	$(CXX) $(CXXFLAGS) -std=c++17 -O3 Extensions.cpp -o $(OUT)/Extensions $(LIB_FUZZING_ENGINE)
	$(CXX) $(CXXFLAGS) -std=c++17 -O3 QueryParser.cpp -o $(OUT)/QueryParser $(LIB_FUZZING_ENGINE)
	$(CXX) $(CXXFLAGS) -std=c++17 -O3 MultipartParser.cpp -o $(OUT)/MultipartParser $(LIB_FUZZING_ENGINE)
	$(CXX) $(CXXFLAGS) -std=c++17 -O3 -I../uSockets/src WebSocket.cpp -o $(OUT)/WebSocket $(LIB_FUZZING_ENGINE)
	$(CXX) $(CXXFLAGS) -std=c++17 -O3 Http.cpp -o $(OUT)/Http $(LIB_FUZZING_ENGINE)
	$(CXX) $(CXXFLAGS) -DUWS_WITH_PROXY -std=c++17 -O3 Http.cpp -o $(OUT)/HttpWithProxy $(LIB_FUZZING_ENGINE)
	$(CXX) $(CXXFLAGS) -DUWS_MOCK_ZLIB -std=c++17 -O3 PerMessageDeflate.cpp -o $(OUT)/PerMessageDeflate $(LIB_FUZZING_ENGINE)
	$(CXX) $(CXXFLAGS) -std=c++17 -O3 TopicTree.cpp -o $(OUT)/TopicTree $(LIB_FUZZING_ENGINE)

regression_test:
	$(OUT)/EpollEchoServer seed-corpus/EpollEchoServer/regressions/*
	$(OUT)/EpollHelloWorld seed-corpus/EpollHelloWorld/regressions/*
	$(OUT)/EpollEchoServerPubSub seed-corpus/EpollEchoServerPubSub/regressions/*
	# $(OUT)/Extensions seed-corpus/Extensions/regressions/*
	# $(OUT)/QueryParser seed-corpus/QueryParser/regressions/*
	$(OUT)/TopicTree seed-corpus/TopicTree/regressions/*
	$(OUT)/WebSocket seed-corpus/WebSocket/regressions/*
	$(OUT)/Http seed-corpus/Http/regressions/*
	$(OUT)/HttpWithProxy seed-corpus/HttpWithProxy/regressions/*
	# $(OUT)/MultipartParser seed-corpus/MultipartParser/regressions/*
	$(OUT)/PerMessageDeflate seed-corpus/PerMessageDeflate/regressions/*
