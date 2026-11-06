// RUN(HOME): lower
// HOME-LABEL: function {{*}}name="withSuper"
// HOME: [[head]] = NewObject layout=[[layout]] @
// HOME: = NewClosure [[head]] function=

// RUN(BASE): lower
// BASE-LABEL: function {{*}}name="m" {{*}}captures=[
// BASE: b0([[home]]
// BASE: [[base]] = GetSuperBase [[home]] @
// BASE: = SuperGet [[base]], {{*}}key="x"

// RUN(PLAIN): lower
// PLAIN-LABEL: function {{*}}name="withoutSuper"
// PLAIN: = NewClosure function=
// PLAIN: = NewObject -, {{*}}fields=[0]

export function withSuper() {
  return {
    m() {
      return super.x;
    },
  };
}

export function withoutSuper() {
  return {
    n() {
      return 1;
    },
  };
}
