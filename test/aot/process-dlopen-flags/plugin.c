// A library that needs a symbol of ./core.c and is not linked against it.
#ifndef _WIN32
int core_value(void);

__attribute__((visibility("default"))) int plugin_value(void) { return core_value() + 1; }
#endif
