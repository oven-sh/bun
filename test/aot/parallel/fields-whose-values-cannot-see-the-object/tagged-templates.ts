// Each tagged template in the value of a field has a template object of its own, also where the constructor evaluates the values of several fields before its parameters.
const seen: TemplateStringsArray[] = [];
function tag(strings: TemplateStringsArray, ...values: unknown[]): string {
  seen.push(strings);
  return strings.join("_") + values.join("");
}

class Stored {
  first = tag`one`;
  second = tag`two`;
  same = tag`two`;
  nested = tag`a${tag`b`}c`;
  count: number;
  constructor(count: number) {
    this.count = count;
  }
}

class Parameter {
  first = tag`three`;
  second = tag`four`;
  constructor(public count: number) {}
}

class Hidden {
  #first = tag`five`;
  #second = String.raw`\six`;
  count: number;
  constructor(count: number) {
    this.count = count;
  }
  read() {
    return this.#first + this.#second + this.count;
  }
}

class Derived extends Stored {
  third = tag`seven`;
  fourth = tag`eight`;
}

class WithoutConstructor {
  first = tag`nine`;
  second = tag`ten`;
}

for (let i = 0; i < 3; i++) {
  seen.length = 0;
  const stored = new Stored(i);
  console.log(stored.first, stored.second, stored.same, stored.nested, stored.count);
  console.log(new Set(seen).size);
  const parameter = new Parameter(i);
  console.log(parameter.first, parameter.second, parameter.count);
  console.log(new Hidden(i).read());
  const derived = new Derived(i);
  console.log(derived.first, derived.second, derived.third, derived.fourth);
  const without = new WithoutConstructor();
  console.log(without.first, without.second, new Set(seen).size, seen.length);
}

const [earlier] = [new Stored(1), seen.at(-1)].slice(1);
new Stored(2);
console.log(earlier === seen.at(-1));
