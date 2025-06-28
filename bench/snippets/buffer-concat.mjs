import { bench, run } from "../runner.mjs";

for (let size of [32, 2048, 1024 * 16, 1024 * 1024 * 2, 1024 * 1024 * 16]) {
  const first = Buffer.allocUnsafe(size);
  const second = Buffer.allocUnsafe(size);
  const third = Buffer.allocUnsafe(size);
  first.fill(1);
  second.fill(2);
  third.fill(3);

  const check = true;

  const buffers = [first, second, third];

  const fmt =
    size > 1024 * 1024
      ? new Intl.NumberFormat(undefined, { unit: "megabyte", style: "unit" })
      : size > 1024
        ? new Intl.NumberFormat(undefined, { unit: "kilobyte", style: "unit" })
        : new Intl.NumberFormat(undefined, { unit: "byte", style: "unit" });

  bench(
    `Buffer.concat(${fmt.format(
      Number((size > 1024 * 1024 ? size / 1024 / 1024 : size > 1024 ? size / 1024 : size).toFixed(2)),
    )} x 3)`,
    () => {
      const result = Buffer.concat(buffers);
      if (check) {
        if (result.byteLength != size * 3) throw new Error("Wrong length");
        if (result[0] != 1) throw new Error("Wrong first byte");
        if (result[size] != 2) throw new Error("Wrong second byte");
        if (result[size * 2] != 3) throw new Error("Wrong third byte");

        result[0] = 10;
        if (first[0] != 1) throw new Error("First buffer was modified");

        result[size] = 20;
        if (second[0] != 2) throw new Error("Second buffer was modified");

        result[size * 2] = 30;
        if (third[0] != 3) throw new Error("Third buffer was modified");
      }
    },
  );
}

const chunk = Buffer.alloc(16);
chunk.fill("3");
const array = Array.from({ length: 100 }, () => chunk);
bench("Buffer.concat 100 tiny chunks", () => {
  return Buffer.concat(array);
});

await run();
