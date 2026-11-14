const above: any = { over: 7 };
const made: any = Object.create(above);
made.over = 1;
const copy = { ...(Object as any) };
console.log(Object.keys(copy).length, Reflect.ownKeys(Object).join());
