// RUN: link
// CHECK: layout [[pair]] module=[[entry]] {{*}}fields=[{key="a"
// CHECK: variable {{*}}name="x" module=[[entry]] declared={type=undefined|null|{{*}}[[pair]] flags=[IsExpected

// What a JavaScript file tells of `x` is a guess: the program tests it wherever it reads `x`, and a class there fails the test and is read by name. So the guess lists no class. To list one, every class of the program with a static `a` would have to be compared with the guess, and that infers what the methods of files that this one never imports return.
class WithStatic {
  static a = 3;
  static f() {
    return 4;
  }
}

export let x = {
  a: 1,
  f() {
    return 2;
  },
};
export const classes = [WithStatic];
