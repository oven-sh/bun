#define _CRT_SECURE_NO_WARNINGS
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <stdarg.h>

int env_is(char *env, char *target) {
    char *val = getenv(env);
    return val && !strcmp(val, target);
}

char *maybe(char *in) {
    return in ? in : "";
}

char *or_else(char *in, char *otherwise) {
    return in ? in : otherwise;
}

int run(const char *cmd, ...) {
    char buf[2048];
    va_list args;
    va_start(args, cmd);
    vsprintf(buf, cmd, args);
    va_end(args);
    printf("--> %s\n\n", buf);
    return system(buf);
}
