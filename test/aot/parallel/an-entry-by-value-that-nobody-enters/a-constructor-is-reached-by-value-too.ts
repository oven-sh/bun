// A constructor whose written `new` is copied is also reached by Reflect.construct, through `constructor` and out of a list, and called without `new`.
class Part {
  readonly size: number;
  constructor(size: number) {
    this.size = size;
  }
}
const direct = new Part(1);
const viaReflect: any = Reflect.construct(Part, [2]);
const viaConstructor: any = new (direct as any).constructor(3);
const classes: any[] = [Part];
const viaList = new classes[0](4);
console.log(direct.size, viaReflect.size, viaConstructor.size, viaList.size, viaList instanceof Part);
try {
  (Part as any)(5);
} catch (error: any) {
  console.log(error.constructor.name);
}
