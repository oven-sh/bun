// Three families whose roots extend Error, Array and Map: their instances are an error, an array and a map and not plain objects. Each family has a method with an override that calls super. The methods are called through the type of the root, then replaced and deleted. One number is printed.
class Failure extends Error {
  code(): number {
    return this.message.length;
  }
}
class Timeout extends Failure {
  code(): number {
    return super.code() + 100;
  }
}
class Refused extends Failure {}

class Stack extends Array<number> {
  top(): number {
    return this[this.length - 1];
  }
}
class Capped extends Stack {
  top(): number {
    return Math.min(super.top(), 10);
  }
}

class Registry extends Map<string, number> {
  total(): number {
    let sum = 0;
    for (const value of this.values()) sum += value;
    return sum;
  }
}
class Doubled extends Registry {
  total(): number {
    return super.total() * 2;
  }
}

function codes(failures: Failure[]): number {
  let sum = 0;
  for (const failure of failures) sum = sum * 1000 + failure.code();
  return sum;
}
function tops(stacks: Stack[]): number {
  let sum = 0;
  for (const stack of stacks) sum = sum * 1000 + stack.top();
  return sum;
}
function totals(registries: Registry[]): number {
  let sum = 0;
  for (const registry of registries) sum = sum * 1000 + registry.total();
  return sum;
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const failures: Failure[] = [new Failure("a"), new Timeout("bb"), new Refused("ccc")];
const stacks: Stack[] = [new Stack(), new Capped()];
for (const stack of stacks) stack.push(5, 50);
const registries: Registry[] = [new Registry(), new Doubled()];
for (const registry of registries) registry.set("x", 3).set("y", 4);

function round(): void {
  note(codes(failures));
  note(tops(stacks));
  note(totals(registries));
}

round();
Failure.prototype.code = () => 7;
Stack.prototype.top = function () {
  return this[0];
};
Registry.prototype.total = function () {
  return this.size;
};
round();
Reflect.deleteProperty(Timeout.prototype, "code");
Reflect.deleteProperty(Capped.prototype, "top");
Reflect.deleteProperty(Doubled.prototype, "total");
round();
stacks[0].top = () => 8;
registries[1].total = () => 9;
failures[2].code = () => 6;
round();
console.log(checksum);

export {};
