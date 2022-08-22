#include <stdio.h>
#include "cpuinfo.h"

int main() {
    /*CpuInfo* arr = getCpuInfo();
    CpuInfo* arr2 = getCpuTime();

    for (int i = 0; arr2[i].userTime > 0; i++) {
        arr2[i].manufacturer = arr[i].manufacturer;
        arr2[i].clockSpeed = arr[i].clockSpeed;
        printf("%s (%f MHz): %d %d %d %d %d %d\n", arr2[i].manufacturer, arr2[i].clockSpeed,
                                                   arr2[i].userTime, arr2[i].niceTime, arr2[i].systemTime,
                                                   arr2[i].idleTime, arr2[i].iowaitTime, arr2[i].irqTime);
    }*/

    CpuInfo* arr = getCpuInfoAndTime();

    for (int i = 0; arr[i].userTime > 0; i++) {
        printf("%s (%f MHz): %d %d %d %d %d %d\n", arr[i].manufacturer, arr[i].clockSpeed,
                                                   arr[i].userTime, arr[i].niceTime, arr[i].systemTime,
                                                   arr[i].idleTime, arr[i].iowaitTime, arr[i].irqTime);
    }
    return 0;
}