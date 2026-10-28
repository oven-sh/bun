{
  function make(i) {
    const o = {};
    o.x = i & 1 ? "red" : "green";
    o.y = "s" + i;
    o.b = i & 1 ? "t" + i : i + 0.5;
    return o;
  }

  function read(o) {
    const out = [];
    out.push(typeof o.x);
    out.push(o.x == null);
    out.push(o.x === undefined);
    out.push(o.x === null);
    out.push(o.x ?? "nullish");
    out.push(o.x?.length);
    out.push(o.x?.v);
    out.push(!o.x);
    out.push(o.x ? 1 : 0);
    out.push(o.x === "red" ? 1 : o.x === "green" ? 2 : o.x === "on" ? 3 : 4);
    out.push(
      typeof o.x === "string"
        ? o.x.length
        : typeof o.x === "number"
          ? o.x + 1
          : typeof o.x === "boolean"
            ? !o.x
            : "other",
    );
    out.push([o.x].length);
    out.push(Object.is(o.x, undefined));
    try {
      out.push(o.x.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x + "!");
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x.charCodeAt(0));
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x === "red" ? "R" : "G");
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.y);
    out.push(o.y == null);
    out.push(o.y === undefined);
    out.push(o.y === null);
    out.push(o.y ?? "nullish");
    out.push(o.y?.length);
    out.push(o.y?.v);
    out.push(!o.y);
    out.push(o.y ? 1 : 0);
    out.push(o.y === "red" ? 1 : o.y === "green" ? 2 : o.y === "on" ? 3 : 4);
    out.push(
      typeof o.y === "string"
        ? o.y.length
        : typeof o.y === "number"
          ? o.y + 1
          : typeof o.y === "boolean"
            ? !o.y
            : "other",
    );
    out.push([o.y].length);
    out.push(Object.is(o.y, undefined));
    try {
      out.push(o.y.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.y + "!");
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.y.charCodeAt(0));
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.b);
    out.push(o.b == null);
    out.push(o.b === undefined);
    out.push(o.b === null);
    out.push(o.b ?? "nullish");
    out.push(o.b?.length);
    out.push(o.b?.v);
    out.push(!o.b);
    out.push(o.b ? 1 : 0);
    out.push(o.b === "red" ? 1 : o.b === "green" ? 2 : o.b === "on" ? 3 : 4);
    out.push(
      typeof o.b === "string"
        ? o.b.length
        : typeof o.b === "number"
          ? o.b + 1
          : typeof o.b === "boolean"
            ? !o.b
            : "other",
    );
    out.push([o.b].length);
    out.push(Object.is(o.b, undefined));
    try {
      out.push(typeof o.b === "string" ? o.b.length : o.b * 2);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.b + "!");
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(JSON.stringify(o));
    } catch (e) {
      out.push("no json");
    }
    out.push(Object.keys(o).join());
    return out.map(String).join(" ");
  }
  function sum(o) {
    let t = "";
    for (let i = 0; i < 3; i++) {
      try {
        t += o.x.length;
      } catch {
        t += "!";
      }
      try {
        t += o.y.length;
      } catch {
        t += "!";
      }
      try {
        t += typeof o.b === "string" ? o.b.length : o.b * 2;
      } catch {
        t += "!";
      }
    }
    return t;
  }

  const all = [];
  for (let i = 0; i < 4; i++) all.push(make(i));
  for (const o of all) console.log(read(o), sum(o));
  {
    const o = all[1];
    new Function("o", [...";)} denifednu :b ,llun :y ,denifednu :x { ,o(ngissa.tcejbO  "].reverse().join(""))(o);
  }
  for (const o of all) console.log(read(o), sum(o));
  const again = make(9);
  console.log(read(again), sum(again));
}
{
  let i = 0;
  class P {
    x = i & 1 ? "red" : "green";
    y = "s" + i;
    b = i & 1 ? "t" + i : i + 0.5;
  }
  function make(n) {
    i = n;
    return new P();
  }

  function read(o) {
    const out = [];
    out.push(typeof o.x);
    out.push(o.x == null);
    out.push(o.x === undefined);
    out.push(o.x === null);
    out.push(o.x ?? "nullish");
    out.push(o.x?.length);
    out.push(o.x?.v);
    out.push(!o.x);
    out.push(o.x ? 1 : 0);
    out.push(o.x === "red" ? 1 : o.x === "green" ? 2 : o.x === "on" ? 3 : 4);
    out.push(
      typeof o.x === "string"
        ? o.x.length
        : typeof o.x === "number"
          ? o.x + 1
          : typeof o.x === "boolean"
            ? !o.x
            : "other",
    );
    out.push([o.x].length);
    out.push(Object.is(o.x, undefined));
    try {
      out.push(o.x.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x + "!");
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x.charCodeAt(0));
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x === "red" ? "R" : "G");
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.y);
    out.push(o.y == null);
    out.push(o.y === undefined);
    out.push(o.y === null);
    out.push(o.y ?? "nullish");
    out.push(o.y?.length);
    out.push(o.y?.v);
    out.push(!o.y);
    out.push(o.y ? 1 : 0);
    out.push(o.y === "red" ? 1 : o.y === "green" ? 2 : o.y === "on" ? 3 : 4);
    out.push(
      typeof o.y === "string"
        ? o.y.length
        : typeof o.y === "number"
          ? o.y + 1
          : typeof o.y === "boolean"
            ? !o.y
            : "other",
    );
    out.push([o.y].length);
    out.push(Object.is(o.y, undefined));
    try {
      out.push(o.y.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.y + "!");
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.y.charCodeAt(0));
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.b);
    out.push(o.b == null);
    out.push(o.b === undefined);
    out.push(o.b === null);
    out.push(o.b ?? "nullish");
    out.push(o.b?.length);
    out.push(o.b?.v);
    out.push(!o.b);
    out.push(o.b ? 1 : 0);
    out.push(o.b === "red" ? 1 : o.b === "green" ? 2 : o.b === "on" ? 3 : 4);
    out.push(
      typeof o.b === "string"
        ? o.b.length
        : typeof o.b === "number"
          ? o.b + 1
          : typeof o.b === "boolean"
            ? !o.b
            : "other",
    );
    out.push([o.b].length);
    out.push(Object.is(o.b, undefined));
    try {
      out.push(typeof o.b === "string" ? o.b.length : o.b * 2);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.b + "!");
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(JSON.stringify(o));
    } catch (e) {
      out.push("no json");
    }
    out.push(Object.keys(o).join());
    return out.map(String).join(" ");
  }
  function sum(o) {
    let t = "";
    for (let i = 0; i < 3; i++) {
      try {
        t += o.x.length;
      } catch {
        t += "!";
      }
      try {
        t += o.y.length;
      } catch {
        t += "!";
      }
      try {
        t += typeof o.b === "string" ? o.b.length : o.b * 2;
      } catch {
        t += "!";
      }
    }
    return t;
  }

  const all = [];
  for (let i = 0; i < 4; i++) all.push(make(i));
  for (const o of all) console.log(read(o), sum(o));
  {
    const o = all[1];
    new Function(
      "o",
      [...';)denifednu ,"b" ,o(tes.tcelfeR ;)denifednu ,"y" ,o(tes.tcelfeR ;)llun ,"x" ,o(tes.tcelfeR  ']
        .reverse()
        .join(""),
    )(o);
  }
  for (const o of all) console.log(read(o), sum(o));
  const again = make(9);
  console.log(read(again), sum(again));
}
{
  class P {
    constructor(i) {
      this.x = i & 1 ? "red" : "green";
      this.y = "s" + i;
      this.b = i & 1 ? "t" + i : i + 0.5;
    }
  }
  function make(i) {
    return new P(i);
  }

  function read(o) {
    const out = [];
    out.push(typeof o.x);
    out.push(o.x == null);
    out.push(o.x === undefined);
    out.push(o.x === null);
    out.push(o.x ?? "nullish");
    out.push(o.x?.length);
    out.push(o.x?.v);
    out.push(!o.x);
    out.push(o.x ? 1 : 0);
    out.push(o.x === "red" ? 1 : o.x === "green" ? 2 : o.x === "on" ? 3 : 4);
    out.push(
      typeof o.x === "string"
        ? o.x.length
        : typeof o.x === "number"
          ? o.x + 1
          : typeof o.x === "boolean"
            ? !o.x
            : "other",
    );
    out.push([o.x].length);
    out.push(Object.is(o.x, undefined));
    try {
      out.push(o.x.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x + "!");
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x.charCodeAt(0));
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x === "red" ? "R" : "G");
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.y);
    out.push(o.y == null);
    out.push(o.y === undefined);
    out.push(o.y === null);
    out.push(o.y ?? "nullish");
    out.push(o.y?.length);
    out.push(o.y?.v);
    out.push(!o.y);
    out.push(o.y ? 1 : 0);
    out.push(o.y === "red" ? 1 : o.y === "green" ? 2 : o.y === "on" ? 3 : 4);
    out.push(
      typeof o.y === "string"
        ? o.y.length
        : typeof o.y === "number"
          ? o.y + 1
          : typeof o.y === "boolean"
            ? !o.y
            : "other",
    );
    out.push([o.y].length);
    out.push(Object.is(o.y, undefined));
    try {
      out.push(o.y.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.y + "!");
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.y.charCodeAt(0));
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.b);
    out.push(o.b == null);
    out.push(o.b === undefined);
    out.push(o.b === null);
    out.push(o.b ?? "nullish");
    out.push(o.b?.length);
    out.push(o.b?.v);
    out.push(!o.b);
    out.push(o.b ? 1 : 0);
    out.push(o.b === "red" ? 1 : o.b === "green" ? 2 : o.b === "on" ? 3 : 4);
    out.push(
      typeof o.b === "string"
        ? o.b.length
        : typeof o.b === "number"
          ? o.b + 1
          : typeof o.b === "boolean"
            ? !o.b
            : "other",
    );
    out.push([o.b].length);
    out.push(Object.is(o.b, undefined));
    try {
      out.push(typeof o.b === "string" ? o.b.length : o.b * 2);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.b + "!");
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(JSON.stringify(o));
    } catch (e) {
      out.push("no json");
    }
    out.push(Object.keys(o).join());
    return out.map(String).join(" ");
  }
  function sum(o) {
    let t = "";
    for (let i = 0; i < 3; i++) {
      try {
        t += o.x.length;
      } catch {
        t += "!";
      }
      try {
        t += o.y.length;
      } catch {
        t += "!";
      }
      try {
        t += typeof o.b === "string" ? o.b.length : o.b * 2;
      } catch {
        t += "!";
      }
    }
    return t;
  }

  const all = [];
  for (let i = 0; i < 4; i++) all.push(make(i));
  for (const o of all) console.log(read(o), sum(o));
  {
    const o = all[1];
    new Function("o", [...';denifednu : llun ? "y" === k = ]k[o ))o(syek.tcejbO fo k tsnoc( rof  '].reverse().join(""))(
      o,
    );
  }
  for (const o of all) console.log(read(o), sum(o));
  const again = make(9);
  console.log(read(again), sum(again));
}
{
  function make(i) {
    return { x: i & 1 ? "red" : "green", y: "s" + i, b: i & 1 ? "t" + i : i + 0.5 };
  }

  function read(o) {
    const out = [];
    out.push(typeof o.x);
    out.push(o.x == null);
    out.push(o.x === undefined);
    out.push(o.x === null);
    out.push(o.x ?? "nullish");
    out.push(o.x?.length);
    out.push(o.x?.v);
    out.push(!o.x);
    out.push(o.x ? 1 : 0);
    out.push(o.x === "red" ? 1 : o.x === "green" ? 2 : o.x === "on" ? 3 : 4);
    out.push(
      typeof o.x === "string"
        ? o.x.length
        : typeof o.x === "number"
          ? o.x + 1
          : typeof o.x === "boolean"
            ? !o.x
            : "other",
    );
    out.push([o.x].length);
    out.push(Object.is(o.x, undefined));
    try {
      out.push(o.x.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x + "!");
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x.charCodeAt(0));
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x === "red" ? "R" : "G");
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.y);
    out.push(o.y == null);
    out.push(o.y === undefined);
    out.push(o.y === null);
    out.push(o.y ?? "nullish");
    out.push(o.y?.length);
    out.push(o.y?.v);
    out.push(!o.y);
    out.push(o.y ? 1 : 0);
    out.push(o.y === "red" ? 1 : o.y === "green" ? 2 : o.y === "on" ? 3 : 4);
    out.push(
      typeof o.y === "string"
        ? o.y.length
        : typeof o.y === "number"
          ? o.y + 1
          : typeof o.y === "boolean"
            ? !o.y
            : "other",
    );
    out.push([o.y].length);
    out.push(Object.is(o.y, undefined));
    try {
      out.push(o.y.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.y + "!");
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.y.charCodeAt(0));
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.b);
    out.push(o.b == null);
    out.push(o.b === undefined);
    out.push(o.b === null);
    out.push(o.b ?? "nullish");
    out.push(o.b?.length);
    out.push(o.b?.v);
    out.push(!o.b);
    out.push(o.b ? 1 : 0);
    out.push(o.b === "red" ? 1 : o.b === "green" ? 2 : o.b === "on" ? 3 : 4);
    out.push(
      typeof o.b === "string"
        ? o.b.length
        : typeof o.b === "number"
          ? o.b + 1
          : typeof o.b === "boolean"
            ? !o.b
            : "other",
    );
    out.push([o.b].length);
    out.push(Object.is(o.b, undefined));
    try {
      out.push(typeof o.b === "string" ? o.b.length : o.b * 2);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.b + "!");
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(JSON.stringify(o));
    } catch (e) {
      out.push("no json");
    }
    out.push(Object.keys(o).join());
    return out.map(String).join(" ");
  }
  function sum(o) {
    let t = "";
    for (let i = 0; i < 3; i++) {
      try {
        t += o.x.length;
      } catch {
        t += "!";
      }
      try {
        t += o.y.length;
      } catch {
        t += "!";
      }
      try {
        t += typeof o.b === "string" ? o.b.length : o.b * 2;
      } catch {
        t += "!";
      }
    }
    return t;
  }

  const all = [];
  for (let i = 0; i < 4; i++) all.push(make(i));
  for (const o of all) console.log(read(o), sum(o));
  {
    const o = all[1];
    new Function(
      "o",
      [
        ...';)} llun :eulav { ,"b" ,o(ytreporPenifed.tcejbO ;)} denifednu :eulav { ,"y" ,o(ytreporPenifed.tcejbO ;)} llun :eulav { ,"x" ,o(ytreporPenifed.tcejbO  ',
      ]
        .reverse()
        .join(""),
    )(o);
  }
  for (const o of all) console.log(read(o), sum(o));
  const again = make(9);
  console.log(read(again), sum(again));
}
{
  function make(i) {
    const o = { y: "s" + i };
    if (i & 1) {
      o.x = i & 1 ? "red" : "green";
      o.b = i & 1 ? "t" + i : i + 0.5;
    }
    return o;
  }

  function read(o) {
    const out = [];
    out.push(typeof o.x);
    out.push(o.x == null);
    out.push(o.x === undefined);
    out.push(o.x === null);
    out.push(o.x ?? "nullish");
    out.push(o.x?.length);
    out.push(o.x?.v);
    out.push(!o.x);
    out.push(o.x ? 1 : 0);
    out.push(o.x === "red" ? 1 : o.x === "green" ? 2 : o.x === "on" ? 3 : 4);
    out.push(
      typeof o.x === "string"
        ? o.x.length
        : typeof o.x === "number"
          ? o.x + 1
          : typeof o.x === "boolean"
            ? !o.x
            : "other",
    );
    out.push([o.x].length);
    out.push(Object.is(o.x, undefined));
    try {
      out.push(o.x.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x + "!");
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x.charCodeAt(0));
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x === "red" ? "R" : "G");
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.y);
    out.push(o.y == null);
    out.push(o.y === undefined);
    out.push(o.y === null);
    out.push(o.y ?? "nullish");
    out.push(o.y?.length);
    out.push(o.y?.v);
    out.push(!o.y);
    out.push(o.y ? 1 : 0);
    out.push(o.y === "red" ? 1 : o.y === "green" ? 2 : o.y === "on" ? 3 : 4);
    out.push(
      typeof o.y === "string"
        ? o.y.length
        : typeof o.y === "number"
          ? o.y + 1
          : typeof o.y === "boolean"
            ? !o.y
            : "other",
    );
    out.push([o.y].length);
    out.push(Object.is(o.y, undefined));
    try {
      out.push(o.y.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.y + "!");
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.y.charCodeAt(0));
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.b);
    out.push(o.b == null);
    out.push(o.b === undefined);
    out.push(o.b === null);
    out.push(o.b ?? "nullish");
    out.push(o.b?.length);
    out.push(o.b?.v);
    out.push(!o.b);
    out.push(o.b ? 1 : 0);
    out.push(o.b === "red" ? 1 : o.b === "green" ? 2 : o.b === "on" ? 3 : 4);
    out.push(
      typeof o.b === "string"
        ? o.b.length
        : typeof o.b === "number"
          ? o.b + 1
          : typeof o.b === "boolean"
            ? !o.b
            : "other",
    );
    out.push([o.b].length);
    out.push(Object.is(o.b, undefined));
    try {
      out.push(typeof o.b === "string" ? o.b.length : o.b * 2);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.b + "!");
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(JSON.stringify(o));
    } catch (e) {
      out.push("no json");
    }
    out.push(Object.keys(o).join());
    return out.map(String).join(" ");
  }
  function sum(o) {
    let t = "";
    for (let i = 0; i < 3; i++) {
      try {
        t += o.x.length;
      } catch {
        t += "!";
      }
      try {
        t += o.y.length;
      } catch {
        t += "!";
      }
      try {
        t += typeof o.b === "string" ? o.b.length : o.b * 2;
      } catch {
        t += "!";
      }
    }
    return t;
  }

  const all = [];
  for (let i = 0; i < 4; i++) all.push(make(i));
  for (const o of all) console.log(read(o), sum(o));
  {
    const o = all[1];
    new Function("o", [...";denifednu = ]k[o ))o(seirtne.tcejbO fo ]k[ tsnoc( rof  "].reverse().join(""))(o);
  }
  for (const o of all) console.log(read(o), sum(o));
  const again = make(9);
  console.log(read(again), sum(again));
}
{
  function make(i) {
    const o = {};
    o.x = { v: i };
    o.y = () => i;
    o.b = BigInt(i);
    return o;
  }

  function read(o) {
    const out = [];
    out.push(typeof o.x);
    out.push(o.x == null);
    out.push(o.x === undefined);
    out.push(o.x === null);
    out.push(o.x ?? "nullish");
    out.push(o.x?.length);
    out.push(o.x?.v);
    out.push(!o.x);
    out.push(o.x ? 1 : 0);
    out.push(o.x === "red" ? 1 : o.x === "green" ? 2 : o.x === "on" ? 3 : 4);
    out.push(
      typeof o.x === "string"
        ? o.x.length
        : typeof o.x === "number"
          ? o.x + 1
          : typeof o.x === "boolean"
            ? !o.x
            : "other",
    );
    out.push([o.x].length);
    out.push(Object.is(o.x, undefined));
    try {
      out.push(o.x.v);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x.v + 1);
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.y);
    out.push(o.y == null);
    out.push(o.y === undefined);
    out.push(o.y === null);
    out.push(o.y ?? "nullish");
    out.push(o.y?.length);
    out.push(o.y?.v);
    out.push(!o.y);
    out.push(o.y ? 1 : 0);
    out.push(o.y === "red" ? 1 : o.y === "green" ? 2 : o.y === "on" ? 3 : 4);
    out.push(
      typeof o.y === "string"
        ? o.y.length
        : typeof o.y === "number"
          ? o.y + 1
          : typeof o.y === "boolean"
            ? !o.y
            : "other",
    );
    out.push([o.y].length);
    out.push(Object.is(o.y, undefined));
    try {
      out.push(o.y());
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.y.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.b);
    out.push(o.b == null);
    out.push(o.b === undefined);
    out.push(o.b === null);
    out.push(o.b ?? "nullish");
    out.push(o.b?.length);
    out.push(o.b?.v);
    out.push(!o.b);
    out.push(o.b ? 1 : 0);
    out.push(o.b === "red" ? 1 : o.b === "green" ? 2 : o.b === "on" ? 3 : 4);
    out.push(
      typeof o.b === "string"
        ? o.b.length
        : typeof o.b === "number"
          ? o.b + 1
          : typeof o.b === "boolean"
            ? !o.b
            : "other",
    );
    out.push([o.b].length);
    out.push(Object.is(o.b, undefined));
    try {
      out.push(o.b + 1n);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.b * 2n);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.b.toString());
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(JSON.stringify(o));
    } catch (e) {
      out.push("no json");
    }
    out.push(Object.keys(o).join());
    return out.map(String).join(" ");
  }
  function sum(o) {
    let t = "";
    for (let i = 0; i < 3; i++) {
      try {
        t += o.x.v;
      } catch {
        t += "!";
      }
      try {
        t += o.y();
      } catch {
        t += "!";
      }
      try {
        t += o.b + 1n;
      } catch {
        t += "!";
      }
    }
    return t;
  }

  const all = [];
  for (let i = 0; i < 4; i++) all.push(make(i));
  for (const o of all) console.log(read(o), sum(o));
  {
    const o = all[1];
    new Function("o", [...";)} denifednu :c { = } b.o :d ,y.o :c ,x.o :a {(  "].reverse().join(""))(o);
  }
  for (const o of all) console.log(read(o), sum(o));
  const again = make(9);
  console.log(read(again), sum(again));
}
{
  let i = 0;
  class P {
    x = { v: i };
    y = () => i;
    b = BigInt(i);
  }
  function make(n) {
    i = n;
    return new P();
  }

  function read(o) {
    const out = [];
    out.push(typeof o.x);
    out.push(o.x == null);
    out.push(o.x === undefined);
    out.push(o.x === null);
    out.push(o.x ?? "nullish");
    out.push(o.x?.length);
    out.push(o.x?.v);
    out.push(!o.x);
    out.push(o.x ? 1 : 0);
    out.push(o.x === "red" ? 1 : o.x === "green" ? 2 : o.x === "on" ? 3 : 4);
    out.push(
      typeof o.x === "string"
        ? o.x.length
        : typeof o.x === "number"
          ? o.x + 1
          : typeof o.x === "boolean"
            ? !o.x
            : "other",
    );
    out.push([o.x].length);
    out.push(Object.is(o.x, undefined));
    try {
      out.push(o.x.v);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x.v + 1);
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.y);
    out.push(o.y == null);
    out.push(o.y === undefined);
    out.push(o.y === null);
    out.push(o.y ?? "nullish");
    out.push(o.y?.length);
    out.push(o.y?.v);
    out.push(!o.y);
    out.push(o.y ? 1 : 0);
    out.push(o.y === "red" ? 1 : o.y === "green" ? 2 : o.y === "on" ? 3 : 4);
    out.push(
      typeof o.y === "string"
        ? o.y.length
        : typeof o.y === "number"
          ? o.y + 1
          : typeof o.y === "boolean"
            ? !o.y
            : "other",
    );
    out.push([o.y].length);
    out.push(Object.is(o.y, undefined));
    try {
      out.push(o.y());
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.y.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.b);
    out.push(o.b == null);
    out.push(o.b === undefined);
    out.push(o.b === null);
    out.push(o.b ?? "nullish");
    out.push(o.b?.length);
    out.push(o.b?.v);
    out.push(!o.b);
    out.push(o.b ? 1 : 0);
    out.push(o.b === "red" ? 1 : o.b === "green" ? 2 : o.b === "on" ? 3 : 4);
    out.push(
      typeof o.b === "string"
        ? o.b.length
        : typeof o.b === "number"
          ? o.b + 1
          : typeof o.b === "boolean"
            ? !o.b
            : "other",
    );
    out.push([o.b].length);
    out.push(Object.is(o.b, undefined));
    try {
      out.push(o.b + 1n);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.b * 2n);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.b.toString());
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(JSON.stringify(o));
    } catch (e) {
      out.push("no json");
    }
    out.push(Object.keys(o).join());
    return out.map(String).join(" ");
  }
  function sum(o) {
    let t = "";
    for (let i = 0; i < 3; i++) {
      try {
        t += o.x.v;
      } catch {
        t += "!";
      }
      try {
        t += o.y();
      } catch {
        t += "!";
      }
      try {
        t += o.b + 1n;
      } catch {
        t += "!";
      }
    }
    return t;
  }

  const all = [];
  for (let i = 0; i < 4; i++) all.push(make(i));
  for (const o of all) console.log(read(o), sum(o));
  {
    const o = all[1];
    new Function(
      "o",
      [
        ...' ;)o(llac.s ;tes.)"v" ,} } ;a = b.siht ;a = y.siht ;a = x.siht { )a(v tes {(rotpircseDytreporPnwOteg.tcejbO = s tsnoc  ',
      ]
        .reverse()
        .join(""),
    )(o);
  }
  for (const o of all) console.log(read(o), sum(o));
  const again = make(9);
  console.log(read(again), sum(again));
}
{
  class P {
    constructor(i) {
      this.x = { v: i };
      this.y = () => i;
      this.b = BigInt(i);
    }
  }
  function make(i) {
    return new P(i);
  }

  function read(o) {
    const out = [];
    out.push(typeof o.x);
    out.push(o.x == null);
    out.push(o.x === undefined);
    out.push(o.x === null);
    out.push(o.x ?? "nullish");
    out.push(o.x?.length);
    out.push(o.x?.v);
    out.push(!o.x);
    out.push(o.x ? 1 : 0);
    out.push(o.x === "red" ? 1 : o.x === "green" ? 2 : o.x === "on" ? 3 : 4);
    out.push(
      typeof o.x === "string"
        ? o.x.length
        : typeof o.x === "number"
          ? o.x + 1
          : typeof o.x === "boolean"
            ? !o.x
            : "other",
    );
    out.push([o.x].length);
    out.push(Object.is(o.x, undefined));
    try {
      out.push(o.x.v);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x.v + 1);
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.y);
    out.push(o.y == null);
    out.push(o.y === undefined);
    out.push(o.y === null);
    out.push(o.y ?? "nullish");
    out.push(o.y?.length);
    out.push(o.y?.v);
    out.push(!o.y);
    out.push(o.y ? 1 : 0);
    out.push(o.y === "red" ? 1 : o.y === "green" ? 2 : o.y === "on" ? 3 : 4);
    out.push(
      typeof o.y === "string"
        ? o.y.length
        : typeof o.y === "number"
          ? o.y + 1
          : typeof o.y === "boolean"
            ? !o.y
            : "other",
    );
    out.push([o.y].length);
    out.push(Object.is(o.y, undefined));
    try {
      out.push(o.y());
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.y.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.b);
    out.push(o.b == null);
    out.push(o.b === undefined);
    out.push(o.b === null);
    out.push(o.b ?? "nullish");
    out.push(o.b?.length);
    out.push(o.b?.v);
    out.push(!o.b);
    out.push(o.b ? 1 : 0);
    out.push(o.b === "red" ? 1 : o.b === "green" ? 2 : o.b === "on" ? 3 : 4);
    out.push(
      typeof o.b === "string"
        ? o.b.length
        : typeof o.b === "number"
          ? o.b + 1
          : typeof o.b === "boolean"
            ? !o.b
            : "other",
    );
    out.push([o.b].length);
    out.push(Object.is(o.b, undefined));
    try {
      out.push(o.b + 1n);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.b * 2n);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.b.toString());
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(JSON.stringify(o));
    } catch (e) {
      out.push("no json");
    }
    out.push(Object.keys(o).join());
    return out.map(String).join(" ");
  }
  function sum(o) {
    let t = "";
    for (let i = 0; i < 3; i++) {
      try {
        t += o.x.v;
      } catch {
        t += "!";
      }
      try {
        t += o.y();
      } catch {
        t += "!";
      }
      try {
        t += o.b + 1n;
      } catch {
        t += "!";
      }
    }
    return t;
  }

  const all = [];
  for (let i = 0; i < 4; i++) all.push(make(i));
  for (const o of all) console.log(read(o), sum(o));
  {
    const o = all[1];
    new Function("o", [...";)} 0 diov :b ,denifednu :y ,0 diov :x ,o... { ,o(ngissa.tcejbO  "].reverse().join(""))(o);
  }
  for (const o of all) console.log(read(o), sum(o));
  const again = make(9);
  console.log(read(again), sum(again));
}
{
  function make(i) {
    return { x: { v: i }, y: () => i, b: BigInt(i) };
  }

  function read(o) {
    const out = [];
    out.push(typeof o.x);
    out.push(o.x == null);
    out.push(o.x === undefined);
    out.push(o.x === null);
    out.push(o.x ?? "nullish");
    out.push(o.x?.length);
    out.push(o.x?.v);
    out.push(!o.x);
    out.push(o.x ? 1 : 0);
    out.push(o.x === "red" ? 1 : o.x === "green" ? 2 : o.x === "on" ? 3 : 4);
    out.push(
      typeof o.x === "string"
        ? o.x.length
        : typeof o.x === "number"
          ? o.x + 1
          : typeof o.x === "boolean"
            ? !o.x
            : "other",
    );
    out.push([o.x].length);
    out.push(Object.is(o.x, undefined));
    try {
      out.push(o.x.v);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x.v + 1);
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.y);
    out.push(o.y == null);
    out.push(o.y === undefined);
    out.push(o.y === null);
    out.push(o.y ?? "nullish");
    out.push(o.y?.length);
    out.push(o.y?.v);
    out.push(!o.y);
    out.push(o.y ? 1 : 0);
    out.push(o.y === "red" ? 1 : o.y === "green" ? 2 : o.y === "on" ? 3 : 4);
    out.push(
      typeof o.y === "string"
        ? o.y.length
        : typeof o.y === "number"
          ? o.y + 1
          : typeof o.y === "boolean"
            ? !o.y
            : "other",
    );
    out.push([o.y].length);
    out.push(Object.is(o.y, undefined));
    try {
      out.push(o.y());
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.y.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.b);
    out.push(o.b == null);
    out.push(o.b === undefined);
    out.push(o.b === null);
    out.push(o.b ?? "nullish");
    out.push(o.b?.length);
    out.push(o.b?.v);
    out.push(!o.b);
    out.push(o.b ? 1 : 0);
    out.push(o.b === "red" ? 1 : o.b === "green" ? 2 : o.b === "on" ? 3 : 4);
    out.push(
      typeof o.b === "string"
        ? o.b.length
        : typeof o.b === "number"
          ? o.b + 1
          : typeof o.b === "boolean"
            ? !o.b
            : "other",
    );
    out.push([o.b].length);
    out.push(Object.is(o.b, undefined));
    try {
      out.push(o.b + 1n);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.b * 2n);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.b.toString());
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(JSON.stringify(o));
    } catch (e) {
      out.push("no json");
    }
    out.push(Object.keys(o).join());
    return out.map(String).join(" ");
  }
  function sum(o) {
    let t = "";
    for (let i = 0; i < 3; i++) {
      try {
        t += o.x.v;
      } catch {
        t += "!";
      }
      try {
        t += o.y();
      } catch {
        t += "!";
      }
      try {
        t += o.b + 1n;
      } catch {
        t += "!";
      }
    }
    return t;
  }

  const all = [];
  for (let i = 0; i < 4; i++) all.push(make(i));
  for (const o of all) console.log(read(o), sum(o));
  {
    const o = all[1];
    new Function(
      "o",
      [
        ...";)o(llac.m.h ;} } ;denifednu = b.repus ;llun = y.repus ;denifednu = x.repus { )(m ,}{ :__otorp__ { = h tsnoc  ",
      ]
        .reverse()
        .join(""),
    )(o);
  }
  for (const o of all) console.log(read(o), sum(o));
  const again = make(9);
  console.log(read(again), sum(again));
}
{
  function make(i) {
    const o = { y: () => i };
    if (i & 1) {
      o.x = { v: i };
      o.b = BigInt(i);
    }
    return o;
  }

  function read(o) {
    const out = [];
    out.push(typeof o.x);
    out.push(o.x == null);
    out.push(o.x === undefined);
    out.push(o.x === null);
    out.push(o.x ?? "nullish");
    out.push(o.x?.length);
    out.push(o.x?.v);
    out.push(!o.x);
    out.push(o.x ? 1 : 0);
    out.push(o.x === "red" ? 1 : o.x === "green" ? 2 : o.x === "on" ? 3 : 4);
    out.push(
      typeof o.x === "string"
        ? o.x.length
        : typeof o.x === "number"
          ? o.x + 1
          : typeof o.x === "boolean"
            ? !o.x
            : "other",
    );
    out.push([o.x].length);
    out.push(Object.is(o.x, undefined));
    try {
      out.push(o.x.v);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x.v + 1);
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.y);
    out.push(o.y == null);
    out.push(o.y === undefined);
    out.push(o.y === null);
    out.push(o.y ?? "nullish");
    out.push(o.y?.length);
    out.push(o.y?.v);
    out.push(!o.y);
    out.push(o.y ? 1 : 0);
    out.push(o.y === "red" ? 1 : o.y === "green" ? 2 : o.y === "on" ? 3 : 4);
    out.push(
      typeof o.y === "string"
        ? o.y.length
        : typeof o.y === "number"
          ? o.y + 1
          : typeof o.y === "boolean"
            ? !o.y
            : "other",
    );
    out.push([o.y].length);
    out.push(Object.is(o.y, undefined));
    try {
      out.push(o.y());
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.y.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.b);
    out.push(o.b == null);
    out.push(o.b === undefined);
    out.push(o.b === null);
    out.push(o.b ?? "nullish");
    out.push(o.b?.length);
    out.push(o.b?.v);
    out.push(!o.b);
    out.push(o.b ? 1 : 0);
    out.push(o.b === "red" ? 1 : o.b === "green" ? 2 : o.b === "on" ? 3 : 4);
    out.push(
      typeof o.b === "string"
        ? o.b.length
        : typeof o.b === "number"
          ? o.b + 1
          : typeof o.b === "boolean"
            ? !o.b
            : "other",
    );
    out.push([o.b].length);
    out.push(Object.is(o.b, undefined));
    try {
      out.push(o.b + 1n);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.b * 2n);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.b.toString());
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(JSON.stringify(o));
    } catch (e) {
      out.push("no json");
    }
    out.push(Object.keys(o).join());
    return out.map(String).join(" ");
  }
  function sum(o) {
    let t = "";
    for (let i = 0; i < 3; i++) {
      try {
        t += o.x.v;
      } catch {
        t += "!";
      }
      try {
        t += o.y();
      } catch {
        t += "!";
      }
      try {
        t += o.b + 1n;
      } catch {
        t += "!";
      }
    }
    return t;
  }

  const all = [];
  for (let i = 0; i < 4; i++) all.push(make(i));
  for (const o of all) console.log(read(o), sum(o));
  {
    const o = all[1];
    new Function(
      "o",
      [...';)o()"} ;denifednu = b ;denifednu = y ;llun = x { )o( htiw" ,"o"(noitcnuF wen  '].reverse().join(""),
    )(o);
  }
  for (const o of all) console.log(read(o), sum(o));
  const again = make(9);
  console.log(read(again), sum(again));
}
{
  function make(i) {
    const o = {};
    o.x = i & 1 ? "u" + i : undefined;
    o.y = i & 1 ? { v: i } : null;
    o.b = i & 1 ? true : "no";
    return o;
  }

  function read(o) {
    const out = [];
    out.push(typeof o.x);
    out.push(o.x == null);
    out.push(o.x === undefined);
    out.push(o.x === null);
    out.push(o.x ?? "nullish");
    out.push(o.x?.length);
    out.push(o.x?.v);
    out.push(!o.x);
    out.push(o.x ? 1 : 0);
    out.push(o.x === "red" ? 1 : o.x === "green" ? 2 : o.x === "on" ? 3 : 4);
    out.push(
      typeof o.x === "string"
        ? o.x.length
        : typeof o.x === "number"
          ? o.x + 1
          : typeof o.x === "boolean"
            ? !o.x
            : "other",
    );
    out.push([o.x].length);
    out.push(Object.is(o.x, undefined));
    try {
      out.push(o.x === undefined ? -1 : o.x.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x !== undefined ? o.x + "!" : "none");
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.y);
    out.push(o.y == null);
    out.push(o.y === undefined);
    out.push(o.y === null);
    out.push(o.y ?? "nullish");
    out.push(o.y?.length);
    out.push(o.y?.v);
    out.push(!o.y);
    out.push(o.y ? 1 : 0);
    out.push(o.y === "red" ? 1 : o.y === "green" ? 2 : o.y === "on" ? 3 : 4);
    out.push(
      typeof o.y === "string"
        ? o.y.length
        : typeof o.y === "number"
          ? o.y + 1
          : typeof o.y === "boolean"
            ? !o.y
            : "other",
    );
    out.push([o.y].length);
    out.push(Object.is(o.y, undefined));
    try {
      out.push(o.y === null ? -1 : o.y.v);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.y !== null ? o.y.v + 1 : "none");
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.b);
    out.push(o.b == null);
    out.push(o.b === undefined);
    out.push(o.b === null);
    out.push(o.b ?? "nullish");
    out.push(o.b?.length);
    out.push(o.b?.v);
    out.push(!o.b);
    out.push(o.b ? 1 : 0);
    out.push(o.b === "red" ? 1 : o.b === "green" ? 2 : o.b === "on" ? 3 : 4);
    out.push(
      typeof o.b === "string"
        ? o.b.length
        : typeof o.b === "number"
          ? o.b + 1
          : typeof o.b === "boolean"
            ? !o.b
            : "other",
    );
    out.push([o.b].length);
    out.push(Object.is(o.b, undefined));
    try {
      out.push(typeof o.b === "string" ? o.b.length : o.b ? 1 : 0);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(typeof o.b === "boolean" ? !o.b : o.b + "!");
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(JSON.stringify(o));
    } catch (e) {
      out.push("no json");
    }
    out.push(Object.keys(o).join());
    return out.map(String).join(" ");
  }
  function sum(o) {
    let t = "";
    for (let i = 0; i < 3; i++) {
      try {
        t += o.x === undefined ? -1 : o.x.length;
      } catch {
        t += "!";
      }
      try {
        t += o.y === null ? -1 : o.y.v;
      } catch {
        t += "!";
      }
      try {
        t += typeof o.b === "string" ? o.b.length : o.b ? 1 : 0;
      } catch {
        t += "!";
      }
    }
    return t;
  }

  const all = [];
  for (let i = 0; i < 4; i++) all.push(make(i));
  for (const o of all) console.log(read(o), sum(o));
  {
    const o = all[1];
    new Function(
      "o",
      [...";llun =|| b.o ;denifednu =&& b.o ;llun =&& y.o ;llun =|| y.o ;denifednu =&& x.o  "].reverse().join(""),
    )(o);
  }
  for (const o of all) console.log(read(o), sum(o));
  const again = make(9);
  console.log(read(again), sum(again));
}
{
  let i = 0;
  class P {
    x = i & 1 ? "u" + i : undefined;
    y = i & 1 ? { v: i } : null;
    b = i & 1 ? true : "no";
  }
  function make(n) {
    i = n;
    return new P();
  }

  function read(o) {
    const out = [];
    out.push(typeof o.x);
    out.push(o.x == null);
    out.push(o.x === undefined);
    out.push(o.x === null);
    out.push(o.x ?? "nullish");
    out.push(o.x?.length);
    out.push(o.x?.v);
    out.push(!o.x);
    out.push(o.x ? 1 : 0);
    out.push(o.x === "red" ? 1 : o.x === "green" ? 2 : o.x === "on" ? 3 : 4);
    out.push(
      typeof o.x === "string"
        ? o.x.length
        : typeof o.x === "number"
          ? o.x + 1
          : typeof o.x === "boolean"
            ? !o.x
            : "other",
    );
    out.push([o.x].length);
    out.push(Object.is(o.x, undefined));
    try {
      out.push(o.x === undefined ? -1 : o.x.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x !== undefined ? o.x + "!" : "none");
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.y);
    out.push(o.y == null);
    out.push(o.y === undefined);
    out.push(o.y === null);
    out.push(o.y ?? "nullish");
    out.push(o.y?.length);
    out.push(o.y?.v);
    out.push(!o.y);
    out.push(o.y ? 1 : 0);
    out.push(o.y === "red" ? 1 : o.y === "green" ? 2 : o.y === "on" ? 3 : 4);
    out.push(
      typeof o.y === "string"
        ? o.y.length
        : typeof o.y === "number"
          ? o.y + 1
          : typeof o.y === "boolean"
            ? !o.y
            : "other",
    );
    out.push([o.y].length);
    out.push(Object.is(o.y, undefined));
    try {
      out.push(o.y === null ? -1 : o.y.v);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.y !== null ? o.y.v + 1 : "none");
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.b);
    out.push(o.b == null);
    out.push(o.b === undefined);
    out.push(o.b === null);
    out.push(o.b ?? "nullish");
    out.push(o.b?.length);
    out.push(o.b?.v);
    out.push(!o.b);
    out.push(o.b ? 1 : 0);
    out.push(o.b === "red" ? 1 : o.b === "green" ? 2 : o.b === "on" ? 3 : 4);
    out.push(
      typeof o.b === "string"
        ? o.b.length
        : typeof o.b === "number"
          ? o.b + 1
          : typeof o.b === "boolean"
            ? !o.b
            : "other",
    );
    out.push([o.b].length);
    out.push(Object.is(o.b, undefined));
    try {
      out.push(typeof o.b === "string" ? o.b.length : o.b ? 1 : 0);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(typeof o.b === "boolean" ? !o.b : o.b + "!");
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(JSON.stringify(o));
    } catch (e) {
      out.push("no json");
    }
    out.push(Object.keys(o).join());
    return out.map(String).join(" ");
  }
  function sum(o) {
    let t = "";
    for (let i = 0; i < 3; i++) {
      try {
        t += o.x === undefined ? -1 : o.x.length;
      } catch {
        t += "!";
      }
      try {
        t += o.y === null ? -1 : o.y.v;
      } catch {
        t += "!";
      }
      try {
        t += typeof o.b === "string" ? o.b.length : o.b ? 1 : 0;
      } catch {
        t += "!";
      }
    }
    return t;
  }

  const all = [];
  for (let i = 0; i < 4; i++) all.push(make(i));
  for (const o of all) console.log(read(o), sum(o));
  {
    const o = all[1];
    new Function("o", [...";)] ,[ fo b.o( rof ;)]denifednu[ fo y.o( rof ;)]llun[ fo x.o( rof  "].reverse().join(""))(o);
  }
  for (const o of all) console.log(read(o), sum(o));
  const again = make(9);
  console.log(read(again), sum(again));
}
{
  class P {
    constructor(i) {
      this.x = i & 1 ? "u" + i : undefined;
      this.y = i & 1 ? { v: i } : null;
      this.b = i & 1 ? true : "no";
    }
  }
  function make(i) {
    return new P(i);
  }

  function read(o) {
    const out = [];
    out.push(typeof o.x);
    out.push(o.x == null);
    out.push(o.x === undefined);
    out.push(o.x === null);
    out.push(o.x ?? "nullish");
    out.push(o.x?.length);
    out.push(o.x?.v);
    out.push(!o.x);
    out.push(o.x ? 1 : 0);
    out.push(o.x === "red" ? 1 : o.x === "green" ? 2 : o.x === "on" ? 3 : 4);
    out.push(
      typeof o.x === "string"
        ? o.x.length
        : typeof o.x === "number"
          ? o.x + 1
          : typeof o.x === "boolean"
            ? !o.x
            : "other",
    );
    out.push([o.x].length);
    out.push(Object.is(o.x, undefined));
    try {
      out.push(o.x === undefined ? -1 : o.x.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x !== undefined ? o.x + "!" : "none");
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.y);
    out.push(o.y == null);
    out.push(o.y === undefined);
    out.push(o.y === null);
    out.push(o.y ?? "nullish");
    out.push(o.y?.length);
    out.push(o.y?.v);
    out.push(!o.y);
    out.push(o.y ? 1 : 0);
    out.push(o.y === "red" ? 1 : o.y === "green" ? 2 : o.y === "on" ? 3 : 4);
    out.push(
      typeof o.y === "string"
        ? o.y.length
        : typeof o.y === "number"
          ? o.y + 1
          : typeof o.y === "boolean"
            ? !o.y
            : "other",
    );
    out.push([o.y].length);
    out.push(Object.is(o.y, undefined));
    try {
      out.push(o.y === null ? -1 : o.y.v);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.y !== null ? o.y.v + 1 : "none");
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.b);
    out.push(o.b == null);
    out.push(o.b === undefined);
    out.push(o.b === null);
    out.push(o.b ?? "nullish");
    out.push(o.b?.length);
    out.push(o.b?.v);
    out.push(!o.b);
    out.push(o.b ? 1 : 0);
    out.push(o.b === "red" ? 1 : o.b === "green" ? 2 : o.b === "on" ? 3 : 4);
    out.push(
      typeof o.b === "string"
        ? o.b.length
        : typeof o.b === "number"
          ? o.b + 1
          : typeof o.b === "boolean"
            ? !o.b
            : "other",
    );
    out.push([o.b].length);
    out.push(Object.is(o.b, undefined));
    try {
      out.push(typeof o.b === "string" ? o.b.length : o.b ? 1 : 0);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(typeof o.b === "boolean" ? !o.b : o.b + "!");
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(JSON.stringify(o));
    } catch (e) {
      out.push("no json");
    }
    out.push(Object.keys(o).join());
    return out.map(String).join(" ");
  }
  function sum(o) {
    let t = "";
    for (let i = 0; i < 3; i++) {
      try {
        t += o.x === undefined ? -1 : o.x.length;
      } catch {
        t += "!";
      }
      try {
        t += o.y === null ? -1 : o.y.v;
      } catch {
        t += "!";
      }
      try {
        t += typeof o.b === "string" ? o.b.length : o.b ? 1 : 0;
      } catch {
        t += "!";
      }
    }
    return t;
  }

  const all = [];
  for (let i = 0; i < 4; i++) all.push(make(i));
  for (const o of all) console.log(read(o), sum(o));
  {
    const o = all[1];
    new Function(
      "o",
      [..." ;)][ ,o(ylppa.w } ;a = b.siht ;c = y.siht ;a = x.siht { )c ,a(w noitcnuf  "].reverse().join(""),
    )(o);
  }
  for (const o of all) console.log(read(o), sum(o));
  const again = make(9);
  console.log(read(again), sum(again));
}
{
  function make(i) {
    return { x: i & 1 ? "u" + i : undefined, y: i & 1 ? { v: i } : null, b: i & 1 ? true : "no" };
  }

  function read(o) {
    const out = [];
    out.push(typeof o.x);
    out.push(o.x == null);
    out.push(o.x === undefined);
    out.push(o.x === null);
    out.push(o.x ?? "nullish");
    out.push(o.x?.length);
    out.push(o.x?.v);
    out.push(!o.x);
    out.push(o.x ? 1 : 0);
    out.push(o.x === "red" ? 1 : o.x === "green" ? 2 : o.x === "on" ? 3 : 4);
    out.push(
      typeof o.x === "string"
        ? o.x.length
        : typeof o.x === "number"
          ? o.x + 1
          : typeof o.x === "boolean"
            ? !o.x
            : "other",
    );
    out.push([o.x].length);
    out.push(Object.is(o.x, undefined));
    try {
      out.push(o.x === undefined ? -1 : o.x.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x !== undefined ? o.x + "!" : "none");
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.y);
    out.push(o.y == null);
    out.push(o.y === undefined);
    out.push(o.y === null);
    out.push(o.y ?? "nullish");
    out.push(o.y?.length);
    out.push(o.y?.v);
    out.push(!o.y);
    out.push(o.y ? 1 : 0);
    out.push(o.y === "red" ? 1 : o.y === "green" ? 2 : o.y === "on" ? 3 : 4);
    out.push(
      typeof o.y === "string"
        ? o.y.length
        : typeof o.y === "number"
          ? o.y + 1
          : typeof o.y === "boolean"
            ? !o.y
            : "other",
    );
    out.push([o.y].length);
    out.push(Object.is(o.y, undefined));
    try {
      out.push(o.y === null ? -1 : o.y.v);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.y !== null ? o.y.v + 1 : "none");
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.b);
    out.push(o.b == null);
    out.push(o.b === undefined);
    out.push(o.b === null);
    out.push(o.b ?? "nullish");
    out.push(o.b?.length);
    out.push(o.b?.v);
    out.push(!o.b);
    out.push(o.b ? 1 : 0);
    out.push(o.b === "red" ? 1 : o.b === "green" ? 2 : o.b === "on" ? 3 : 4);
    out.push(
      typeof o.b === "string"
        ? o.b.length
        : typeof o.b === "number"
          ? o.b + 1
          : typeof o.b === "boolean"
            ? !o.b
            : "other",
    );
    out.push([o.b].length);
    out.push(Object.is(o.b, undefined));
    try {
      out.push(typeof o.b === "string" ? o.b.length : o.b ? 1 : 0);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(typeof o.b === "boolean" ? !o.b : o.b + "!");
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(JSON.stringify(o));
    } catch (e) {
      out.push("no json");
    }
    out.push(Object.keys(o).join());
    return out.map(String).join(" ");
  }
  function sum(o) {
    let t = "";
    for (let i = 0; i < 3; i++) {
      try {
        t += o.x === undefined ? -1 : o.x.length;
      } catch {
        t += "!";
      }
      try {
        t += o.y === null ? -1 : o.y.v;
      } catch {
        t += "!";
      }
      try {
        t += typeof o.b === "string" ? o.b.length : o.b ? 1 : 0;
      } catch {
        t += "!";
      }
    }
    return t;
  }

  const all = [];
  for (let i = 0; i < 4; i++) all.push(make(i));
  for (const o of all) console.log(read(o), sum(o));
  {
    const o = all[1];
    new Function(
      "o",
      [...";)} } denifednu :eulav { :b ,} llun :eulav { :y ,} denifednu :eulav { :x { ,o(seitreporPenifed.tcejbO  "]
        .reverse()
        .join(""),
    )(o);
  }
  for (const o of all) console.log(read(o), sum(o));
  const again = make(9);
  console.log(read(again), sum(again));
}
{
  function make(i) {
    const o = { y: i & 1 ? { v: i } : null };
    if (i & 1) {
      o.x = i & 1 ? "u" + i : undefined;
      o.b = i & 1 ? true : "no";
    }
    return o;
  }

  function read(o) {
    const out = [];
    out.push(typeof o.x);
    out.push(o.x == null);
    out.push(o.x === undefined);
    out.push(o.x === null);
    out.push(o.x ?? "nullish");
    out.push(o.x?.length);
    out.push(o.x?.v);
    out.push(!o.x);
    out.push(o.x ? 1 : 0);
    out.push(o.x === "red" ? 1 : o.x === "green" ? 2 : o.x === "on" ? 3 : 4);
    out.push(
      typeof o.x === "string"
        ? o.x.length
        : typeof o.x === "number"
          ? o.x + 1
          : typeof o.x === "boolean"
            ? !o.x
            : "other",
    );
    out.push([o.x].length);
    out.push(Object.is(o.x, undefined));
    try {
      out.push(o.x === undefined ? -1 : o.x.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x !== undefined ? o.x + "!" : "none");
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.y);
    out.push(o.y == null);
    out.push(o.y === undefined);
    out.push(o.y === null);
    out.push(o.y ?? "nullish");
    out.push(o.y?.length);
    out.push(o.y?.v);
    out.push(!o.y);
    out.push(o.y ? 1 : 0);
    out.push(o.y === "red" ? 1 : o.y === "green" ? 2 : o.y === "on" ? 3 : 4);
    out.push(
      typeof o.y === "string"
        ? o.y.length
        : typeof o.y === "number"
          ? o.y + 1
          : typeof o.y === "boolean"
            ? !o.y
            : "other",
    );
    out.push([o.y].length);
    out.push(Object.is(o.y, undefined));
    try {
      out.push(o.y === null ? -1 : o.y.v);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.y !== null ? o.y.v + 1 : "none");
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.b);
    out.push(o.b == null);
    out.push(o.b === undefined);
    out.push(o.b === null);
    out.push(o.b ?? "nullish");
    out.push(o.b?.length);
    out.push(o.b?.v);
    out.push(!o.b);
    out.push(o.b ? 1 : 0);
    out.push(o.b === "red" ? 1 : o.b === "green" ? 2 : o.b === "on" ? 3 : 4);
    out.push(
      typeof o.b === "string"
        ? o.b.length
        : typeof o.b === "number"
          ? o.b + 1
          : typeof o.b === "boolean"
            ? !o.b
            : "other",
    );
    out.push([o.b].length);
    out.push(Object.is(o.b, undefined));
    try {
      out.push(typeof o.b === "string" ? o.b.length : o.b ? 1 : 0);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(typeof o.b === "boolean" ? !o.b : o.b + "!");
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(JSON.stringify(o));
    } catch (e) {
      out.push("no json");
    }
    out.push(Object.keys(o).join());
    return out.map(String).join(" ");
  }
  function sum(o) {
    let t = "";
    for (let i = 0; i < 3; i++) {
      try {
        t += o.x === undefined ? -1 : o.x.length;
      } catch {
        t += "!";
      }
      try {
        t += o.y === null ? -1 : o.y.v;
      } catch {
        t += "!";
      }
      try {
        t += typeof o.b === "string" ? o.b.length : o.b ? 1 : 0;
      } catch {
        t += "!";
      }
    }
    return t;
  }

  const all = [];
  for (let i = 0; i < 4; i++) all.push(make(i));
  for (const o of all) console.log(read(o), sum(o));
  {
    const o = all[1];
    new Function(
      "o",
      [...';))]]denifednu ,"b"[ ,]llun ,"y"[ ,]denifednu ,"x"[[(seirtnEmorf.tcejbO ,o(ngissa.tcejbO  ']
        .reverse()
        .join(""),
    )(o);
  }
  for (const o of all) console.log(read(o), sum(o));
  const again = make(9);
  console.log(read(again), sum(again));
}
{
  function make(i) {
    const o = {};
    o.x = i & 1 ? "on" : undefined;
    o.y = i & 1 ? i : null;
    o.b = [i, i + 1];
    return o;
  }

  function read(o) {
    const out = [];
    out.push(typeof o.x);
    out.push(o.x == null);
    out.push(o.x === undefined);
    out.push(o.x === null);
    out.push(o.x ?? "nullish");
    out.push(o.x?.length);
    out.push(o.x?.v);
    out.push(!o.x);
    out.push(o.x ? 1 : 0);
    out.push(o.x === "red" ? 1 : o.x === "green" ? 2 : o.x === "on" ? 3 : 4);
    out.push(
      typeof o.x === "string"
        ? o.x.length
        : typeof o.x === "number"
          ? o.x + 1
          : typeof o.x === "boolean"
            ? !o.x
            : "other",
    );
    out.push([o.x].length);
    out.push(Object.is(o.x, undefined));
    try {
      out.push(o.x === undefined ? -1 : o.x.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x === undefined ? "none" : o.x === "on" ? "ON" : "OFF");
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.y);
    out.push(o.y == null);
    out.push(o.y === undefined);
    out.push(o.y === null);
    out.push(o.y ?? "nullish");
    out.push(o.y?.length);
    out.push(o.y?.v);
    out.push(!o.y);
    out.push(o.y ? 1 : 0);
    out.push(o.y === "red" ? 1 : o.y === "green" ? 2 : o.y === "on" ? 3 : 4);
    out.push(
      typeof o.y === "string"
        ? o.y.length
        : typeof o.y === "number"
          ? o.y + 1
          : typeof o.y === "boolean"
            ? !o.y
            : "other",
    );
    out.push([o.y].length);
    out.push(Object.is(o.y, undefined));
    try {
      out.push(o.y === null ? -1 : o.y + 1);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.y !== null ? o.y * 2 : "none");
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.b);
    out.push(o.b == null);
    out.push(o.b === undefined);
    out.push(o.b === null);
    out.push(o.b ?? "nullish");
    out.push(o.b?.length);
    out.push(o.b?.v);
    out.push(!o.b);
    out.push(o.b ? 1 : 0);
    out.push(o.b === "red" ? 1 : o.b === "green" ? 2 : o.b === "on" ? 3 : 4);
    out.push(
      typeof o.b === "string"
        ? o.b.length
        : typeof o.b === "number"
          ? o.b + 1
          : typeof o.b === "boolean"
            ? !o.b
            : "other",
    );
    out.push([o.b].length);
    out.push(Object.is(o.b, undefined));
    try {
      out.push(o.b.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.b[0]);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.b[1] + 1);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(JSON.stringify(o));
    } catch (e) {
      out.push("no json");
    }
    out.push(Object.keys(o).join());
    return out.map(String).join(" ");
  }
  function sum(o) {
    let t = "";
    for (let i = 0; i < 3; i++) {
      try {
        t += o.x === undefined ? -1 : o.x.length;
      } catch {
        t += "!";
      }
      try {
        t += o.y === null ? -1 : o.y + 1;
      } catch {
        t += "!";
      }
      try {
        t += o.b.length;
      } catch {
        t += "!";
      }
    }
    return t;
  }

  const all = [];
  for (let i = 0; i < 4; i++) all.push(make(i));
  for (const o of all) console.log(read(o), sum(o));
  {
    const o = all[1];
    new Function("o", [...";]denifednu ,[ = ]b.o ,y.o ,x.o[  "].reverse().join(""))(o);
  }
  for (const o of all) console.log(read(o), sum(o));
  const again = make(9);
  console.log(read(again), sum(again));
}
{
  let i = 0;
  class P {
    x = i & 1 ? "on" : undefined;
    y = i & 1 ? i : null;
    b = [i, i + 1];
  }
  function make(n) {
    i = n;
    return new P();
  }

  function read(o) {
    const out = [];
    out.push(typeof o.x);
    out.push(o.x == null);
    out.push(o.x === undefined);
    out.push(o.x === null);
    out.push(o.x ?? "nullish");
    out.push(o.x?.length);
    out.push(o.x?.v);
    out.push(!o.x);
    out.push(o.x ? 1 : 0);
    out.push(o.x === "red" ? 1 : o.x === "green" ? 2 : o.x === "on" ? 3 : 4);
    out.push(
      typeof o.x === "string"
        ? o.x.length
        : typeof o.x === "number"
          ? o.x + 1
          : typeof o.x === "boolean"
            ? !o.x
            : "other",
    );
    out.push([o.x].length);
    out.push(Object.is(o.x, undefined));
    try {
      out.push(o.x === undefined ? -1 : o.x.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x === undefined ? "none" : o.x === "on" ? "ON" : "OFF");
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.y);
    out.push(o.y == null);
    out.push(o.y === undefined);
    out.push(o.y === null);
    out.push(o.y ?? "nullish");
    out.push(o.y?.length);
    out.push(o.y?.v);
    out.push(!o.y);
    out.push(o.y ? 1 : 0);
    out.push(o.y === "red" ? 1 : o.y === "green" ? 2 : o.y === "on" ? 3 : 4);
    out.push(
      typeof o.y === "string"
        ? o.y.length
        : typeof o.y === "number"
          ? o.y + 1
          : typeof o.y === "boolean"
            ? !o.y
            : "other",
    );
    out.push([o.y].length);
    out.push(Object.is(o.y, undefined));
    try {
      out.push(o.y === null ? -1 : o.y + 1);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.y !== null ? o.y * 2 : "none");
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.b);
    out.push(o.b == null);
    out.push(o.b === undefined);
    out.push(o.b === null);
    out.push(o.b ?? "nullish");
    out.push(o.b?.length);
    out.push(o.b?.v);
    out.push(!o.b);
    out.push(o.b ? 1 : 0);
    out.push(o.b === "red" ? 1 : o.b === "green" ? 2 : o.b === "on" ? 3 : 4);
    out.push(
      typeof o.b === "string"
        ? o.b.length
        : typeof o.b === "number"
          ? o.b + 1
          : typeof o.b === "boolean"
            ? !o.b
            : "other",
    );
    out.push([o.b].length);
    out.push(Object.is(o.b, undefined));
    try {
      out.push(o.b.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.b[0]);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.b[1] + 1);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(JSON.stringify(o));
    } catch (e) {
      out.push("no json");
    }
    out.push(Object.keys(o).join());
    return out.map(String).join(" ");
  }
  function sum(o) {
    let t = "";
    for (let i = 0; i < 3; i++) {
      try {
        t += o.x === undefined ? -1 : o.x.length;
      } catch {
        t += "!";
      }
      try {
        t += o.y === null ? -1 : o.y + 1;
      } catch {
        t += "!";
      }
      try {
        t += o.b.length;
      } catch {
        t += "!";
      }
    }
    return t;
  }

  const all = [];
  for (let i = 0; i < 4; i++) all.push(make(i));
  for (const o of all) console.log(read(o), sum(o));
  {
    const o = all[1];
    new Function(
      "o",
      [..."} ;e = b.o ;e = y.o { )e( hctac } ;llun worht { yrt } ;e = x.o { )e( hctac } ;denifednu worht { yrt  "]
        .reverse()
        .join(""),
    )(o);
  }
  for (const o of all) console.log(read(o), sum(o));
  const again = make(9);
  console.log(read(again), sum(again));
}
{
  class P {
    constructor(i) {
      this.x = i & 1 ? "on" : undefined;
      this.y = i & 1 ? i : null;
      this.b = [i, i + 1];
    }
  }
  function make(i) {
    return new P(i);
  }

  function read(o) {
    const out = [];
    out.push(typeof o.x);
    out.push(o.x == null);
    out.push(o.x === undefined);
    out.push(o.x === null);
    out.push(o.x ?? "nullish");
    out.push(o.x?.length);
    out.push(o.x?.v);
    out.push(!o.x);
    out.push(o.x ? 1 : 0);
    out.push(o.x === "red" ? 1 : o.x === "green" ? 2 : o.x === "on" ? 3 : 4);
    out.push(
      typeof o.x === "string"
        ? o.x.length
        : typeof o.x === "number"
          ? o.x + 1
          : typeof o.x === "boolean"
            ? !o.x
            : "other",
    );
    out.push([o.x].length);
    out.push(Object.is(o.x, undefined));
    try {
      out.push(o.x === undefined ? -1 : o.x.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x === undefined ? "none" : o.x === "on" ? "ON" : "OFF");
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.y);
    out.push(o.y == null);
    out.push(o.y === undefined);
    out.push(o.y === null);
    out.push(o.y ?? "nullish");
    out.push(o.y?.length);
    out.push(o.y?.v);
    out.push(!o.y);
    out.push(o.y ? 1 : 0);
    out.push(o.y === "red" ? 1 : o.y === "green" ? 2 : o.y === "on" ? 3 : 4);
    out.push(
      typeof o.y === "string"
        ? o.y.length
        : typeof o.y === "number"
          ? o.y + 1
          : typeof o.y === "boolean"
            ? !o.y
            : "other",
    );
    out.push([o.y].length);
    out.push(Object.is(o.y, undefined));
    try {
      out.push(o.y === null ? -1 : o.y + 1);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.y !== null ? o.y * 2 : "none");
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.b);
    out.push(o.b == null);
    out.push(o.b === undefined);
    out.push(o.b === null);
    out.push(o.b ?? "nullish");
    out.push(o.b?.length);
    out.push(o.b?.v);
    out.push(!o.b);
    out.push(o.b ? 1 : 0);
    out.push(o.b === "red" ? 1 : o.b === "green" ? 2 : o.b === "on" ? 3 : 4);
    out.push(
      typeof o.b === "string"
        ? o.b.length
        : typeof o.b === "number"
          ? o.b + 1
          : typeof o.b === "boolean"
            ? !o.b
            : "other",
    );
    out.push([o.b].length);
    out.push(Object.is(o.b, undefined));
    try {
      out.push(o.b.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.b[0]);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.b[1] + 1);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(JSON.stringify(o));
    } catch (e) {
      out.push("no json");
    }
    out.push(Object.keys(o).join());
    return out.map(String).join(" ");
  }
  function sum(o) {
    let t = "";
    for (let i = 0; i < 3; i++) {
      try {
        t += o.x === undefined ? -1 : o.x.length;
      } catch {
        t += "!";
      }
      try {
        t += o.y === null ? -1 : o.y + 1;
      } catch {
        t += "!";
      }
      try {
        t += o.b.length;
      } catch {
        t += "!";
      }
    }
    return t;
  }

  const all = [];
  for (let i = 0; i < 4; i++) all.push(make(i));
  for (const o of all) console.log(read(o), sum(o));
  {
    const o = all[1];
    new Function(
      "o",
      [...";)3(teg.m = b.o ;denifednu ?? )2(teg.m = y.o ;)1(teg.m = x.o ;)(paM wen = m tsnoc  "].reverse().join(""),
    )(o);
  }
  for (const o of all) console.log(read(o), sum(o));
  const again = make(9);
  console.log(read(again), sum(again));
}
{
  function make(i) {
    return { x: i & 1 ? "on" : undefined, y: i & 1 ? i : null, b: [i, i + 1] };
  }

  function read(o) {
    const out = [];
    out.push(typeof o.x);
    out.push(o.x == null);
    out.push(o.x === undefined);
    out.push(o.x === null);
    out.push(o.x ?? "nullish");
    out.push(o.x?.length);
    out.push(o.x?.v);
    out.push(!o.x);
    out.push(o.x ? 1 : 0);
    out.push(o.x === "red" ? 1 : o.x === "green" ? 2 : o.x === "on" ? 3 : 4);
    out.push(
      typeof o.x === "string"
        ? o.x.length
        : typeof o.x === "number"
          ? o.x + 1
          : typeof o.x === "boolean"
            ? !o.x
            : "other",
    );
    out.push([o.x].length);
    out.push(Object.is(o.x, undefined));
    try {
      out.push(o.x === undefined ? -1 : o.x.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x === undefined ? "none" : o.x === "on" ? "ON" : "OFF");
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.y);
    out.push(o.y == null);
    out.push(o.y === undefined);
    out.push(o.y === null);
    out.push(o.y ?? "nullish");
    out.push(o.y?.length);
    out.push(o.y?.v);
    out.push(!o.y);
    out.push(o.y ? 1 : 0);
    out.push(o.y === "red" ? 1 : o.y === "green" ? 2 : o.y === "on" ? 3 : 4);
    out.push(
      typeof o.y === "string"
        ? o.y.length
        : typeof o.y === "number"
          ? o.y + 1
          : typeof o.y === "boolean"
            ? !o.y
            : "other",
    );
    out.push([o.y].length);
    out.push(Object.is(o.y, undefined));
    try {
      out.push(o.y === null ? -1 : o.y + 1);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.y !== null ? o.y * 2 : "none");
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.b);
    out.push(o.b == null);
    out.push(o.b === undefined);
    out.push(o.b === null);
    out.push(o.b ?? "nullish");
    out.push(o.b?.length);
    out.push(o.b?.v);
    out.push(!o.b);
    out.push(o.b ? 1 : 0);
    out.push(o.b === "red" ? 1 : o.b === "green" ? 2 : o.b === "on" ? 3 : 4);
    out.push(
      typeof o.b === "string"
        ? o.b.length
        : typeof o.b === "number"
          ? o.b + 1
          : typeof o.b === "boolean"
            ? !o.b
            : "other",
    );
    out.push([o.b].length);
    out.push(Object.is(o.b, undefined));
    try {
      out.push(o.b.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.b[0]);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.b[1] + 1);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(JSON.stringify(o));
    } catch (e) {
      out.push("no json");
    }
    out.push(Object.keys(o).join());
    return out.map(String).join(" ");
  }
  function sum(o) {
    let t = "";
    for (let i = 0; i < 3; i++) {
      try {
        t += o.x === undefined ? -1 : o.x.length;
      } catch {
        t += "!";
      }
      try {
        t += o.y === null ? -1 : o.y + 1;
      } catch {
        t += "!";
      }
      try {
        t += o.b.length;
      } catch {
        t += "!";
      }
    }
    return t;
  }

  const all = [];
  for (let i = 0; i < 4; i++) all.push(make(i));
  for (const o of all) console.log(read(o), sum(o));
  {
    const o = all[1];
    new Function("o", [...";)7(ta.e = b.o ;]3[e = y.o ;)(pop.e = x.o ;][ = e tsnoc  "].reverse().join(""))(o);
  }
  for (const o of all) console.log(read(o), sum(o));
  const again = make(9);
  console.log(read(again), sum(again));
}
{
  function make(i) {
    const o = { y: i & 1 ? i : null };
    if (i & 1) {
      o.x = i & 1 ? "on" : undefined;
      o.b = [i, i + 1];
    }
    return o;
  }

  function read(o) {
    const out = [];
    out.push(typeof o.x);
    out.push(o.x == null);
    out.push(o.x === undefined);
    out.push(o.x === null);
    out.push(o.x ?? "nullish");
    out.push(o.x?.length);
    out.push(o.x?.v);
    out.push(!o.x);
    out.push(o.x ? 1 : 0);
    out.push(o.x === "red" ? 1 : o.x === "green" ? 2 : o.x === "on" ? 3 : 4);
    out.push(
      typeof o.x === "string"
        ? o.x.length
        : typeof o.x === "number"
          ? o.x + 1
          : typeof o.x === "boolean"
            ? !o.x
            : "other",
    );
    out.push([o.x].length);
    out.push(Object.is(o.x, undefined));
    try {
      out.push(o.x === undefined ? -1 : o.x.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.x === undefined ? "none" : o.x === "on" ? "ON" : "OFF");
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.y);
    out.push(o.y == null);
    out.push(o.y === undefined);
    out.push(o.y === null);
    out.push(o.y ?? "nullish");
    out.push(o.y?.length);
    out.push(o.y?.v);
    out.push(!o.y);
    out.push(o.y ? 1 : 0);
    out.push(o.y === "red" ? 1 : o.y === "green" ? 2 : o.y === "on" ? 3 : 4);
    out.push(
      typeof o.y === "string"
        ? o.y.length
        : typeof o.y === "number"
          ? o.y + 1
          : typeof o.y === "boolean"
            ? !o.y
            : "other",
    );
    out.push([o.y].length);
    out.push(Object.is(o.y, undefined));
    try {
      out.push(o.y === null ? -1 : o.y + 1);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.y !== null ? o.y * 2 : "none");
    } catch (e) {
      out.push(e.constructor.name);
    }
    out.push(typeof o.b);
    out.push(o.b == null);
    out.push(o.b === undefined);
    out.push(o.b === null);
    out.push(o.b ?? "nullish");
    out.push(o.b?.length);
    out.push(o.b?.v);
    out.push(!o.b);
    out.push(o.b ? 1 : 0);
    out.push(o.b === "red" ? 1 : o.b === "green" ? 2 : o.b === "on" ? 3 : 4);
    out.push(
      typeof o.b === "string"
        ? o.b.length
        : typeof o.b === "number"
          ? o.b + 1
          : typeof o.b === "boolean"
            ? !o.b
            : "other",
    );
    out.push([o.b].length);
    out.push(Object.is(o.b, undefined));
    try {
      out.push(o.b.length);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.b[0]);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(o.b[1] + 1);
    } catch (e) {
      out.push(e.constructor.name);
    }
    try {
      out.push(JSON.stringify(o));
    } catch (e) {
      out.push("no json");
    }
    out.push(Object.keys(o).join());
    return out.map(String).join(" ");
  }
  function sum(o) {
    let t = "";
    for (let i = 0; i < 3; i++) {
      try {
        t += o.x === undefined ? -1 : o.x.length;
      } catch {
        t += "!";
      }
      try {
        t += o.y === null ? -1 : o.y + 1;
      } catch {
        t += "!";
      }
      try {
        t += o.b.length;
      } catch {
        t += "!";
      }
    }
    return t;
  }

  const all = [];
  for (let i = 0; i < 4; i++) all.push(make(i));
  for (const o of all) console.log(read(o), sum(o));
  {
    const o = all[1];
    new Function(
      "o",
      [...";)()denifednu ,llun ,o(dnib.w } ;a = b.siht ;c = y.siht ;a = x.siht { )c ,a(w noitcnuf  "]
        .reverse()
        .join(""),
    )(o);
  }
  for (const o of all) console.log(read(o), sum(o));
  const again = make(9);
  console.log(read(again), sum(again));
}
