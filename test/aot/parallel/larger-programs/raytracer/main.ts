// Spheres, planes and boxes, lights, reflection, a scene graph with transforms, images printed as characters, in two modules
import { Vec, Ray, Material, Shape, Sphere, Plane, Box, Group, Scene, Camera, Image } from "./lib";
const paint = (r: number, g: number, b: number, shine = 0,
  mirror = 0): Material => ({ color: new Vec(r, g, b), shine, mirror });
const root = new Group("all").add(new Plane(new Vec(0, 1, 0), -1, { ...paint(0.9, 0.9, 0.9),
  checker: new Vec(0.2, 0.2, 0.25) }), new Group("balls").add(...Array.from({ length: 6 }, (_,
  i) => new Sphere(new Vec(i * 1.3 - 3.2, Math.sin(i) * 0.4, 4 + (i % 3)), 0.6 + (i % 2) * 0.2,
  paint(0.3 + i * 0.1, 0.9 - i * 0.1, 0.5, 20, i % 2 ? 0.4 : 0)))),
  new Group("boxes").add(new Box(new Vec(-1, -1, 6), new Vec(0.5, 0.2, 7), paint(0.8, 0.3, 0.2,
  5, 0.1))));
const scene = new Scene(root, [{ kind: "ambient", level: 0.15 }, { kind: "sun",
  to: new Vec(0.4, 1, -0.6).unit(), level: 0.6 }, { kind: "lamp", at: new Vec(-2, 3, 1),
  level: 0.7, reach: 12 }], to => new Vec(0.4, 0.6, 1).mul(0.5 + 0.5 * Math.max(0, to.y)));
for (const [w, h, samples] of [[48, 32, 1], [96, 64, 1], [90, 60, 4]]) {
  const image = Image.render(scene, new Camera(new Vec(0, 0.8, -2), new Vec(0, 0, 5), 1.4), w,
    h, samples);
  console.log(image.hash, scene.rays, Shape.tests);
  if (w === 48) console.log(image.text(1));
}
console.log(JSON.stringify(root.count()), Vec.made, String(scene.trace(new Ray(Vec.zero,
  new Vec(0, 0, 1)), 2)));
