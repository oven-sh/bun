// What enters the variable is an instance of a class, a function, an array or a Map, none of which has the required property.
interface Meta { sign: string[] | true; secrets?: string }
class Other { path = "/"; }
function compose(value: any): string {
  const meta: Meta = value;
  if (meta.sign) return "signed";
  meta.secrets = "none";
  return "plain " + (value as any).secrets + " " + (meta === value);
}
console.log(compose(new Other()));
console.log(compose(function named() {}));
console.log(compose([1, 2]));
console.log(compose(new Map()));
