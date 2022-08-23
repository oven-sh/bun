#include "cpuinfo.h"
#include <cstdio>

int main() {
    CpuInfo* arr = getCpuInfo();
    for (int i = 0; arr[i].manufacturer; i++) {
        printf("%s: %f\n", arr[i].manufacturer, arr[i].clockSpeed);
    }
    return 0;
}