// RUN: link
// CHECK: {kind=PrivateFunction depth=[[depth]] layout=[[scope]] field=[[method]] operand=[[environment]]}, {name="#total" kind=PrivateMethod {{*}}function=0}, {kind=PrivateAccessorPair depth=[[depth]] layout=[[scope]] field=[[pair]] operand=[[environment]]}, {name="#rate" kind=PrivateAccessor {{*}}function=2 setter=2}, {kind=PrivateFunction depth=[[depth]] operand=[[closure]]}, {name="#plain" kind=PrivateMethod {{*}}function=4}

const same = (_: any, __: any): any => undefined;

export let late: any;

export function define(turn: number): any {
  return class {
    [eval("(late = entry => entry.#total(), 'first')")]() {
      return turn;
    }
    @same #total() {
      return turn;
    }
    @same accessor #rate = turn;
    #plain() {
      return turn;
    }
  };
}
