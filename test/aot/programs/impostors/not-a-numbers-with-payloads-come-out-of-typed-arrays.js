function show(value) {
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "object" && value !== null) return "object";
  return typeof value + " " + String(value);
}

const payloads = [
  [0x7ff80000, 0],
  [0xfff80000, 0],
  [0x7ff00000, 1],
  [0xfff00000, 1],
  [0x7ffa0000, 0],
  [0x7ffb0000, 0],
  [0x7ffc0000, 0],
  [0x7ffe0000, 0],
  [0xfffa0000, 0],
  [0xfffc0000, 42],
  [0xfffc0000, 0],
  [0xfffd0000, 7],
  [0xfffe0000, 0],
  [0xfffe0000, 2],
  [0xfffe0000, 6],
  [0xfffe0000, 7],
  [0xfffe0000, 10],
  [0xfffe0000, 0x1000],
  [0xffff0000, 0],
  [0xffffffff, 0xffffffff],
  [0x7fffffff, 0xffffffff],
];

const floatPayloads = [
  0x7fc00000, 0xffc00000, 0x7f800001, 0x7fd00000, 0x7fd80000, 0x7fe00000, 0xffe00000, 0xfff00000, 0xffffffff,
];

function firstOf(floats) {
  return floats[0];
}

function sumOf(floats) {
  let total = 0;
  for (let i = 0; i < floats.length; i++) total += floats[i];
  return total;
}

function kindOfFirst(floats) {
  return typeof floats[0];
}

function copyOut(floats) {
  const list = [];
  for (let i = 0; i < floats.length; i++) list.push(floats[i]);
  return list;
}

function keep(floats) {
  return { kept: floats[0], other: 0.5 };
}

function keptOf(holder) {
  return holder.kept;
}

function firstOrText(floats) {
  return floats[0] ?? "nullish";
}

function isFirstItself(floats) {
  const first = floats[0];
  return first === first;
}

function negated(floats) {
  return -floats[0];
}

function viewed(view) {
  return view.getFloat64(0);
}

const honest = new Float64Array([0.5, 1.5, 2.5]);
let warm = 0;
for (let i = 0; i < 2000; i++) {
  warm +=
    firstOf(honest) +
    sumOf(honest) +
    kindOfFirst(honest).length +
    copyOut(honest).length +
    keptOf(keep(honest)) +
    firstOrText(honest) +
    negated(honest) +
    (isFirstItself(honest) ? 1 : 0);
}
console.log("2000 honest rounds:", warm);

function report(label, floats) {
  const list = copyOut(floats);
  const holder = keep(floats);
  console.log(
    label + ":",
    show(firstOf(floats)),
    "| sum",
    show(sumOf(floats)),
    "| typeof",
    kindOfFirst(floats),
    "| copied",
    show(list[0]),
    0 in list,
    list.length,
    "| kept",
    show(keptOf(holder)),
    "kept" in holder,
    JSON.stringify(holder),
    "| or",
    show(firstOrText(floats)),
    "| itself",
    isFirstItself(floats),
    "| negated",
    show(negated(floats)),
    "| is NaN",
    Object.is(firstOf(floats), NaN),
  );
}

for (const [high, low] of payloads) {
  const label = high.toString(16) + " " + low.toString(16);
  report("Float64Array " + label, new Float64Array(new Uint32Array([low, high]).buffer));
  const view = new DataView(new ArrayBuffer(8));
  view.setUint32(0, high);
  view.setUint32(4, low);
  console.log(
    "DataView " + label + ":",
    show(viewed(view)),
    typeof viewed(view),
    show([viewed(view)][0]),
    show({ kept: viewed(view) }.kept),
  );
}

for (const bits of floatPayloads)
  report("Float32Array " + bits.toString(16), new Float32Array(new Uint32Array([bits]).buffer));

const mixed = new Float64Array(new Uint32Array([0, 0x3ff00000, 2, 0xfffe0000, 0, 0x40000000]).buffer);
report("a payload between one and two", mixed);
console.log("copied:", copyOut(mixed).map(show).join(", "));
console.log("sorted:", Array.from(mixed).sort().map(show).join(", "));
console.log(
  "mapped:",
  Array.from(mixed, value => value * 2)
    .map(show)
    .join(", "),
);
report("honest again", honest);
