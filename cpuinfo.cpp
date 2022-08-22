#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

#include "cpuinfo.h"

CpuInfo *getCpuInfo()
{
    CpuInfo *cores = (CpuInfo*) malloc(sizeof(CpuInfo));
    if (cores == NULL) return NULL;
    char *data = (char*) malloc(sizeof(char));
    if (data == NULL) return NULL;
    char *line = (char*) malloc(sizeof(char));
    if (line == NULL) return NULL;
    char **lines = (char**) malloc(sizeof(char*));
    if (lines == NULL) return NULL;
    char temp;
    short columnSplit = 0;
    short tempLine = 0;
    short coresIndex = -1;

    FILE* systemData = fopen("/proc/cpuinfo", "r");
    if (systemData == NULL) return NULL;

    *data = '\0';
    *line = '\0';

    for (int i = 0; (temp = fgetc(systemData)) != EOF; i++) {
        data = (char*) realloc(data, i+2);
        if (data == NULL) return NULL;
        data[i] = temp;
        data[i+1] = '\0';
    }
    
    for (int i = 0; i < strlen(data); i++) {
        for (int j = 0; data[i] != '\n'; i++, j++) {
            line = (char*) realloc(line, j+2);
            if (line == NULL) return NULL;
            line[j] = data[i];
            line[j+1] = '\0';
        }

        lines[tempLine] = (char*) malloc(strlen(line)+1);
        if (lines[tempLine] == NULL) return NULL;
        memcpy(lines[tempLine], line, strlen(line));

        lines[tempLine][strlen(line)] = '\0';
        tempLine++;
        free(line);

        lines = (char**) realloc(lines, (tempLine+1) * sizeof(char*));
        if (lines == NULL) return NULL;
        line = (char*) malloc(sizeof(char));
        if (line == NULL) return NULL;
    }
    lines[tempLine] = NULL;
    tempLine = 0;

    free(data);

    while (lines[tempLine] != NULL) {
        columnSplit = 0;
        for (int i = 0; i < strlen(lines[tempLine]); i++) {
            if (lines[tempLine][i] == ':') {
                columnSplit = i;
                break;
            }
        }
        char *columnName = strndup(lines[tempLine], columnSplit);

        if (!strncmp("processor", columnName, strlen("processor"))) {
            coresIndex++;
            if (coresIndex > 0)  {
                cores = (CpuInfo*) realloc(cores, (coresIndex+1) * sizeof(CpuInfo));
                if (cores == NULL) return NULL;
            }
        } else if(!strncmp("model name", columnName, strlen("model name"))) {
            char *columnData = strndup((lines[tempLine]+columnSplit+2), strlen(lines[tempLine]));
            cores[coresIndex].manufacturer = (char*) malloc(strlen(columnData)+1);
            if (cores[coresIndex].manufacturer == NULL) return NULL;
            memcpy(cores[coresIndex].manufacturer, columnData, strlen(columnData));
            cores[coresIndex].manufacturer[strlen(columnData)] = '\0';
        } else if(!strncmp("cpu MHz", columnName, strlen("cpu MHz"))) {
            char *columnData = strndup((lines[tempLine]+columnSplit+2), strlen(lines[tempLine]));
            cores[coresIndex].clockSpeed = atof(columnData);
        }
        tempLine++;
    }
    coresIndex++;
    cores = (CpuInfo*) realloc(cores, (coresIndex+1) * sizeof(CpuInfo));
    if (cores == NULL) return NULL;
    cores[coresIndex] = (CpuInfo) {NULL, 0, 0, 0, 0, 0, 0, 0};
    return cores;
}

