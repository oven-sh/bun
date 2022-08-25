#include <cstdio>
#include "cpuinfo.h"

int main() {
    for (int i = 0; i < 10; i++) {
        CpuInfo *arr = getCpuInfoAndTime();
        for (int j = 0; j < getCpuArrayLen(arr); j++) {
            printf("%s\n", arr[j].manufacturer);
        }
        freeCpuInfoArray(arr);
    }
}