import { numbersUpTo, parsed, put, take } from "./out-of-sight.js";

function hundred(make) {
  const made = [];
  for (let i = 0; i < 100; i++) made.push(make(i));
  return made;
}

function kept(name, value) {
  put(name, value);
  return take(name);
}

function widthTimesHeight(box) {
  return box.boxWidth * box.boxHeight;
}

function membersAreRead(boxes) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += widthTimesHeight(boxes[i]);
  return total;
}

function lengthTimesDepth(crate) {
  return crate.crateLength * crate.crateDepth;
}

function membersOfParsedObjects(crates) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += lengthTimesDepth(crates[i]);
  return total;
}

function sumOfLeftEdges(panes) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += panes[i].paneLeft + panes[i].paneRight;
  return total;
}

function moveRight(dot) {
  dot.dotLeft = dot.dotLeft + 1;
}

function membersAreStored(dots) {
  for (let i = 0; i < 100; i++) moveRight(dots[i]);
  return dots[99].dotLeft;
}

function spanOf({ spanStart, spanEnd }) {
  return spanEnd - spanStart;
}

function parameterIsDestructured(spans) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += spanOf(spans[i]);
  return total;
}

function rangeOf(range) {
  const { rangeLow, rangeHigh } = range;
  return rangeHigh - rangeLow;
}

function variableIsDestructured(ranges) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += rangeOf(ranges[i]);
  return total;
}

function cityOf(person) {
  return person.homeAddress.cityCode;
}

function twoMembersDeep(people) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += cityOf(people[i]);
  return total;
}

function hasFlag(settings) {
  return "flagOne" in settings;
}

function askedWithIn(list) {
  let count = 0;
  for (let i = 0; i < 100; i++) if (hasFlag(list[i])) count++;
  return count;
}

function countNames(record) {
  let count = 0;
  for (const name in record) count++;
  return count;
}

function walkedWithForIn(records) {
  let count = 0;
  for (let i = 0; i < 100; i++) count += countNames(records[i]);
  return count;
}

function withOneMore(record) {
  return { ...record, extraMember: 1 };
}

function spreadIntoLiteral(records) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += withOneMore(records[i]).extraMember;
  return total;
}

class Account {
  constructor(balance) {
    this.accountBalance = balance;
    this.accountLimit = 1000;
  }
  roomLeft() {
    return this.accountLimit - this.accountBalance;
  }
  get isEmpty() {
    return this.accountBalance === 0;
  }
}

function roomOf(account) {
  return account.roomLeft();
}

function methodOfClassIsCalled(accounts) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += roomOf(accounts[i]);
  return total;
}

function balanceOf(account) {
  return account.accountBalance;
}

function fieldOfClassIsRead(accounts) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += balanceOf(accounts[i]);
  return total;
}

function emptinessOf(account) {
  return account.isEmpty;
}

function getterOfClassIsRead(accounts) {
  let count = 0;
  for (let i = 0; i < 100; i++) if (emptinessOf(accounts[i])) count++;
  return count;
}

function tallyOf(tally) {
  return tally.tallyCount + 1;
}

function fieldOfSmallIntegers(tallies) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += tallyOf(tallies[i]);
  return total;
}

function isAccount(value) {
  return value instanceof Account;
}

function testedWithInstanceof(accounts) {
  let count = 0;
  for (let i = 0; i < 100; i++) if (isAccount(accounts[i])) count++;
  return count;
}

function stockOf(shelves) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += shelves.get(i).shelfStock;
  return total;
}

function shelvesByNumber() {
  const shelves = new Map();
  for (let i = 0; i < 100; i++) shelves.set(i, { shelfStock: i, shelfRow: 1 });
  return shelves;
}

class Basket {
  constructor(items) {
    this.basketItems = items;
  }
}

function totalOfBasket(basket) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += basket.basketItems[i];
  return total;
}

