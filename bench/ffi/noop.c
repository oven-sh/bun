// clang -O3 -shared -undefined dynamic_lookup ./noop.c -o noop.dylib

int noop();

int noop() { return 1; }