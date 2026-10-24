export interface Holder {
  size: number;
  pair(): [Uint8Array, Uint8Array];
  count(): number;
}
export function find(name: string): Holder | null;
export const holder: { inner: Holder | null };
