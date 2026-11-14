// A loop that moves elements counts in a variable of the file. It is copied into the body of the file, behind the variable's store.
let n = 0, moved = 0;
const filters = {
  copy(pixels, start, width, step, raw) { for (let x = 0; x < width; x++) { n++; raw[step + x] = pixels[start + x]; } return raw; },
  back(pixels, width, raw) { for (let x = width - 1; x >= 0; x--) { raw[x] = pixels[x]; moved++; } return raw; },
};
class Filter { static fill(raw, width) { for (let x = 0; x < width; x++) { raw[x] = 7; n++; } return raw; } move(raw, width) { for (let x = 0; x < width; x++) { n++; raw[x] = raw[x + 1]; } return raw; } }
const values = Array.from({ length: 24 }, (_, k) => (k * 37 + 11) & 255);
const show = value => Array.from({ length: Math.min(value.length, 12) }, (_, k) => k in value ? String(value[k]) : ".").join();
const shared = Buffer.from(values); console.log(show(filters.copy(shared, 0, 12, 1, shared)), show(filters.copy(new Uint8Array(shared.buffer, shared.byteOffset, 12), 0, 8, 3, shared)), n);
console.log(show(filters.back(values, 12, [])), show(filters.back(new Uint8Array(values), 5, new Float64Array(6))), moved);
console.log(show(Filter.fill([], 4)), show(Filter.fill(new Uint8Array(3), 3)), show(new Filter().move(values.slice(), 6)), show(new Filter().move(new Uint8Array(values), 6)), n);
const attempt = f => { try { return show(f()); } catch (error) { return error.name; } };
const late = { copy(pixels, width, raw) { for (let x = 0; x < width; x++) { count++; raw[x] = pixels[x]; } return raw; } };
console.log(attempt(() => late.copy(values, 3, [])), attempt(() => late.copy(shared, 3, new Uint8Array(4))), attempt(() => late.copy(values, 0, [])));
let count = 0;
console.log(show(late.copy(values, 3, [])), show(late.copy(shared, 3, new Uint8Array(4))), count);
