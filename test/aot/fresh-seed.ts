// A seed that no earlier run has used: the day, and the commit of the Bun under test. Every build of Bun tries other programs, and one
// build tries the same ones all day. A test that uses it has the seed in its name, so a failure says how to see it again:
//
//   AOT_FRESH_SEED=<seed> bun test test/aot/<the test file>
export const freshSeed = Number(process.env.AOT_FRESH_SEED) || Math.floor(Date.now() / 86_400_000) * 100_000 + (parseInt(Bun.revision.slice(0, 4), 16) || 0);
