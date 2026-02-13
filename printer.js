console.log(process.pid);
let i = 0n;
while (true)
  if (++i % 50000000n == 0n)
    console.log(i);