class Odometer {
  constructor() {
    this.distanceDriven = 0;
  }
}

function advance(odometer) {
  odometer.distanceDriven = odometer.distanceDriven + 2;
}

function advanceHundredTimes(odometer) {
  for (let i = 0; i < 100; i++) advance(odometer);
  return odometer.distanceDriven;
}

export const cases = {
  "a field that holds a list is read under a number": {
    prepare: () => kept("basket", new Basket(numbersUpTo(100))),
    turn: totalOfBasket,
  },
  "a field that gets numbers in plain sight only is added to": {
    prepare: () => kept("odometer", new Odometer()),
    turn: advanceHundredTimes,
  },
  "what a Map holds is read": { prepare: () => kept("shelves", shelvesByNumber()), turn: stockOf },
  "members of an object literal are read": {
    prepare: () =>
      kept(
        "boxes",
        hundred(i => ({ boxWidth: i, boxHeight: 2 })),
      ),
    turn: membersAreRead,
  },
  "a member of an object literal is stored to": {
    prepare: () =>
      kept(
        "dots",
        hundred(i => ({ dotLeft: i, dotTop: 0 })),
      ),
    turn: membersAreStored,
  },
  "a parameter is an object pattern": {
    prepare: () =>
      kept(
        "spans",
        hundred(i => ({ spanStart: i, spanEnd: i * 3 })),
      ),
    turn: parameterIsDestructured,
  },
  "a variable is an object pattern": {
    prepare: () =>
      kept(
        "ranges",
        hundred(i => ({ rangeLow: i, rangeHigh: i * 3 })),
      ),
    turn: variableIsDestructured,
  },
  "a member of a member is read": {
    prepare: () =>
      kept(
        "people",
        hundred(i => ({ homeAddress: { cityCode: i } })),
      ),
    turn: twoMembersDeep,
  },
  "an object is asked with in": {
    prepare: () =>
      kept(
        "settings",
        hundred(i => ({ flagOne: i, flagTwo: 0 })),
      ),
    turn: askedWithIn,
  },
  "an object is walked with for-in": {
    prepare: () =>
      kept(
        "records",
        hundred(i => ({ recordOne: i, recordTwo: 0, recordThree: 1 })),
      ),
    turn: walkedWithForIn,
  },
  "an object is spread into a literal": {
    prepare: () =>
      kept(
        "spreads",
        hundred(i => ({ spreadOne: i, spreadTwo: 0 })),
      ),
    turn: spreadIntoLiteral,
  },
  "a method of a class is called": {
    prepare: () =>
      kept(
        "accounts",
        hundred(i => new Account(i)),
      ),
    turn: methodOfClassIsCalled,
  },
  "a field of a class is read": {
    prepare: () =>
      kept(
        "accounts",
        hundred(i => new Account(i)),
      ),
    turn: fieldOfClassIsRead,
  },
  "a getter of a class is read": {
    prepare: () =>
      kept(
        "accounts",
        hundred(i => new Account(i)),
      ),
    turn: getterOfClassIsRead,
  },
  "a field that gets small integers only is read": {
    prepare: () =>
      kept(
        "tallies",
        hundred(i => ({ tallyCount: i & 63, tallyName: "t" })),
      ),
    turn: fieldOfSmallIntegers,
  },
  "a value is tested with instanceof": {
    prepare: () =>
      kept(
        "accounts",
        hundred(i => new Account(i)),
      ),
    turn: testedWithInstanceof,
  },
  "members of a parsed object are read": {
    prepare: () => parsed("[" + '{"crateLength":3,"crateDepth":2},'.repeat(99) + '{"crateLength":3,"crateDepth":2}]'),
    turn: membersOfParsedObjects,
  },
  "members of an element of a list are read": {
    prepare: () =>
      kept(
        "panes",
        hundred(i => ({ paneLeft: i, paneRight: i + 1 })),
      ),
    turn: sumOfLeftEdges,
  },
};
