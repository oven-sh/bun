// RUN(OBJECT): link
// OBJECT: layout [[counter]] kind=Instance name="Counter" {{*}}fields=[{key=#"class brand"@[[counter]] {{*}}IsBrand
// OBJECT: evalscope [[scope]] flags=[IsInFunction, AllowsSuperProperty, AllowsNewTarget] bindings=
// OBJECT: {name="#count" kind=PrivateAccessor depth=[[depth]] layout=[[counter]] field=0 operand=[[token]] function=[[getter]] setter=[[setter]]}
// OBJECT: {name="#step" kind=PrivateName depth=[[depth]] layout=[[counter]] field=1 operand=[[token]]}
// OBJECT: function [[ask]] name="ask" {{*}}thisType={type=[[counter]]}
// OBJECT: [[get]] = NewClosure function=[[getCount]]
// OBJECT: [[set]] = NewClosure function=[[setCount]]
// OBJECT: = DirectEval {{*}}[[get]], [[set]] evalScope=[[scope]]
// OBJECT: function [[getCount]] name="#count" {{*}}kind=Getter
// OBJECT: function [[setCount]] name="#count" {{*}}kind=Setter

// RUN(CLASS): link
// CLASS: evalscope [[scope]] {{*}}{name="Registry" kind=Constant
// CLASS-NOT: {name="#total" kind=PrivateName
// CLASS: {name="#total" kind=PrivateAccessor depth=[[depth]] operand=[[class]] function=[[getter]] setter=[[setter]]}
// CLASS: {name="#seen" kind=PrivateName depth=[[depth]] variable=[[seen]] operand=[[class]]}
// CLASS: function [[getTotal]] name="#total" {{*}}kind=Getter
// CLASS: function [[setTotal]] name="#total" {{*}}kind=Setter

export class Counter {
  accessor #count = 1;
  #step = 2;
  ask(text) {
    return eval(text);
  }
}

export class Registry {
  static accessor #total = 7;
  static #seen = 0;
  static ask(text) {
    return eval(text);
  }
}
