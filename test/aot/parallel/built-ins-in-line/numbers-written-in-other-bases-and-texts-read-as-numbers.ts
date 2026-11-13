function written(value: number, radix: number) {
  return "<" + value.toString(radix) + ">";
}
for (const value of [0, -0, 1, -1, 255, 256, 4294967295, -2147483648, 0.5, -255.75, 1e21, 123456789012345680000, NaN, Infinity, -Infinity])
  console.log(value, written(value, 2), written(value, 8), written(value, 10), written(value, 16), written(value, 36));
for (const radix of [1, 37, 0, NaN, 2.9]) {
  try {
    console.log(radix, written(255, radix));
  } catch (error) {
    console.log(radix, (error as Error).constructor.name);
  }
}
function read(text: string) {
  return Number(text);
}
const wide = " ";
for (const text of ["", " ", "12", " 12 ", "1e3", "0x1f", "0b101", "0o17", "-0", "+5", "1_000", "12px", ".5", "5.", "Infinity", "-Infinity", "infinity", wide + "7" + wide, "١", "7€", "﻿8"]) {
  const value = read(text);
  console.log(JSON.stringify(text), Object.is(value, -0) ? "-0" : value, +text === value || (value !== value && +text !== +text));
}
