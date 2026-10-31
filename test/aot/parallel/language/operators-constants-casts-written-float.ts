// Applies operators to constants that stand behind casts and prints the bytes of the results.
const bytes = new Uint8Array(8),
  number = new Float64Array(bytes.buffer);
const text = (value: number) => {
  number[0] = value;
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0"))
    .reverse()
    .join("")
    .slice(0, 4);
};
const nothing = undefined;
console.log("a", text(-(undefined as any)));
console.log("b", text(-undefined!));
console.log("c", text(-(void 0 as any)));
console.log("d", text(-(nothing as any)));
console.log("e", text(-(undefined as unknown as number)));
console.log("f", text(-("x" as any)));
console.log("g", text(-(NaN as any)));
console.log("h", text(-(NaN as number)));
console.log("i", text(-((0 / 0) as any)));
console.log("j", text(-({} as any)));
console.log("k", text(-+undefined!));
console.log("l", text(-(<any>undefined)));
console.log("m", text(-(undefined satisfies undefined as any)));
console.log(
  "n",
  text((undefined as any) - 0),
  text(0 - (undefined as any)),
  text((undefined as any) * -1),
  text(-1 * (undefined as any)),
  text((undefined as any) / -1),
);
console.log("o", text(-(null as any)), text(-(true as any)), text(-("" as any)), text(-("0" as any)));
