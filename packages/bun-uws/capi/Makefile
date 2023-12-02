CAPI_EXAMPLE_FILES := HelloWorld HelloWorldAsync ServerName UpgradeSync UpgradeAsync EchoServer Broadcast BroadcastEchoServer
RUST_EXAMPLE_FILES := RustHelloWorld
LIBRARY_NAME := libuwebsockets

default:
	$(MAKE) capi
	$(CXX) -O3 -flto -I ../src -I ../uSockets/src examples/HelloWorld.c *.o -lz -luv -lssl -lcrypto -lstdc++ ../uSockets/uSockets.a -o HelloWorld

capi:
	$(MAKE) clean
	cd ../uSockets && $(CC) -pthread -DUWS_WITH_PROXY -DLIBUS_USE_OPENSSL -DLIBUS_USE_LIBUV -std=c11 -Isrc -flto -fPIC -O3 -c src/*.c src/eventing/*.c src/crypto/*.c
	cd ../uSockets && $(CXX) -std=c++17 -flto -fPIC -O3 -c src/crypto/*.cpp 
	cd ../uSockets && $(AR) rvs uSockets.a *.o

	$(CXX) -DUWS_WITH_PROXY -c -O3 -std=c++17 -lz -luv -flto -fPIC -I ../src -I ../uSockets/src $(LIBRARY_NAME).cpp
	$(AR) rvs $(LIBRARY_NAME).a $(LIBRARY_NAME).o ../uSockets/uSockets.a
shared:
	$(MAKE) clean

	cd ../uSockets && $(CC) -pthread -DUWS_WITH_PROXY  -DLIBUS_USE_OPENSSL -DLIBUS_USE_LIBUV -std=c11 -Isrc -flto -fPIC -O3 -c src/*.c src/eventing/*.c src/crypto/*.c
	cd ../uSockets && $(CXX) -std=c++17 -flto -fPIC -O3 -c src/crypto/*.cpp 
	cd ../uSockets && $(AR) rvs uSockets.a *.o

	$(CXX) -DUWS_WITH_PROXY  -c -O3 -std=c++17 -lz -luv -flto -fPIC -I ../src -I ../uSockets/src $(LIBRARY_NAME).cpp 
	$(CXX) -shared -o $(LIBRARY_NAME).so  $(LIBRARY_NAME).o ../uSockets/uSockets.a -fPIC  -lz -luv -lssl -lcrypto
misc:
	mkdir -p ../misc && openssl req -newkey rsa:2048 -new -nodes -x509 -days 3650 -passout pass:1234 -keyout ../misc/key.pem -out ../misc/cert.pem
rust:
	$(MAKE) capi
	rustc -C link-arg=$(LIBRARY_NAME).a -C link-args="-lstdc++ -luv" -C opt-level=3 -C lto -L all=. examples/RustHelloWorld.rs -o RustHelloWorld

clean:
	rm -f *.o $(CAPI_EXAMPLE_FILES) $(RUST_EXAMPLE_FILES) $(LIBRARY_NAME).a $(LIBRARY_NAME).so

all:
	for FILE in $(CAPI_EXAMPLE_FILES); do  $(CXX) -O3 -flto -I ../src -I ../uSockets/src examples/$$FILE.c *.o -luv -lstdc++ ../uSockets/uSockets.a -o $$FILE & done; \
	wait
	
