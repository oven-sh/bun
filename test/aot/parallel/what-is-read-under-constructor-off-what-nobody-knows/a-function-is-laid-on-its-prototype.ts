function lay(given: any): void {
  given.constructor.prototype.doubled = function (this: number) {
    return Number(this) * 2;
  };
}
lay(JSON.parse("1"));
console.log(String((21 as any).doubled()), String("doubled" in Number.prototype));
