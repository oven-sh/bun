// The programs of method-table that are mostly a loop written out: thousands of fields, variables or functions that differ in a number.
import { programsOf, text } from "../generate";

export const programs = () =>
  programsOf({
    "seventy-methods-of-one-class-are-replaced-one-after-the-other-and-one-number-is-printed.ts": text(
      `// A class has seventy methods and its subclass overrides every second one: more members to watch than a word has bits. One function calls all seventy. Then each is replaced where it is defined, one after the other, and all seventy are called after every tenth. One number is printed.
class Wide {
  m00(): number {
    return 0;
  }
  m01(): number {
    return 1;
  }
  m02(): number {
    return 2;
  }
  m03(): number {
    return 3;
  }
  m04(): number {
    return 4;
  }
  m05(): number {
    return 5;
  }
  m06(): number {
    return 6;
  }
  m07(): number {
    return 7;
  }
  m08(): number {
    return 8;
  }
  m09(): number {`,
      [
        60,
        n => `    return ${n + 9};
  }
  m${n + 10}(): number {`,
      ],
      `    return 69;
  }
}
class Wider extends Wide {
  m00(): number {
    return 1000;
  }
  m02(): number {
    return 1002;
  }
  m04(): number {
    return 1004;
  }
  m06(): number {
    return 1006;
  }
  m08(): number {`,
      [
        30,
        n => `    return ${2 * n + 1008};
  }
  m${2 * n + 10}(): number {`,
      ],
      `    return 1068;
  }
}

function callAll(x: Wide): number {
  let sum = 0;
  sum = (sum * 7 + x.m00()) % 1000003;
  sum = (sum * 7 + x.m01()) % 1000003;
  sum = (sum * 7 + x.m02()) % 1000003;
  sum = (sum * 7 + x.m03()) % 1000003;
  sum = (sum * 7 + x.m04()) % 1000003;
  sum = (sum * 7 + x.m05()) % 1000003;
  sum = (sum * 7 + x.m06()) % 1000003;
  sum = (sum * 7 + x.m07()) % 1000003;
  sum = (sum * 7 + x.m08()) % 1000003;
  sum = (sum * 7 + x.m09()) % 1000003;`,
      [60, n => `  sum = (sum * 7 + x.m${n + 10}()) % 1000003;`],
      `  return sum;
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const wide = new Wide();
const wider = new Wider();
note(callAll(wide));
note(callAll(wider));
Wider.prototype.m00 = () => 5000;
Wide.prototype.m00 = () => 6000;
Wide.prototype.m01 = () => 5001;
Wider.prototype.m02 = () => 5002;
Wide.prototype.m03 = () => 5003;
Wider.prototype.m04 = () => 5004;
Wide.prototype.m04 = () => 6004;
Wide.prototype.m05 = () => 5005;
Wider.prototype.m06 = () => 5006;
Wide.prototype.m07 = () => 5007;
Wider.prototype.m08 = () => 5008;
Wide.prototype.m08 = () => 6008;
Wide.prototype.m09 = () => 5009;`,
      [
        3,
        n => `note(callAll(wide));
note(callAll(wider));
Wider.prototype.m${20 * n + 10} = () => ${20 * n + 5010};
Wide.prototype.m${20 * n + 11} = () => ${20 * n + 5011};
Wider.prototype.m${20 * n + 12} = () => ${20 * n + 5012};
Wide.prototype.m${20 * n + 12} = () => ${20 * n + 6012};
Wide.prototype.m${20 * n + 13} = () => ${20 * n + 5013};
Wider.prototype.m${20 * n + 14} = () => ${20 * n + 5014};
Wide.prototype.m${20 * n + 15} = () => ${20 * n + 5015};
Wider.prototype.m${20 * n + 16} = () => ${20 * n + 5016};
Wide.prototype.m${20 * n + 16} = () => ${20 * n + 6016};
Wide.prototype.m${20 * n + 17} = () => ${20 * n + 5017};
Wider.prototype.m${20 * n + 18} = () => ${20 * n + 5018};
Wide.prototype.m${20 * n + 19} = () => ${20 * n + 5019};
note(callAll(wide));
note(callAll(wider));
Wider.prototype.m${20 * n + 20} = () => ${20 * n + 5020};
Wide.prototype.m${20 * n + 20} = () => ${20 * n + 6020};
Wide.prototype.m${20 * n + 21} = () => ${20 * n + 5021};
Wider.prototype.m${20 * n + 22} = () => ${20 * n + 5022};
Wide.prototype.m${20 * n + 23} = () => ${20 * n + 5023};
Wider.prototype.m${20 * n + 24} = () => ${20 * n + 5024};
Wide.prototype.m${20 * n + 24} = () => ${20 * n + 6024};
Wide.prototype.m${20 * n + 25} = () => ${20 * n + 5025};
Wider.prototype.m${20 * n + 26} = () => ${20 * n + 5026};
Wide.prototype.m${20 * n + 27} = () => ${20 * n + 5027};
Wider.prototype.m${20 * n + 28} = () => ${20 * n + 5028};
Wide.prototype.m${20 * n + 28} = () => ${20 * n + 6028};
Wide.prototype.m${20 * n + 29} = () => ${20 * n + 5029};`,
      ],
      `note(callAll(wide));
note(callAll(wider));
console.log(checksum);

export {};
`,
    ),
    "seventy-methods-of-one-class-are-replaced-one-after-the-other.ts": text(
      `// A class has seventy methods and its subclass overrides every second one: more members to watch than a word has bits. One function calls all seventy. Then each is replaced where it is defined, one after the other, and all seventy are called after every tenth.
class Wide {
  m00(): number {
    return 0;
  }
  m01(): number {
    return 1;
  }
  m02(): number {
    return 2;
  }
  m03(): number {
    return 3;
  }
  m04(): number {
    return 4;
  }
  m05(): number {
    return 5;
  }
  m06(): number {
    return 6;
  }
  m07(): number {
    return 7;
  }
  m08(): number {
    return 8;
  }
  m09(): number {`,
      [
        60,
        n => `    return ${n + 9};
  }
  m${n + 10}(): number {`,
      ],
      `    return 69;
  }
}
class Wider extends Wide {
  m00(): number {
    return 1000;
  }
  m02(): number {
    return 1002;
  }
  m04(): number {
    return 1004;
  }
  m06(): number {
    return 1006;
  }
  m08(): number {`,
      [
        30,
        n => `    return ${2 * n + 1008};
  }
  m${2 * n + 10}(): number {`,
      ],
      `    return 1068;
  }
}

function callAll(x: Wide): number {
  let sum = 0;
  sum = (sum * 7 + x.m00()) % 1000003;
  sum = (sum * 7 + x.m01()) % 1000003;
  sum = (sum * 7 + x.m02()) % 1000003;
  sum = (sum * 7 + x.m03()) % 1000003;
  sum = (sum * 7 + x.m04()) % 1000003;
  sum = (sum * 7 + x.m05()) % 1000003;
  sum = (sum * 7 + x.m06()) % 1000003;
  sum = (sum * 7 + x.m07()) % 1000003;
  sum = (sum * 7 + x.m08()) % 1000003;
  sum = (sum * 7 + x.m09()) % 1000003;`,
      [60, n => `  sum = (sum * 7 + x.m${n + 10}()) % 1000003;`],
      `  return sum;
}

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

const wide = new Wide();
const wider = new Wider();
note("the base at first", callAll(wide));
note("the subclass at first", callAll(wider));
Wider.prototype.m00 = () => 5000;
Wide.prototype.m00 = () => 6000;
Wide.prototype.m01 = () => 5001;
Wider.prototype.m02 = () => 5002;
Wide.prototype.m03 = () => 5003;
Wider.prototype.m04 = () => 5004;
Wide.prototype.m04 = () => 6004;
Wide.prototype.m05 = () => 5005;
Wider.prototype.m06 = () => 5006;
Wide.prototype.m07 = () => 5007;
Wider.prototype.m08 = () => 5008;
Wide.prototype.m08 = () => 6008;
Wide.prototype.m09 = () => 5009;`,
      [
        3,
        n => `note("the base", callAll(wide));
note("the subclass", callAll(wider));
Wider.prototype.m${20 * n + 10} = () => ${20 * n + 5010};
Wide.prototype.m${20 * n + 11} = () => ${20 * n + 5011};
Wider.prototype.m${20 * n + 12} = () => ${20 * n + 5012};
Wide.prototype.m${20 * n + 12} = () => ${20 * n + 6012};
Wide.prototype.m${20 * n + 13} = () => ${20 * n + 5013};
Wider.prototype.m${20 * n + 14} = () => ${20 * n + 5014};
Wide.prototype.m${20 * n + 15} = () => ${20 * n + 5015};
Wider.prototype.m${20 * n + 16} = () => ${20 * n + 5016};
Wide.prototype.m${20 * n + 16} = () => ${20 * n + 6016};
Wide.prototype.m${20 * n + 17} = () => ${20 * n + 5017};
Wider.prototype.m${20 * n + 18} = () => ${20 * n + 5018};
Wide.prototype.m${20 * n + 19} = () => ${20 * n + 5019};
note("the base", callAll(wide));
note("the subclass", callAll(wider));
Wider.prototype.m${20 * n + 20} = () => ${20 * n + 5020};
Wide.prototype.m${20 * n + 20} = () => ${20 * n + 6020};
Wide.prototype.m${20 * n + 21} = () => ${20 * n + 5021};
Wider.prototype.m${20 * n + 22} = () => ${20 * n + 5022};
Wide.prototype.m${20 * n + 23} = () => ${20 * n + 5023};
Wider.prototype.m${20 * n + 24} = () => ${20 * n + 5024};
Wide.prototype.m${20 * n + 24} = () => ${20 * n + 6024};
Wide.prototype.m${20 * n + 25} = () => ${20 * n + 5025};
Wider.prototype.m${20 * n + 26} = () => ${20 * n + 5026};
Wide.prototype.m${20 * n + 27} = () => ${20 * n + 5027};
Wider.prototype.m${20 * n + 28} = () => ${20 * n + 5028};
Wide.prototype.m${20 * n + 28} = () => ${20 * n + 6028};
Wide.prototype.m${20 * n + 29} = () => ${20 * n + 5029};`,
      ],
      `note("the base", callAll(wide));
note("the subclass", callAll(wider));

export {};
`,
    ),
  });
