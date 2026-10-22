// The honest twin of the structural programs: one call site sees objects of eight classes, four of one family and four that are no relatives, with different fields in front of the ones the methods read. Two methods with different numbers of arguments are called on each.
interface Priced {
  price(): number;
  discounted(percent: number): number;
}
class Item {
  constructor(public cost: number) {}
  price(): number {
    return this.cost;
  }
  discounted(percent: number): number {
    return this.price() - (this.price() * percent) / 100;
  }
}
class Taxed extends Item {
  price(): number {
    return this.cost + 10;
  }
}
class Free extends Item {
  price(): number {
    return 0;
  }
  discounted(): number {
    return 0;
  }
}
class Bundle extends Taxed {
  count = 3;
  price(): number {
    return super.price() * this.count;
  }
}
class Ticket {
  seat = "a1";
  fee = 200;
  price(): number {
    return this.fee;
  }
  discounted(percent: number): number {
    return this.fee - percent;
  }
}
class Gift {
  price(): number {
    return 1;
  }
  discounted(percent: number): number {
    return percent;
  }
}
class Loan {
  months = 12;
  rate = 5;
  price(): number {
    return this.months * this.rate;
  }
  discounted(percent: number): number {
    return this.price() - this.months * percent;
  }
}
class Fixed {
  a = 1;
  b = 2;
  c = 3;
  price(): number {
    return this.a + this.b + this.c;
  }
  discounted(percent: number): number {
    return this.c * percent;
  }
}

function sum(list: Priced[]): number {
  let total = 0;
  for (const each of list) total += each.price() * 7 + each.discounted(50);
  return total;
}

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

const list: Priced[] = [new Item(100), new Taxed(100), new Free(100), new Bundle(100), new Ticket(), new Gift(), new Loan(), new Fixed()];
for (const each of list) note("price", each.price());
for (const each of list) note("discounted", each.discounted(10));
note("all", sum(list));
let total = 0;
for (let round = 0; round < 1000; round++) total += sum(list);
note("a thousand rounds", total);

export {};
