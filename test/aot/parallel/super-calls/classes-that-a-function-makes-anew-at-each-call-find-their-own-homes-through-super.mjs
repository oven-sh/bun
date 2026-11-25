const rows = JSON.parse('[{"price":3,"service":true},{"price":5,"service":false},{"price":8,"service":true}]');
const Named = Base => class extends Base { describe() { return "n" + super.describe(); } cost() { return super.cost() + 1; } };
const Tagged = Base => class extends Base { tags = 2; describe() { return "t" + super.describe(); } cost() { return super.cost() + this.tags; } };
const Priced = Base => class extends Base { rate = 1.5; cost() { return super.cost() * this.rate; } };
class Item { constructor(row) { this.price = row.price; } describe() { return "i" + this.price; } cost() { return this.price; } }
class Free { constructor(row) { this.price = row.price; } describe() { return "f"; } cost() { return 0; } }
class Product extends Named(Tagged(Priced(Item))) {}
class Service extends Tagged(Priced(Item)) { cost() { return super.cost() / 2; } }
class Gift extends Named(Tagged(Priced(Free))) {}
for (const row of rows) console.log([new Product(row), new Service(row), new Gift(row)].map(it => it.describe() + ":" + it.cost()).join(" "));
