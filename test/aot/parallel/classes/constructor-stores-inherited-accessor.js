// The constructor above stores under an inherited accessor before the field below is defined.
const seen = [];

class Counted {
  constructor() {
    this.count = 0;
    this.ratio = 0.5;
    this.isOpen = false;
    this.label = "above";
  }
  set count(value) {
    seen.push("count " + value);
  }
  set ratio(value) {
    seen.push("ratio " + value);
  }
  set isOpen(value) {
    seen.push("isOpen " + value);
  }
  set label(value) {
    seen.push("label " + value);
  }
}
class CountedBelow extends Counted {
  count = 1;
  ratio = 1.5;
  isOpen = true;
  label = "below";
}
const counted = new CountedBelow();
console.log(counted.count, counted.ratio, counted.isOpen, counted.label, seen.join());
counted.count = 2;
console.log(counted.count, seen.length);

class ReadOnly {
  constructor() {
    try {
      this.size = 0;
      console.log("stored");
    } catch (error) {
      console.log(error.constructor.name);
    }
  }
  get size() {
    return 7;
  }
}
class ReadOnlyBelow extends ReadOnly {
  size = 1;
}
console.log(new ReadOnlyBelow().size);

class Fixed {
  constructor() {
    try {
      this.width = 0;
      console.log("stored");
    } catch (error) {
      console.log(error.constructor.name);
    }
  }
}
Object.defineProperty(Fixed.prototype, "width", { value: 7, writable: false });
class FixedBelow extends Fixed {
  width = 1;
}
console.log(new FixedBelow().width);

let resets = 0;
class Reset {
  constructor() {
    this.reset();
  }
  reset() {
    this.level = 0;
  }
  set level(value) {
    resets++;
  }
}
class Between extends Reset {}
class ResetBelow extends Between {
  level = 1;
}
const reset = new ResetBelow();
console.log(reset.level, resets);
reset.reset();
console.log(reset.level, resets);
new Reset();
console.log(resets);
