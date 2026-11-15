class Base {}
export class Loads extends Base {
  load = new Function("return import(\"./dep.mjs\")")();
}
