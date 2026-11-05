function whole(holder) { Object.freeze(holder); return Object.getOwnPropertyNames(holder); }
const first = Reflect.set, second = Reflect.apply;
console.log(typeof first, typeof second, whole(Reflect).join(" "));
