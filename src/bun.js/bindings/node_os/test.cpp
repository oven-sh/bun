#include <cstdio>
#include "cpuinfo.h"
#include "interface_addresses.h"

int main() {
    for (int i = 0; i < 10; i++) {
        CpuInfo *arr = getCpuInfoAndTime();
        int len = getCpuArrayLen(arr);
        for (int j = 0; j < len; j++) {
            printf("%s\n", arr[j].manufacturer);
        }
        freeCpuInfoArray(arr, len);
    }

    for (int i = 0; i < 10; i++) {
        NetworkInterface *arr = getNetworkInterfaces();
        int len = getNetworkInterfaceArrayLen(arr);
        for (int j = 0; j < len; j++) {
            printf("%s\n", arr[j].interface);
        }
        freeNetworkInterfaceArray(arr, len);
    }
}