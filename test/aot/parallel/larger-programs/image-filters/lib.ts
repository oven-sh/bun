// Images over typed arrays: drawing, filters as a pipeline of passes, edges, histograms, a palette by median cut, dithering, components, resizing, a run-length format written and read
export type Pixel = readonly [r: number, g: number, b: number];
export interface Pass {
  readonly name: string;
  apply(image: Bitmap): Bitmap
}
export enum Channel {
  Red, Green, Blue
}
export class Bitmap {
  readonly data: Uint8ClampedArray;
  constructor(readonly width: number, readonly height: number, data?: Uint8ClampedArray) {
    if (!(width > 0 && height > 0)) throw new RangeError(`size ${width}x${height}`);
    this.data = data ?? new Uint8ClampedArray(width * height * 3);
  }
  static from(width: number, height: number, f: (x: number, y: number) => Pixel) {
    const b = new Bitmap(width, height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) b.set(x, y, f(x, y));
    return b;
  }
  get(x: number, y: number): Pixel {
    const i = (y * this.width + x) * 3;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }
  set(x: number, y: number, [r, g, b]: Pixel) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 3;
    this.data[i] = r;
    this.data[i + 1] = g;
    this.data[i + 2] = b;
  }
  level(x: number, y: number) {
    const i = (y * this.width + x) * 3;
    return (this.data[i] * 77 + this.data[i + 1] * 150 + this.data[i + 2] * 29) >> 8;
  }
  copy() {
    return new Bitmap(this.width, this.height, this.data.slice());
  }
  map(f: (p: Pixel, x: number, y: number) => Pixel): Bitmap {
    return Bitmap.from(this.width, this.height, (x, y) => f(this.get(x, y), x, y));
  }
  get hash() {
    let h = 2166136261;
    for (let i = 0; i < this.data.length; i++) h = Math.imul(h ^ this.data[i], 16777619);
    return h >>> 0;
  }
  get mean() {
    let s = 0;
    for (const v of this.data) s += v;
    return s / this.data.length;
  }
  text(step = 1) {
    const marks = " .:-=+*#%@";
    let out = "";
    for (let y = 0; y < this.height; y += step * 2) {
      for (let x = 0; x < this.width; x += step) out += marks[Math.min(9, (this.level(x,
        y) * 10) >> 8)];
      out += "/";
    }
    return out;
  }
}
export namespace Draw {
  export function line(b: Bitmap, x0: number, y0: number, x1: number, y1: number, p: Pixel) {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1,
      sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    for (;;) {
      b.set(x0, y0, p);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * error;
      if (e2 >= dy) {
        error += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        error += dx;
        y0 += sy;
      }
    }
  }
  export function disc(b: Bitmap, cx: number, cy: number, r: number, p: Pixel) {
    for (let y = -r; y <= r; y++) {
      const w = Math.floor(Math.sqrt(r * r - y * y));
      for (let x = -w; x <= w; x++) b.set(cx + x, cy + y, p);
    }
  }
  export function fill(b: Bitmap, x: number, y: number, p: Pixel): number {
    const from = b.get(x, y).join();
    if (from === p.join()) return 0;
    const stack = [[x, y]];
    let n = 0;
    while (stack.length) {
      const [px, py] = stack.pop()!;
      if (px < 0 || py < 0 || px >= b.width || py >= b.height || b.get(px,
        py).join() !== from) continue;
      b.set(px, py, p);
      n++;
      stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
    }
    return n;
  }
}
export abstract class Kernel implements Pass {
  abstract readonly name: string;
  constructor(readonly size: number, readonly weights: readonly number[], readonly offset = 0) {
    if (weights.length !== size * size) throw new RangeError("kernel of " + weights.length);
  }
  apply(image: Bitmap): Bitmap {
    const {
      width, height, data
  } = image, out = new Bitmap(width, height), half = this.size >> 1;
    const total = this.weights.reduce((a, b) => a + b, 0) || 1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      for (let ky = 0; ky < this.size; ky++) {
        const sy = Math.max(0, Math.min(height - 1, y + ky - half));
        for (let kx = 0; kx < this.size; kx++) {
          const sx = Math.max(0, Math.min(width - 1, x + kx - half)),
            w = this.weights[ky * this.size + kx], i = (sy * width + sx) * 3;
          r += data[i] * w;
          g += data[i + 1] * w;
          b += data[i + 2] * w;
        }
      }
      const i = (y * width + x) * 3;
      out.data[i] = r / total + this.offset;
      out.data[i + 1] = g / total + this.offset;
      out.data[i + 2] = b / total + this.offset;
    }
    return out;
  }
}
export class Blur extends Kernel {
  readonly name = "blur";
  constructor(size = 3) {
    super(size, Array.from({ length: size * size }, (_, i) => {
      const half = size >> 1, x = (i % size) - half, y = ((i / size) | 0) - half;
      return Math.round(100 * Math.exp(-(x * x + y * y) / (half + 0.5)));
  }));
  }
}
export class Sharpen extends Kernel {
  readonly name = "sharpen";
  constructor() {
    super(3, [0, -1, 0, -1, 5, -1, 0, -1, 0]);
  }
}
export class Emboss extends Kernel {
  readonly name = "emboss";
  constructor() {
    super(3, [-2, -1, 0, -1, 1, 1, 0, 1, 2], 10);
  }
}
export class Edges implements Pass {
  readonly name = "edges";
  constructor(readonly threshold: number) {
  }
  apply(image: Bitmap): Bitmap {
    const {
      width, height
  } = image;
    return Bitmap.from(width, height, (x, y) => {
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return [0, 0, 0];
      const l = (dx: number, dy: number) => image.level(x + dx, y + dy);
      const gx = l(1, -1) + 2 * l(1, 0) + l(1, 1) - l(-1, -1) - 2 * l(-1, 0) - l(-1, 1),
        gy = l(-1, 1) + 2 * l(0, 1) + l(1, 1) - l(-1, -1) - 2 * l(0, -1) - l(1, -1);
      const m = Math.hypot(gx, gy);
      const v = m > this.threshold ? Math.min(255, m) : 0;
      return [v, v, v];
  });
  }
}
export class Median implements Pass {
  readonly name = "median";
  apply(image: Bitmap): Bitmap {
    const list = new Uint8Array(9);
    return image.map((_, x, y) => {
      const out: number[] = [];
      for (const c of [Channel.Red, Channel.Green, Channel.Blue]) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const sx = Math.max(0, Math.min(image.width - 1, x + dx)), sy = Math.max(0,
            Math.min(image.height - 1, y + dy));
          list[n++] = image.data[(sy * image.width + sx) * 3 + c];
        }
        list.sort();
        out.push(list[4]);
      }
      return out as unknown as Pixel;
  });
  }
}
export class Tone implements Pass {
  readonly #table = new Uint8ClampedArray(256);
  constructor(readonly name: string, curve: (v: number) => number) {
    for (let i = 0; i < 256; i++) this.#table[i] = curve(i);
  }
  apply(image: Bitmap) {
    return image.map(([r, g, b]) => [this.#table[r], this.#table[g], this.#table[b]]);
  }
}
export class Equalize implements Pass {
  readonly name = "equalize";
  static histogram(image: Bitmap): Uint32Array {
    const h = new Uint32Array(256);
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) h[image.level(x,
      y)]++;
    return h;
  }
  apply(image: Bitmap) {
    const h = Equalize.histogram(image), table = new Uint8Array(256);
    let sum = 0;
    const n = image.width * image.height;
    for (let i = 0; i < 256; i++) {
      sum += h[i];
      table[i] = Math.round((255 * sum) / n);
    }
    return image.map((p, x, y) => {
      const l = image.level(x, y), k = l ? table[l] / l : 0;
      return [p[0] * k, p[1] * k, p[2] * k];
  });
  }
}
export class Resize implements Pass {
  readonly name: string;
  constructor(readonly width: number, readonly height: number, readonly smooth: boolean) {
    this.name = `${smooth ? "smooth" : "rough"} ${width}x${height}`;
  }
  apply(image: Bitmap) {
    const fx = image.width / this.width, fy = image.height / this.height;
    return Bitmap.from(this.width, this.height, (x, y) => {
      if (!this.smooth) return image.get(Math.floor(x * fx), Math.floor(y * fy));
      const sx = Math.max(0, Math.min(image.width - 1.001, (x + 0.5) * fx - 0.5)),
        sy = Math.max(0, Math.min(image.height - 1.001, (y + 0.5) * fy - 0.5)),
        x0 = Math.floor(sx), y0 = Math.floor(sy), tx = sx - x0, ty = sy - y0;
      const p = [image.get(x0, y0), image.get(Math.min(x0 + 1, image.width - 1), y0),
        image.get(x0, Math.min(y0 + 1, image.height - 1)), image.get(Math.min(x0 + 1,
        image.width - 1), Math.min(y0 + 1, image.height - 1))];
      return [0, 1,
        2].map(c => (p[0][c] * (1 - tx) + p[1][c] * tx) * (1 - ty) + (p[2][c] * (1 - tx) + p[3][c] * tx) * ty) as unknown as Pixel;
  });
  }
}
export class Palette {
  private constructor(readonly colors: readonly Pixel[]) {
  }
  static medianCut(image: Bitmap, count: number): Palette {
    const seen = new Map<number, {
      p: Pixel;
      n: number
    }
    >();
    for (let i = 0; i < image.data.length; i += 3) {
      const key = (image.data[i] << 16) | (image.data[i + 1] << 8) | image.data[i + 2];
      const s = seen.get(key);
      if (s) s.n++;
      else seen.set(key, { p: [image.data[i], image.data[i + 1], image.data[i + 2]], n: 1 });
    }
    const boxes = [[...seen.values()]];
    while (boxes.length < count) {
      let best = -1, axis = 0, width = 0;
      boxes.forEach((box, k) => {
        if (box.length < 2) return;
        for (let c = 0; c < 3; c++) {
          let lo = 255, hi = 0;
          for (const { p } of box) {
            lo = Math.min(lo, p[c]);
            hi = Math.max(hi, p[c]);
          }
          if (hi - lo > width) {
            width = hi - lo;
            best = k;
            axis = c;
          }
        }
    });
      if (best < 0) break;
      const box = boxes[best].sort((a, b) => a.p[axis] - b.p[axis] || a.p[0] - b.p[0] ||
        a.p[1] - b.p[1] || a.p[2] - b.p[2]);
      const half = box.reduce((s, x) => s + x.n, 0) / 2;
      let sum = 0, at = 0;
      while (at < box.length - 1 && (sum += box[at].n) < half) at++;
      boxes.splice(best, 1, box.slice(0, at + 1), box.slice(at + 1));
    }
    return new Palette(boxes.filter(b => b.length).map(b => {
      const n = b.reduce((s, x) => s + x.n, 0);
      return [0, 1, 2].map(c => Math.round(b.reduce((s, x) => s + x.p[c] * x.n,
        0) / n)) as unknown as Pixel;
  }));
  }
  nearest(p: readonly number[]): number {
    let best = 0, least = Infinity;
    this.colors.forEach((c, i) => {
      const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2;
      if (d < least) {
        least = d;
        best = i;
      }
  });
    return best;
  }
  dither(image: Bitmap): Uint8Array {
    const {
      width, height
  } = image, out = new Uint8Array(width * height), work = Float32Array.from(image.data);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3, at = this.nearest([work[i], work[i + 1], work[i + 2]]);
      out[y * width + x] = at;
      for (let c = 0; c < 3; c++) {
        const e = work[i + c] - this.colors[at][c];
        for (const [dx, dy, w] of [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < width &&
            ny < height) work[(ny * width + nx) * 3 + c] += (e * w) / 16;
        }
      }
    }
    return out;
  }
}
export namespace Runs {
  export function pack(bytes: Uint8Array): Uint8Array {
    const out: number[] = [];
    for (let i = 0; i < bytes.length; ) {
      let n = 1;
      while (i + n < bytes.length && n < 127 && bytes[i + n] === bytes[i]) n++;
      if (n > 2) {
        out.push(128 + n, bytes[i]);
        i += n;
        continue;
      }
      let k = i;
      while (k < bytes.length && k - i < 127 && !(bytes[k] === bytes[k + 1] &&
        bytes[k] === bytes[k + 2])) k++;
      out.push(k - i, ...bytes.subarray(i, k));
      i = k;
    }
    return Uint8Array.from(out);
  }
  export function unpack(bytes: Uint8Array): Uint8Array {
    const out: number[] = [];
    for (let i = 0; i < bytes.length; ) {
      const n = bytes[i++];
      if (n > 128) {
        for (let k = 0; k < n - 128; k++) out.push(bytes[i]);
        i++;
    } else {
        if (n === 0 || i + n > bytes.length) throw new RangeError("bad run at " + (i - 1));
        out.push(...bytes.subarray(i, i + n));
        i += n;
      }
    }
    return Uint8Array.from(out);
  }
}
export function components(image: Bitmap, test: (level: number) => boolean): {
  count: number;
  largest: number;
  boxes: string[]
}
{
  const {
    width, height
} = image, label = new Int32Array(width * height);
  let count = 0, largest = 0;
  const boxes: string[] = [];
  for (let s = 0; s < label.length; s++) {
    if (label[s] || !test(image.level(s % width, (s / width) | 0))) continue;
    count++;
    let size = 0, x0 = width, x1 = 0, y0 = height, y1 = 0;
    const queue = [s];
    label[s] = count;
    for (let q = 0; q < queue.length; q++) {
      const x = queue[q] % width, y = (queue[q] / width) | 0;
      size++;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const k = ny * width + nx;
        if (!label[k] && test(image.level(nx, ny))) {
          label[k] = count;
          queue.push(k);
        }
      }
    }
    largest = Math.max(largest, size);
    if (boxes.length < 4) boxes.push(`${x0},${y0}-${x1},${y1}:${size}`);
  }
  return {
    count, largest, boxes
};
}
export class Pipeline {
  readonly #passes: Pass[] = [];
  readonly log: string[] = [];
  add(...p: Pass[]): this {
    this.#passes.push(...p);
    return this;
  }
  run(image: Bitmap): Bitmap {
    return this.#passes.reduce((b, p) => {
      const out = p.apply(b);
      this.log.push(`${p.name} ${out.width}x${out.height} ${out.hash}`);
      return out;
  }, image);
  }
}
