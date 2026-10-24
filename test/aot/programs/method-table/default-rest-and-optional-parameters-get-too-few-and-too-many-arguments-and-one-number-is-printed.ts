// Overrides take fewer or more parameters than the method they override: one parameter, defaults, a rest parameter, optional ones. Call sites typed with the base pass three arguments or none to all of them, directly and with a spread; each method reports how many it got. One number is printed.
class Mixer {
  mix(a: number, b: number, c: number): number {
    return arguments.length * 1000 + a + b + c;
  }
  idle(): number {
    return arguments.length * 1000;
  }
}
class First extends Mixer {
  mix(a: number): number {
    return arguments.length * 1000 + a;
  }
  idle(a?: number, b?: number): number {
    return arguments.length * 1000 + (a ?? 1) + (b ?? 2);
  }
}
class Defaults extends Mixer {
  mix(a: number, b = 20, c = 30, d = 40): number {
    return arguments.length * 1000 + a + b + c + d;
  }
  idle(a = 5, b = a * 2): number {
    return arguments.length * 1000 + a + b;
  }
}
class Rest extends Mixer {
  mix(...all: number[]): number {
    let sum = all.length * 1000;
    for (const each of all) sum += each;
    return sum;
  }
  idle(first = 3, ...others: number[]): number {
    return others.length * 1000 + first;
  }
}
class None extends Mixer {
  mix(): number {
    return arguments.length * 1000;
  }
}

function three(mixer: Mixer): number {
  return mixer.mix(1, 2, 3);
}
function spread(mixer: Mixer, triple: [number, number, number]): number {
  return mixer.mix(...triple);
}
function none(mixer: Mixer): number {
  return mixer.idle();
}
function holes(defaults: Defaults): number {
  return defaults.mix(1, undefined, 3) + defaults.mix(1) + defaults.mix(1, 2, 3, 4) + defaults.idle(undefined, 1);
}
function many(rest: Rest): number {
  return rest.mix() + rest.mix(1) + rest.mix(1, 2, 3, 4, 5, 6, 7, 8, 9, 10) + rest.idle(1, 2, 3) + rest.mix(...[1, 2], ...[3, 4, 5]);
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const mixers: Mixer[] = [new Mixer(), new First(), new Defaults(), new Rest(), new None()];
for (const mixer of mixers) note(three(mixer));
for (const mixer of mixers) note(spread(mixer, [4, 5, 6]));
for (const mixer of mixers) note(none(mixer));
note(holes(new Defaults()));
note(many(new Rest()));
console.log(checksum);

export {};
