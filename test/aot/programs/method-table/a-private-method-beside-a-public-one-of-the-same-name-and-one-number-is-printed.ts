// #code() and code() live side by side, in a class and in its subclass, which has a #code() of its own. Replacing or deleting the public one never changes what the private name finds, and an object made from the prototype alone has the public one and not the private one. One number is printed.
class Safe {
  #code(): number {
    return 1;
  }
  code(): number {
    return this.#code() * 10;
  }
  static peek(safe: Safe): number {
    return safe.#code();
  }
}
class Vault extends Safe {
  #code(): number {
    return 2;
  }
  code(): number {
    return super.code() + this.#code();
  }
}
class Drawer extends Safe {}

function codes(safes: Safe[]): number {
  let sum = 0;
  for (const safe of safes) sum = sum * 100 + safe.code() + Safe.peek(safe);
  return sum;
}

function attempt(run: () => number): number {
  try {
    return run();
  } catch (error) {
    return error instanceof TypeError ? -1 : -2;
  }
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const safes: Safe[] = [new Safe(), new Vault(), new Drawer()];
note(codes(safes));
Safe.prototype.code = () => 5;
note(codes(safes));
Reflect.deleteProperty(Vault.prototype, "code");
note(codes(safes));
const bare: Safe = Object.create(Safe.prototype);
note(attempt(() => bare.code()));
note(attempt(() => Safe.peek(bare)));
console.log(checksum);

export {};
