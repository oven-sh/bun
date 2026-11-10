// STATISTIC: SwitchesMergedIntoPredecessor >= 1
'use strict';
function shared(k) {
  hit: {
    switch (k) { case 10: case 11: case 12: case 13: case 200: break hit; }
    switch (k) { case 12: case 13: case 14: case 15: case 90: break hit; }
    switch (k) { case 10: case 15: case 16: case 17: break hit; }
    return 0;
  }
  return 1;
}
function near(k) {
  hit: {
    switch (k) { case 1: case 2: case 3: case 5: break hit; }
    switch (k) { case 8: case 13: case 21: case 34: break hit; }
    return 0;
  }
  return 1;
}
function far(k) {
  hit: {
    switch (k) { case 1: case 2: case 3: case 5: break hit; }
    switch (k) { case 1000000: case 2000000: case -3000000: case 2147483647: case -2147483648: break hit; }
    return 0;
  }
  return 1;
}
function elsewhere(k) {
  other: {
    hit: {
      switch (k) { case 1: case 2: case 3: case 4: case 100: break hit; }
      switch (k) { case 5: case 6: case 7: case 8: case 101: break other; }
      switch (k) { case 9: case 10: case 11: case 12: case 102: break hit; }
      return 0;
    }
    return 1;
  }
  return 2;
}
function leadsOn(k) {
  hit: {
    switch (k) { case 1: case 2: case 3: case 4: case 100: break hit; case 50: case 51: break; }
    switch (k) { case 50: case 60: case 61: case 62: case 63: break hit; case 51: break; }
    return 0;
  }
  return 1;
}
let work = 0;
function between(k) {
  hit: {
    switch (k) { case 1: case 2: case 3: case 4: case 100: break hit; }
    work++;
    switch (k) { case 5: case 6: case 7: case 8: case 101: break hit; }
    return 0;
  }
  return 1;
}
const asked = [shared, near, far, elsewhere, leadsOn, between];
const values = [];
for (let k = -3; k < 110; k++) values.push(k);
values.push(200, 201, 999999, 1000000, 2000000, -3000000, 2147483647, -2147483648, 2147483648, 4294967297, 1.5, NaN, -0, "1", null, undefined, true, 1n, { valueOf() { return 1; } });
const said = [];
for (const ask of asked) {
  let line = "";
  for (const value of values) line += ask(value);
  said.push(line);
}
console.log(said.join("\n"), work);
