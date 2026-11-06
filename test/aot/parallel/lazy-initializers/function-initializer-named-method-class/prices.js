import { column } from "./tables.js";
const nothing = () => ({ low: 1 });
export const prices = column("prices", nothing);
export class NeverMade {
  take() {
    return nothing;
  }
}
