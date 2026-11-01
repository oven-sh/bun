// Groups that are repeated inside groups that are repeated: on a subject that nearly matches, code that goes back tries the same places again and again, twice as often for each character more.
// The code of the image gives such a search up, and a program that remembers the searches that have failed makes it in a time in proportion to the subject. That is no pattern left to the
// interpreter, and is not counted as one.
// COUNTER: RegExpsCreatedWithoutRecord = 0
// COUNTER: RegExpsCompiledToBytecode = 0
// COUNTER: RegExpMatchesInterpreted = 0
// COUNTER: RegExpsPreparedForLongSearches = 2
// COUNTER: RegExpLongSearchesHandedOver >= 2
const runsOfRuns = /(a+)+$/;
const wordsOfWords = /^(\w+\s?)*$/;
const nearly = "a".repeat(40) + "!";
const answers = [runsOfRuns.test(nearly), wordsOfWords.test(nearly), runsOfRuns.test("aaa"), wordsOfWords.test("some words here"), runsOfRuns.exec("baaa").index];
console.log(answers.join());
