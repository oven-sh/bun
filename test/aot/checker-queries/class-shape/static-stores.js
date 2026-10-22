// Stores to the class add static members only when the binding is known to be the class: not if reassigned or visible to `eval`.
function stores() {
  class S {
    static {
      this.a = 1;
      S.b = 2;
    }
  }
  S.c = 3;
}
function reassigned() {
  class R {}
  R.x = 1;
  R = null;
}
class E {}
E.x = 1;
eval("E");
