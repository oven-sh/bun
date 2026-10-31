class Failure extends Error {
  constructor(
    message: string,
    public code: number,
  ) {
    super(message);
  }
}
class Worse extends Failure {
  override name = "Worse";
}
(Error.prototype as unknown as { describe(): string }).describe = function (this: Error) {
  return this.name + "/" + this.message;
};
const all: Error[] = [new Failure("f", 1), new Worse("w", 2), new TypeError("t")];
console.log(
  all.map(each => (each as unknown as { describe(): string }).describe()).join(),
  all.map(each => each instanceof Error && each instanceof Object).join(),
);
Error.prototype.name = "Base";
console.log(all.map(each => each.name).join(), String(all[0]));
