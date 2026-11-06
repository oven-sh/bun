// Classes and functions whose stack frames show a name that they get while the program runs, and that hold from no value to twenty-eight values across the call that throws.
// Flags: --aot-disable=flow-results
const input = JSON.parse("[" + Array.from({ length: 32 }, (_, index) => index + 1).join() + "]");
const flag = { fails: true };

function fail() {
  throw new Error("x");
}
const check = new Function("fails", "if (fails) throw new Error('x');");

function framesOf(call) {
  try {
    return `returned ${call()}`;
  } catch (error) {
    return String(error.stack)
      .split("\n")
      .slice(1, 4)
      .map(line =>
        line
          .trim()
          .replace(/ ?\(.*\)$/, "")
          .replace(/at (?:[A-Z]:)?[\\/].*$/, "at <file>"),
      )
      .join(" < ");
  }
}

const classes = [
  class {
    static name = "always0";
    constructor() {
      fail();
      this.sum = 0;
    }
  },
  class {
    static name = "always1";
    constructor() {
      const v0 = input[0];
      fail();
      this.sum = 0 + v0;
    }
  },
  class {
    static name = "always2";
    constructor() {
      const v0 = input[0];
      const v1 = input[1];
      fail();
      this.sum = 0 + v0 + v1;
    }
  },
  class {
    static name = "always5";
    constructor() {
      const v0 = input[0];
      const v1 = input[1];
      const v2 = input[2];
      const v3 = input[3];
      const v4 = input[4];
      fail();
      this.sum = 0 + v0 + v1 + v2 + v3 + v4;
    }
  },
  class {
    static name = "always12";
    constructor() {
      const v0 = input[0];
      const v1 = input[1];
      const v2 = input[2];
      const v3 = input[3];
      const v4 = input[4];
      const v5 = input[5];
      const v6 = input[6];
      const v7 = input[7];
      const v8 = input[8];
      const v9 = input[9];
      const v10 = input[10];
      const v11 = input[11];
      fail();
      this.sum = 0 + v0 + v1 + v2 + v3 + v4 + v5 + v6 + v7 + v8 + v9 + v10 + v11;
    }
  },
  class {
    static name = "always28";
    constructor() {
      const v0 = input[0];
      const v1 = input[1];
      const v2 = input[2];
      const v3 = input[3];
      const v4 = input[4];
      const v5 = input[5];
      const v6 = input[6];
      const v7 = input[7];
      const v8 = input[8];
      const v9 = input[9];
      const v10 = input[10];
      const v11 = input[11];
      const v12 = input[12];
      const v13 = input[13];
      const v14 = input[14];
      const v15 = input[15];
      const v16 = input[16];
      const v17 = input[17];
      const v18 = input[18];
      const v19 = input[19];
      const v20 = input[20];
      const v21 = input[21];
      const v22 = input[22];
      const v23 = input[23];
      const v24 = input[24];
      const v25 = input[25];
      const v26 = input[26];
      const v27 = input[27];
      fail();
      this.sum =
        0 +
        v0 +
        v1 +
        v2 +
        v3 +
        v4 +
        v5 +
        v6 +
        v7 +
        v8 +
        v9 +
        v10 +
        v11 +
        v12 +
        v13 +
        v14 +
        v15 +
        v16 +
        v17 +
        v18 +
        v19 +
        v20 +
        v21 +
        v22 +
        v23 +
        v24 +
        v25 +
        v26 +
        v27;
    }
  },
  class {
    static name = "rarely0";
    constructor() {
      if (flag.fails) fail();
      this.sum = 0;
    }
  },
  class {
    static name = "rarely1";
    constructor() {
      const v0 = input[0];
      if (flag.fails) fail();
      this.sum = 0 + v0;
    }
  },
  class {
    static name = "rarely2";
    constructor() {
      const v0 = input[0];
      const v1 = input[1];
      if (flag.fails) fail();
      this.sum = 0 + v0 + v1;
    }
  },
  class {
    static name = "rarely5";
    constructor() {
      const v0 = input[0];
      const v1 = input[1];
      const v2 = input[2];
      const v3 = input[3];
      const v4 = input[4];
      if (flag.fails) fail();
      this.sum = 0 + v0 + v1 + v2 + v3 + v4;
    }
  },
  class {
    static name = "rarely12";
    constructor() {
      const v0 = input[0];
      const v1 = input[1];
      const v2 = input[2];
      const v3 = input[3];
      const v4 = input[4];
      const v5 = input[5];
      const v6 = input[6];
      const v7 = input[7];
      const v8 = input[8];
      const v9 = input[9];
      const v10 = input[10];
      const v11 = input[11];
      if (flag.fails) fail();
      this.sum = 0 + v0 + v1 + v2 + v3 + v4 + v5 + v6 + v7 + v8 + v9 + v10 + v11;
    }
  },
  class {
    static name = "rarely28";
    constructor() {
      const v0 = input[0];
      const v1 = input[1];
      const v2 = input[2];
      const v3 = input[3];
      const v4 = input[4];
      const v5 = input[5];
      const v6 = input[6];
      const v7 = input[7];
      const v8 = input[8];
      const v9 = input[9];
      const v10 = input[10];
      const v11 = input[11];
      const v12 = input[12];
      const v13 = input[13];
      const v14 = input[14];
      const v15 = input[15];
      const v16 = input[16];
      const v17 = input[17];
      const v18 = input[18];
      const v19 = input[19];
      const v20 = input[20];
      const v21 = input[21];
      const v22 = input[22];
      const v23 = input[23];
      const v24 = input[24];
      const v25 = input[25];
      const v26 = input[26];
      const v27 = input[27];
      if (flag.fails) fail();
      this.sum =
        0 +
        v0 +
        v1 +
        v2 +
        v3 +
        v4 +
        v5 +
        v6 +
        v7 +
        v8 +
        v9 +
        v10 +
        v11 +
        v12 +
        v13 +
        v14 +
        v15 +
        v16 +
        v17 +
        v18 +
        v19 +
        v20 +
        v21 +
        v22 +
        v23 +
        v24 +
        v25 +
        v26 +
        v27;
    }
  },
  class {
    static name = "unseen0";
    constructor() {
      check(flag.fails);
      this.sum = 0;
    }
  },
  class {
    static name = "unseen1";
    constructor() {
      const v0 = input[0];
      check(flag.fails);
      this.sum = 0 + v0;
    }
  },
  class {
    static name = "unseen2";
    constructor() {
      const v0 = input[0];
      const v1 = input[1];
      check(flag.fails);
      this.sum = 0 + v0 + v1;
    }
  },
  class {
    static name = "unseen5";
    constructor() {
      const v0 = input[0];
      const v1 = input[1];
      const v2 = input[2];
      const v3 = input[3];
      const v4 = input[4];
      check(flag.fails);
      this.sum = 0 + v0 + v1 + v2 + v3 + v4;
    }
  },
  class {
    static name = "unseen12";
    constructor() {
      const v0 = input[0];
      const v1 = input[1];
      const v2 = input[2];
      const v3 = input[3];
      const v4 = input[4];
      const v5 = input[5];
      const v6 = input[6];
      const v7 = input[7];
      const v8 = input[8];
      const v9 = input[9];
      const v10 = input[10];
      const v11 = input[11];
      check(flag.fails);
      this.sum = 0 + v0 + v1 + v2 + v3 + v4 + v5 + v6 + v7 + v8 + v9 + v10 + v11;
    }
  },
  class {
    static name = "unseen28";
    constructor() {
      const v0 = input[0];
      const v1 = input[1];
      const v2 = input[2];
      const v3 = input[3];
      const v4 = input[4];
      const v5 = input[5];
      const v6 = input[6];
      const v7 = input[7];
      const v8 = input[8];
      const v9 = input[9];
      const v10 = input[10];
      const v11 = input[11];
      const v12 = input[12];
      const v13 = input[13];
      const v14 = input[14];
      const v15 = input[15];
      const v16 = input[16];
      const v17 = input[17];
      const v18 = input[18];
      const v19 = input[19];
      const v20 = input[20];
      const v21 = input[21];
      const v22 = input[22];
      const v23 = input[23];
      const v24 = input[24];
      const v25 = input[25];
      const v26 = input[26];
      const v27 = input[27];
      check(flag.fails);
      this.sum =
        0 +
        v0 +
        v1 +
        v2 +
        v3 +
        v4 +
        v5 +
        v6 +
        v7 +
        v8 +
        v9 +
        v10 +
        v11 +
        v12 +
        v13 +
        v14 +
        v15 +
        v16 +
        v17 +
        v18 +
        v19 +
        v20 +
        v21 +
        v22 +
        v23 +
        v24 +
        v25 +
        v26 +
        v27;
    }
  },
];

