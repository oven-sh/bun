import { shuffle } from "lodash";

// Lodash uses a variety of uncommon syntax (such as unicode escapes in regexp)
// so running it is a broad test of the parser, lexer, and printer
export function test() {
  const foo = [1, 2, 3, 4, 6];
  const bar = shuffle(foo);
  console.assert(bar !== foo);
  console.assert(bar.length === foo.length);
  bar.sort();
  foo.sort();
  for (let i = 0; i < bar.length; i++) {
    console.assert(bar[i] === foo[i], "expected " + i + " to be " + foo[i]);
    console.assert(typeof bar[i] === "number");
    console.assert(typeof foo[i] === "number");
  }

  return testDone(import.meta.url);
}

// export function test() {
//   const regexp = RegExp("['\u2019]", "g");
//   return testDone(import.meta.url);
// }
