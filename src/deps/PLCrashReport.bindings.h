#include <stdbool.h>
#include <stdint.h>

extern bool PLCrashReportStart(const char *version, const char *basePath);
extern void PLCrashReportHandler(void *context);

extern void PLCrashReportGenerate();
extern void *PLCrashReportLoadPending();

extern uint16_t copyCrashReportPath(char *buf[1024]);
