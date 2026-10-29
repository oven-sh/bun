interface Size {
  width: number;
  height: number;
}

function areaOf(size: Size): number {
  return size.width * size.height;
}

function widerObjectsAndBothOrders(): () => number {
  const sizes: Size[] = [];
  for (let i = 0; i < 50; i++) {
    const labeled = { width: i, height: 2, label: "wide" };
    const turned = { height: 3, width: i };
    sizes.push(labeled, turned);
  }
  return function turnOfWiderObjectsAndBothOrders() {
    let total = 0;
    for (let i = 0; i < 100; i++) total += areaOf(sizes[i]);
    return total;
  };
}

class Meter {
  reading = 1;
  read(): number {
    return this.reading;
  }
}

class Gauge {
  reading = 2;
  read(): number {
    return this.reading * 10;
  }
}

function readingOf(meter: Meter): number {
  return meter.read() + meter.reading;
}

function twoClassesOfOneShape(): () => number {
  const meters: Meter[] = [];
  for (let i = 0; i < 50; i++) meters.push(new Meter(), new Gauge());
  return function turnOfTwoClassesOfOneShape() {
    let total = 0;
    for (let i = 0; i < 100; i++) total += readingOf(meters[i]);
    return total;
  };
}

function lengthOf(value: { length: number }): number {
  return value.length;
}

function primitivesForObjectTypes(): () => number {
  const values: { length: number }[] = [];
  for (let i = 0; i < 50; i++) values.push("abc" + i, [i, i]);
  return function turnOfPrimitivesForObjectTypes() {
    let total = 0;
    for (let i = 0; i < 100; i++) total += lengthOf(values[i]);
    return total;
  };
}

function idOf<T extends { id: number }>(value: T): number {
  return value.id;
}

function genericOverTwoShapes(): () => number {
  const users: { id: number; name: string }[] = [];
  const orders: { total: number; id: number }[] = [];
  for (let i = 0; i < 50; i++) {
    users.push({ id: i, name: "u" });
    orders.push({ total: 5, id: i });
  }
  return function turnOfGenericOverTwoShapes() {
    let total = 0;
    for (let i = 0; i < 50; i++) total += idOf(users[i]) + idOf(orders[i]);
    return total;
  };
}

class Reservoir {
  level: number;
  capacity: number;
  constructor(level: number) {
    this.level = level;
    this.capacity = 100;
  }
  room(): number {
    return this.capacity - this.level;
  }
}

function fieldsSetInTheConstructor(): () => number {
  const reservoirs: Reservoir[] = [];
  for (let i = 0; i < 100; i++) reservoirs.push(new Reservoir(i));
  return function turnOfFieldsSetInTheConstructor() {
    let total = 0;
    for (let i = 0; i < 100; i++) total += reservoirs[i].room() + reservoirs[i].level;
    return total;
  };
}

export const cases = {
  "1 wider objects and both orders of members for one type": widerObjectsAndBothOrders,
  "2 two unrelated classes of one shape": twoClassesOfOneShape,
  "3 strings and arrays for a type with a length": primitivesForObjectTypes,
  "12 a generic function over two shapes": genericOverTwoShapes,
  "14 fields that the constructor sets": fieldsSetInTheConstructor,
};
