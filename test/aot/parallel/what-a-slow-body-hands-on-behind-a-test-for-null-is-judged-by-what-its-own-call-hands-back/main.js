// Under: --aot-check=Validate: the judge of calls is asked of the slow body, which hands on what its own call by value gave, behind a test for null
// A matcher that calls itself. Every caller is known, and one hands it lists where texts are written, so it has a guard and its slow body runs.
import { matches, match } from "./lib.js";
console.log(JSON.stringify(matches("ab", "a b")), matches("x", "abc"), JSON.stringify(match(["a", "b"], ["A", " ", "B"], 0, 0)));
console.log(JSON.stringify(matches("abc", "Alpha Beta Car")), JSON.stringify(matches("ab", "ab")), matches("a", ""), JSON.stringify(match(["z"], ["A"], 0, 0)), JSON.stringify(match([], ["A"], 0, 0)));
