declare const config: { flat: string };
export function read() {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return config["flat"] + ":" + (config["flat"] === "built" ? "decided" : "left") + ":" + work;
}
