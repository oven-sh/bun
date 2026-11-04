export const where = () => import.meta;
export function fail(): never {
  throw new Error("from a leaf");
}
