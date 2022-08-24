#ifndef CPU_INFO_LIB
#define CPU_INFO_LIB

extern "C" {
    typedef struct {    
        char *manufacturer;
        float clockSpeed;
        int userTime;
        int niceTime;
        int systemTime;
        int idleTime;
        int iowaitTime;
        int irqTime;    
    } CpuInfo;

    CpuInfo *getCpuInfo_B();
    CpuInfo *getCpuTime_B();
    CpuInfo *getCpuInfoAndTime_B();
    int getCpuArrayLen_B(CpuInfo *arr);
}

#endif