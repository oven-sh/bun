class Order {
  side: string;
  price: number;
  tif: string;
  constructor({ side, price = 0, tif = "GTC" }: { side: string; price?: number; tif?: string }) {
    this.side = side;
    this.price = price;
    this.tif = tif;
  }
}
const orders = [new Order({ side: "buy" }), new Order({ side: "sell", price: 2.5 }), new Order({ side: "buy", price: undefined, tif: "IOC" }), new Order({ side: "x", price: null as any, tif: undefined })];
for (const order of orders) console.log(order.side, order.price, order.tif, typeof order.price);
const [a = 1, b = 2, c = 3] = [undefined, null, 0] as any[];
console.log(a, b, c);
