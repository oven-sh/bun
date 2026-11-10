// RUN: lower
// OPTIONS: builtin-modules

// Array callbacks in ES5 style over a list of 3,000 objects: filter, map, reduce, some, every, forEach, sort and find, with closures that read a property under a computed name.
function makeOrders(count) {
  var orders = [];
  for (var i = 0; i < count; i++) {
    orders.push({ id: i, customer: "c" + (i % 23), amount: (i * 37) % 500, open: i % 3 !== 0 });
  }
  return orders;
}

function pluck(name) {
  return function (item) {
    return item[name];
  };
}

function add(a, b) {
  return a + b;
}

function groupBy(list, keyOf) {
  return list.reduce(function (groups, item) {
    var key = keyOf(item);
    (groups[key] = groups[key] || []).push(item);
    return groups;
  }, {});
}

function report(orders) {
  var open = orders.filter(function (order) {
    return order.open;
  });
  var total = open.map(pluck("amount")).reduce(add, 0);
  var large = open.some(function (order) {
    return order.amount > 495;
  });
  var valid = orders.every(function (order) {
    return order.amount >= 0;
  });
  var groups = groupBy(open, pluck("customer"));
  var best = 0;
  Object.keys(groups).forEach(function (customer) {
    var spent = groups[customer].map(pluck("amount")).reduce(add, 0);
    if (spent > best) best = spent;
  });
  var sorted = open.slice(0, 200).sort(function (a, b) {
    return b.amount - a.amount || a.id - b.id;
  });
  var found = orders.find(function (order) {
    return order.id === 777;
  });
  return total + best + sorted[0].id + (large ? 1 : 0) + (valid ? 2 : 0) + found.amount + orders.indexOf(found);
}

function run(rounds) {
  var orders = makeOrders(3000);
  var total = 0;
  for (var i = 0; i < rounds; i++) total += report(orders);
  return total;
}

console.log(run(250));

// GENERATED: makeOrders groupBy
// CHECK-LABEL: function {{*}}name="makeOrders"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: v2 = Data data=[[d_1]]
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v4)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = Less v5, v0
// CHECK-NEXT: Branch v7 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v8 = PropGet v2 key="push"
// CHECK-NEXT: v9 = String string="c"
// CHECK-NEXT: v10 = Integer integer=23
// CHECK-NEXT: v11 = Mod v5, v10
// CHECK-NEXT: v12 = Add v9, v11
// CHECK-NEXT: v13 = Integer integer=37
// CHECK-NEXT: v14 = Mul v5, v13
// CHECK-NEXT: v15 = Integer integer=500
// CHECK-NEXT: v16 = Mod v14, v15
// CHECK-NEXT: v17 = Integer integer=3
// CHECK-NEXT: v18 = Mod v5, v17
// CHECK-NEXT: v19 = Integer
// CHECK-NEXT: v20 = StrictEq v18, v19
// CHECK-NEXT: v21 = LogicalNot v20
// CHECK-NEXT: v22 = NewObject -, v5, v12, v16, v21 layout=[[L_2]] fields=[2, 1, 0, 3]
// CHECK-NEXT: v23 = FinishObject v22
// CHECK-NEXT: v24 = Call v8, v2, v23 calleeKey="push" calleeName="orders.push"
// CHECK-NEXT: v25 = Increment v5
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v26)
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="groupBy"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|function):
// CHECK-NEXT: v2 = PropGet v0 key="reduce"
// CHECK-NEXT: v3 = NewClosure v1 function=[[f_3]]
// CHECK-NEXT: v4 = Data data=[[d_4]]
// CHECK-NEXT: v5 = Call v2, v0, v3, v4 calleeKey="reduce" calleeName="list.reduce"
// CHECK-NEXT: ReturnCall v5
// CHECK-NEXT: }
