// The first read of a static field through a value of unknown type makes the members of the class, and the run time looks a second time to see what every later read sees. Each Worker reads one field of each of 64 classes so, and terminate() is called as soon as it says that it begins: the request arrives among those reads. Every Worker closes. COUNT says how many.
class Class00 {
  static count = 0;
}
class Class01 {
  static count = 1;
}
class Class02 {
  static count = 2;
}
class Class03 {
  static count = 3;
}
class Class04 {
  static count = 4;
}
class Class05 {
  static count = 5;
}
class Class06 {
  static count = 6;
}
class Class07 {
  static count = 7;
}
class Class08 {
  static count = 8;
}
class Class09 {
  static count = 9;
}
class Class10 {
  static count = 10;
}
class Class11 {
  static count = 11;
}
class Class12 {
  static count = 12;
}
class Class13 {
  static count = 13;
}
class Class14 {
  static count = 14;
}
class Class15 {
  static count = 15;
}
class Class16 {
  static count = 16;
}
class Class17 {
  static count = 17;
}
class Class18 {
  static count = 18;
}
class Class19 {
  static count = 19;
}
class Class20 {
  static count = 20;
}
class Class21 {
  static count = 21;
}
class Class22 {
  static count = 22;
}
class Class23 {
  static count = 23;
}
class Class24 {
  static count = 24;
}
class Class25 {
  static count = 25;
}
class Class26 {
  static count = 26;
}
class Class27 {
  static count = 27;
}
class Class28 {
  static count = 28;
}
class Class29 {
  static count = 29;
}
class Class30 {
  static count = 30;
}
class Class31 {
  static count = 31;
}
class Class32 {
  static count = 32;
}
class Class33 {
  static count = 33;
}
class Class34 {
  static count = 34;
}
class Class35 {
  static count = 35;
}
class Class36 {
  static count = 36;
}
class Class37 {
  static count = 37;
}
class Class38 {
  static count = 38;
}
class Class39 {
  static count = 39;
}
class Class40 {
  static count = 40;
}
class Class41 {
  static count = 41;
}
class Class42 {
  static count = 42;
}
class Class43 {
  static count = 43;
}
class Class44 {
  static count = 44;
}
class Class45 {
  static count = 45;
}
class Class46 {
  static count = 46;
}
class Class47 {
  static count = 47;
}
class Class48 {
  static count = 48;
}
class Class49 {
  static count = 49;
}
class Class50 {
  static count = 50;
}
class Class51 {
  static count = 51;
}
class Class52 {
  static count = 52;
}
class Class53 {
  static count = 53;
}
class Class54 {
  static count = 54;
}
class Class55 {
  static count = 55;
}
class Class56 {
  static count = 56;
}
class Class57 {
  static count = 57;
}
class Class58 {
  static count = 58;
}
class Class59 {
  static count = 59;
}
class Class60 {
  static count = 60;
}
class Class61 {
  static count = 61;
}
class Class62 {
  static count = 62;
}
class Class63 {
  static count = 63;
}
// prettier-ignore
const classes: any[] = [Class00, Class01, Class02, Class03, Class04, Class05, Class06, Class07, Class08, Class09, Class10, Class11, Class12, Class13, Class14, Class15, Class16, Class17, Class18, Class19, Class20, Class21, Class22, Class23, Class24, Class25, Class26, Class27, Class28, Class29, Class30, Class31, Class32, Class33, Class34, Class35, Class36, Class37, Class38, Class39, Class40, Class41, Class42, Class43, Class44, Class45, Class46, Class47, Class48, Class49, Class50, Class51, Class52, Class53, Class54, Class55, Class56, Class57, Class58, Class59, Class60, Class61, Class62, Class63];

if (Bun.isMainThread) {
  const rounds = Number(process.env.COUNT ?? 96);
  let closed = 0;
  const one = async () => {
    const worker = new Worker(new URL(import.meta.url));
    const isClosed = new Promise<void>(resolve => worker.addEventListener("close", () => resolve()));
    await new Promise<void>(resolve => {
      worker.onmessage = () => resolve();
    });
    worker.terminate();
    await isClosed;
    closed++;
  };
  let next = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next++ < rounds) await one();
    }),
  );
  console.log("closed:", closed === rounds);
} else {
  postMessage("begins");
  let sum = 0;
  for (;;) for (const each of classes) sum += each.count;
}