CpuInfo *getCpuTime()
{
    CpuInfo *cores = (CpuInfo*) malloc(sizeof(CpuInfo));
    if (cores == NULL) return NULL;
    char *data = (char*) malloc(sizeof(char));
    if (data == NULL) return NULL;
    char *line = (char*) malloc(sizeof(char));
    if (line == NULL) return NULL;
    char **lines = (char**) malloc(sizeof(char*));
    if (lines == NULL) return NULL;
    char temp;
    short tempLine = 0;
    short coresIndex = -1;

    FILE* systemData = fopen("/proc/stat", "r");
    if (systemData == NULL) return NULL;

    *data = '\0';
    *line = '\0';

    for (int i = 0; (temp = fgetc(systemData)) != EOF; i++) {
        data = (char*) realloc(data, i+2);
        if (data == NULL) return NULL;
        data[i] = temp;
        data[i+1] = '\0';
    }
    
    for (int i = 0; i < strlen(data); i++) {
        for (int j = 0; data[i] != '\n'; i++, j++) {
            line = (char*) realloc(line, j+2);
            if (line == NULL) return NULL;
            line[j] = data[i];
            line[j+1] = '\0';
        }

        lines[tempLine] = (char*) malloc(strlen(line)+1);
        if (lines[tempLine] == NULL) return NULL;
        memcpy(lines[tempLine], line, strlen(line));

        lines[tempLine][strlen(line)] = '\0';
        tempLine++;
        free(line);

        lines = (char**) realloc(lines, (tempLine+1) * sizeof(char*));
        if (lines == NULL) return NULL;
        line = (char*) malloc(sizeof(char));
        if (line == NULL) return NULL;
    }
    lines[tempLine] = NULL;
    tempLine = 0;

    free(data);

    data = (char*) malloc(sizeof(char));
    if (data == NULL) return NULL;

    while (lines[tempLine] != NULL) {

        char *name = strndup(lines[tempLine], 3);

        if (!strncmp("cpu", name, 3) && isdigit(lines[tempLine][3])) {
            coresIndex++;
            if (coresIndex > 0) {
                cores = (CpuInfo*) realloc(cores, (coresIndex+1) * sizeof(CpuInfo));
                if (cores == NULL) return NULL;
            }
            int space = 0;
            for (int i = 0; i < strlen(lines[tempLine]); i++) {
                if (lines[tempLine][i] == ' ') {
                    space = i;
                    break;
                }
            }
            char *cpuData = strndup((lines[tempLine]+space+1), strlen(lines[tempLine]));
            int iter = 0;
            for (int i = 0; cpuData[i] != ' '; i++) {
                data = (char*) realloc(data, i+2);
                data[i] = cpuData[iter+i];
                data[i+1] = '\0';
            }
            iter += strlen(data) + 1;
            cores[coresIndex].userTime = atoi(data);
            free(data);
            data = (char*) malloc(sizeof(char));
            if (data == NULL) return NULL;

            for (int i = 0; cpuData[i] != ' '; i++) {
                data = (char*) realloc(data, i+2);
                data[i] = cpuData[iter+i];
                data[i+1] = '\0';
            }
            iter += strlen(data) + 1;
            cores[coresIndex].niceTime = atoi(data);
            free(data);
            data = (char*) malloc(sizeof(char));
            if (data == NULL) return NULL;

            for (int i = 0; cpuData[i] != ' '; i++) {
                data = (char*) realloc(data, i+2);
                data[i] = cpuData[iter+i];
                data[i+1] = '\0';
            }
            iter += strlen(data) + 1;
            cores[coresIndex].systemTime = atoi(data);
            free(data);
            data = (char*) malloc(sizeof(char));
            if (data == NULL) return NULL;

            for (int i = 0; cpuData[i] != ' '; i++) {
                data = (char*) realloc(data, i+2);
                data[i] = cpuData[iter+i];
                data[i+1] = '\0';
            }
            iter += strlen(data) + 1;
            cores[coresIndex].idleTime = atoi(data);
            free(data);
            data = (char*) malloc(sizeof(char));
            if (data == NULL) return NULL;

            for (int i = 0; cpuData[i] != ' '; i++) {
                data = (char*) realloc(data, i+2);
                data[i] = cpuData[iter+i];
                data[i+1] = '\0';
            }
            iter += strlen(data) + 1;
            cores[coresIndex].iowaitTime = atoi(data);
            free(data);
            data = (char*) malloc(sizeof(char));
            if (data == NULL) return NULL;

            for (int i = 0; cpuData[i] != ' '; i++) {
                data = (char*) realloc(data, i+2);
                data[i] = cpuData[iter+i];
                data[i+1] = '\0';
            }
            iter += strlen(data) + 1;
            cores[coresIndex].irqTime = atoi(data);
            free(data);
            data = (char*) malloc(sizeof(char));
            if (data == NULL) return NULL;
        }

        tempLine++;
    }
    coresIndex++;
    cores = (CpuInfo*) realloc(cores, (coresIndex+1) * sizeof(CpuInfo));
    if (cores == NULL) return NULL;
    cores[coresIndex] = (CpuInfo) {NULL, 0, 0, 0, 0, 0, 0, 0};

    return cores;
}

CpuInfo *getCpuInfoAndTime() {
    CpuInfo* arr = getCpuInfo();
    CpuInfo* arr2 = getCpuTime();

    for (int i = 0; arr2[i].userTime > 0; i++) {
        arr2[i].manufacturer = arr[i].manufacturer;
        arr2[i].clockSpeed = arr[i].clockSpeed;
    }

    return arr2;
}