// new Proxy(lamp, ..) has the type of the lamp. Proxies lie in one list with real instances: one without traps, one whose get trap counts the reads, one whose get trap answers another function under the name of the method, a proxy of a proxy, and a revoked one, on which every call throws a TypeError. One number is printed.
class Lamp {
  constructor(public watts: number) {}
  factor(): number {
    return 1;
  }
  power(): number {
    return this.watts * this.factor();
  }
}
class Bright extends Lamp {
  factor(): number {
    return 2;
  }
}

function powerOf(lamp: Lamp): number {
  return lamp.power();
}

function attempt(lamp: Lamp): number {
  try {
    return powerOf(lamp);
  } catch (error) {
    return error instanceof TypeError ? -1 : -2;
  }
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

let reads = 0;
const plain = new Proxy(new Bright(3), {});
const counting = new Proxy(new Bright(4), {
  get(target, key, receiver) {
    reads++;
    return Reflect.get(target, key, receiver);
  },
});
const lying = new Proxy(new Bright(5), {
  get(target, key, receiver) {
    return key === "factor" ? () => 100 : Reflect.get(target, key, receiver);
  },
});
const nested = new Proxy(counting, {});
const revocable = Proxy.revocable(new Lamp(6), {});
const lamps: Lamp[] = [new Lamp(1), plain, new Bright(2), counting, lying, nested, revocable.proxy];

for (const lamp of lamps) note(attempt(lamp));
note(reads);
revocable.revoke();
Bright.prototype.factor = () => 7;
for (const lamp of lamps) note(attempt(lamp));
note(reads);
let sum = 0;
for (let round = 0; round < 100; round++) for (const lamp of lamps) sum += attempt(lamp);
note(sum);
console.log(checksum);

export {};
