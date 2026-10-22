// A duplicate private name or constructor, `??` mixed with `||`, and a rest element before the end are EarlyError. A duplicate public field is valid JavaScript, so it is Semantic.
class E {
  #a = 1;
  #a = 2;
}
class F {
  #a = 1;
  static #a = 2;
}
class H {
  constructor() {}
  constructor() {}
}
class G {
  a = 1;
  a = 2;
}
declare let a: any, b: any, c: any;
a ?? b || c;
[...a, b] = c;
