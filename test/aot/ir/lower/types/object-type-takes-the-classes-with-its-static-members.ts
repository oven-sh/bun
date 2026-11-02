// RUN: link
// CHECK: layout [[pair]] module=[[entry]] {{*}}fields=[{key="a"
// CHECK: layout [[other]] module=[[entry]] {{*}}fields=[{key="b"
// CHECK: variable {{*}}name="x" module=[[entry]] declared={type=undefined|null|absent|[[pair]]|f{{*}} site=
// CHECK: variable {{*}}name="y" module=[[entry]] declared={type=undefined|null|absent|[[other]] site=

// A class with the static members `a` and `f` is a `{ a: number; f(): number }`. A class is a function and has no layout, so the object type lists the class beside its layout. No class has a static `b`.
class WithStatic {
  static a = 3;
  static f() {
    return 4;
  }
}

class WithOne {
  static a = 5;
}

export let x: { a: number; f(): number };
export let y: { b: number };
export const classes = [WithStatic, WithOne];
