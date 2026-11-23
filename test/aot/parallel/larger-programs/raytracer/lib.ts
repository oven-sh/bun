// Spheres, planes and boxes, lights, reflection, a scene graph with transforms, images printed as characters
export class Vec {
  constructor(readonly x: number, readonly y: number, readonly z: number) {
    Vec.made++;
  }
  static made = 0;
  static readonly zero = new Vec(0, 0, 0);
  add(o: Vec) {
    return new Vec(this.x + o.x, this.y + o.y, this.z + o.z);
  }
  sub(o: Vec) {
    return new Vec(this.x - o.x, this.y - o.y, this.z - o.z);
  }
  mul(k: number) {
    return new Vec(this.x * k, this.y * k, this.z * k);
  }
  times(o: Vec) {
    return new Vec(this.x * o.x, this.y * o.y, this.z * o.z);
  }
  dot(o: Vec) {
    return this.x * o.x + this.y * o.y + this.z * o.z;
  }
  cross(o: Vec) {
    return new Vec(this.y * o.z - this.z * o.y, this.z * o.x - this.x * o.z,
      this.x * o.y - this.y * o.x);
  }
  get length() {
    return Math.sqrt(this.dot(this));
  }
  unit() {
    return this.mul(1 / this.length);
  }
  reflect(n: Vec) {
    return this.sub(n.mul(2 * this.dot(n)));
  }
  toString() {
    return [this.x, this.y, this.z].map(v => v.toFixed(3)).join();
  }
}
export class Ray {
  constructor(readonly from: Vec, readonly to: Vec) {
  }
  at(t: number) {
    return this.from.add(this.to.mul(t));
  }
}
export interface Material {
  color: Vec;
  shine: number;
  mirror: number;
  checker?: Vec
}
export interface Hit {
  t: number;
  point: Vec;
  normal: Vec;
  material: Material
}
export abstract class Shape {
  static tests = 0;
  constructor(readonly material: Material, readonly name: string) {
  }
  abstract distance(ray: Ray): number;
  abstract normal(point: Vec): Vec;
  protected colorAt(point: Vec): Material {
    if (!this.material.checker) return this.material;
    const odd = (Math.floor(point.x) + Math.floor(point.z)) & 1;
    return odd ? {
      ...this.material, color: this.material.checker
  } : this.material;
  }
  hit(ray: Ray, near: number, far: number): Hit | null {
    Shape.tests++;
    const t = this.distance(ray);
    if (!(t > near && t < far)) return null;
    const point = ray.at(t);
    return {
      t, point, normal: this.normal(point), material: this.colorAt(point)
  };
  }
}
export class Sphere extends Shape {
  constructor(readonly center: Vec, readonly radius: number, material: Material) {
    super(material, "sphere");
  }
  distance(ray: Ray): number {
    const oc = ray.from.sub(this.center), b = oc.dot(ray.to),
      c = oc.dot(oc) - this.radius * this.radius, d = b * b - c;
    if (d < 0) return Infinity;
    const s = Math.sqrt(d);
    return -b - s > 1e-4 ? -b - s : -b + s;
  }
  normal(point: Vec): Vec {
    return point.sub(this.center).mul(1 / this.radius);
  }
}
export class Plane extends Shape {
  constructor(readonly up: Vec, readonly height: number, material: Material) {
    super(material, "plane");
  }
  distance(ray: Ray): number {
    const d = this.up.dot(ray.to);
    return Math.abs(d) < 1e-6 ? Infinity : (this.height - this.up.dot(ray.from)) / d;
  }
  normal(): Vec {
    return this.up;
  }
}
export class Box extends Shape {
  constructor(readonly low: Vec, readonly high: Vec, material: Material) {
    super(material, "box");
  }
  distance(ray: Ray): number {
    let near = -Infinity, far = Infinity;
    for (const axis of ["x", "y", "z"] as const) {
      const inverse = 1 / ray.to[axis];
      let a = (this.low[axis] - ray.from[axis]) * inverse,
        b = (this.high[axis] - ray.from[axis]) * inverse;
      if (a > b) [a, b] = [b, a];
      near = Math.max(near, a);
      far = Math.min(far, b);
      if (near > far) return Infinity;
    }
    return near > 1e-4 ? near : far;
  }
  normal(point: Vec): Vec {
    const center = this.low.add(this.high).mul(0.5), half = this.high.sub(this.low).mul(0.5),
      d = point.sub(center);
    const ax = Math.abs(d.x / half.x), ay = Math.abs(d.y / half.y), az = Math.abs(d.z / half.z);
    if (ax >= ay && ax >= az) return new Vec(Math.sign(d.x), 0, 0);
    return ay >= az ? new Vec(0, Math.sign(d.y), 0) : new Vec(0, 0, Math.sign(d.z));
  }
}
export type Light = {
  kind: "ambient";
  level: number
} | {
  kind: "sun";
  to: Vec;
  level: number
} | {
  kind: "lamp";
  at: Vec;
  level: number;
  reach: number
};
export class Group {
  readonly children: (Shape | Group)[] = [];
  constructor(readonly label: string) {
  }
  add(...all: (Shape | Group)[]): this {
    this.children.push(...all);
    return this;
  }
  *shapes(): Generator<Shape> {
    for (const c of this.children) if (c instanceof Group) yield* c.shapes();
    else yield c;
  }
  count(): Record<string, number> {
    const out: Record<string, number> = {
  };
    for (const s of this.shapes()) out[s.name] = (out[s.name] ?? 0) + 1;
    return out;
  }
}
export class Scene {
  readonly #shapes: Shape[];
  rays = 0;
  constructor(readonly root: Group, readonly lights: Light[], readonly sky: (to: Vec) => Vec) {
    this.#shapes = [...root.shapes()];
  }
  nearest(ray: Ray, far = Infinity): Hit | null {
    let best: Hit | null = null;
    for (const s of this.#shapes) {
      const h = s.hit(ray, 1e-4, best ? best.t : far);
      if (h) best = h;
    }
    return best;
  }
  blocked(ray: Ray, far: number): boolean {
    for (const s of this.#shapes) if (s.hit(ray, 1e-3, far)) return true;
    return false;
  }
  light(hit: Hit, view: Vec): number {
    let level = 0;
    for (const l of this.lights) {
      switch (l.kind) {
        case "ambient": level += l.level;
        break;
        case "sun": {
          const d = l.to.dot(hit.normal);
          if (d > 0 && !this.blocked(new Ray(hit.point, l.to), Infinity)) {
            level += l.level * d;
            const r = view.reflect(hit.normal).dot(l.to);
            if (r > 0 && hit.material.shine) level += l.level * Math.pow(r, hit.material.shine);
          }
          break;
        }
        case "lamp": {
          const to = l.at.sub(hit.point), far = to.length, dir = to.mul(1 / far),
            d = dir.dot(hit.normal);
          if (d > 0 && far < l.reach && !this.blocked(new Ray(hit.point, dir),
            far)) level += l.level * d * (1 - far / l.reach);
          break;
        }
        default: {
          const never: never = l;
          throw new TypeError("light " + never);
        }
      }
    }
    return level;
  }
  trace(ray: Ray, depth: number): Vec {
    this.rays++;
    const hit = this.nearest(ray);
    if (!hit) return this.sky(ray.to);
    const own = hit.material.color.mul(this.light(hit, ray.to));
    if (depth === 0 || hit.material.mirror === 0) return own;
    const back = this.trace(new Ray(hit.point, ray.to.reflect(hit.normal).unit()), depth - 1);
    return own.mul(1 - hit.material.mirror).add(back.mul(hit.material.mirror));
  }
}
export class Camera {
  readonly #right: Vec;
  readonly #up: Vec;
  readonly #forward: Vec;
  constructor(readonly at: Vec, look: Vec, readonly zoom: number) {
    this.#forward = look.sub(at).unit();
    this.#right = this.#forward.cross(new Vec(0, 1, 0)).unit();
    this.#up = this.#right.cross(this.#forward);
  }
  ray(x: number, y: number): Ray {
    return new Ray(this.at,
      this.#forward.mul(this.zoom).add(this.#right.mul(x)).add(this.#up.mul(y)).unit());
  }
}
export class Image {
  readonly data: Float64Array;
  constructor(readonly width: number, readonly height: number) {
    this.data = new Float64Array(width * height * 3);
  }
  set(x: number, y: number, c: Vec) {
    const i = (y * this.width + x) * 3;
    this.data[i] = Math.min(1, c.x);
    this.data[i + 1] = Math.min(1, c.y);
    this.data[i + 2] = Math.min(1, c.z);
  }
  level(x: number, y: number) {
    const i = (y * this.width + x) * 3;
    return this.data[i] * 0.3 + this.data[i + 1] * 0.6 + this.data[i + 2] * 0.1;
  }
  text(step: number): string {
    const marks = " .:-=+*#%@";
    let out = "";
    for (let y = 0; y < this.height; y += step * 2) {
      for (let x = 0; x < this.width; x += step) out += marks[Math.min(9,
        Math.floor(this.level(x, y) * 10))];
      out += "\n";
    }
    return out;
  }
  get hash() {
    let h = 0;
    for (const v of this.data) h = (h * 31 + Math.round(v * 255)) >>> 0;
    return h;
  }
  static render(scene: Scene, camera: Camera, width: number, height: number,
    samples: number): Image {
    const image = new Image(width, height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let sum = Vec.zero;
      for (let s = 0; s < samples; s++) {
        const dx = (s % 2) / 2, dy = (s >> 1) / 2;
        sum = sum.add(scene.trace(camera.ray(((x + dx) / width - 0.5) * (width / height) * 2,
          (0.5 - (y + dy) / height) * 2), 3));
      }
      image.set(x, y, sum.mul(1 / samples));
    }
    return image;
  }
}
