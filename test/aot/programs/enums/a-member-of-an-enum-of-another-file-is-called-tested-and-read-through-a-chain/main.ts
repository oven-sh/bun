import { Color } from "./color";
try {
  (Color.Green as any)();
} catch (e) {
  console.log((e as Error).constructor.name);
}
console.log(typeof Color.Green, Color?.Green, (Color as any).Missing, (Color.Green as number).toFixed(1));
