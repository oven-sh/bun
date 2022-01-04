#include "PLCrashReport.bindings.h"

#include <PLCrashReporter/PLCrashReporter.h>

NSString *crash_folder;

@interface PLCrashReporter (PrivateMethods)

- (id)initWithApplicationIdentifier:(NSString *)applicationIdentifier
                         appVersion:(NSString *)applicationVersion
                appMarketingVersion:(NSString *)applicationMarketingVersion
                      configuration:(PLCrashReporterConfig *)configuration;

@end

void pl_crash_reporter_post_crash_callback(siginfo_t *info, ucontext_t *uap,
                                           void *context) {
  PLCrashReportHandler(context);
}

static PLCrashReporter *reporter;

NSString *v;
NSString *basePath_;
static void *handler;
bool PLCrashReportStart(const char *version, const char *basePath) {
  PLCrashReporterConfig *config;
  basePath_ = [NSString stringWithUTF8String:basePath];

  handler = &pl_crash_reporter_post_crash_callback;
  PLCrashReporterCallbacks callbacks = {
      .version = 0, .context = NULL, .handleSignal = handler};
  config = [[PLCrashReporterConfig alloc]
                   initWithSignalHandlerType:PLCrashReporterSignalHandlerTypeBSD
                       symbolicationStrategy:
                           PLCrashReporterSymbolicationStrategyNone
      shouldRegisterUncaughtExceptionHandler:YES
                                    basePath:basePath_;

  v = [[NSString alloc] initWithBytesNoCopy:version
                                     length:strlen(version)
                                   encoding:NSUTF8StringEncoding
                               freeWhenDone:NO];
  reporter = [[PLCrashReporter alloc] initWithApplicationIdentifier:@"bun"
                                                         appVersion:v
                                                appMarketingVersion:v
                                                      configuration:config];

  [reporter setValue:basePath_ forKey:@"_crashReportDirectory"];
  [reporter setCrashCallbacks:&callbacks];

  return [reporter enableCrashReporter];
}

void PLCrashReportGenerate() { [reporter generateLiveReport]; }
void *PLCrashReportLoadPending() {
  return [reporter loadPendingCrashReportData];
}

uint16_t copyCrashReportPath(char *buf[1024]) {
  NSString *crashReportPath = [reporter crashReportPath];
  [crashReportPath getBytes:buf
                  maxLength:(1024 - 1)
                 usedLength:NULL
                   encoding:NSUTF8StringEncoding
                    options:0
                      range:NSMakeRange(0, [crashReportPath length])
             remainingRange:NULL];
  size_t len = [crashReportPath length];
  if (len > 1024) {
    len = 0;
  }
  return (uint16_t)len;
}
