#pragma once

#include "root.h"

#if OS(WINDOWS)

#include <winsock2.h>
#include <ws2ipdef.h>

extern "C" {

// Layout of libuv's uv_cpu_info_t. Times are milliseconds.
struct BunCpuInfo {
    char* model; // UTF-8, NUL-terminated
    int speed; // MHz
    struct {
        uint64_t user;
        uint64_t nice;
        uint64_t sys;
        uint64_t idle;
        uint64_t irq;
    } cpu_times;
};

// Layout of libuv's uv_interface_address_t.
struct BunInterfaceAddress {
    char* name; // UTF-8, NUL-terminated
    char phys_addr[6];
    int is_internal;
    union {
        struct sockaddr_in address4;
        struct sockaddr_in6 address6;
    } address;
    union {
        struct sockaddr_in netmask4;
        struct sockaddr_in6 netmask6;
    } netmask;
};

// Both return 0 or a negative UV_E* number. On success the array, which may be
// null when `*count` is 0, is released with the matching free function.
int Bun__Os__cpuInfo(BunCpuInfo** cpuInfos, int* count);
void Bun__Os__freeCpuInfo(BunCpuInfo* cpuInfos, int count);
int Bun__Os__interfaceAddresses(BunInterfaceAddress** addresses, int* count);
void Bun__Os__freeInterfaceAddresses(BunInterfaceAddress* addresses, int count);
}

#endif // OS(WINDOWS)
