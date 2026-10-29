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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|Array<undefined|null|[[L_1]]> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: v2 = Data data=[[d_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v5 = Integer
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v6)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v9 = Convert v7 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v10 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v11 = Less v9, v10
// CHECK-NEXT: Branch v11 -> taken b3(| 0, 1), notTaken b6(| 0, 1)
// CHECK-NEXT: b3(v12, v13):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v14 = PropGet v4 key="push"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v16 = Convert v12 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v17 = NewObject layout=[[L_1]]
// CHECK-NEXT: PropDefine v17, v16 key="id"
// CHECK-NEXT: v19 = String string="c"
// CHECK-NEXT: v20 = Integer integer=23
// CHECK-NEXT: v21 = Mod v16, v20
// CHECK-NEXT: v22 = Add v19, v21
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: PropDefine v17, v23 key="customer"
// CHECK-NEXT: v25 = Integer integer=37
// CHECK-NEXT: v26 = Mul v16, v25
// CHECK-NEXT: v27 = Integer integer=500
// CHECK-NEXT: v28 = Mod v26, v27
// CHECK-NEXT: v29 = Convert v28 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropDefine v17, v29 key="amount"
// CHECK-NEXT: v31 = Integer integer=3
// CHECK-NEXT: v32 = Mod v16, v31
// CHECK-NEXT: v33 = Integer
// CHECK-NEXT: v34 = StrictEq v32, v33
// CHECK-NEXT: v35 = LogicalNot v34
// CHECK-NEXT: v36 = Convert v35 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: PropDefine v17, v36 key="open"
// CHECK-NEXT: v38 = FinishObject v17
// CHECK-NEXT: v39 = Call v15, v4, v38 calleeKey="push" calleeName="orders.push"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v40 = Increment v16
// CHECK-NEXT: v41 = Convert v40 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v41)
// CHECK-NEXT: b6(v42, v43):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v44 = Convert v4 declared={type=undefined|null|Array<undefined|null|[[L_1]]> flags=[IsExpected]}
// CHECK-NEXT: Return v44
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="groupBy"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v0 key="reduce"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v4 = NewClosure v1 function=[[f_4]]
// CHECK-NEXT: v5 = Data data=[[d_5]]
// CHECK-NEXT: v6 = Call v3, v0, v4, v5 calleeKey="reduce" calleeName="list.reduce"
// CHECK-NEXT: ReturnCall v6
// CHECK-NEXT: }
