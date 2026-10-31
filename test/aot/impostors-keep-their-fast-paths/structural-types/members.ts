interface Priced {
  price: number;
}

class Fixed implements Priced {
  price = 5;
}

class Computed implements Priced {
  base = 2;
  get price(): number {
    return this.base * 3;
  }
}

function priceOf(item: Priced): number {
  return item.price;
}

function aGetterForAPlainMember(): () => number {
  const items: Priced[] = [];
  for (let i = 0; i < 50; i++) items.push(new Fixed(), new Computed());
  return function turnOfAGetterForAPlainMember() {
    let total = 0;
    for (let i = 0; i < 100; i++) total += priceOf(items[i]);
    return total;
  };
}

interface Position {
  left: number;
  top: number;
}

function distanceFromOrigin(position: Readonly<Position>): number {
  return position.left + position.top;
}

function moveDown(position: Position): void {
  position.top = position.top + 1;
}

function readonlyAndMutableViews(): () => number {
  const positions: Position[] = [];
  for (let i = 0; i < 100; i++) positions.push({ left: i, top: 0 });
  return function turnOfReadonlyAndMutableViews() {
    let total = 0;
    for (let i = 0; i < 100; i++) {
      moveDown(positions[i]);
      total += distanceFromOrigin(positions[i]);
    }
    return total;
  };
}

interface Options {
  size: number;
  weight?: number;
}

function weightOf(options: Options): number {
  return options.weight === undefined ? options.size : options.weight;
}

function optionalMembers(): () => number {
  const list: Options[] = [];
  for (let i = 0; i < 50; i++) list.push({ size: i }, { size: i, weight: 7 });
  return function turnOfOptionalMembers() {
    let total = 0;
    for (let i = 0; i < 100; i++) total += weightOf(list[i]);
    return total;
  };
}

export const cases = {
  "4 a getter for a plain member": aGetterForAPlainMember,
  "5 a readonly and a mutable view of one object": readonlyAndMutableViews,
  "6 an optional member that is there or not": optionalMembers,
};
