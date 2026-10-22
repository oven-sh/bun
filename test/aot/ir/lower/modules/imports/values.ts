export const one = 1;
export let counter = 0;

export function bump() {
  counter++;
}

export default "text";

export * as nested from "./nested";
