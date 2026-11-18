class Crate {
  wide: number;
  constructor(wide: number) {
    console.log(eval("typeof this.wide + ' ' + typeof Crate"));
    this.wide = wide;
    console.log(eval("this.wide"));
    try { eval("Crate = 5"); } catch (error) { console.log((error as Error).name); }
  }
}
new Crate(3);
console.log(typeof Crate);
