// Each line: where the caller of a function stands whose last statement is an expression that nobody takes, over a variable that is used once; and the frame under the conversion of a list that is written over several lines.
const show = (label, error) =>
  console.log(
    label +
      " | " +
      String(error && error.message) +
      " | " +
      String(error && error.stack)
        .split("\n")
        .slice(1, 6)
        .map(line => line.trim().replace(/\(?[^ (]*[\\/]([^\\/ ]+:\d+:\d+)\)?/, "$1"))
        .join(" < "),
  );
function fail() {
  throw new Error("fail");
}
const thing = {
  toString() {
    throw new Error("thing");
  },
};
function a1() {
  (function () {
    fail();
    const v = 564;
    565 | v;
  })();
}
function a2() {
  (function () {
    fail();
    const v = 564;
    v;
  })();
}
function a3() {
  (function () {
    fail();
    const v = 564;
    -v;
  })();
}
function a4() {
  (function () {
    fail();
    const v = 564;
    565 | v;
    3;
  })();
}
function a5() {
  (function () {
    fail();
    const v = "x";
    v + "y";
  })();
}
// prettier-ignore
function b1() {
  return `${[
    (function () { return 1; })(),
    thing,
  ]}`;
}
// prettier-ignore
function b2() {
  return `${[
    1,
    thing,
  ]}`;
}
// prettier-ignore
function b3() {
  return `${[(function () { return 1; })(), thing]}`;
}
// prettier-ignore
function b4() {
  return String([
    (function () { return 1; })(),
    thing,
  ]);
}
// prettier-ignore
function b5() {
  return "" + [
    (function () { return 1; })(),
    thing,
  ];
}
for (const f of [a1, a2, a3, a4, a5, b1, b2, b3, b4, b5]) {
  try {
    f();
    console.log(f.name, "no error");
  } catch (error) {
    show(f.name, error);
  }
}
const more = [
  function c1() {
    (function () {
      fail();
      const v = 564;
      v === 1;
    })();
  },
  function c2() {
    (function () {
      fail();
      const v = 564;
      v == 1;
    })();
  },
  function c3() {
    (function () {
      fail();
      const v = 564;
      !v;
    })();
  },
  function c4() {
    (function () {
      fail();
      const v = 564;
      void v;
    })();
  },
  function c5() {
    (function () {
      fail();
      const v = 564;
      typeof v;
    })();
  },
  function c6() {
    (function () {
      fail();
      const v = 564;
      v && 1;
    })();
  },
  function c7() {
    (function () {
      fail();
      const v = 564;
      (v, 1);
    })();
  },
  function c8() {
    (function () {
      fail();
      const v = 564;
      1 + v;
    })();
  },
  function c9() {
    (function () {
      fail();
      const v = 564;
      v * 2;
    })();
  },
  function c10() {
    (function () {
      fail();
      const v = "x";
      "y" + v;
    })();
  },
  function c11() {
    (function () {
      fail();
      const v = "x";
      `${v}`;
    })();
  },
  function c12() {
    (function () {
      fail();
      const v = 564;
      v ? 1 : 2;
    })();
  },
  function c13() {
    (function () {
      fail();
      const v = 564;
      1 ? v : 2;
    })();
  },
  function c14() {
    (function () {
      fail();
      const v = 564;
      v | 565;
    })();
  },
  function c15() {
    (function () {
      fail();
      const v = 564;
      !(v | 565);
    })();
  },
  function c16() {
    (function () {
      fail();
      const v = 564;
      v < 565;
    })();
  },
  function c17() {
    (function () {
      fail();
      const v = "x";
      v + "y" + "z";
    })();
  },
  function c18() {
    (function () {
      fail();
      const v = "x";
      v + 1;
    })();
  },
  function c19() {
    (function () {
      fail();
      const v = 1;
      v + "y";
    })();
  },
  function c20() {
    (function () {
      const v = 564;
      fail();
      565 | v;
    })();
  },
  function c21() {
    (function () {
      fail();
      const v = 564;
      1 !== v;
    })();
  },
  function c22() {
    (function () {
      fail();
      const v = 564;
      v ?? 1;
    })();
  },
  function c23() {
    (function () {
      fail();
      const v = 564;
      ~v;
    })();
  },
  function c24() {
    (function () {
      fail();
      const v = 564;
      +v;
    })();
  },
];
for (const f of more) {
  try {
    f();
    console.log(f.name, "no error");
  } catch (error) {
    show(f.name, error);
  }
}
