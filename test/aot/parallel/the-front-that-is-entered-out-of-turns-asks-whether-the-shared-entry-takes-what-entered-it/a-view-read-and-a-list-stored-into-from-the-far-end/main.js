// STATISTIC: FrontsEnteredOutOfTurnsWithClosedCopiesOfTheirOwn >= 1
// STATISTIC: PurchasesOfLoopsThatFailed = 0
// Under: --aot-check=VerifyEachStage: a walk that fails ends the build there, where a build as anybody makes it says a line and goes on
// Under: --aot-testing=FailGuesses: guesses fail unasked now and then, in turns and in fronts: wherever the loop is left it goes on from that turn
// Under: --aot-testing=FailGuesses:3:9: the front that the typed copy leaves for fails behind turns that are done: a loop that began again there would read what those turns stored
// Under: --aot-testing=FailGuesses:7:12: the same at other turns
// Under: --aot-harden=proof-checks: what Link has shown of what is read is asked at the run in the closed copies
const programs = {
  0: () => import("./nothing.js"),
  1: () => import("./loaded.js"),
};
await programs[JSON.parse("1")]();
