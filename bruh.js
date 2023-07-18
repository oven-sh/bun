// https://github.com/nodejs/node/issues/34493

let fn = () => new Promise(resolve => setTimeout(resolve, 2));

let runWithExpiry = async (expiry, fn) => {
  let iterations = 0;
  while (Date.now() < expiry) {
    await fn();
    iterations++;
  }
  return iterations;
};

async function main() {
  print(`Performed ${await runWithExpiry(Date.now() + 500, fn)} iterations to warmup`);

  let withoutAls = await runWithExpiry(Date.now() + 1000000, fn);
  print(`Performed ${withoutAls} iterations (with ALS disabled)`);

  // let withAls;
  // await asyncLocalStorage.run({}, async () => {
  //   withAls = await runWithExpiry(Date.now() + 10000, fn);
  //   console.log(`Performed ${withAls} iterations (with ALS enabled)`);
  // });

  // console.log("ALS penalty: " + Math.round((1 - withAls / withoutAls) * 10000) / 100 + "%");
  print("done");
}

main();
