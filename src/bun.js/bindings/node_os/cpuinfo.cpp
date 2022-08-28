#include "mimalloc.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cctype>
#include <cstddef>
#include <unistd.h>

#ifdef __APPLE__
#include <dlfcn.h>
#include <mach/mach.h>
#include <sys/resource.h>
#include <sys/sysctl.h>
#endif

#include "cpuinfo.h"

#define free mi_free
#define malloc mi_malloc
#define realloc mi_realloc
#define strdup mi_strdup

#ifdef __linux__
extern "C" CpuInfo* getCpuInfo()
{
    CpuInfo* cores = (CpuInfo*)malloc(sizeof(CpuInfo));
    FILE* file = fopen("/proc/cpuinfo", "r");
    if (file == NULL)
        return NULL;

    char buff[2048];
    int coresIndex = -1;

    memset(cores, 0, sizeof(CpuInfo));

    while (fgets(buff, 2048, file)) {
        if (strlen(buff) == 0)
            continue;

        short columnSplit = 0;
        for (int i = 0; i < (int)strlen(buff); i++) {
            if (buff[i] == ':') {
                columnSplit = i;
                break;
            }
        }
        char* columnName = strndup(buff, columnSplit);
        if (columnName == NULL)
            return NULL;

        if (!strncmp("processor", columnName, strlen("processor"))) {
            coresIndex++;
            if (coresIndex > 0) {
                cores = (CpuInfo*)realloc(cores, (coresIndex + 1) * sizeof(CpuInfo));
                if (cores == NULL)
                    return NULL;
            }
#ifdef __PPC__
        } else if (!strncmp("cpu", columnName, 3)) {
#else
        } else if (!strncmp("model name", columnName, strlen("model name"))) {
#endif
            cores[coresIndex].manufacturer = strndup((buff + columnSplit + 2), strlen(buff) - 3 - columnSplit);
            if (cores[coresIndex].manufacturer == NULL)
                return NULL;
#ifdef __PPC__
        } else if (!strncmp("clock", columnName, strlen("clock"))) {
#else
        } else if (!strncmp("cpu MHz", columnName, strlen("cpu MHz"))) {
#endif
            char* columnData = strndup((buff + columnSplit + 2), strlen(buff) - 3 - columnSplit);
            if (columnData == NULL)
                return NULL;
            cores[coresIndex].clockSpeed = atof(columnData);
            free(columnData);
        }
        free(columnName);
    }

    coresIndex++;
    cores = (CpuInfo*)realloc(cores, (coresIndex + 1) * sizeof(CpuInfo));
    if (cores == NULL)
        return NULL;
    cores[coresIndex] = (CpuInfo) { NULL, 0, 0, 0, 0, 0, 0, 0 };
    fclose(file);
    return cores;
}
#elif __APPLE__
extern "C" CpuInfo* getCpuInfo()
{
    unsigned int ticks = (unsigned int)sysconf(_SC_CLK_TCK), multiplier = ((uint64_t)1000L / ticks);
    char model[512];

    unsigned int freq;
    int mib[] = { CTL_HW, HW_CPU_FREQ };
    size_t freqSize = sizeof(freq);
    sysctl(mib, 2, &freq, &freqSize, NULL, 0);

    size_t size;
    unsigned int i;
    natural_t numcpus = 0;
    mach_msg_type_number_t msg_type;
    processor_cpu_load_info_data_t* info;
    CpuInfo* cores;

    size = sizeof(model);
    if (sysctlbyname("machdep.cpu.brand_string", model, &size, NULL, 0) && sysctlbyname("hw.model", model, &size, NULL, 0)) {
        return NULL;
    }

    if (host_processor_info(mach_host_self(), PROCESSOR_CPU_LOAD_INFO, &numcpus,
            (processor_info_array_t*)&info,
            &msg_type)
        != KERN_SUCCESS) {
        return NULL;
    }

    freq = freq / 1000000; // Hz to MHz
    cores = (CpuInfo*)malloc(sizeof(CpuInfo) * numcpus);

    if (cores == NULL)
        return NULL;
    memset(cores, 0, sizeof(CpuInfo) * numcpus);

    for (i = 0; i < numcpus; i++) {

        cores[i].manufacturer = (char*)malloc(strlen(model) + 1);
        if (cores[i].manufacturer == NULL)
            return NULL;
        memcpy(cores[i].manufacturer, &model, strlen(model));
        cores[i].manufacturer[strlen(model)] = '\0';
        cores[i].clockSpeed = freq;

        cores[i].userTime = info[i].cpu_ticks[0] * multiplier;
        cores[i].niceTime = info[i].cpu_ticks[3] * multiplier;
        cores[i].systemTime = info[i].cpu_ticks[1] * multiplier;
        cores[i].idleTime = info[i].cpu_ticks[2] * multiplier;
        cores[i].iowaitTime = 0;
        cores[i].irqTime = 0;
    }
    cores[numcpus] = (CpuInfo) { NULL, 0, 0, 0, 0, 0, 0, 0 };
    return cores;
}
#endif

