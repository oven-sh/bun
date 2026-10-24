// A seed that no earlier run has used: the day, and the commit of the Bun under test. Every build of Bun tries other programs, and one
// build tries the same ones all day. A test that uses it has the seed in its name, so a failure says how to see it again:
//
//   AOT_FRESH_SEED=<seed> bun test test/aot/<the test file>
//
// Only a run that asks for it has one: AOT_FRESH_SEEDS=1, which the machines that look for bugs set, and AOT_TAKES=drawn, the step of CI that holds up
// nothing. Without it a run says the same about the same commit, so no pull request is held up by a program that nobody has seen. Whoever fixes what a fresh seed
// found adds the seed to `foundByFreshSeeds` of its generator (generated/python-generators.ts), and it runs everywhere from then on.
export const freshSeed: number | undefined =
  Number(process.env.AOT_FRESH_SEED) ||
  (process.env.AOT_FRESH_SEEDS === "1" || process.env.AOT_TAKES === "drawn"
    ? Math.floor(Date.now() / 86_400_000) * 100_000 + (parseInt(Bun.revision.slice(0, 4), 16) || 0)
    : undefined);
