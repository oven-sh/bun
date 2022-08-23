#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <stddef.h>

#include "cpuinfo.h"

extern "C" CpuInfo *getCpuInfo()
{
    CpuInfo *cores = (CpuInfo*) malloc(sizeof(CpuInfo));
    FILE *file = fopen("/proc/cpuinfo", "r");
    if (file == NULL) return NULL;

    char buff[256];
    int coresIndex = -1;

    while (fgets(buff, 256, file)) {
        if (strlen(buff) == 0) continue;

        short columnSplit = 0;
        for (int i = 0; i < (int) strlen(buff); i++) {
            if (buff[i] == ':') {
                columnSplit = i;
                break;
            }
        }
        char *columnName = strndup(buff, columnSplit);
        
        if (!strncmp("processor", columnName, strlen("processor"))) {
            coresIndex++;
            if (coresIndex > 0)  {
                cores = (CpuInfo*) realloc(cores, (coresIndex+1) * sizeof(CpuInfo));
                if (cores == NULL) return NULL;
            }
        } else if(!strncmp("model name", columnName, strlen("model name"))) {
            char *columnData = strndup((buff+columnSplit+2), strlen(buff));
            cores[coresIndex].manufacturer = (char*) malloc(strlen(columnData));
            if (cores[coresIndex].manufacturer == NULL) return NULL;
            memcpy(cores[coresIndex].manufacturer, columnData, strlen(columnData)-1);
            cores[coresIndex].manufacturer[strlen(columnData)] = '\0';
        } else if(!strncmp("cpu MHz", columnName, strlen("cpu MHz"))) {
            char *columnData = strndup((buff+columnSplit+2), strlen(buff));
            cores[coresIndex].clockSpeed = atof(columnData);
        }
    }

    coresIndex++;
    cores = (CpuInfo*) realloc(cores, (coresIndex+1) * sizeof(CpuInfo));
    if (cores == NULL) return NULL;
    cores[coresIndex] = (CpuInfo) {NULL, 0, 0, 0, 0, 0, 0, 0};
    return cores;
}

extern "C" CpuInfo *getCpuTime()
{
    CpuInfo *cores = (CpuInfo*) malloc(sizeof(CpuInfo));
    FILE *file = fopen("/proc/stat", "r");
    if (file == NULL) return NULL;

    char buff[256];
    int coresIndex = -1;
    int j = 0;

    while (fgets(buff, 256, file)) {
        char *name = strndup(buff, 3);
        if (!strncmp("cpu", name, 3) && isdigit(buff[3])) {
            coresIndex++;
            if (coresIndex > 0) {
                cores = (CpuInfo*) realloc(cores, (coresIndex+1) * sizeof(CpuInfo));
                if (cores == NULL) return NULL;
            }
            int space;
            for (int i = 0; i < (int) strlen(buff); i++) {
                if (buff[i] == ' ') {
                    space = i;
                    break;
                }
            }
            char *cpuData = strndup((buff+space+1), strlen(buff));
            // Time to be smart, What I am about to do is dangerous.
            char *temp = (char*) &cores[coresIndex];
            size_t start = offsetof(CpuInfo, userTime); // getting offset from `userTime` member.
            temp = temp + start;
            j = 0;
            for (int i = 0; i < 6; i++, j++) {
                cpuData = (cpuData+j); // offseting string.
                for (j = 0; cpuData[j] != ' '; j++);
                *(int*)temp = atoi(strndup(cpuData, j));
                temp = temp + sizeof(int); // switching to next int member.
            }
        }
    }
    coresIndex++;
    cores = (CpuInfo*) realloc(cores, (coresIndex+1) * sizeof(CpuInfo));
    if (cores == NULL) return NULL;
    cores[coresIndex] = (CpuInfo) {NULL, 0, 0, 0, 0, 0, 0, 0};
    
    return cores;
}

extern "C" CpuInfo *getCpuInfoAndTime()
{
    CpuInfo* arr = getCpuInfo();
    if (arr == NULL) return (CpuInfo*) malloc(sizeof(CpuInfo));
    CpuInfo* arr2 = getCpuTime();
    if (arr2 == NULL) return (CpuInfo*) malloc(sizeof(CpuInfo));

    for (int i = 0; arr[i].manufacturer; i++) {
        arr2[i].manufacturer = arr[i].manufacturer;
        arr2[i].clockSpeed = arr[i].clockSpeed;
    }
    free(arr);

    return arr2;
}

extern "C" int getCpuArrayLen(CpuInfo *arr)
{
    int i = 0;
    for (; arr[i].manufacturer; i++);
    return i-1;
}