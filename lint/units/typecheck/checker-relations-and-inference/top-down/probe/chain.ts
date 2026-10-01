declare let s: { a: { b: { c: string } } };
declare let t: { a: { b: { c: number } } };
t = s;
declare let s2: { m: () => { "x-y": string } };
declare let t2: { m: () => { "x-y": number } };
t2 = s2;
declare let s3: { k: new (p: number) => { z: string } };
declare let t3: { k: new (p: number) => { z: number } };
t3 = s3;