extern "C" CpuInfo* getCpuTime()
{
    CpuInfo* cores = (CpuInfo*)malloc(sizeof(CpuInfo));
    FILE* file = fopen("/proc/stat", "r");
    if (file == NULL)
        return NULL;

    char buff[2048];
    int coresIndex = -1;
    int j = 0;

    while (fgets(buff, 2048, file)) {
        char* name = strndup(buff, 3);
        if (name == NULL)
            return NULL;
        if (!strncmp("cpu", name, 3) && isdigit(buff[3])) {
            coresIndex++;
            if (coresIndex > 0) {
                cores = (CpuInfo*)realloc(cores, (coresIndex + 1) * sizeof(CpuInfo));
                if (cores == NULL)
                    return NULL;
            }
            int space;
            for (int i = 0; i < (int)strlen(buff); i++) {
                if (buff[i] == ' ') {
                    space = i;
                    break;
                }
            }
            char* cpuDataStart = strndup((buff + space + 1), strlen(buff));
            if (cpuDataStart == NULL)
                return NULL;
            char* cpuData = cpuDataStart;
            // Time to be smart, What I am about to do is dangerous.
            char* temp = (char*)&cores[coresIndex];
            size_t start = offsetof(CpuInfo, userTime); // getting offset from `userTime` member.
            temp = temp + start;
            j = 0;
            for (int i = 0; i < 6; i++, j++) {
                cpuData = (cpuData + j); // offseting string.
                for (j = 0; cpuData[j] != ' '; j++)
                    ;
                char* parseStr = strndup(cpuData, j);
                if (parseStr == NULL)
                    return NULL;
                *(int*)temp = atoi(parseStr);
                free(parseStr);
                temp = temp + sizeof(int); // switching to next int member.
            }
            free(cpuDataStart);
        }
        free(name);
    }
    coresIndex++;
    cores = (CpuInfo*)realloc(cores, (coresIndex + 1) * sizeof(CpuInfo));
    if (cores == NULL)
        return NULL;
    cores[coresIndex] = (CpuInfo) { NULL, 0, 0, 0, 0, 0, 0, 0 };
    fclose(file);
    return cores;
}

extern "C" CpuInfo* getCpuInfoAndTime()
{
#ifdef __APPLE__
    CpuInfo* arr = getCpuInfo();
    if (arr == NULL)
        return (CpuInfo*)malloc(sizeof(CpuInfo));
    return arr;
#elif __linux__
    CpuInfo* arr = getCpuInfo();
    if (arr == NULL)
        return NULL;

    CpuInfo* arr2 = getCpuTime();
    if (arr2 == NULL)
        return NULL;

    for (int i = 0; arr[i].manufacturer; i++) {
        arr2[i].manufacturer = arr[i].manufacturer;
        arr2[i].clockSpeed = arr[i].clockSpeed;
    }
    free(arr);

    return arr2;
#endif
}

extern "C" int getCpuArrayLen(CpuInfo* arr)
{
    int i = 0;
    for (; arr[i].manufacturer; i++)
        ;
    return i - 1;
}

extern "C" void freeCpuInfoArray(CpuInfo* arr, int len)
{
    for (int i = 0; i < len; i++) {
        free(arr[i].manufacturer);
    }

    free(arr);
}