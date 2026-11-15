class Light {
  static #on = 1;
  static raise(by: number) { return Light.#on += by; }
}
namespace Light {
  export enum Color { Red, Green }
}
console.log(Light.Color.Green, Light.raise(Number(process.argv[2] ?? 3)));
export {};
