#include "uv.h"
#include <stdio.h>

int main(void) {
    printf("UV_UNKNOWN_HANDLE=%d\n", UV_UNKNOWN_HANDLE);
    printf("UV_ASYNC=%d\n", UV_ASYNC);
    printf("UV_CHECK=%d\n", UV_CHECK);
    printf("UV_FS_EVENT=%d\n", UV_FS_EVENT);
    printf("UV_FS_POLL=%d\n", UV_FS_POLL);
    printf("UV_HANDLE=%d\n", UV_HANDLE);
    printf("UV_IDLE=%d\n", UV_IDLE);
    printf("UV_NAMED_PIPE=%d\n", UV_NAMED_PIPE);
    printf("UV_POLL=%d\n", UV_POLL);
    printf("UV_PREPARE=%d\n", UV_PREPARE);
    printf("UV_PROCESS=%d\n", UV_PROCESS);
    printf("UV_STREAM=%d\n", UV_STREAM);
    printf("UV_TCP=%d\n", UV_TCP);
    printf("UV_TIMER=%d\n", UV_TIMER);
    printf("UV_TTY=%d\n", UV_TTY);
    printf("UV_UDP=%d\n", UV_UDP);
    printf("UV_SIGNAL=%d\n", UV_SIGNAL);
    printf("UV_FILE=%d\n", UV_FILE);
    printf("UV_HANDLE_TYPE_MAX=%d\n", UV_HANDLE_TYPE_MAX);
    return 0;
}
