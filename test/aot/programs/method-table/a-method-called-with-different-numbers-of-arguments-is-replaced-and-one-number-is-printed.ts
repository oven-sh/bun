// One method is called with no, one, two and three arguments and with a spread, each at a call site of its own. When the method is replaced, deleted or put back, all five call sites see it at once, whatever number of arguments they pass. One number is printed.
class Mixer {
  mix(a = 1, b = 2, c = 3): number {
    return a * 100 + b * 10 + c;
  }
}
class Loud extends Mixer {
  mix(a = 4, b = 5, c = 6): number {
    return -(a * 100 + b * 10 + c);
  }
}
class Same extends Mixer {}

function none(mixer: Mixer): number {
  return mixer.mix();
}
function one(mixer: Mixer): number {
  return mixer.mix(7);
}
function two(mixer: Mixer): number {
  return mixer.mix(7, 8);
}
function three(mixer: Mixer): number {
  return mixer.mix(7, 8, 9);
}
function spread(mixer: Mixer, list: [number?, number?, number?]): number {
  return mixer.mix(...list);
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

const mixers: Mixer[] = [new Mixer(), new Loud(), new Same()];
const ofMixer = Mixer.prototype.mix;
const ofLoud = Loud.prototype.mix;

function round(): void {
  for (const mixer of mixers) {
    note(attempt(() => none(mixer)));
    note(attempt(() => one(mixer)));
    note(attempt(() => two(mixer)));
    note(attempt(() => three(mixer)));
    note(attempt(() => spread(mixer, [5, 6])));
  }
}

round();
Mixer.prototype.mix = function () {
  return 1000 + arguments.length;
};
round();
Loud.prototype.mix = (...all: number[]) => 2000 + all.length;
round();
Reflect.deleteProperty(Loud.prototype, "mix");
round();
Reflect.deleteProperty(Mixer.prototype, "mix");
round();
Mixer.prototype.mix = ofMixer;
Loud.prototype.mix = ofLoud;
round();
console.log(checksum);

export {};
