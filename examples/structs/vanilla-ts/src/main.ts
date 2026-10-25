struct Money {
  amount: number;
  currency: string;
  constructor(amount: number, currency: string) {
    this.amount = amount;
    this.currency = currency;
  }
  plus(other: Money): Money {
    if (other.currency !== this.currency) throw new RangeError("currency mismatch");
    return new Money(this.amount + other.amount, this.currency);
  }
  toString(): string {
    return `${this.amount.toFixed(2)} ${this.currency}`;
  }
}

struct Item extends Money {
  label: string;
  constructor(label: string, amount: number, currency: string) {
    super(amount, currency);
    this.label = label;
  }
}

// A shared struct only holds primitives and other shared structs, so it is safe to hand to a worker
// in a runtime with native support. Here, in a browser bundle, it is an ordinary sealed object.
shared struct Counter {
  count: number;
}

const counter = new Counter();
counter.count = 0;

const cart: Item[] = [new Item("book", 12.5, "EUR"), new Item("pen", 2.25, "EUR")];
const total = cart.reduce<Money>((sum, item) => sum.plus(item), new Money(0, "EUR"));

const out = document.getElementById("out") as HTMLPreElement;
function render(): void {
  out.textContent = [`cart: ${cart.map(item => item.label).join(", ")}`, `total: ${total}`, `clicks: ${counter.count}`].join("\n");
}

document.getElementById("inc")!.addEventListener("click", () => {
  counter.count += 1;
  render();
});

try {
  (cart[0] as any).discount = 1;
} catch (error) {
  out.dataset.sealed = String(error instanceof TypeError);
}

render();
