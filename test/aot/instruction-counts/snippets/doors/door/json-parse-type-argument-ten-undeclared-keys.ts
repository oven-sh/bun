// JSON.parse<T>(text), ten undeclared keys
function door(i: number): Order {
  return JSON.parse<Order>(textOf(i, ',"e0":0,"e1":1,"e2":2,"e3":3,"e4":4,"e5":5,"e6":6,"e7":7,"e8":8,"e9":9'));
}
