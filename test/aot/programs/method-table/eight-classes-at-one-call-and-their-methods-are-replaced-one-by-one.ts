// One call site sees objects of eight classes, four of one family and four that are no relatives. In each round of a loop the method of one more class is replaced, in the middle of the walk over the list, until none of the eight is the one its class defines.
interface Priced {
  price(): number;
}
class Item {
  constructor(public cost: number) {}
  price(): number {
    return this.cost;
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
}
class Gift {
  price(): number {
    return 1;
  }
}
class Loan {
  months = 12;
  rate = 5;
  price(): number {
    return this.months * this.rate;
  }
}
class Fixed {
  a = 1;
  b = 2;
  c = 3;
  price(): number {
    return this.a + this.b + this.c;
  }
}

const prototypes: Priced[] = [Item.prototype, Taxed.prototype, Free.prototype, Bundle.prototype, Ticket.prototype, Gift.prototype, Loan.prototype, Fixed.prototype];

function sum(list: Priced[], replaced: number): number {
  let total = 0;
  for (let i = 0; i < list.length; i++) {
    if (i === 4 && replaced >= 0) prototypes[replaced].price = () => 1000 + replaced;
    total += list[i].price();
  }
  return total;
}

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

const list: Priced[] = [new Item(100), new Taxed(100), new Free(100), new Bundle(100), new Ticket(), new Gift(), new Loan(), new Fixed()];
note("at first", sum(list, -1));
for (let replaced = 0; replaced < 8; replaced++) {
  note("while one more is replaced", sum(list, replaced));
  note("afterwards", sum(list, -1));
}

export {};
