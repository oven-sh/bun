export let current = [1, 2, 3];
export function become(value) {
  current = value;
}
export { current as alias };
export default current;
