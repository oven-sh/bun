const printValue = console.log;
interface O2 {}
const v2: boolean = {} as unknown as boolean;
const v5: boolean = {} as unknown as boolean;
const v7: [boolean] = [v5];
printValue("v7", v7);
for (using v8 of v7 as any) {
  v8.c = WeakSet;
  v8.a = v8;
}
