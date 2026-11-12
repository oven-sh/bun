export const at = import.meta.url;
export const later = () => import.meta.url;
export function hoisted() {
  return import.meta.url;
}
export class Place {
  static at = import.meta.url;
  at = import.meta.url;
}
export const listed = [...(function* () {
  yield import.meta.url;
})()].join();
export const rate = 1;
