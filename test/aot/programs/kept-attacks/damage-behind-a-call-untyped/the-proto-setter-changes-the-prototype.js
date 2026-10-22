// A store to `__proto__` runs the setter of Object.prototype and gives the object another prototype. It stands below a call, and the caller has read an absent property and called an inherited method before.
class Animal {
  constructor(legs) {
    this.legs = legs;
  }
  sound() {
    return "none";
  }
}
const bird = {
  wings: 2,
  sound() {
    return "tweet";
  },
};

let mode = 0;
function below(a) {
  if (mode === 1) a.__proto__ = bird;
  else if (mode === 2) a.__proto__ = null;
  else if (mode === 3) a["__pro" + "to__"] = bird;
  return 1;
}

function holder(a) {
  const before = a.legs + "," + a.wings + "," + a.sound();
  const got = below(a);
  let sound;
  try {
    sound = a.sound();
  } catch (error) {
    sound = error.name;
  }
  return before + " " + got + " " + a.legs + "," + a.wings + "," + sound + "," + (a instanceof Animal);
}

for (let round = 0; round < 400; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = holder(new Animal(round));
  if (mode || round === 0) console.log(round + ": " + line);
}
