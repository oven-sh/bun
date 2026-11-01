export let name = "first";
export const rename = () => { name = "second"; };
class A { [name]() { return 1; } }
export const read = () => A;
