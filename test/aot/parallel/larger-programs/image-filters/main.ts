// Images over typed arrays: drawing, filters as a pipeline of passes, edges, histograms, a palette by median cut, dithering, components, resizing, a run-length format written and read, in two modules
import { Bitmap, Draw, Kernel, Blur, Sharpen, Emboss, Edges, Median, Tone, Equalize, Resize, Palette, Runs, components, Pipeline } from "./lib";
const scene = Bitmap.from(120, 90, (x, y) => [(x * 2 + y) & 255,
  (Math.sin(x / 9) * 60 + 128 + y) | 0, ((x ^ y) * 3) & 255]);
for (let i = 0; i < 9; i++) Draw.disc(scene, 12 + i * 12, 20 + (i * 17) % 50, 5 + (i % 4),
  [250 - i * 25, i * 28, (i * 77) % 256]);
for (let i = 0; i < 12; i++) Draw.line(scene, (i * 37) % 120, 0, (i * 53) % 120, 89, [255, 255,
  255]);
console.log(scene.hash, scene.mean.toFixed(4), Draw.fill(scene, 12, 20, [1, 2, 3]),
  Draw.fill(scene, 12, 20, [1, 2, 3]));
const pipeline = new Pipeline().add(new Blur(), new Sharpen(), new Median(), new Equalize(),
  new Tone("gamma", v => 255 * Math.pow(v / 255, 0.8)), new Blur(5), new Emboss(),
  new Resize(60, 45, true), new Edges(60), new Resize(90, 30, false));
let image = pipeline.run(scene);
console.log(pipeline.log.join("\n"));
console.log(image.text(3));
let mixed = 0;
for (let i = 0; i < 6; i++) {
  image = new Pipeline().add(i % 2 ? new Blur() : new Sharpen(), new Tone("invert",
    v => 255 - v + i), new Edges(20 + i)).run(scene);
  mixed = (mixed * 31 + image.hash) >>> 0;
}
console.log(mixed);
console.log([...Equalize.histogram(scene)].map((n, i) => [n, i]).sort((a, b) => b[0] - a[0] ||
  a[1] - b[1]).slice(0, 4).join(" "));
for (const count of [2, 8, 16]) {
  const palette = Palette.medianCut(scene, count), indexes = palette.dither(scene),
    packed = Runs.pack(indexes), back = Runs.unpack(packed);
  let h = 0;
  for (const v of indexes) h = (h * 31 + v) >>> 0;
  console.log(count, palette.colors.slice(0, 3).map(c => c.join("-")).join(" "), h,
    packed.length, back.length === indexes.length && back.every((v, i) => v === indexes[i]));
}
console.log(JSON.stringify(components(scene, l => l > 180)),
  JSON.stringify(components(new Edges(200).apply(scene), l => l > 0)));
for (const bad of [() => new Bitmap(0, 5),
  () => new (class extends Kernel { readonly name = "bad"; constructor() {
  super(3, [1]);
}
})(), () => Runs.unpack(Uint8Array.of(5, 1)), () => Runs.unpack(Uint8Array.of(0))]) try {
  bad();
} catch (e) {
  console.log((e as Error).name, (e as Error).message);
}
