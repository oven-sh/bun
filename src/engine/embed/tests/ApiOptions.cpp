#include "ApiFixtures.h"

using namespace JSC;

static bool set(Engine::Options& options, ASCIILiteral assignment)
{
    return Engine::options_set(options, byteCast<uint8_t>(assignment.span()));
}

TEST(OptionsTakeEffect)
{
    Test::Realm realm;
    EXPECT(Options::areFrozen());
    EXPECT(realm.run("Error.stackTraceLimit"_s) == jsNumber(7));
}

TEST(OptionsAreSetByName)
{
    Engine::Options options;
    Engine::options_initialize(&options, sizeof(options));
    EXPECT(options.useJIT && options.thresholdForJITAfterWarmUp == 500 && options.jitPolicyScale == 1);

    EXPECT(set(options, "USEjit=No"_s) && !options.useJIT);
    EXPECT(set(options, "thresholdForJITAfterWarmUp= -12x"_s) && options.thresholdForJITAfterWarmUp == -12);
    EXPECT(set(options, "forceRAMSize=8589934592"_s) && options.forceRAMSize == 8589934592);
    EXPECT(set(options, "jitPolicyScale=.25;"_s) && options.jitPolicyScale == .25);
    EXPECT(set(options, "logGC=verbose"_s) && options.logGC);
    EXPECT(set(options, "logGC=none"_s) && !options.logGC);
    EXPECT(set(options, "disableGC=1"_s) && !options.useGC);
    EXPECT(set(options, "enableTailCalls=0"_s) && !options.useTailCalls);

    EXPECT(!set(options, "useJIT"_s));
    EXPECT(!set(options, "useJIT="_s));
    EXPECT(!set(options, "useJIT=2"_s));
    EXPECT(!set(options, "useJIT=none"_s));
    EXPECT(!set(options, "forceRAMSize=much"_s));
    EXPECT(!set(options, "thereIsNoSuchOption=1"_s));
    EXPECT(!set(options, "=1"_s));
}

TEST(OptionsWithoutEffectAreChecked)
{
    Engine::Options options;
    Engine::options_initialize(&options, sizeof(options));
    EXPECT(set(options, "useTracePoints=1"_s));
    EXPECT(!set(options, "useTracePoints=often"_s));
    EXPECT(set(options, "rareBlockPenalty=0.5"_s));
    EXPECT(!set(options, "rareBlockPenalty="_s));
    EXPECT(set(options, "diskCachePath="_s));
}
