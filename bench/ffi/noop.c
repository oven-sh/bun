// clang -O3 -shared -mtune=native ./noop.c -o noop.dylib

void noop();

void noop() {}