const factories = [
  name => {
    function made() {
      fail();
      return 0;
    }
    return Object.defineProperty(made, "name", { value: name });
  },
  name => {
    function made() {
      const v0 = input[0];
      fail();
      return 0 + v0;
    }
    return Object.defineProperty(made, "name", { value: name });
  },
  name => {
    function made() {
      const v0 = input[0];
      const v1 = input[1];
      fail();
      return 0 + v0 + v1;
    }
    return Object.defineProperty(made, "name", { value: name });
  },
  name => {
    function made() {
      const v0 = input[0];
      const v1 = input[1];
      const v2 = input[2];
      const v3 = input[3];
      const v4 = input[4];
      fail();
      return 0 + v0 + v1 + v2 + v3 + v4;
    }
    return Object.defineProperty(made, "name", { value: name });
  },
  name => {
    function made() {
      const v0 = input[0];
      const v1 = input[1];
      const v2 = input[2];
      const v3 = input[3];
      const v4 = input[4];
      const v5 = input[5];
      const v6 = input[6];
      const v7 = input[7];
      const v8 = input[8];
      const v9 = input[9];
      const v10 = input[10];
      const v11 = input[11];
      fail();
      return 0 + v0 + v1 + v2 + v3 + v4 + v5 + v6 + v7 + v8 + v9 + v10 + v11;
    }
    return Object.defineProperty(made, "name", { value: name });
  },
  name => {
    function made() {
      const v0 = input[0];
      const v1 = input[1];
      const v2 = input[2];
      const v3 = input[3];
      const v4 = input[4];
      const v5 = input[5];
      const v6 = input[6];
      const v7 = input[7];
      const v8 = input[8];
      const v9 = input[9];
      const v10 = input[10];
      const v11 = input[11];
      const v12 = input[12];
      const v13 = input[13];
      const v14 = input[14];
      const v15 = input[15];
      const v16 = input[16];
      const v17 = input[17];
      const v18 = input[18];
      const v19 = input[19];
      const v20 = input[20];
      const v21 = input[21];
      const v22 = input[22];
      const v23 = input[23];
      const v24 = input[24];
      const v25 = input[25];
      const v26 = input[26];
      const v27 = input[27];
      fail();
      return (
        0 +
        v0 +
        v1 +
        v2 +
        v3 +
        v4 +
        v5 +
        v6 +
        v7 +
        v8 +
        v9 +
        v10 +
        v11 +
        v12 +
        v13 +
        v14 +
        v15 +
        v16 +
        v17 +
        v18 +
        v19 +
        v20 +
        v21 +
        v22 +
        v23 +
        v24 +
        v25 +
        v26 +
        v27
      );
    }
    return Object.defineProperty(made, "name", { value: name });
  },
  name => {
    function made() {
      if (flag.fails) fail();
      return 0;
    }
    return Object.defineProperty(made, "name", { value: name });
  },
  name => {
    function made() {
      const v0 = input[0];
      if (flag.fails) fail();
      return 0 + v0;
    }
    return Object.defineProperty(made, "name", { value: name });
  },
  name => {
    function made() {
      const v0 = input[0];
      const v1 = input[1];
      if (flag.fails) fail();
      return 0 + v0 + v1;
    }
    return Object.defineProperty(made, "name", { value: name });
  },
  name => {
    function made() {
      const v0 = input[0];
      const v1 = input[1];
      const v2 = input[2];
      const v3 = input[3];
      const v4 = input[4];
      if (flag.fails) fail();
      return 0 + v0 + v1 + v2 + v3 + v4;
    }
    return Object.defineProperty(made, "name", { value: name });
  },
  name => {
    function made() {
      const v0 = input[0];
      const v1 = input[1];
      const v2 = input[2];
      const v3 = input[3];
      const v4 = input[4];
      const v5 = input[5];
      const v6 = input[6];
      const v7 = input[7];
      const v8 = input[8];
      const v9 = input[9];
      const v10 = input[10];
      const v11 = input[11];
      if (flag.fails) fail();
      return 0 + v0 + v1 + v2 + v3 + v4 + v5 + v6 + v7 + v8 + v9 + v10 + v11;
    }
    return Object.defineProperty(made, "name", { value: name });
  },
  name => {
    function made() {
      const v0 = input[0];
      const v1 = input[1];
      const v2 = input[2];
      const v3 = input[3];
      const v4 = input[4];
      const v5 = input[5];
      const v6 = input[6];
      const v7 = input[7];
      const v8 = input[8];
      const v9 = input[9];
      const v10 = input[10];
      const v11 = input[11];
      const v12 = input[12];
      const v13 = input[13];
      const v14 = input[14];
      const v15 = input[15];
      const v16 = input[16];
      const v17 = input[17];
      const v18 = input[18];
      const v19 = input[19];
      const v20 = input[20];
      const v21 = input[21];
      const v22 = input[22];
      const v23 = input[23];
      const v24 = input[24];
      const v25 = input[25];
      const v26 = input[26];
      const v27 = input[27];
      if (flag.fails) fail();
      return (
        0 +
        v0 +
        v1 +
        v2 +
        v3 +
        v4 +
        v5 +
        v6 +
        v7 +
        v8 +
        v9 +
        v10 +
        v11 +
        v12 +
        v13 +
        v14 +
        v15 +
        v16 +
        v17 +
        v18 +
        v19 +
        v20 +
        v21 +
        v22 +
        v23 +
        v24 +
        v25 +
        v26 +
        v27
      );
    }
    return Object.defineProperty(made, "name", { value: name });
  },
  name => {
    function made() {
      check(flag.fails);
      return 0;
    }
    return Object.defineProperty(made, "name", { value: name });
  },
  name => {
    function made() {
      const v0 = input[0];
      check(flag.fails);
      return 0 + v0;
    }
    return Object.defineProperty(made, "name", { value: name });
  },
  name => {
    function made() {
      const v0 = input[0];
      const v1 = input[1];
      check(flag.fails);
      return 0 + v0 + v1;
    }
    return Object.defineProperty(made, "name", { value: name });
  },
  name => {
    function made() {
      const v0 = input[0];
      const v1 = input[1];
      const v2 = input[2];
      const v3 = input[3];
      const v4 = input[4];
      check(flag.fails);
      return 0 + v0 + v1 + v2 + v3 + v4;
    }
    return Object.defineProperty(made, "name", { value: name });
  },
  name => {
    function made() {
      const v0 = input[0];
      const v1 = input[1];
      const v2 = input[2];
      const v3 = input[3];
      const v4 = input[4];
      const v5 = input[5];
      const v6 = input[6];
      const v7 = input[7];
      const v8 = input[8];
      const v9 = input[9];
      const v10 = input[10];
      const v11 = input[11];
      check(flag.fails);
      return 0 + v0 + v1 + v2 + v3 + v4 + v5 + v6 + v7 + v8 + v9 + v10 + v11;
    }
    return Object.defineProperty(made, "name", { value: name });
  },
  name => {
    function made() {
      const v0 = input[0];
      const v1 = input[1];
      const v2 = input[2];
      const v3 = input[3];
      const v4 = input[4];
      const v5 = input[5];
      const v6 = input[6];
      const v7 = input[7];
      const v8 = input[8];
      const v9 = input[9];
      const v10 = input[10];
      const v11 = input[11];
      const v12 = input[12];
      const v13 = input[13];
      const v14 = input[14];
      const v15 = input[15];
      const v16 = input[16];
      const v17 = input[17];
      const v18 = input[18];
      const v19 = input[19];
      const v20 = input[20];
      const v21 = input[21];
      const v22 = input[22];
      const v23 = input[23];
      const v24 = input[24];
      const v25 = input[25];
      const v26 = input[26];
      const v27 = input[27];
      check(flag.fails);
      return (
        0 +
        v0 +
        v1 +
        v2 +
        v3 +
        v4 +
        v5 +
        v6 +
        v7 +
        v8 +
        v9 +
        v10 +
        v11 +
        v12 +
        v13 +
        v14 +
        v15 +
        v16 +
        v17 +
        v18 +
        v19 +
        v20 +
        v21 +
        v22 +
        v23 +
        v24 +
        v25 +
        v26 +
        v27
      );
    }
    return Object.defineProperty(made, "name", { value: name });
  },
];

for (const fails of [true, false, true]) {
  flag.fails = fails;
  for (const one of classes)
    console.log(
      fails,
      one.name,
      framesOf(() => new one().sum),
    );
  for (const [index, factory] of factories.entries()) {
    const [first, second] = [factory(`first${index}`), factory(`second${index}`)];
    console.log(fails, index, framesOf(first), "|", framesOf(second), "|", framesOf(first));
  }
}
