// RUN: link
// CHECK: layout {{*}}kind=Instance name="C" {{*}}fields=[{key="ok" declared={type={{*}}} flags=[IsRequired]}]

// RUN(FIELDS): link
// FIELDS-NOT: layout {{*}}name="C"{{*}}}, {key=

// RUN(PIECES): lower
// PIECES-LABEL: function {{*}}kind=Initializer
// PIECES: ElemDefine [[this]],
// PIECES: PropDefine [[this]], {{*}}key="1.5"
// PIECES: PropDefine [[this]], {{*}}key="__proto__"
// PIECES: PropDefine [[this]], {{*}}key=@@iterator
// PIECES: PropDefine [[this]], {{*}}key="ok"

export class C {
  0 = 1;
  "1.5" = 2;
  __proto__ = 3;
  [Symbol.iterator] = 4;
  ok = 5;
}
