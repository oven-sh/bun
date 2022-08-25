#include <cstdio>
#include "cpuinfo.h"

int main() {
    for (int i = 0; i < 1000000; i++) {
        CpuInfo *arr = getCpuInfoAndTime();
    }
}