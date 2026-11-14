function make(number) {
  return { a: number, b: "t" + number };
}

const attributes = [
  { value: 5, enumerable: false, configurable: true },
  { value: 5, enumerable: true, configurable: true, writable: false },
  { value: 5, enumerable: true, configurable: true, writable: true },
];

function show(object) {
  let names = "";
  for (const name in object) names += name + " ";
  console.log(
    Object.values(object).join(),
    Object.keys(object).join(),
    Object.entries(object).join("|"),
    JSON.stringify(object),
    JSON.stringify({ ...object }),
    JSON.stringify(Object.assign({}, object)),
    JSON.stringify(Object.assign(make(0), object)),
    names,
  );
}

for (const index of [0, 1, 7, 100000, 4294967294]) {
  for (const attribute of attributes) {
    const object = make(index);
    Object.defineProperty(object, index, attribute);
    show(object);
    delete object[index];
    show(object);
    object[index] = 6;
    show(object);
    delete object[index];
    object.c = 7;
    show(object);
    delete object.c;
    show(object);
  }
}
