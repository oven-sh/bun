// A loop that has run on numbers for a while meets a value of another kind, once or often, at the start, in the middle or at the end, and goes on.
var log = [];

function unknown(value) {
  return JSON.parse(JSON.stringify({ value: value })).value;
}

function list(length, odd) {
  var items = [];
  for (var i = 0; i < length; i++) items.push(unknown(i % 7));
  for (var at in odd) items[at] = odd[at];
  return items;
}

function sum(values) {
  var total = 0;
  for (var i = 0; i < values.length; i++) total += values[i];
  return total;
}

function sumAndCount(values) {
  var state = { total: 0, count: 0 };
  for (var i = 0; i < values.length; i++) {
    state.total += values[i];
    state.count++;
  }
  return state.total + "/" + state.count;
}

function product(values) {
  var result = 1;
  for (var i = 0; i < values.length; i++) result = (result * (values[i] + 1)) % 1009;
  return result;
}

function chase(next, steps) {
  var at = 0;
  var seen = 0;
  for (var step = 0; step < steps; step++) {
    at = next[at];
    seen++;
  }
  return String(at) + ":" + seen;
}

function largest(values) {
  var best = -Infinity;
  for (var i = 0; i < values.length; i++) {
    if (values[i] > best) best = values[i];
  }
  return best;
}

function nested(rows) {
  var total = 0;
  for (var i = 0; i < rows.length; i++) {
    var row = 0;
    for (var j = 0; j < rows[i].length; j++) row += rows[i][j];
    total += row;
  }
  return total;
}

function carriedThroughBoth(rows) {
  var total = 0;
  for (var i = 0; i < rows.length; i++) {
    for (var j = 0; j < rows[i].length; j++) total += rows[i][j];
    total += 1;
  }
  return total;
}

function untilOdd(values) {
  var total = 0;
  var i = 0;
  while (true) {
    var value = values[i++];
    if (value === undefined) break;
    if (typeof value === "string") continue;
    total += value;
  }
  return total + "@" + i;
}

function caught(values) {
  var total = 0;
  var failures = 0;
  for (var i = 0; i < values.length; i++) {
    try {
      total += values[i];
    } catch (error) {
      failures++;
      total = 0;
    } finally {
      total += 1;
    }
  }
  return String(total) + "!" + failures;
}

function closures(values) {
  var readers = [];
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    total += values[i];
    if (i % 40 === 0) readers.push(() => i + ":" + total);
  }
  return readers.map(reader => reader()).join();
}

var plain = list(200, {});
log.push(sum(plain), sumAndCount(plain), product(plain), largest(plain));

for (var at of [0, 1, 99, 198, 199]) {
  var odd = {};
  odd[at] = "x";
  var values = list(200, odd);
  log.push(at + " " + sum(values).length + " " + sumAndCount(values).length + " " + product(values) + " " + largest(values) + " " + untilOdd(values));
}

log.push(sum(list(200, { 10: 0.5, 20: -0, 30: 2147483647, 40: 4294967296, 50: NaN })));
log.push(sum(list(200, { 10: 0.5, 20: 1e300, 30: -1e300 })), product(list(200, { 3: 0.25 })), largest(list(200, { 7: 6.5, 8: "9", 9: null })));
log.push(sum(list(200, { 5: null, 6: true, 7: false })), String(sum(list(200, { 5: undefined }))), sum(list(200, { 199: [1, 2] })));

var calls = 0;
var counting = {
  valueOf() {
    calls++;
    return calls;
  },
};
log.push(sum(list(200, { 0: counting, 100: counting, 199: counting })), calls, sumAndCount(list(50, { 25: counting })), calls);

var shrinking = list(200, {});
shrinking[50] = {
  valueOf() {
    shrinking.length = 60;
    return 1000;
  },
};
log.push(sum(shrinking), shrinking.length);

var growing = list(20, {});
growing[10] = {
  valueOf() {
    if (growing.length < 40) growing.push(0.5, "tail");
    return 1;
  },
};
log.push(sum(growing), growing.length);

var holey = list(100, {});
holey[30] = {
  valueOf() {
    delete holey[31];
    holey[32] = 1.5;
    return 0;
  },
};
log.push(String(sum(holey)));

try {
  sum(list(100, { 60: 1n }));
  log.push("no error");
} catch (error) {
  log.push(error instanceof TypeError);
}
try {
  sum(list(100, { 60: Symbol("s") }));
  log.push("no error");
} catch (error) {
  log.push(error instanceof TypeError);
}
log.push(caught(list(100, { 10: 1n, 50: Symbol("s"), 99: "end" })), caught(plain));

var ring = [];
for (var n = 0; n < 64; n++) ring.push(unknown((n * 5 + 3) % 64));
log.push(chase(ring, 1000));
ring[17] = "18";
log.push(chase(ring, 1000));
ring[18] = 19.0;
ring[19] = 20.5;
log.push(chase(ring, 1000));
ring[19] = { toString: () => "21" };
log.push(chase(ring, 1000));
ring[21] = -1;
log.push(chase(ring, 1000));

var rows = [];
for (var r = 0; r < 30; r++) rows.push(list(30, r === 12 ? { 4: "s" } : r === 20 ? { 29: 0.5 } : {}));
log.push(nested(rows), carriedThroughBoth(rows).length);
rows[12] = list(30, {});
log.push(nested(rows), carriedThroughBoth(rows));

log.push(closures(list(100, { 41: "c" })), closures(list(100, {})));

var repeated = 0;
for (var round = 0; round < 300; round++) {
  var mixed = round % 50 === 49 ? list(40, { 20: "m" }) : plain;
  var answer = sum(mixed);
  repeated += typeof answer === "string" ? answer.length : answer;
}
log.push(repeated);

console.log(log.join("\n"));
