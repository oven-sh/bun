function described(it) {
  return Reflect.ownKeys(it)
    .map(key => String(key) + "=" + (it[key] && it[key].n))
    .join();
}
function counted(it) {
  const listed = Reflect.ownKeys(it);
  return listed.length + 0;
}
function inALoop1(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = +i,
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function inALoop2(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = +i,
      value = { n: i },
      raw = all;
    all = { [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function inALoop3(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "k" + i,
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function inALoop4(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "k" + i,
      value = { n: i },
      raw = all;
    all = { [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function inALoop5(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = Symbol.for("s" + i),
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function inALoop6(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = Symbol.for("s" + i),
      value = { n: i },
      raw = all;
    all = { [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function inALoop7(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = i % 2,
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function inALoop8(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = i % 2,
      value = { n: i },
      raw = all;
    all = { [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function inALoop9(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "k" + (i % 2),
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function inALoop10(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "k" + (i % 2),
      value = { n: i },
      raw = all;
    all = { [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function inALoop11(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = i ? "__proto__" : +i,
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function inALoop12(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = i ? "__proto__" : +i,
      value = { n: i },
      raw = all;
    all = { [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function inALoop13(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "__proto__",
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function inALoop14(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "__proto__",
      value = { n: i },
      raw = all;
    all = { [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function inALoop15(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = +i,
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { ...all, [key]: value };
  }
  return counted(all) + " " + described(all);
}
function inALoop16(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = +i,
      value = { n: i },
      raw = all;
    all = { ...all, [key]: value };
  }
  return counted(all) + " " + described(all);
}
function inALoop17(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "k" + i,
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { ...all, [key]: value };
  }
  return counted(all) + " " + described(all);
}
function inALoop18(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "k" + i,
      value = { n: i },
      raw = all;
    all = { ...all, [key]: value };
  }
  return counted(all) + " " + described(all);
}
function inALoop19(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = Symbol.for("s" + i),
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { ...all, [key]: value };
  }
  return counted(all) + " " + described(all);
}
function inALoop20(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = Symbol.for("s" + i),
      value = { n: i },
      raw = all;
    all = { ...all, [key]: value };
  }
  return counted(all) + " " + described(all);
}
function inALoop21(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = i % 2,
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { ...all, [key]: value };
  }
  return counted(all) + " " + described(all);
}
function inALoop22(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = i % 2,
      value = { n: i },
      raw = all;
    all = { ...all, [key]: value };
  }
  return counted(all) + " " + described(all);
}
function inALoop23(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "k" + (i % 2),
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { ...all, [key]: value };
  }
  return counted(all) + " " + described(all);
}
function inALoop24(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "k" + (i % 2),
      value = { n: i },
      raw = all;
    all = { ...all, [key]: value };
  }
  return counted(all) + " " + described(all);
}
function inALoop25(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = i ? "__proto__" : +i,
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { ...all, [key]: value };
  }
  return counted(all) + " " + described(all);
}
function inALoop26(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = i ? "__proto__" : +i,
      value = { n: i },
      raw = all;
    all = { ...all, [key]: value };
  }
  return counted(all) + " " + described(all);
}
function inALoop27(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "__proto__",
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { ...all, [key]: value };
  }
  return counted(all) + " " + described(all);
}
function inALoop28(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "__proto__",
      value = { n: i },
      raw = all;
    all = { ...all, [key]: value };
  }
  return counted(all) + " " + described(all);
}
function inALoop29(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = +i,
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  return counted(all) + " " + described(all);
}
function inALoop30(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = +i,
      value = { n: i },
      raw = all;
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  return counted(all) + " " + described(all);
}
function inALoop31(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "k" + i,
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  return counted(all) + " " + described(all);
}
function inALoop32(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "k" + i,
      value = { n: i },
      raw = all;
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  return counted(all) + " " + described(all);
}
function inALoop33(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = Symbol.for("s" + i),
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  return counted(all) + " " + described(all);
}
function inALoop34(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = Symbol.for("s" + i),
      value = { n: i },
      raw = all;
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  return counted(all) + " " + described(all);
}
function inALoop35(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = i % 2,
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  return counted(all) + " " + described(all);
}
function inALoop36(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = i % 2,
      value = { n: i },
      raw = all;
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  return counted(all) + " " + described(all);
}
function inALoop37(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "k" + (i % 2),
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  return counted(all) + " " + described(all);
}
function inALoop38(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "k" + (i % 2),
      value = { n: i },
      raw = all;
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  return counted(all) + " " + described(all);
}
function inALoop39(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = i ? "__proto__" : +i,
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  return counted(all) + " " + described(all);
}
function inALoop40(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = i ? "__proto__" : +i,
      value = { n: i },
      raw = all;
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  return counted(all) + " " + described(all);
}
function inALoop41(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "__proto__",
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  return counted(all) + " " + described(all);
}
function inALoop42(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "__proto__",
      value = { n: i },
      raw = all;
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  return counted(all) + " " + described(all);
}
function inALoop43(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = +i,
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { ...all, [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function inALoop44(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = +i,
      value = { n: i },
      raw = all;
    all = { ...all, [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function inALoop45(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "k" + i,
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { ...all, [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function inALoop46(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "k" + i,
      value = { n: i },
      raw = all;
    all = { ...all, [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function inALoop47(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = Symbol.for("s" + i),
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { ...all, [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function inALoop48(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = Symbol.for("s" + i),
      value = { n: i },
      raw = all;
    all = { ...all, [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function inALoop49(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = i % 2,
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { ...all, [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function inALoop50(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = i % 2,
      value = { n: i },
      raw = all;
    all = { ...all, [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function inALoop51(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "k" + (i % 2),
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { ...all, [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function inALoop52(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "k" + (i % 2),
      value = { n: i },
      raw = all;
    all = { ...all, [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function inALoop53(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = i ? "__proto__" : +i,
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { ...all, [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function inALoop54(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = i ? "__proto__" : +i,
      value = { n: i },
      raw = all;
    all = { ...all, [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function inALoop55(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "__proto__",
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { ...all, [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function inALoop56(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "__proto__",
      value = { n: i },
      raw = all;
    all = { ...all, [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function inALoop57(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = +i,
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  return counted(all) + " " + described(all);
}
function inALoop58(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = +i,
      value = { n: i },
      raw = all;
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  return counted(all) + " " + described(all);
}
function inALoop59(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "k" + i,
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  return counted(all) + " " + described(all);
}
function inALoop60(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "k" + i,
      value = { n: i },
      raw = all;
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  return counted(all) + " " + described(all);
}
function inALoop61(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = Symbol.for("s" + i),
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  return counted(all) + " " + described(all);
}
function inALoop62(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = Symbol.for("s" + i),
      value = { n: i },
      raw = all;
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  return counted(all) + " " + described(all);
}
function inALoop63(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = i % 2,
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  return counted(all) + " " + described(all);
}
function inALoop64(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = i % 2,
      value = { n: i },
      raw = all;
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  return counted(all) + " " + described(all);
}
function inALoop65(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "k" + (i % 2),
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  return counted(all) + " " + described(all);
}
function inALoop66(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "k" + (i % 2),
      value = { n: i },
      raw = all;
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  return counted(all) + " " + described(all);
}
function inALoop67(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = i ? "__proto__" : +i,
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  return counted(all) + " " + described(all);
}
function inALoop68(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = i ? "__proto__" : +i,
      value = { n: i },
      raw = all;
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  return counted(all) + " " + described(all);
}
function inALoop69(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "__proto__",
      value = { n: i },
      raw = all;
    if (i === 3) raw[Symbol.for("s")] = { n: i };
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  return counted(all) + " " + described(all);
}
function inALoop70(count) {
  const other = { o: { n: -1 } };
  let all = {};
  for (let i = 0; i < count; i++) {
    const key = "__proto__",
      value = { n: i },
      raw = all;
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  return counted(all) + " " + described(all);
}
function outside71(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = +i,
      value = { n: i };
    all = { [key]: value, ...all };
  }
  {
    const i = first + 1,
      key = +i,
      value = { n: i };
    all = { [key]: value, ...all };
  }
  {
    const i = first + 2,
      key = +i,
      value = { n: i };
    all = { [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function outside72(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = "k" + i,
      value = { n: i };
    all = { [key]: value, ...all };
  }
  {
    const i = first + 1,
      key = "k" + i,
      value = { n: i };
    all = { [key]: value, ...all };
  }
  {
    const i = first + 2,
      key = "k" + i,
      value = { n: i };
    all = { [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function outside73(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = Symbol.for("s" + i),
      value = { n: i };
    all = { [key]: value, ...all };
  }
  {
    const i = first + 1,
      key = Symbol.for("s" + i),
      value = { n: i };
    all = { [key]: value, ...all };
  }
  {
    const i = first + 2,
      key = Symbol.for("s" + i),
      value = { n: i };
    all = { [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function outside74(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = i % 2,
      value = { n: i };
    all = { [key]: value, ...all };
  }
  {
    const i = first + 1,
      key = i % 2,
      value = { n: i };
    all = { [key]: value, ...all };
  }
  {
    const i = first + 2,
      key = i % 2,
      value = { n: i };
    all = { [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function outside75(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = "k" + (i % 2),
      value = { n: i };
    all = { [key]: value, ...all };
  }
  {
    const i = first + 1,
      key = "k" + (i % 2),
      value = { n: i };
    all = { [key]: value, ...all };
  }
  {
    const i = first + 2,
      key = "k" + (i % 2),
      value = { n: i };
    all = { [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function outside76(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = i ? "__proto__" : +i,
      value = { n: i };
    all = { [key]: value, ...all };
  }
  {
    const i = first + 1,
      key = i ? "__proto__" : +i,
      value = { n: i };
    all = { [key]: value, ...all };
  }
  {
    const i = first + 2,
      key = i ? "__proto__" : +i,
      value = { n: i };
    all = { [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function outside77(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = "__proto__",
      value = { n: i };
    all = { [key]: value, ...all };
  }
  {
    const i = first + 1,
      key = "__proto__",
      value = { n: i };
    all = { [key]: value, ...all };
  }
  {
    const i = first + 2,
      key = "__proto__",
      value = { n: i };
    all = { [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function outside78(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = +i,
      value = { n: i };
    all = { ...all, [key]: value };
  }
  {
    const i = first + 1,
      key = +i,
      value = { n: i };
    all = { ...all, [key]: value };
  }
  {
    const i = first + 2,
      key = +i,
      value = { n: i };
    all = { ...all, [key]: value };
  }
  return counted(all) + " " + described(all);
}
function outside79(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = "k" + i,
      value = { n: i };
    all = { ...all, [key]: value };
  }
  {
    const i = first + 1,
      key = "k" + i,
      value = { n: i };
    all = { ...all, [key]: value };
  }
  {
    const i = first + 2,
      key = "k" + i,
      value = { n: i };
    all = { ...all, [key]: value };
  }
  return counted(all) + " " + described(all);
}
function outside80(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = Symbol.for("s" + i),
      value = { n: i };
    all = { ...all, [key]: value };
  }
  {
    const i = first + 1,
      key = Symbol.for("s" + i),
      value = { n: i };
    all = { ...all, [key]: value };
  }
  {
    const i = first + 2,
      key = Symbol.for("s" + i),
      value = { n: i };
    all = { ...all, [key]: value };
  }
  return counted(all) + " " + described(all);
}
function outside81(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = i % 2,
      value = { n: i };
    all = { ...all, [key]: value };
  }
  {
    const i = first + 1,
      key = i % 2,
      value = { n: i };
    all = { ...all, [key]: value };
  }
  {
    const i = first + 2,
      key = i % 2,
      value = { n: i };
    all = { ...all, [key]: value };
  }
  return counted(all) + " " + described(all);
}
function outside82(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = "k" + (i % 2),
      value = { n: i };
    all = { ...all, [key]: value };
  }
  {
    const i = first + 1,
      key = "k" + (i % 2),
      value = { n: i };
    all = { ...all, [key]: value };
  }
  {
    const i = first + 2,
      key = "k" + (i % 2),
      value = { n: i };
    all = { ...all, [key]: value };
  }
  return counted(all) + " " + described(all);
}
function outside83(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = i ? "__proto__" : +i,
      value = { n: i };
    all = { ...all, [key]: value };
  }
  {
    const i = first + 1,
      key = i ? "__proto__" : +i,
      value = { n: i };
    all = { ...all, [key]: value };
  }
  {
    const i = first + 2,
      key = i ? "__proto__" : +i,
      value = { n: i };
    all = { ...all, [key]: value };
  }
  return counted(all) + " " + described(all);
}
function outside84(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = "__proto__",
      value = { n: i };
    all = { ...all, [key]: value };
  }
  {
    const i = first + 1,
      key = "__proto__",
      value = { n: i };
    all = { ...all, [key]: value };
  }
  {
    const i = first + 2,
      key = "__proto__",
      value = { n: i };
    all = { ...all, [key]: value };
  }
  return counted(all) + " " + described(all);
}
function outside85(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = +i,
      value = { n: i };
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  {
    const i = first + 1,
      key = +i,
      value = { n: i };
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  {
    const i = first + 2,
      key = +i,
      value = { n: i };
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  return counted(all) + " " + described(all);
}
function outside86(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = "k" + i,
      value = { n: i };
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  {
    const i = first + 1,
      key = "k" + i,
      value = { n: i };
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  {
    const i = first + 2,
      key = "k" + i,
      value = { n: i };
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  return counted(all) + " " + described(all);
}
function outside87(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = Symbol.for("s" + i),
      value = { n: i };
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  {
    const i = first + 1,
      key = Symbol.for("s" + i),
      value = { n: i };
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  {
    const i = first + 2,
      key = Symbol.for("s" + i),
      value = { n: i };
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  return counted(all) + " " + described(all);
}
function outside88(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = i % 2,
      value = { n: i };
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  {
    const i = first + 1,
      key = i % 2,
      value = { n: i };
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  {
    const i = first + 2,
      key = i % 2,
      value = { n: i };
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  return counted(all) + " " + described(all);
}
function outside89(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = "k" + (i % 2),
      value = { n: i };
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  {
    const i = first + 1,
      key = "k" + (i % 2),
      value = { n: i };
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  {
    const i = first + 2,
      key = "k" + (i % 2),
      value = { n: i };
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  return counted(all) + " " + described(all);
}
function outside90(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = i ? "__proto__" : +i,
      value = { n: i };
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  {
    const i = first + 1,
      key = i ? "__proto__" : +i,
      value = { n: i };
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  {
    const i = first + 2,
      key = i ? "__proto__" : +i,
      value = { n: i };
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  return counted(all) + " " + described(all);
}
function outside91(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = "__proto__",
      value = { n: i };
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  {
    const i = first + 1,
      key = "__proto__",
      value = { n: i };
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  {
    const i = first + 2,
      key = "__proto__",
      value = { n: i };
    all = { [key]: value, ...all, ["z" + i]: value };
  }
  return counted(all) + " " + described(all);
}
function outside92(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = +i,
      value = { n: i };
    all = { ...all, [key]: value, ...all };
  }
  {
    const i = first + 1,
      key = +i,
      value = { n: i };
    all = { ...all, [key]: value, ...all };
  }
  {
    const i = first + 2,
      key = +i,
      value = { n: i };
    all = { ...all, [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function outside93(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = "k" + i,
      value = { n: i };
    all = { ...all, [key]: value, ...all };
  }
  {
    const i = first + 1,
      key = "k" + i,
      value = { n: i };
    all = { ...all, [key]: value, ...all };
  }
  {
    const i = first + 2,
      key = "k" + i,
      value = { n: i };
    all = { ...all, [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function outside94(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = Symbol.for("s" + i),
      value = { n: i };
    all = { ...all, [key]: value, ...all };
  }
  {
    const i = first + 1,
      key = Symbol.for("s" + i),
      value = { n: i };
    all = { ...all, [key]: value, ...all };
  }
  {
    const i = first + 2,
      key = Symbol.for("s" + i),
      value = { n: i };
    all = { ...all, [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function outside95(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = i % 2,
      value = { n: i };
    all = { ...all, [key]: value, ...all };
  }
  {
    const i = first + 1,
      key = i % 2,
      value = { n: i };
    all = { ...all, [key]: value, ...all };
  }
  {
    const i = first + 2,
      key = i % 2,
      value = { n: i };
    all = { ...all, [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function outside96(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = "k" + (i % 2),
      value = { n: i };
    all = { ...all, [key]: value, ...all };
  }
  {
    const i = first + 1,
      key = "k" + (i % 2),
      value = { n: i };
    all = { ...all, [key]: value, ...all };
  }
  {
    const i = first + 2,
      key = "k" + (i % 2),
      value = { n: i };
    all = { ...all, [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function outside97(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = i ? "__proto__" : +i,
      value = { n: i };
    all = { ...all, [key]: value, ...all };
  }
  {
    const i = first + 1,
      key = i ? "__proto__" : +i,
      value = { n: i };
    all = { ...all, [key]: value, ...all };
  }
  {
    const i = first + 2,
      key = i ? "__proto__" : +i,
      value = { n: i };
    all = { ...all, [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function outside98(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = "__proto__",
      value = { n: i };
    all = { ...all, [key]: value, ...all };
  }
  {
    const i = first + 1,
      key = "__proto__",
      value = { n: i };
    all = { ...all, [key]: value, ...all };
  }
  {
    const i = first + 2,
      key = "__proto__",
      value = { n: i };
    all = { ...all, [key]: value, ...all };
  }
  return counted(all) + " " + described(all);
}
function outside99(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = +i,
      value = { n: i };
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  {
    const i = first + 1,
      key = +i,
      value = { n: i };
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  {
    const i = first + 2,
      key = +i,
      value = { n: i };
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  return counted(all) + " " + described(all);
}
function outside100(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = "k" + i,
      value = { n: i };
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  {
    const i = first + 1,
      key = "k" + i,
      value = { n: i };
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  {
    const i = first + 2,
      key = "k" + i,
      value = { n: i };
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  return counted(all) + " " + described(all);
}
function outside101(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = Symbol.for("s" + i),
      value = { n: i };
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  {
    const i = first + 1,
      key = Symbol.for("s" + i),
      value = { n: i };
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  {
    const i = first + 2,
      key = Symbol.for("s" + i),
      value = { n: i };
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  return counted(all) + " " + described(all);
}
function outside102(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = i % 2,
      value = { n: i };
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  {
    const i = first + 1,
      key = i % 2,
      value = { n: i };
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  {
    const i = first + 2,
      key = i % 2,
      value = { n: i };
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  return counted(all) + " " + described(all);
}
function outside103(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = "k" + (i % 2),
      value = { n: i };
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  {
    const i = first + 1,
      key = "k" + (i % 2),
      value = { n: i };
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  {
    const i = first + 2,
      key = "k" + (i % 2),
      value = { n: i };
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  return counted(all) + " " + described(all);
}
function outside104(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = i ? "__proto__" : +i,
      value = { n: i };
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  {
    const i = first + 1,
      key = i ? "__proto__" : +i,
      value = { n: i };
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  {
    const i = first + 2,
      key = i ? "__proto__" : +i,
      value = { n: i };
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  return counted(all) + " " + described(all);
}
function outside105(first) {
  const other = { o: { n: -1 } };
  let all = {};
  {
    const i = first + 0,
      key = "__proto__",
      value = { n: i };
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  {
    const i = first + 1,
      key = "__proto__",
      value = { n: i };
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  {
    const i = first + 2,
      key = "__proto__",
      value = { n: i };
    all = { [key]: value, ["z" + i]: value, ...all, ...other };
  }
  return counted(all) + " " + described(all);
}
console.log(
  "in a loop, the key, then the spread, a number, with a write through another name:",
  inALoop1(5),
  "|",
  inALoop1(8),
  "|",
  inALoop1(0),
);
console.log("in a loop, the key, then the spread, a number:", inALoop2(5), "|", inALoop2(8), "|", inALoop2(0));
console.log(
  "in a loop, the key, then the spread, a text, with a write through another name:",
  inALoop3(5),
  "|",
  inALoop3(8),
  "|",
  inALoop3(0),
);
console.log("in a loop, the key, then the spread, a text:", inALoop4(5), "|", inALoop4(8), "|", inALoop4(0));
console.log(
  "in a loop, the key, then the spread, a symbol, with a write through another name:",
  inALoop5(5),
  "|",
  inALoop5(8),
  "|",
  inALoop5(0),
);
console.log("in a loop, the key, then the spread, a symbol:", inALoop6(5), "|", inALoop6(8), "|", inALoop6(0));
console.log(
  "in a loop, the key, then the spread, a number that repeats, with a write through another name:",
  inALoop7(5),
  "|",
  inALoop7(8),
  "|",
  inALoop7(0),
);
console.log(
  "in a loop, the key, then the spread, a number that repeats:",
  inALoop8(5),
  "|",
  inALoop8(8),
  "|",
  inALoop8(0),
);
console.log(
  "in a loop, the key, then the spread, a text that repeats, with a write through another name:",
  inALoop9(5),
  "|",
  inALoop9(8),
  "|",
  inALoop9(0),
);
console.log(
  "in a loop, the key, then the spread, a text that repeats:",
  inALoop10(5),
  "|",
  inALoop10(8),
  "|",
  inALoop10(0),
);
console.log(
  "in a loop, the key, then the spread, __proto__ but for the first, with a write through another name:",
  inALoop11(5),
  "|",
  inALoop11(8),
  "|",
  inALoop11(0),
);
console.log(
  "in a loop, the key, then the spread, __proto__ but for the first:",
  inALoop12(5),
  "|",
  inALoop12(8),
  "|",
  inALoop12(0),
);
console.log(
  "in a loop, the key, then the spread, __proto__ in every turn, with a write through another name:",
  inALoop13(5),
  "|",
  inALoop13(8),
  "|",
  inALoop13(0),
);
console.log(
  "in a loop, the key, then the spread, __proto__ in every turn:",
  inALoop14(5),
  "|",
  inALoop14(8),
  "|",
  inALoop14(0),
);
console.log(
  "in a loop, the spread, then the key, a number, with a write through another name:",
  inALoop15(5),
  "|",
  inALoop15(8),
  "|",
  inALoop15(0),
);
console.log("in a loop, the spread, then the key, a number:", inALoop16(5), "|", inALoop16(8), "|", inALoop16(0));
console.log(
  "in a loop, the spread, then the key, a text, with a write through another name:",
  inALoop17(5),
  "|",
  inALoop17(8),
  "|",
  inALoop17(0),
);
console.log("in a loop, the spread, then the key, a text:", inALoop18(5), "|", inALoop18(8), "|", inALoop18(0));
console.log(
  "in a loop, the spread, then the key, a symbol, with a write through another name:",
  inALoop19(5),
  "|",
  inALoop19(8),
  "|",
  inALoop19(0),
);
console.log("in a loop, the spread, then the key, a symbol:", inALoop20(5), "|", inALoop20(8), "|", inALoop20(0));
console.log(
  "in a loop, the spread, then the key, a number that repeats, with a write through another name:",
  inALoop21(5),
  "|",
  inALoop21(8),
  "|",
  inALoop21(0),
);
console.log(
  "in a loop, the spread, then the key, a number that repeats:",
  inALoop22(5),
  "|",
  inALoop22(8),
  "|",
  inALoop22(0),
);
console.log(
  "in a loop, the spread, then the key, a text that repeats, with a write through another name:",
  inALoop23(5),
  "|",
  inALoop23(8),
  "|",
  inALoop23(0),
);
console.log(
  "in a loop, the spread, then the key, a text that repeats:",
  inALoop24(5),
  "|",
  inALoop24(8),
  "|",
  inALoop24(0),
);
console.log(
  "in a loop, the spread, then the key, __proto__ but for the first, with a write through another name:",
  inALoop25(5),
  "|",
  inALoop25(8),
  "|",
  inALoop25(0),
);
console.log(
  "in a loop, the spread, then the key, __proto__ but for the first:",
  inALoop26(5),
  "|",
  inALoop26(8),
  "|",
  inALoop26(0),
);
console.log(
  "in a loop, the spread, then the key, __proto__ in every turn, with a write through another name:",
  inALoop27(5),
  "|",
  inALoop27(8),
  "|",
  inALoop27(0),
);
console.log(
  "in a loop, the spread, then the key, __proto__ in every turn:",
  inALoop28(5),
  "|",
  inALoop28(8),
  "|",
  inALoop28(0),
);
console.log(
  "in a loop, a key on either side of the spread, a number, with a write through another name:",
  inALoop29(5),
  "|",
  inALoop29(8),
  "|",
  inALoop29(0),
);
console.log(
  "in a loop, a key on either side of the spread, a number:",
  inALoop30(5),
  "|",
  inALoop30(8),
  "|",
  inALoop30(0),
);
console.log(
  "in a loop, a key on either side of the spread, a text, with a write through another name:",
  inALoop31(5),
  "|",
  inALoop31(8),
  "|",
  inALoop31(0),
);
console.log(
  "in a loop, a key on either side of the spread, a text:",
  inALoop32(5),
  "|",
  inALoop32(8),
  "|",
  inALoop32(0),
);
console.log(
  "in a loop, a key on either side of the spread, a symbol, with a write through another name:",
  inALoop33(5),
  "|",
  inALoop33(8),
  "|",
  inALoop33(0),
);
console.log(
  "in a loop, a key on either side of the spread, a symbol:",
  inALoop34(5),
  "|",
  inALoop34(8),
  "|",
  inALoop34(0),
);
console.log(
  "in a loop, a key on either side of the spread, a number that repeats, with a write through another name:",
  inALoop35(5),
  "|",
  inALoop35(8),
  "|",
  inALoop35(0),
);
console.log(
  "in a loop, a key on either side of the spread, a number that repeats:",
  inALoop36(5),
  "|",
  inALoop36(8),
  "|",
  inALoop36(0),
);
console.log(
  "in a loop, a key on either side of the spread, a text that repeats, with a write through another name:",
  inALoop37(5),
  "|",
  inALoop37(8),
  "|",
  inALoop37(0),
);
console.log(
  "in a loop, a key on either side of the spread, a text that repeats:",
  inALoop38(5),
  "|",
  inALoop38(8),
  "|",
  inALoop38(0),
);
console.log(
  "in a loop, a key on either side of the spread, __proto__ but for the first, with a write through another name:",
  inALoop39(5),
  "|",
  inALoop39(8),
  "|",
  inALoop39(0),
);
console.log(
  "in a loop, a key on either side of the spread, __proto__ but for the first:",
  inALoop40(5),
  "|",
  inALoop40(8),
  "|",
  inALoop40(0),
);
console.log(
  "in a loop, a key on either side of the spread, __proto__ in every turn, with a write through another name:",
  inALoop41(5),
  "|",
  inALoop41(8),
  "|",
  inALoop41(0),
);
console.log(
  "in a loop, a key on either side of the spread, __proto__ in every turn:",
  inALoop42(5),
  "|",
  inALoop42(8),
  "|",
  inALoop42(0),
);
console.log(
  "in a loop, the spread on either side of the key, a number, with a write through another name:",
  inALoop43(5),
  "|",
  inALoop43(8),
  "|",
  inALoop43(0),
);
console.log(
  "in a loop, the spread on either side of the key, a number:",
  inALoop44(5),
  "|",
  inALoop44(8),
  "|",
  inALoop44(0),
);
console.log(
  "in a loop, the spread on either side of the key, a text, with a write through another name:",
  inALoop45(5),
  "|",
  inALoop45(8),
  "|",
  inALoop45(0),
);
console.log(
  "in a loop, the spread on either side of the key, a text:",
  inALoop46(5),
  "|",
  inALoop46(8),
  "|",
  inALoop46(0),
);
console.log(
  "in a loop, the spread on either side of the key, a symbol, with a write through another name:",
  inALoop47(5),
  "|",
  inALoop47(8),
  "|",
  inALoop47(0),
);
console.log(
  "in a loop, the spread on either side of the key, a symbol:",
  inALoop48(5),
  "|",
  inALoop48(8),
  "|",
  inALoop48(0),
);
console.log(
  "in a loop, the spread on either side of the key, a number that repeats, with a write through another name:",
  inALoop49(5),
  "|",
  inALoop49(8),
  "|",
  inALoop49(0),
);
console.log(
  "in a loop, the spread on either side of the key, a number that repeats:",
  inALoop50(5),
  "|",
  inALoop50(8),
  "|",
  inALoop50(0),
);
console.log(
  "in a loop, the spread on either side of the key, a text that repeats, with a write through another name:",
  inALoop51(5),
  "|",
  inALoop51(8),
  "|",
  inALoop51(0),
);
console.log(
  "in a loop, the spread on either side of the key, a text that repeats:",
  inALoop52(5),
  "|",
  inALoop52(8),
  "|",
  inALoop52(0),
);
console.log(
  "in a loop, the spread on either side of the key, __proto__ but for the first, with a write through another name:",
  inALoop53(5),
  "|",
  inALoop53(8),
  "|",
  inALoop53(0),
);
console.log(
  "in a loop, the spread on either side of the key, __proto__ but for the first:",
  inALoop54(5),
  "|",
  inALoop54(8),
  "|",
  inALoop54(0),
);
console.log(
  "in a loop, the spread on either side of the key, __proto__ in every turn, with a write through another name:",
  inALoop55(5),
  "|",
  inALoop55(8),
  "|",
  inALoop55(0),
);
console.log(
  "in a loop, the spread on either side of the key, __proto__ in every turn:",
  inALoop56(5),
  "|",
  inALoop56(8),
  "|",
  inALoop56(0),
);
console.log(
  "in a loop, two keys, then two spreads, a number, with a write through another name:",
  inALoop57(5),
  "|",
  inALoop57(8),
  "|",
  inALoop57(0),
);
console.log("in a loop, two keys, then two spreads, a number:", inALoop58(5), "|", inALoop58(8), "|", inALoop58(0));
console.log(
  "in a loop, two keys, then two spreads, a text, with a write through another name:",
  inALoop59(5),
  "|",
  inALoop59(8),
  "|",
  inALoop59(0),
);
console.log("in a loop, two keys, then two spreads, a text:", inALoop60(5), "|", inALoop60(8), "|", inALoop60(0));
console.log(
  "in a loop, two keys, then two spreads, a symbol, with a write through another name:",
  inALoop61(5),
  "|",
  inALoop61(8),
  "|",
  inALoop61(0),
);
console.log("in a loop, two keys, then two spreads, a symbol:", inALoop62(5), "|", inALoop62(8), "|", inALoop62(0));
console.log(
  "in a loop, two keys, then two spreads, a number that repeats, with a write through another name:",
  inALoop63(5),
  "|",
  inALoop63(8),
  "|",
  inALoop63(0),
);
console.log(
  "in a loop, two keys, then two spreads, a number that repeats:",
  inALoop64(5),
  "|",
  inALoop64(8),
  "|",
  inALoop64(0),
);
console.log(
  "in a loop, two keys, then two spreads, a text that repeats, with a write through another name:",
  inALoop65(5),
  "|",
  inALoop65(8),
  "|",
  inALoop65(0),
);
console.log(
  "in a loop, two keys, then two spreads, a text that repeats:",
  inALoop66(5),
  "|",
  inALoop66(8),
  "|",
  inALoop66(0),
);
console.log(
  "in a loop, two keys, then two spreads, __proto__ but for the first, with a write through another name:",
  inALoop67(5),
  "|",
  inALoop67(8),
  "|",
  inALoop67(0),
);
console.log(
  "in a loop, two keys, then two spreads, __proto__ but for the first:",
  inALoop68(5),
  "|",
  inALoop68(8),
  "|",
  inALoop68(0),
);
console.log(
  "in a loop, two keys, then two spreads, __proto__ in every turn, with a write through another name:",
  inALoop69(5),
  "|",
  inALoop69(8),
  "|",
  inALoop69(0),
);
console.log(
  "in a loop, two keys, then two spreads, __proto__ in every turn:",
  inALoop70(5),
  "|",
  inALoop70(8),
  "|",
  inALoop70(0),
);
console.log("outside a loop, the key, then the spread, a number:", outside71(0), "|", outside71(1));
console.log("outside a loop, the key, then the spread, a text:", outside72(0), "|", outside72(1));
console.log("outside a loop, the key, then the spread, a symbol:", outside73(0), "|", outside73(1));
console.log("outside a loop, the key, then the spread, a number that repeats:", outside74(0), "|", outside74(1));
console.log("outside a loop, the key, then the spread, a text that repeats:", outside75(0), "|", outside75(1));
console.log("outside a loop, the key, then the spread, __proto__ but for the first:", outside76(0), "|", outside76(1));
console.log("outside a loop, the key, then the spread, __proto__ in every turn:", outside77(0), "|", outside77(1));
console.log("outside a loop, the spread, then the key, a number:", outside78(0), "|", outside78(1));
console.log("outside a loop, the spread, then the key, a text:", outside79(0), "|", outside79(1));
console.log("outside a loop, the spread, then the key, a symbol:", outside80(0), "|", outside80(1));
console.log("outside a loop, the spread, then the key, a number that repeats:", outside81(0), "|", outside81(1));
console.log("outside a loop, the spread, then the key, a text that repeats:", outside82(0), "|", outside82(1));
console.log("outside a loop, the spread, then the key, __proto__ but for the first:", outside83(0), "|", outside83(1));
console.log("outside a loop, the spread, then the key, __proto__ in every turn:", outside84(0), "|", outside84(1));
console.log("outside a loop, a key on either side of the spread, a number:", outside85(0), "|", outside85(1));
console.log("outside a loop, a key on either side of the spread, a text:", outside86(0), "|", outside86(1));
console.log("outside a loop, a key on either side of the spread, a symbol:", outside87(0), "|", outside87(1));
console.log(
  "outside a loop, a key on either side of the spread, a number that repeats:",
  outside88(0),
  "|",
  outside88(1),
);
console.log(
  "outside a loop, a key on either side of the spread, a text that repeats:",
  outside89(0),
  "|",
  outside89(1),
);
console.log(
  "outside a loop, a key on either side of the spread, __proto__ but for the first:",
  outside90(0),
  "|",
  outside90(1),
);
console.log(
  "outside a loop, a key on either side of the spread, __proto__ in every turn:",
  outside91(0),
  "|",
  outside91(1),
);
console.log("outside a loop, the spread on either side of the key, a number:", outside92(0), "|", outside92(1));
console.log("outside a loop, the spread on either side of the key, a text:", outside93(0), "|", outside93(1));
console.log("outside a loop, the spread on either side of the key, a symbol:", outside94(0), "|", outside94(1));
console.log(
  "outside a loop, the spread on either side of the key, a number that repeats:",
  outside95(0),
  "|",
  outside95(1),
);
console.log(
  "outside a loop, the spread on either side of the key, a text that repeats:",
  outside96(0),
  "|",
  outside96(1),
);
console.log(
  "outside a loop, the spread on either side of the key, __proto__ but for the first:",
  outside97(0),
  "|",
  outside97(1),
);
console.log(
  "outside a loop, the spread on either side of the key, __proto__ in every turn:",
  outside98(0),
  "|",
  outside98(1),
);
console.log("outside a loop, two keys, then two spreads, a number:", outside99(0), "|", outside99(1));
console.log("outside a loop, two keys, then two spreads, a text:", outside100(0), "|", outside100(1));
console.log("outside a loop, two keys, then two spreads, a symbol:", outside101(0), "|", outside101(1));
console.log("outside a loop, two keys, then two spreads, a number that repeats:", outside102(0), "|", outside102(1));
console.log("outside a loop, two keys, then two spreads, a text that repeats:", outside103(0), "|", outside103(1));
console.log(
  "outside a loop, two keys, then two spreads, __proto__ but for the first:",
  outside104(0),
  "|",
  outside104(1),
);
console.log("outside a loop, two keys, then two spreads, __proto__ in every turn:", outside105(0), "|", outside105(1));
