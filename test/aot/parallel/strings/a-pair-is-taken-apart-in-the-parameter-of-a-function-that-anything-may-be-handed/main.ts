// A frozen list of pairs of numbers is mapped to a text by `([low, high]) => ..`, and three patterns in two files are made of that text. The analysis of the whole program does not know what the
// list is (here: it comes through a function that is also handed a value nobody knows), so it knows neither what `.map(` calls nor what the arrow is handed, and the pair is taken apart in the
// way that fits whatever can be gone through. The walk that works the text out has the list in sight: going through a list gives its members. In a large program this was the one pattern that
// made nine tenths of all interpreted matches. `low.toString(16)` is a call of something unknown too: a number in sight has the methods of numbers. Nothing is warned of.
// COUNTER: RegExpsCreatedWithoutRecord = 0
// COUNTER: RegExpsCompiledToBytecode = 0
// COUNTER: RegExpMatchesInterpreted = 0
// COUNTER: RegExpPredictedTextsGivenCode = 3
// STATISTIC: RegExpTextsLostToOperation = 0
// STATISTIC: RegExpTextsLostToUnknownCode = 0
import { INNER, ONE } from "./ranges"
import { others } from "./keep"
const WHOLE = RegExp(`^[${INNER}]+$`, "u")
const OTHERS = RegExp(`[^${INNER}]`, "gu")
console.log(others.length, WHOLE.source, OTHERS.source, ONE.source)
console.log(["AZ_", "a", "ĀZ", "ab", "_"].map(text => `${WHOLE.test(text)}:${text.replace(OTHERS, "")}:${ONE.test(text)}`).join(" "))
