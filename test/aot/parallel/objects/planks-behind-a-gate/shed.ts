import * as yard from "./gate";
import Wood = yard.Wood;

export function shelf(): string {
  const wide: Wood.Plank = { width: Wood.double(7) };
  return `${Wood.kind} ${wide.width}`;
}
