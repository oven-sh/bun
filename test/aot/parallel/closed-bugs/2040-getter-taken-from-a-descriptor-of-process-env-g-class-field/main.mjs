class Kept { constructor(d) { this.get = d.get; } }
console.log(typeof new Kept(Object.getOwnPropertyDescriptor(process.env, "TZ")).get);
