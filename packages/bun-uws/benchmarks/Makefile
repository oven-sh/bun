default:
	clang -flto -O3 -DLIBUS_USE_OPENSSL -I../uSockets/src ../uSockets/src/*.c ../uSockets/src/eventing/*.c ../uSockets/src/crypto/*.c broadcast_test.c load_test.c scale_test.c -c
	clang++ -flto -O3 -DLIBUS_USE_OPENSSL -I../uSockets/src ../uSockets/src/crypto/*.cpp -c -std=c++17
	clang++ -flto -O3 -DLIBUS_USE_OPENSSL `ls *.o | grep -Ev "load_test|scale_test"` -lssl -lcrypto -o broadcast_test
	clang++ -flto -O3 -DLIBUS_USE_OPENSSL `ls *.o | grep -Ev "broadcast_test|scale_test"` -lssl -lcrypto -o load_test
	clang++ -flto -O3 -DLIBUS_USE_OPENSSL `ls *.o | grep -Ev "broadcast_test|load_test"` -lssl -lcrypto -o scale_test

