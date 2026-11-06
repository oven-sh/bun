// RUN: link
// CHECK: layout [[c]] kind=Instance name="C" {{*}}fields=[{key=#"#"@[[c]] declared={type=classtoken flags=[IsFromCompiler]} flags=[IsRequired, IsPrivate, IsImmutable, IsBrand, IsHidden]}, {key=#"#1"@[[c]] declared={type={{*}}} flags=[IsRequired, IsPrivate, IsHidden]}]

// RUN(METHOD): link
// METHOD-NOT: layout {{*}}key=#"#m"

export class C {
  #m() {}
  accessor v = 1;
}
